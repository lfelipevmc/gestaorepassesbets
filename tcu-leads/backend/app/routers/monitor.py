from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import date, datetime

from ..database import get_db
from ..models import TcuLead, TcuMonitorRun, TcuLeadStatus
from ..models.process import TrackedProcess
from ..models.user import User
from ..schemas import SettingsOut, SettingsUpdate, RunOut, IngestText
from ..core.auth import get_current_user
from ..services import pipeline

router = APIRouter(prefix="/api/monitor", tags=["monitor"])


@router.get("/stats")
def stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(TcuLead).count()
    novos = db.query(TcuLead).filter(TcuLead.status == TcuLeadStatus.novo).count()
    oportunidades = db.query(TcuLead).filter(TcuLead.is_opportunity.is_(True)).count()
    em_atendimento = db.query(TcuLead).filter(TcuLead.status == TcuLeadStatus.em_atendimento).count()

    today = date.today()
    prazos = (
        db.query(TcuLead)
        .filter(TcuLead.prazo_final.isnot(None), TcuLead.prazo_final >= today,
                TcuLead.status != TcuLeadStatus.descartado)
        .order_by(TcuLead.prazo_final.asc()).limit(10).all()
    )

    by_type = dict(db.query(TcuLead.act_type, func.count(TcuLead.id)).group_by(TcuLead.act_type).all())
    by_tema = dict(db.query(TcuLead.tema, func.count(TcuLead.id))
                   .filter(TcuLead.tema.isnot(None)).group_by(TcuLead.tema).all())
    by_status = dict(db.query(TcuLead.status, func.count(TcuLead.id)).group_by(TcuLead.status).all())
    valor_total = db.query(func.coalesce(func.sum(TcuLead.valor_debito), 0)).scalar() or 0

    autuados_hoje = db.query(TrackedProcess).filter(TrackedProcess.detection_date == today).count()
    processos_total = db.query(TrackedProcess).count()

    last_run = db.query(TcuMonitorRun).order_by(TcuMonitorRun.started_at.desc()).first()

    return {
        "total": total, "novos": novos, "oportunidades": oportunidades,
        "em_atendimento": em_atendimento, "valor_total_debito": float(valor_total),
        "autuados_hoje": autuados_hoje, "processos_total": processos_total,
        "by_type": {(k.value if hasattr(k, "value") else str(k)): v for k, v in by_type.items()},
        "by_tema": by_tema,
        "by_status": {(k.value if hasattr(k, "value") else str(k)): v for k, v in by_status.items()},
        "prazos_proximos": [
            {"id": l.id, "responsavel": l.responsavel_nome, "processo": l.numero_processo,
             "prazo_final": l.prazo_final.isoformat() if l.prazo_final else None,
             "dias_restantes": (l.prazo_final - today).days if l.prazo_final else None}
            for l in prazos
        ],
        "last_run": {
            "id": last_run.id, "status": last_run.status.value,
            "finished_at": last_run.finished_at.isoformat() if last_run and last_run.finished_at else None,
            "leads_created": last_run.leads_created,
        } if last_run else None,
    }


def _run_bg(trigger: str, user_id: int):
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        pipeline.run_pipeline(db, trigger=trigger, user_id=user_id)
    finally:
        db.close()


@router.post("/run")
def run_now(background_tasks: BackgroundTasks, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user)):
    background_tasks.add_task(_run_bg, "manual", current_user.id)
    return {"message": "Coleta iniciada em segundo plano. Acompanhe em Configuração → Execuções."}


@router.post("/ingest/text")
def ingest_text(data: IngestText, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return pipeline.ingest_text(db, data.text, publication=data.publication_date, user_id=current_user.id)


@router.post("/ingest/pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    publication_date: Optional[str] = Form(None),
    source_codigo: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Envie um arquivo PDF.")
    content = await file.read()
    pub = None
    if publication_date:
        try:
            pub = datetime.strptime(publication_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "publication_date deve estar em AAAA-MM-DD.")
    return pipeline.ingest_pdf(db, content, publication=pub, source_codigo=source_codigo, user_id=current_user.id)


@router.get("/runs", response_model=List[RunOut])
def list_runs(limit: int = 20, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(TcuMonitorRun).order_by(TcuMonitorRun.started_at.desc()).limit(min(limit, 100)).all()


@router.post("/cleanup-noise")
def cleanup_noise(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove leads de baixo valor (acórdãos da API sem responsável identificado)."""
    result = pipeline.cleanup_noise(db)
    return {"message": f"{result['removed']} lead(s) de acórdão sem parte foram removidos.", **result}


@router.post("/test-source/processos")
def test_source_processos(data: dict = None, db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    """Testa a fonte de processos configurada, a partir DO SERVIDOR (que alcança
    o TCU), e devolve um diagnóstico com status, contagem e amostra dos campos."""
    from ..services import sources as src
    settings = pipeline.get_settings(db)
    client = pipeline._client(settings)
    data_str = (data or {}).get("data")   # AAAA-MM-DD opcional
    try:
        return src.probe_processos_source(client, settings, data_str=data_str)
    except Exception as e:
        import logging, traceback
        logging.getLogger(__name__).warning(f"probe processos falhou: {e}\n{traceback.format_exc()}")
        return {"status": "erro", "error": f"Exceção no teste: {e}"}
    finally:
        try:
            client.close()
        except Exception:
            pass


@router.post("/clear-autuados-source")
def clear_autuados_source(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove uma URL customizada antiga de listagem de autuados, voltando a usar
    a Pesquisa Integrada padrão do TCU."""
    s = pipeline.get_settings(db)
    s.autuados_listing_url = None
    s.autuados_listing_body = None
    s.autuados_listing_method = "GET"
    db.commit()
    return {"ok": True, "message": "Fonte customizada removida. Usando a Pesquisa Integrada padrão."}


@router.get("/settings", response_model=SettingsOut)
def get_settings_endpoint(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return pipeline.get_settings(db)


@router.patch("/settings", response_model=SettingsOut)
def update_settings(data: SettingsUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = pipeline.get_settings(db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    try:
        from ..services.scheduler import reschedule_job
        reschedule_job(s)
    except Exception:
        pass
    return s
