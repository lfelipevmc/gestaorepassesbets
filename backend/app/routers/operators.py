from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.operator import BettingOperator, OperatorContact, OperatorStatus
from ..models.user import User
from ..schemas.operator import OperatorCreate, OperatorUpdate, OperatorOut, ContactCreate, ContactOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action
from ..services.mf_scraper import scrape_mf_operators
from ..services.ai_service import find_operator_contacts

router = APIRouter(prefix="/api/operators", tags=["operators"])


@router.get("/", response_model=List[OperatorOut])
def list_operators(
    status: Optional[OperatorStatus] = None,
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    q = db.query(BettingOperator)
    if status:
        q = q.filter(BettingOperator.status == status)
    if search:
        q = q.filter(
            BettingOperator.company_name.ilike(f"%{search}%") |
            BettingOperator.fantasy_name.ilike(f"%{search}%") |
            BettingOperator.cnpj.ilike(f"%{search}%")
        )
    return q.offset(skip).limit(limit).all()


@router.post("/", response_model=OperatorOut)
def create_operator(data: OperatorCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = BettingOperator(**data.model_dump())
    db.add(op)
    db.commit()
    db.refresh(op)
    log_action(db=db, action="CREATE", entity_type="BettingOperator", entity_id=op.id, new_values=data.model_dump(), user_id=current_user.id)
    return op


@router.get("/{id}", response_model=OperatorOut)
def get_operator(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    return op


@router.patch("/{id}", response_model=OperatorOut)
def update_operator(id: int, data: OperatorUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    old = {k: str(v) for k, v in op.__dict__.items() if not k.startswith("_")}
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(op, k, v)
    db.commit()
    db.refresh(op)
    log_action(db=db, action="UPDATE", entity_type="BettingOperator", entity_id=id, old_values=old, new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return op


@router.post("/{id}/contacts", response_model=ContactOut)
def add_contact(id: int, data: ContactCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    contact = OperatorContact(operator_id=id, **data.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    log_action(db=db, action="ADD_CONTACT", entity_type="BettingOperator", entity_id=id, new_values=data.model_dump(), user_id=current_user.id)
    return contact


@router.delete("/{id}/contacts/{contact_id}")
def delete_contact(id: int, contact_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    contact = db.query(OperatorContact).filter(OperatorContact.id == contact_id, OperatorContact.operator_id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")
    db.delete(contact)
    db.commit()
    log_action(db=db, action="DELETE_CONTACT", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return {"ok": True}


@router.post("/{id}/find-contacts")
def ai_find_contacts(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    op = db.query(BettingOperator).get(id)
    if not op:
        raise HTTPException(status_code=404, detail="Operador não encontrado")
    result = find_operator_contacts(op.company_name, op.fantasy_name, op.cnpj, op.website)
    log_action(db=db, action="AI_FIND_CONTACTS", entity_type="BettingOperator", entity_id=id, user_id=current_user.id)
    return result


@router.post("/sync-mf")
def sync_from_mf(background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    background_tasks.add_task(scrape_mf_operators, db)
    return {"message": "Sincronização iniciada em segundo plano"}
