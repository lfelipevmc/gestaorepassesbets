from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models.messaging import MessageTemplate, TemplateOccasion
from ..models.user import User
from ..schemas.finance import TemplateCreate, TemplateUpdate, TemplateOut
from ..core.auth import get_current_user, require_office
from ..services.audit_service import log_action

router = APIRouter(prefix="/api/templates", tags=["templates"])


@router.get("/", response_model=List[TemplateOut])
def list_templates(
    confederation_id: Optional[int] = None,
    occasion: Optional[TemplateOccasion] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(MessageTemplate)
    if confederation_id is not None:
        # templates da confederação OU globais (confederation_id nulo)
        q = q.filter((MessageTemplate.confederation_id == confederation_id) | (MessageTemplate.confederation_id.is_(None)))
    if occasion:
        q = q.filter(MessageTemplate.occasion == occasion)
    return q.order_by(MessageTemplate.name).all()


@router.post("/", response_model=TemplateOut)
def create_template(data: TemplateCreate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    t = MessageTemplate(**data.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    log_action(db=db, action="CREATE_TEMPLATE", entity_type="MessageTemplate", entity_id=t.id,
               new_values={"name": t.name}, user_id=current_user.id)
    return t


@router.patch("/{id}", response_model=TemplateOut)
def update_template(id: int, data: TemplateUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    t = db.query(MessageTemplate).get(id)
    if not t:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/{id}")
def delete_template(id: int, db: Session = Depends(get_db), current_user: User = Depends(require_office)):
    t = db.query(MessageTemplate).get(id)
    if not t:
        raise HTTPException(status_code=404, detail="Template não encontrado")
    db.delete(t)
    db.commit()
    return {"ok": True}
