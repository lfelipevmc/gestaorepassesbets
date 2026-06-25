from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from ..models.payment import PaymentStatus


class PaymentDeclareGGR(BaseModel):
    ggr_declared: Decimal
    operator_percentage: Optional[Decimal] = None   # % individual da bet (sobrescreve padrão)
    notes: Optional[str] = None


class PaymentConfirm(BaseModel):
    amount_paid: Decimal
    payment_date: date
    notes: Optional[str] = None


class PaymentRegisterReport(BaseModel):
    report_reference_month: Optional[date] = None  # mês de competência do relatório
    report_notes: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    cycle_id: int
    operator_id: int
    confederation_id: int
    ggr_declared: Optional[Decimal]
    operator_percentage: Optional[Decimal]
    calculated_amount: Optional[Decimal]
    amount_paid: Optional[Decimal]
    payment_date: Optional[date]
    payment_confirmed_at: Optional[datetime]
    status: PaymentStatus
    notes: Optional[str]
    report_received: bool
    report_reference_month: Optional[date]
    report_notes: Optional[str]
    report_file_url: Optional[str]
    report_received_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ENDRPaymentBetLinkOut(BaseModel):
    id: int
    operator_id: int
    notes: Optional[str]

    class Config:
        from_attributes = True


class ENDRPaymentOut(BaseModel):
    id: int
    confederation_id: int
    reference_month: date
    amount_received: Decimal
    received_date: date
    notes: Optional[str]
    report_file_url: Optional[str]
    created_at: datetime
    bet_links: List[ENDRPaymentBetLinkOut]

    class Config:
        from_attributes = True


class ENDRPaymentCreate(BaseModel):
    confederation_id: int
    reference_month: date
    amount_received: Decimal
    received_date: date
    notes: Optional[str] = None
    operator_ids: List[int] = []


class ConfederationOut(BaseModel):
    pass
