from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date
from decimal import Decimal
from ..models.payment import PaymentStatus


class PaymentDeclareGGR(BaseModel):
    ggr_declared: Decimal
    confederation_percentage: Optional[Decimal] = None
    notes: Optional[str] = None


class PaymentConfirm(BaseModel):
    amount_paid: Decimal
    payment_date: date
    notes: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    cycle_id: int
    operator_id: int
    confederation_id: int
    ggr_declared: Optional[Decimal]
    calculated_amount: Optional[Decimal]
    amount_paid: Optional[Decimal]
    payment_date: Optional[date]
    payment_confirmed_at: Optional[datetime]
    status: PaymentStatus
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
