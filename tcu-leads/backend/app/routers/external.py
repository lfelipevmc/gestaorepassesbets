"""
Radar Externo — API de fontes web/RSS e do DOU.

Permite ao escritório cadastrar fontes (embaixadas, estatais, grandes empresas),
testá-las a partir do servidor (que alcança a internet, ao contrário do ambiente
de desenvolvimento) e disparar a coleta manualmente.
"""
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime

from ..database import get_db
from ..models import MonitoredSource
from ..models.user import User
from ..schemas import MonitoredSourceCreate, MonitoredSourceUpdate, MonitoredSourceOut
from ..core.auth import get_current_user
from ..services import pipeline
from ..services.external import pipeline as ext_pipeline
from ..services.external import dou as dou_src
from ..services.external import web as web_src
from ..services.external import classifier

router = APIRouter(prefix="/api/external", tags=["external"])


# --------------------------------------------------------------------------- #
# CRUD de fontes monitoradas
# --------------------------------------------------------------------------- #

@router.get("/sources", response_model=List[MonitoredSourceOut])
def list_sources(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(MonitoredSource).order_by(MonitoredSource.created_at.desc()).all()


@router.post("/sources", response_model=MonitoredSourceOut)
def create_source(data: MonitoredSourceCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    src = MonitoredSource(**data.model_dump())
    db.add(src)
    db.commit()
    db.refresh(src)
    return src


@router.patch("/sources/{source_id}", response_model=MonitoredSourceOut)
def update_source(source_id: int, data: MonitoredSourceUpdate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    src = db.query(MonitoredSource).get(source_id)
    if not src:
        raise HTTPException(404, "Fonte não encontrada")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(src, k, v)
    db.commit()
    db.refresh(src)
    return src


@router.delete("/sources/{source_id}")
def delete_source(source_id: int, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    src = db.query(MonitoredSource).get(source_id)
    if not src:
        raise HTTPException(404, "Fonte não encontrada")
    db.delete(src)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Testes (executados a partir do servidor)
# --------------------------------------------------------------------------- #

def _preview(items: list[dict], user_keywords: list[str], categoria_padrao: Optional[str],
             limit: int = 12) -> dict:
    """Classifica uma amostra e resume o que viraria lead."""
    sample = []
    opp = 0
    for it in items[:limit]:
        cls = classifier.classify_item(
            it.get("title", ""), it.get("body", ""),
            user_keywords=user_keywords, categoria_padrao=categoria_padrao)
        if cls["is_opportunity"]:
            opp += 1
        sample.append({
            "title": it.get("title"), "url": it.get("url"),
            "categoria": cls["categoria"], "is_opportunity": cls["is_opportunity"],
            "score": cls["score"], "keywords": cls["keywords"],
            "orgao": cls["orgao"], "documentos": cls["documentos"],
        })
    return {"total_itens": len(items), "oportunidades_na_amostra": opp, "amostra": sample}


@router.post("/test-source")
def test_source(data: dict, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    """Testa uma fonte web/RSS ad-hoc: {kind, url, item_selector?, keywords?, categoria_padrao?}."""
    kind = (data.get("kind") or "rss").strip()
    url = (data.get("url") or "").strip()
    if not url:
        raise HTTPException(400, "Informe a URL da fonte.")
    item_selector = data.get("item_selector") or None
    user_keywords = ext_pipeline._split_keywords(data.get("keywords"))
    categoria_padrao = data.get("categoria_padrao") or None
    try:
        items = web_src.fetch_source_items(kind, url, item_selector=item_selector)
    except Exception as e:
        return {"status": "erro", "error": str(e), "total_itens": 0, "amostra": []}
    if not items:
        return {"status": "vazio",
                "error": "Nenhum item foi lido (URL inacessível do servidor, feed inválido "
                         "ou seletor CSS que não casou). Para páginas HTML, informe um seletor CSS.",
                "total_itens": 0, "amostra": []}
    return {"status": "ok", **_preview(items, user_keywords, categoria_padrao)}


@router.post("/sources/{source_id}/test")
def test_saved_source(source_id: int, db: Session = Depends(get_db),
                      current_user: User = Depends(get_current_user)):
    src = db.query(MonitoredSource).get(source_id)
    if not src:
        raise HTTPException(404, "Fonte não encontrada")
    user_keywords = ext_pipeline._split_keywords(src.keywords)
    try:
        items = web_src.fetch_source_items(src.kind or "rss", src.url, item_selector=src.item_selector)
    except Exception as e:
        return {"status": "erro", "error": str(e), "total_itens": 0, "amostra": []}
    if not items:
        return {"status": "vazio",
                "error": "Nenhum item foi lido. Verifique a URL/seletor.",
                "total_itens": 0, "amostra": []}
    return {"status": "ok", **_preview(items, user_keywords, src.categoria_padrao)}


@router.post("/test-dou")
def test_dou(data: dict = None, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    """Testa a leitura do DOU a partir do servidor. Body opcional: {data, secoes, keywords}."""
    data = data or {}
    settings = pipeline.get_settings(db)
    secoes = ext_pipeline._split_keywords(data.get("secoes") or getattr(settings, "dou_secoes", None) or "do1,do3")
    keywords = ext_pipeline._split_keywords(data.get("keywords") or getattr(settings, "dou_keywords", None))
    dia = date.today()
    if data.get("data"):
        try:
            dia = datetime.strptime(data["data"], "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(400, "data deve estar em AAAA-MM-DD.")
    items, diag = dou_src.fetch_dou(secoes, dia)
    if not items:
        return {"status": "vazio", "diag": diag, "total_itens": 0, "amostra": []}
    return {"status": "ok", "diag": diag, **_preview(items, keywords, None, limit=15)}


# --------------------------------------------------------------------------- #
# Execução manual do Radar Externo
# --------------------------------------------------------------------------- #

def _run_bg():
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        settings = pipeline.get_settings(db)
        ext_pipeline.run_external(db, settings)
    finally:
        db.close()


@router.post("/run")
def run_now(background_tasks: BackgroundTasks, db: Session = Depends(get_db),
            current_user: User = Depends(get_current_user)):
    background_tasks.add_task(_run_bg)
    return {"message": "Coleta do Radar Externo iniciada em segundo plano."}


@router.post("/presets")
def add_presets(seed_dou: bool = True, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    """Adiciona as fontes sugeridas (embaixadas, estatais, portais de contratação)
    e, opcionalmente, semeia as palavras-chave jurídicas no DOU."""
    from ..services.external import presets
    res = presets.apply_presets(db, MonitoredSource)
    if seed_dou:
        settings = pipeline.get_settings(db)
        atuais = settings.dou_keywords or ""
        existentes = {l.strip().lower() for l in atuais.replace(",", "\n").splitlines() if l.strip()}
        novas = [k for k in presets.DOU_KEYWORDS_JURIDICO if k.lower() not in existentes]
        if novas:
            settings.dou_keywords = "\n".join([atuais.strip()] + novas).strip() if atuais.strip() else "\n".join(novas)
            db.commit()
        res["dou_keywords_adicionadas"] = len(novas)
    return {"message": f"{res['criadas']} fonte(s) sugerida(s) adicionada(s).", **res}
