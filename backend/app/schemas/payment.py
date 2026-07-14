from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from ..models.payment import PaymentStatus


class PaymentDeclareValue(BaseModel):
    """Registra o valor apurado/informado pelo agente operador (não há cálculo pelo escritório)."""
    amount_due: Decimal                       # valor devido informado pelo operador
    base_calculo: Optional[Decimal] = None    # Base de Cálculo apurada (do relatório)
    notes: Optional[str] = None


class PaymentConfirm(BaseModel):
    amount_paid: Decimal
    payment_date: date
    notes: Optional[str] = None


class PaymentReceiptOut(BaseModel):
    id: int
    amount: Decimal
    received_date: date
    report_received: bool
    report_reference_month: Optional[date]
    report_notes: Optional[str]
    report_file_url: Optional[str]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class PaymentRegisterReport(BaseModel):
    report_reference_month: Optional[date] = None  # mês de competência do relatório
    report_notes: Optional[str] = None


class PaymentOut(BaseModel):
    id: int
    cycle_id: int
    operator_id: int
    confederation_id: int
    base_calculo: Optional[Decimal]
    amount_due: Optional[Decimal]
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
    receipts: List[PaymentReceiptOut] = []

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
    reference_month: Optional[date] = None
    reference_month_end: Optional[date] = None
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
    reference_month: Optional[date] = None   # competência definida depois, com o relatório
    amount_received: Decimal
    received_date: date
    notes: Optional[str] = None
    operator_ids: List[int] = []


class DirectPaymentCreate(BaseModel):
    confederation_id: int
    reference_month: Optional[date] = None   # pode ser definido depois, ao receber o relatório
    amount_received: Decimal
    received_date: date
    notes: Optional[str] = None


class DirectPaymentUpdate(BaseModel):
    reference_month: Optional[date] = None
    notes: Optional[str] = None


class DirectPaymentOut(BaseModel):
    id: int
    operator_id: int
    confederation_id: int
    reference_month: Optional[date] = None
    amount_received: Decimal
    received_date: date
    notes: Optional[str]
    report_file_url: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
