from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from ..database import get_db
from ..models.user import User
from ..core.auth import require_office
from ..services.ai_service import draft_collection_email

router = APIRouter(prefix="/api/ai", tags=["ai"])


class DraftRequest(BaseModel):
    operator_name: str
    confederation_name: str
    reference_month: str
    notification_number: int
    calculated_amount: Optional[float] = None


@router.post("/draft-notification")
def draft_notification(data: DraftRequest, current_user: User = Depends(require_office)):
    text = draft_collection_email(
        operator_name=data.operator_name,
        confederation_name=data.confederation_name,
        reference_month=data.reference_month,
        notification_number=data.notification_number,
        calculated_amount=data.calculated_amount
    )
    return {"draft": text}
