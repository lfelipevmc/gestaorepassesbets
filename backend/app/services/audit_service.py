from sqlalchemy.orm import Session
from ..models.audit import AuditLog
from typing import Optional


def log_action(
    db: Session,
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    old_values: Optional[dict] = None,
    new_values: Optional[dict] = None,
    description: Optional[str] = None,
    user_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    confederation_id: Optional[int] = None,
):
    entry = AuditLog(
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        confederation_id=confederation_id,
        old_values=old_values,
        new_values=new_values,
        description=description,
        ip_address=ip_address,
    )
    db.add(entry)
    db.commit()
