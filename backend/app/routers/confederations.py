from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
import os, shutil, uuid
from ..database import get_db
from ..models.confederation import Confederation, OperatorConfederationRule
from ..models.user import User
from ..schemas.confederation import ConfederationCreate, ConfederationUpdate, ConfederationOut, OperatorRuleCreate, OperatorRuleOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/confederations", tags=["confederations"])

UPLOAD_DIR = "/app/uploads/logos"


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


@router.post("/{id}/upload-logo")
async def upload_logo(id: int, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    conf = db.query(Confederation).get(id)
    if not conf:
        raise HTTPException(status_code=404, detail="Confederação não encontrada")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "logo.png")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".svg", ".webp"):
        raise HTTPException(status_code=400, detail="Formato inválido. Use PNG, JPG, SVG ou WebP.")
    filename = f"conf_{id}_{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    conf.logo_url = f"/uploads/logos/{filename}"
    db.commit()
    return {"logo_url": conf.logo_url}


@router.get("/{id}/rules", response_model=List[OperatorRuleOut])
def list_rules(id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(OperatorConfederationRule).filter(OperatorConfederationRule.confederation_id == id).all()


@router.post("/{id}/rules", response_model=OperatorRuleOut)
def upsert_rule(id: int, data: OperatorRuleCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    existing = db.query(OperatorConfederationRule).filter(
        OperatorConfederationRule.confederation_id == id,
        OperatorConfederationRule.operator_id == data.operator_id,
    ).first()
    if existing:
        existing.percentage = data.percentage
        existing.notes = data.notes
        existing.updated_by_id = current_user.id
        db.commit()
        db.refresh(existing)
        return existing
    rule = OperatorConfederationRule(
        confederation_id=id,
        operator_id=data.operator_id,
        percentage=data.percentage,
        notes=data.notes,
        updated_by_id=current_user.id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    log_action(db=db, action="SET_OPERATOR_RULE", entity_type="Confederation", entity_id=id,
               new_values=data.model_dump(), user_id=current_user.id)
    return rule


@router.delete("/{id}/rules/{rule_id}")
def delete_rule(id: int, rule_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    rule = db.query(OperatorConfederationRule).filter(
        OperatorConfederationRule.id == rule_id,
        OperatorConfederationRule.confederation_id == id,
    ).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Regra não encontrada")
    db.delete(rule)
    db.commit()
    return {"ok": True}
