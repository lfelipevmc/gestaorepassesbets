from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal

from ..database import get_db
from ..models.tcu import (
    TcuLead, TcuLeadNote, TcuCnpjEnrichment, TcuMonitorRun, TcuMonitorSettings,
    TcuActType, TcuDocType, TcuLeadStatus, TcuSourceKind, TcuRunStatus,
)
from ..models.user import User
from ..schemas.tcu import (
    TcuLeadOut, TcuLeadDetail, TcuLeadUpdate, TcuLeadNoteCreate, TcuLeadNoteOut,
    TcuSettingsOut, TcuSettingsUpdate, TcuRunOut, TcuIngestText,
)
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from ..services import tcu_pipeline

router = APIRouter(prefix="/api/tcu", tags=["tcu"])


# --------------------------------------------------------------------------- #
# Leads — lista filtrável
# --------------------------------------------------------------------------- #

@router.get("/leads", response_model=List[TcuLeadOut])
def list_leads(
    act_type: Optional[TcuActType] = None,
    tema: Optional[str] = None,
    status: Optional[TcuLeadStatus] = None,
    doc_type: Optional[TcuDocType] = None,
    uf: Optional[str] = None,
    source_kind: Optional[TcuSourceKind] = None,
    valor_min: Optional[float] = None,
    valor_max: Optional[float] = None,
    only_opportunities: bool = False,
    hide_represented: bool = False,
    search: Optional[str] = Query(None),
    order_by: str = Query("score", pattern="^(score|recent|deadline|valor)$"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(TcuLead)
    if act_type:
        q = q.filter(TcuLead.act_type == act_type)
    if tema:
        q = q.filter(TcuLead.tema == tema)
    if status:
        q = q.filter(TcuLead.status == status)
    if doc_type:
        q = q.filter(TcuLead.doc_type == doc_type)
    if uf:
        q = q.filter(TcuLead.uf == uf.upper())
    if source_kind:
        q = q.filter(TcuLead.source_kind == source_kind)
    if valor_min is not None:
        q = q.filter(func.coalesce(TcuLead.valor_debito, TcuLead.valor_multa, 0) >= Decimal(str(valor_min)))
    if valor_max is not None:
        q = q.filter(func.coalesce(TcuLead.valor_debito, TcuLead.valor_multa, 0) <= Decimal(str(valor_max)))
    if only_opportunities:
        q = q.filter(TcuLead.is_opportunity.is_(True))
    if hide_represented:
        q = q.filter(TcuLead.ja_representado.is_(False))
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            TcuLead.responsavel_nome.ilike(like),
            TcuLead.responsavel_documento.ilike(like),
            TcuLead.numero_processo.ilike(like),
            TcuLead.orgao_entidade.ilike(like),
            TcuLead.resumo.ilike(like),
        ))

    if order_by == "recent":
        q = q.order_by(TcuLead.created_at.desc())
    elif order_by == "deadline":
        q = q.order_by(TcuLead.prazo_final.is_(None), TcuLead.prazo_final.asc())
    elif order_by == "valor":
        q = q.order_by(func.coalesce(TcuLead.valor_debito, TcuLead.valor_multa, 0).desc())
    else:  # score
        q = q.order_by(TcuLead.opportunity_score.desc().nullslast(), TcuLead.created_at.desc())

    return q.offset(skip).limit(min(limit, 300)).all()


@router.get("/leads/{lead_id}", response_model=TcuLeadDetail)
def get_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    return lead


