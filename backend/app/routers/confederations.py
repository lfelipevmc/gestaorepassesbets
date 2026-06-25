from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models.confederation import Confederation
from ..models.user import User
from ..schemas.confederation import ConfederationCreate, ConfederationUpdate, ConfederationOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/confederations", tags=["confederations"])


@router.get("/", response_model=List[ConfederationOut])
def list_confederations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role == "confederation_viewer":
        return db.query(Confederation).filter(Confederation.id == current_user.confederation_id).all()
    return db.query(Confederation).all()


@router.post("/", response_model=ConfederationOut)
def create_confederation(data: ConfederationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = Confederation(**data.model_dump())
    db.add(conf)
    db.commit()
    db.refresh(conf)
    log_action(db=db, action="CREATE", entity_type="Confederation", entity_id=conf.id, new_values=data.model_dump(), user_id=current_user.id)
    return conf


@router.get("/{id}", response_model=ConfederationOut)
def get_confederation(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    if current_user.role == "confederation_viewer" and current_user.confederation_id != id:
        raise HTTPException(status_code=403, detail="Acesso negado")
    return conf


@router.patch("/{id}", response_model=ConfederationOut)
def update_confederation(id: int, data: ConfederationUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    old = {k: str(v) for k, v in conf.__dict__.items() if not k.startswith("_")}
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(conf, k, v)
    db.commit()
    db.refresh(conf)
    log_action(db=db, action="UPDATE", entity_type="Confederation", entity_id=id, old_values=old, new_values=data.model_dump(exclude_none=True), user_id=current_user.id)
    return conf
