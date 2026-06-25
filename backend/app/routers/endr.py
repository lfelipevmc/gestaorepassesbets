from fastapi import APIRouter, Depends, HTTPException, Query
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