@router.patch("/leads/{lead_id}", response_model=TcuLeadDetail)
def update_lead(lead_id: int, data: TcuLeadUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(require_office)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")

    changes = data.model_dump(exclude_none=True)
    old_status = lead.status
    for k, v in changes.items():
        setattr(lead, k, v)

    # trilha automática de mudança de status
    if "status" in changes and changes["status"] != old_status:
        db.add(TcuLeadNote(
            lead_id=lead.id, author_id=current_user.id, kind="status_change",
            body=f"Status alterado de '{old_status.value}' para '{lead.status.value}'.",
        ))

    db.commit()
    db.refresh(lead)
    log_action(db=db, action="TCU_LEAD_UPDATE", entity_type="TcuLead", entity_id=lead_id,
               new_values={k: str(v) for k, v in changes.items()}, user_id=current_user.id)
    return lead


@router.post("/leads/{lead_id}/notes", response_model=TcuLeadNoteOut)
def add_note(lead_id: int, data: TcuLeadNoteCreate, db: Session = Depends(get_db),
             current_user: User = Depends(require_office)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    note = TcuLeadNote(lead_id=lead_id, author_id=current_user.id, kind=data.kind, body=data.body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.post("/leads/{lead_id}/enrich")
def enrich_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    """Enriquece o lead (apenas PJ/CNPJ — CPF não é enriquecido, por conformidade LGPD)."""
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    if lead.doc_type != TcuDocType.cnpj:
        raise HTTPException(400, "Enriquecimento disponível apenas para responsáveis PJ (CNPJ).")
    settings = tcu_pipeline.get_settings(db)
    client = tcu_pipeline._client(settings)
    enr = tcu_pipeline.enrich_lead_cnpj(db, lead, client, cache_days=int(settings.enrich_cache_days or 40))
    db.commit()
    if not enr:
        raise HTTPException(502, "Não foi possível enriquecer o CNPJ (serviço indisponível ou CNPJ inválido).")
    log_action(db=db, action="TCU_LEAD_ENRICH", entity_type="TcuLead", entity_id=lead_id, user_id=current_user.id)
    return {"ok": True, "enrichment_id": enr.id}


# --------------------------------------------------------------------------- #
# Dashboard / estatísticas
# --------------------------------------------------------------------------- #

@router.get("/stats")
def stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = db.query(TcuLead).count()
    novos = db.query(TcuLead).filter(TcuLead.status == TcuLeadStatus.novo).count()
    oportunidades = db.query(TcuLead).filter(TcuLead.is_opportunity.is_(True)).count()
    em_atendimento = db.query(TcuLead).filter(TcuLead.status == TcuLeadStatus.em_atendimento).count()

    # prazos vencendo em 5 dias (não descartados)
    today = date.today()
    prazos = (
        db.query(TcuLead)
        .filter(TcuLead.prazo_final.isnot(None), TcuLead.prazo_final >= today,
                TcuLead.status != TcuLeadStatus.descartado)
        .order_by(TcuLead.prazo_final.asc()).limit(10).all()
    )

    by_type = dict(
        db.query(TcuLead.act_type, func.count(TcuLead.id)).group_by(TcuLead.act_type).all()
    )
    by_tema = dict(
        db.query(TcuLead.tema, func.count(TcuLead.id)).filter(TcuLead.tema.isnot(None))
        .group_by(TcuLead.tema).all()
    )
    by_status = dict(
        db.query(TcuLead.status, func.count(TcuLead.id)).group_by(TcuLead.status).all()
    )
    valor_total = db.query(func.coalesce(func.sum(TcuLead.valor_debito), 0)).scalar() or 0

    last_run = db.query(TcuMonitorRun).order_by(TcuMonitorRun.started_at.desc()).first()

    return {
        "total": total,
        "novos": novos,
        "oportunidades": oportunidades,
        "em_atendimento": em_atendimento,
        "valor_total_debito": float(valor_total),
        "by_type": {k.value if hasattr(k, "value") else str(k): v for k, v in by_type.items()},
        "by_tema": by_tema,
        "by_status": {k.value if hasattr(k, "value") else str(k): v for k, v in by_status.items()},
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


# --------------------------------------------------------------------------- #
# Execução do pipeline / ingestão
# --------------------------------------------------------------------------- #

def _run_pipeline_bg(trigger: str, user_id: int):
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        tcu_pipeline.run_pipeline(db, trigger=trigger, user_id=user_id)
    finally:
        db.close()


@router.post("/run")
def run_now(background_tasks: BackgroundTasks, db: Session = Depends(get_db),
            current_user: User = Depends(require_office)):
    """Dispara o pipeline manualmente (em segundo plano)."""
    background_tasks.add_task(_run_pipeline_bg, "manual", current_user.id)
    return {"message": "Coleta iniciada em segundo plano. Acompanhe em Configuração → Execuções."}


@router.post("/ingest/text")
def ingest_text(data: TcuIngestText, db: Session = Depends(get_db),
                current_user: User = Depends(require_office)):
    """Ingestão manual do texto de um caderno do Diário/BTCU (contorna a lacuna
    do endpoint de listagem e serve para backfill)."""
    result = tcu_pipeline.ingest_text(db, data.text, publication=data.publication_date,
                                      user_id=current_user.id)
    return result


@router.post("/ingest/pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    publication_date: Optional[str] = Form(None),
    source_codigo: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office),
):
    """Ingestão manual de um PDF do BTCU (caderno Deliberações)."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Envie um arquivo PDF.")
    content = await file.read()
    pub = None
    if publication_date:
        try:
            pub = datetime.strptime(publication_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "publication_date deve estar em AAAA-MM-DD.")
    return tcu_pipeline.ingest_pdf(db, content, publication=pub, source_codigo=source_codigo,
                                   user_id=current_user.id)


@router.get("/runs", response_model=List[TcuRunOut])
def list_runs(limit: int = 20, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    return db.query(TcuMonitorRun).order_by(TcuMonitorRun.started_at.desc()).limit(min(limit, 100)).all()


# --------------------------------------------------------------------------- #
# Configuração
# --------------------------------------------------------------------------- #

@router.get("/settings", response_model=TcuSettingsOut)
def get_settings_endpoint(db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    return tcu_pipeline.get_settings(db)


@router.patch("/settings", response_model=TcuSettingsOut)
def update_settings(data: TcuSettingsUpdate, db: Session = Depends(get_db),
                    current_user: User = Depends(require_office)):
    settings = tcu_pipeline.get_settings(db)
    changes = data.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(settings, k, v)
    db.commit()
    db.refresh(settings)
    # reagenda o job diário conforme novo horário/estado
    try:
        from ..services.scheduler import reschedule_tcu_job
        reschedule_tcu_job(settings)
    except Exception:
        pass
    log_action(db=db, action="TCU_SETTINGS_UPDATE", entity_type="TcuMonitorSettings", entity_id=1,
               new_values={k: str(v) for k, v in changes.items()}, user_id=current_user.id)
    return settings
