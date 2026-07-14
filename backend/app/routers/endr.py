from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from pydantic import BaseModel
from ..database import get_db
from ..models.operator import ENDREntity, EndrAssociation, BettingOperator, OperatorStatus
from ..models.user import User
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/endr", tags=["endr"])


class ENDREntityOut(BaseModel):
    id: int
    logo_url: Optional[str] = None
    name: Optional[str]
    cnpj: Optional[str]
    website: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    address: Optional[str]
    notes: Optional[str]

    class Config:
        from_attributes = True


class ENDREntityUpdate(BaseModel):
    name: Optional[str] = None
    cnpj: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class MonthlyAssocOut(BaseModel):
    assoc_id: int
    operator_id: int
    company_name: str
    fantasy_name: Optional[str]
    cnpj: Optional[str]
    reference_month: date
    notes: Optional[str]

    class Config:
        from_attributes = True


class AddAssocRequest(BaseModel):
    operator_id: int
    reference_month: date
    notes: Optional[str] = None


def _get_or_create_entity(db: Session) -> ENDREntity:
    entity = db.query(ENDREntity).first()
    if not entity:
        entity = ENDREntity(id=1, name="ENDR – Escritório Nacional de Direitos de Rateio")
        db.add(entity)
        db.commit()
        db.refresh(entity)
    return entity


