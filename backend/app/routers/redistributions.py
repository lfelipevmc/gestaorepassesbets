from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, timedelta
import os, shutil, uuid
from decimal import Decimal
from ..database import get_db
from ..models.redistribution import Redistribution, RedistributionItem, RedistributionStatus, ItemStatus
from ..models.confederation import Confederation
from ..models.beneficiary import Beneficiary
from ..models.user import User
from ..schemas.finance import RedistributionCreate, RedistributionOut, RedistributionItemIn, RedistributionItemOut, ItemPayIn
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/redistributions", tags=["redistributions"])

PROOF_DIR = "/app/uploads/redistributions"


def _recompute_status(redis: Redistribution):
    items = redis.items
    if not items:
        redis.status = RedistributionStatus.pending
        return
    paid = [i for i in items if i.status == ItemStatus.paid]
    if len(paid) == 0:
        redis.status = RedistributionStatus.pending
    elif len(paid) == len(items):
        redis.status = RedistributionStatus.completed
    else:
        redis.status = RedistributionStatus.partial


@router.get("/", response_model=List[RedistributionOut])
def list_redistributions(
    confederation_id: Optional[int] = None,
    status: Optional[RedistributionStatus] = None,
    overdue: Optional[bool] = Query(None, description="Apenas com prazo vencido e não concluídas"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Redistribution)
    if current_user.role == "confederation_viewer":
        q = q.filter(Redistribution.confederation_id == current_user.confederation_id)
    elif confederation_id:
        q = q.filter(Redistribution.confederation_id == confederation_id)
    if status:
        q = q.filter(Redistribution.status == status)
    if overdue:
        q = q.filter(
            Redistribution.deadline_date < date.today(),
            Redistribution.status != RedistributionStatus.completed,
        )
    return q.order_by(Redistribution.received_date.desc()).all()


@router.post("/", response_model=RedistributionOut)
def create_redistribution(data: RedistributionCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(data.confederation_id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")

    deadline = None
    if conf.redistribution_deadline_days:
        deadline = data.received_date + timedelta(days=conf.redistribution_deadline_days)

    redis = Redistribution(
        confederation_id=data.confederation_id,
        source_type=data.source_type,
        source_payment_id=data.source_payment_id,
        source_endr_id=data.source_endr_id,
        competition_name=data.competition_name,
        reference_month=data.reference_month,
        amount_received=data.amount_received,
        received_date=data.received_date,
        deadline_date=deadline,
        notes=data.notes,
        created_by_id=current_user.id,
    )
    db.add(redis)
    db.flush()
    for it in data.items:
        label = it.beneficiary_label
        category = it.category
        if it.beneficiary_id:
            ben = db.query(Beneficiary).get(it.beneficiary_id)
            if ben:
                label = label or ben.name
                category = category or str(ben.type.value if hasattr(ben.type, "value") else ben.type)
        db.add(RedistributionItem(
            redistribution_id=redis.id,
            beneficiary_id=it.beneficiary_id,
            beneficiary_label=label,
            category=category,
            amount=it.amount,
            notes=it.notes,
        ))
    db.flush()
    _recompute_status(redis)
    db.commit()
    db.refresh(redis)
    log_action(db=db, action="CREATE_REDISTRIBUTION", entity_type="Redistribution", entity_id=redis.id,
               new_values={"amount": str(data.amount_received), "items": len(data.items)}, user_id=current_user.id)
    return redis


@router.get("/{id}", response_model=RedistributionOut)
def get_redistribution(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    redis = db.query(Redistribution).get(id)
    if not redis:
        raise HTTPException(status_code=404, detail="Redistribuição não encontrada")
    return redis


@router.post("/{id}/items", response_model=RedistributionItemOut)
def add_item(id: int, data: RedistributionItemIn, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    redis = db.query(Redistribution).get(id)
    if not redis:
        raise HTTPException(status_code=404, detail="Redistribuição não encontrada")
    label = data.beneficiary_label
    category = data.category
    if data.beneficiary_id:
        ben = db.query(Beneficiary).get(data.beneficiary_id)
        if ben:
            label = label or ben.name
            category = category or str(ben.type.value if hasattr(ben.type, "value") else ben.type)
    item = RedistributionItem(
        redistribution_id=id, beneficiary_id=data.beneficiary_id,
        beneficiary_label=label, category=category, amount=data.amount, notes=data.notes,
    )
    db.add(item)
    db.flush()
    _recompute_status(redis)
    db.commit()
    db.refresh(item)
    return item


@router.post("/{id}/items/{item_id}/pay", response_model=RedistributionItemOut)
def pay_item(id: int, item_id: int, data: ItemPayIn, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    item = db.query(RedistributionItem).filter(
        RedistributionItem.id == item_id, RedistributionItem.redistribution_id == id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    item.status = ItemStatus.paid
    item.paid_date = data.paid_date
    if data.notes:
        item.notes = data.notes
    db.flush()
    _recompute_status(item.redistribution)
    db.commit()
    db.refresh(item)
    log_action(db=db, action="PAY_BENEFICIARY", entity_type="RedistributionItem", entity_id=item_id,
               new_values={"amount": str(item.amount), "beneficiary": item.beneficiary_label}, user_id=current_user.id)
    return item


@router.post("/{id}/items/{item_id}/proof")
async def upload_proof(id: int, item_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    item = db.query(RedistributionItem).filter(
        RedistributionItem.id == item_id, RedistributionItem.redistribution_id == id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    os.makedirs(PROOF_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "comprovante.pdf")[1].lower()
    filename = f"redis_{id}_{item_id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(PROOF_DIR, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    item.proof_file_url = f"/uploads/redistributions/{filename}"
    db.commit()
    return {"proof_file_url": item.proof_file_url}


@router.delete("/{id}/items/{item_id}")
def delete_item(id: int, item_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    item = db.query(RedistributionItem).filter(
        RedistributionItem.id == item_id, RedistributionItem.redistribution_id == id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    redis = item.redistribution
    db.delete(item)
    db.flush()
    _recompute_status(redis)
    db.commit()
    return {"ok": True}


@router.delete("/{id}")
def delete_redistribution(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    redis = db.query(Redistribution).get(id)
    if not redis:
        raise HTTPException(status_code=404, detail="Redistribuição não encontrada")
    db.delete(redis)
    db.commit()
    return {"ok": True}
