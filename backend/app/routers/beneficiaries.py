from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.beneficiary import Beneficiary, BeneficiaryType
from ..models.user import User
from ..schemas.finance import BeneficiaryCreate, BeneficiaryUpdate, BeneficiaryOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/beneficiaries", tags=["beneficiaries"])


@router.get("/", response_model=List[BeneficiaryOut])
def list_beneficiaries(
    confederation_id: Optional[int] = None,
    type: Optional[BeneficiaryType] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Beneficiary)
    if current_user.role == "confederation_viewer":
        q = q.filter(Beneficiary.confederation_id == current_user.confederation_id)
    elif confederation_id:
        q = q.filter(Beneficiary.confederation_id == confederation_id)
    if type:
        q = q.filter(Beneficiary.type == type)
    return q.order_by(Beneficiary.name).all()


@router.post("/", response_model=BeneficiaryOut)
def create_beneficiary(confederation_id: int, data: BeneficiaryCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    b = Beneficiary(confederation_id=confederation_id, **data.model_dump())
    db.add(b)
    db.commit()
    db.refresh(b)
    log_action(db=db, action="CREATE_BENEFICIARY", entity_type="Beneficiary", entity_id=b.id,
               new_values={"name": b.name, "type": str(b.type)}, user_id=current_user.id)
    return b


@router.patch("/{id}", response_model=BeneficiaryOut)
def update_beneficiary(id: int, data: BeneficiaryUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    b = db.query(Beneficiary).get(id)
    if not b:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(b, k, v)
    db.commit()
    db.refresh(b)
    log_action(db=db, action="UPDATE_BENEFICIARY", entity_type="Beneficiary", entity_id=id,
               new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return b


@router.delete("/{id}")
def delete_beneficiary(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    b = db.query(Beneficiary).get(id)
    if not b:
        raise HTTPException(status_code=404, detail="Beneficiário não encontrado")
    db.delete(b)
    db.commit()
    return {"ok": True}