@router.get("/entity", response_model=ENDREntityOut)
def get_entity(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _get_or_create_entity(db)


@router.patch("/entity", response_model=ENDREntityOut)
def update_entity(data: ENDREntityUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    entity = _get_or_create_entity(db)
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(entity, k, v)
    db.commit()
    db.refresh(entity)
    log_action(db=db, action="UPDATE_ENDR_ENTITY", entity_type="ENDREntity", entity_id=entity.id,
               new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return entity


@router.get("/monthly", response_model=List[MonthlyAssocOut])
def list_monthly(
    month: date = Query(..., description="Primeiro dia do mês, ex: 2025-06-01"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista todas as bets associadas ao ENDR no mês informado."""
    assocs = (
        db.query(EndrAssociation)
        .filter(EndrAssociation.reference_month == month, EndrAssociation.is_associated == True)
        .all()
    )
    result = []
    for a in assocs:
        op = a.operator
        result.append(MonthlyAssocOut(
            assoc_id=a.id,
            operator_id=op.id,
            company_name=op.company_name,
            fantasy_name=op.fantasy_name,
            cnpj=op.cnpj,
            reference_month=a.reference_month,
            notes=a.notes,
        ))
    return result


@router.get("/operators-available", response_model=List[dict])
def list_available_operators(
    month: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Lista operadores ativos que NÃO estão associados ao ENDR no mês."""
    already = {
        a.operator_id
        for a in db.query(EndrAssociation)
        .filter(EndrAssociation.reference_month == month, EndrAssociation.is_associated == True)
        .all()
    }
    ops = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()
    return [
        {"id": op.id, "company_name": op.company_name, "fantasy_name": op.fantasy_name, "cnpj": op.cnpj}
        for op in ops if op.id not in already
    ]


@router.post("/monthly", response_model=MonthlyAssocOut)
def add_monthly(data: AddAssocRequest, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(data.operator_id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    existing = db.query(EndrAssociation).filter(
        EndrAssociation.operator_id == data.operator_id,
        EndrAssociation.reference_month == data.reference_month,
    ).first()
    if existing:
        existing.is_associated = True
        existing.notes = data.notes
        existing.updated_by_id = current_user.id
        db.commit()
        db.refresh(existing)
        assoc = existing
    else:
        assoc = EndrAssociation(
            operator_id=data.operator_id,
            reference_month=data.reference_month,
            is_associated=True,
            notes=data.notes,
            updated_by_id=current_user.id,
        )
        db.add(assoc)
        db.commit()
        db.refresh(assoc)
    log_action(db=db, action="ADD_ENDR_ASSOCIATION", entity_type="BettingOperator", entity_id=data.operator_id,
               new_values={"month": str(data.reference_month)}, user_id=current_user.id)
    return MonthlyAssocOut(
        assoc_id=assoc.id, operator_id=op.id, company_name=op.company_name,
        fantasy_name=op.fantasy_name, cnpj=op.cnpj,
        reference_month=assoc.reference_month, notes=assoc.notes,
    )


@router.delete("/monthly/{assoc_id}")
def remove_monthly(assoc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    assoc = db.query(EndrAssociation).filter(EndrAssociation.id == assoc_id).first()
    if not assoc:
        raise HTTPException(status_code=404, detail="Associação não encontrada")
    op_id = assoc.operator_id
    db.delete(assoc)
    db.commit()
    log_action(db=db, action="DELETE_ENDR_ASSOCIATION", entity_type="BettingOperator", entity_id=op_id,
               user_id=current_user.id)
    return {"ok": True}


# ============================================================================
# ACOMPANHAMENTO ENDR (item 9)
# Consolida automaticamente os repasses ENDR registrados nas confederações,
# gestão documental por competência e linha do tempo geral desde 2025.
# ============================================================================

@router.get("/acompanhamento")
def endr_acompanhamento(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Painel consolidado do ENDR.

    Os repasses ENDR são registrados nas confederações (aba Repasses ENDR de cada
    confederação) e gravados na tabela única endr_payments — por isso são refletidos
    aqui automaticamente, sem necessidade de novo lançamento."""
    from ..models.payment import ENDRPayment, ENDRPaymentBetLink
    from ..models.confederation import Confederation
    from ..models.document import Document

    confs = db.query(Confederation).order_by(Confederation.acronym).all()
    payments = db.query(ENDRPayment).order_by(ENDRPayment.received_date.desc()).all()

    # --- Resumo por confederação ---
    by_conf = []
    for c in confs:
        pays = [p for p in payments if p.confederation_id == c.id]
        total = sum(float(p.amount_received or 0) for p in pays)
        last = max(pays, key=lambda p: p.received_date) if pays else None
        pending_reports = sum(1 for p in pays if p.reference_month is None)
        if not pays:
            situacao = "sem_repasse"
        elif pending_reports:
            situacao = "aguardando_relatorio"
        else:
            situacao = "regular"
        by_conf.append({
            "confederation_id": c.id, "acronym": c.acronym, "name": c.name,
            "total_received": total, "count": len(pays),
            "last_date": last.received_date.isoformat() if last else None,
            "last_amount": float(last.amount_received) if last else None,
            "pending_reports": pending_reports, "situacao": situacao,
        })

    conf_map = {c.id: c.acronym for c in confs}

    # --- Histórico de repasses (todos) ---
    pay_rows = []
    for p in payments:
        ops = [{"operator_id": l.operator_id,
                "name": (l.operator.fantasy_name or l.operator.company_name) if l.operator else "?"}
               for l in p.bet_links]
        pay_rows.append({
            "id": p.id, "confederation_id": p.confederation_id,
            "acronym": conf_map.get(p.confederation_id, "?"),
            "reference_month": p.reference_month.isoformat() if p.reference_month else None,
            "reference_month_end": p.reference_month_end.isoformat() if p.reference_month_end else None,
            "amount_received": float(p.amount_received or 0),
            "received_date": p.received_date.isoformat(),
            "report_file_url": p.report_file_url,
            "operators": ops, "notes": p.notes,
        })

    # --- Linha do tempo mensal desde jan/2025 ---
    assocs = db.query(EndrAssociation).filter(EndrAssociation.is_associated == True).all()
    # mês -> set de operator_ids associados
    month_ops: dict = {}
    op_names: dict = {}
    for a in assocs:
        ym = a.reference_month.strftime("%Y-%m")
        month_ops.setdefault(ym, set()).add(a.operator_id)
        if a.operator_id not in op_names and a.operator:
            op_names[a.operator_id] = a.operator.fantasy_name or a.operator.company_name

    today = date.today()
    months = []
    y, m = 2025, 1
    while (y, m) <= (today.year, today.month):
        months.append(f"{y}-{m:02d}")
        m += 1
        if m > 12:
            m, y = 1, y + 1

    # relatórios por competência (um repasse pode cobrir um PERÍODO de meses)
    reports_by_month: dict = {}
    for p in payments:
        if p.reference_month:
            mm = p.reference_month.replace(day=1)
            fim = (p.reference_month_end or p.reference_month).replace(day=1)
            n_meses = (fim.year - mm.year) * 12 + (fim.month - mm.month) + 1
            while mm <= fim:
                reports_by_month.setdefault(mm.strftime("%Y-%m"), []).append({
                    "payment_id": p.id, "acronym": conf_map.get(p.confederation_id, "?"),
                    "amount": float(p.amount_received or 0), "operators_count": len(p.bet_links),
                    "period_months": n_meses,
                })
                mm = date(mm.year + 1, 1, 1) if mm.month == 12 else date(mm.year, mm.month + 1, 1)

    timeline = []
    prev: set = set()
    for ym in months:
        cur = month_ops.get(ym, set())
        entered = sorted(op_names.get(i, f"#{i}") for i in cur - prev)
        left = sorted(op_names.get(i, f"#{i}") for i in prev - cur)
        timeline.append({
            "month": ym, "associated_count": len(cur),
            "entered": entered, "left": left,
            "reports": reports_by_month.get(ym, []),
        })
        prev = cur
    timeline.reverse()  # mais recente primeiro

    # --- Documentos ENDR (gestão documental por competência) ---
    docs = (db.query(Document)
            .filter(Document.description.like("[ENDR]%"))
            .order_by(Document.reference_month.desc().nullslast(), Document.created_at.desc())
            .all())
    doc_rows = [{
        "id": d.id, "title": d.title, "file_name": d.file_name,
        "file_path": d.file_path, "file_size": d.file_size,
        "confederation_id": d.confederation_id,
        "acronym": conf_map.get(d.confederation_id) if d.confederation_id else None,
        "reference_month": d.reference_month.isoformat() if d.reference_month else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "description": (d.description or "").replace("[ENDR]", "").strip() or None,
    } for d in docs]

    total_geral = sum(r["total_received"] for r in by_conf)
    return {
        "confederations": by_conf, "payments": pay_rows,
        "timeline": timeline, "documents": doc_rows,
        "total_geral": total_geral,
        "pending_reports_total": sum(r["pending_reports"] for r in by_conf),
    }


@router.post("/documents")
async def upload_endr_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    reference_month: Optional[str] = Form(None),
    confederation_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_office),
):
    """Upload de documento do ENDR vinculado a uma competência (relatórios, listas, ofícios)."""
    import os, shutil, uuid
    from ..models.document import Document, DocumentType
    updir = "/app/uploads/documents"
    os.makedirs(updir, exist_ok=True)
    ext = os.path.splitext(file.filename or "doc")[1].lower()
    filename = f"endr_doc_{uuid.uuid4().hex}{ext}"
    path = os.path.join(updir, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    ref = None
    if reference_month:
        ref = date.fromisoformat(reference_month[:7] + "-01")
    doc = Document(
        confederation_id=confederation_id,
        title=title or (file.filename or "Documento ENDR"),
        document_type=DocumentType.report,
        file_path=f"/uploads/documents/{filename}",
        file_name=file.filename or filename,
        file_size=os.path.getsize(path),
        description=f"[ENDR] {description or ''}".strip(),
        reference_month=ref,
        uploaded_by_id=current_user.id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    log_action(db=db, action="UPLOAD_ENDR_DOCUMENT", entity_type="Document", entity_id=doc.id,
               new_values={"title": doc.title, "reference_month": str(ref)}, user_id=current_user.id)
    return {"id": doc.id, "file_path": doc.file_path}


@router.delete("/documents/{doc_id}")
def delete_endr_document(doc_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    from ..models.document import Document
    doc = db.query(Document).filter(Document.id == doc_id, Document.description.like("[ENDR]%")).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento ENDR não encontrado")
    db.delete(doc)
    db.commit()
    log_action(db=db, action="DELETE_ENDR_DOCUMENT", entity_type="Document", entity_id=doc_id, user_id=current_user.id)
    return {"ok": True}


@router.post("/entity/upload-logo")
async def upload_endr_logo(file: UploadFile = File(...), db: Session = Depends(get_db),
                           current_user: User = Depends(require_office)):
    entity = _get_or_create_entity(db)
    import os, uuid, shutil
    updir = "/app/uploads/logos"
    os.makedirs(updir, exist_ok=True)
    ext = os.path.splitext(file.filename or "logo.png")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"):
        raise HTTPException(status_code=400, detail="Envie uma imagem (png/jpg/webp/svg).")
    filename = f"endr_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(updir, filename), "wb") as f:
        shutil.copyfileobj(file.file, f)
    entity.logo_url = f"/uploads/logos/{filename}"
    db.commit()
    log_action(db=db, action="UPLOAD_ENDR_LOGO", entity_type="ENDREntity", entity_id=entity.id, user_id=current_user.id)
    return {"logo_url": entity.logo_url}
