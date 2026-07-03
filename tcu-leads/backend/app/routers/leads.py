from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
from decimal import Decimal

from ..database import get_db
from ..models import TcuLead, TcuLeadNote, TcuActType, TcuDocType, TcuLeadStatus, TcuSourceKind
from ..models.user import User
from ..schemas import LeadOut, LeadDetail, LeadUpdate, LeadNoteCreate, LeadNoteOut
from ..core.auth import get_current_user
from ..services import pipeline

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("", response_model=List[LeadOut])
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
    else:
        q = q.order_by(TcuLead.opportunity_score.desc().nullslast(), TcuLead.created_at.desc())

    return q.offset(skip).limit(min(limit, 300)).all()


@router.get("/{lead_id}", response_model=LeadDetail)
def get_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    return lead


@router.patch("/{lead_id}", response_model=LeadDetail)
def update_lead(lead_id: int, data: LeadUpdate, db: Session = Depends(get_db),
                current_user: User = Depends(get_current_user)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    changes = data.model_dump(exclude_none=True)
    old_status = lead.status
    for k, v in changes.items():
        setattr(lead, k, v)
    if "status" in changes and changes["status"] != old_status:
        db.add(TcuLeadNote(lead_id=lead.id, author_id=current_user.id, kind="status_change",
                           body=f"Status alterado de '{old_status.value}' para '{lead.status.value}'."))
    db.commit()
    db.refresh(lead)
    return lead


@router.post("/{lead_id}/notes", response_model=LeadNoteOut)
def add_note(lead_id: int, data: LeadNoteCreate, db: Session = Depends(get_db),
             current_user: User = Depends(get_current_user)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    note = TcuLeadNote(lead_id=lead_id, author_id=current_user.id, kind=data.kind, body=data.body)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.post("/{lead_id}/enrich")
def enrich_lead(lead_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    lead = db.query(TcuLead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead não encontrado")
    if lead.doc_type != TcuDocType.cnpj:
        raise HTTPException(400, "Enriquecimento disponível apenas para responsáveis PJ (CNPJ).")
    settings = pipeline.get_settings(db)
    client = pipeline._client(settings)
    enr = pipeline.enrich_lead_cnpj(db, lead, client, cache_days=int(settings.enrich_cache_days or 40))
    db.commit()
    if not enr:
        raise HTTPException(502, "Não foi possível enriquecer o CNPJ (serviço indisponível ou CNPJ inválido).")
    return {"ok": True, "enrichment_id": enr.id}
