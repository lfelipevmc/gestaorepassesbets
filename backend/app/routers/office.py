import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..models.office import OfficeSettings
from ..models.user import User
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/office", tags=["office"])

LOGO_DIR = "/app/uploads/office"


class OfficeUpdate(BaseModel):
    name: Optional[str] = None
    legal_name: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    signature_name: Optional[str] = None
    notes: Optional[str] = None


class OfficeOut(BaseModel):
    id: int
    name: Optional[str] = None
    legal_name: Optional[str] = None
    cnpj: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    logo_url: Optional[str] = None
    signature_name: Optional[str] = None
    notes: Optional[str] = None

    class Config:
        from_attributes = True


def _get_or_create(db: Session) -> OfficeSettings:
    office = db.query(OfficeSettings).first()
    if not office:
        office = OfficeSettings(id=1, name="Escritório Jurídico")
        db.add(office)
        db.commit()
        db.refresh(office)
    return office


@router.get("/", response_model=OfficeOut)
def get_office(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _get_or_create(db)


@router.patch("/", response_model=OfficeOut)
def update_office(data: OfficeUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    office = _get_or_create(db)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(office, k, v)
    db.commit()
    db.refresh(office)
    log_action(db=db, action="UPDATE_OFFICE", entity_type="OfficeSettings", entity_id=office.id, user_id=current_user.id)
    return office


@router.post("/upload-logo", response_model=OfficeOut)
async def upload_logo(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    office = _get_or_create(db)
    os.makedirs(LOGO_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "logo.png")[1] or ".png"
    disk_name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(LOGO_DIR, disk_name)
    with open(path, "wb") as f:
        f.write(await file.read())
    office.logo_url = f"/uploads/office/{disk_name}"
    db.commit()
    db.refresh(office)
    log_action(db=db, action="UPDATE_OFFICE_LOGO", entity_type="OfficeSettings", entity_id=office.id, user_id=current_user.id)
    return office
