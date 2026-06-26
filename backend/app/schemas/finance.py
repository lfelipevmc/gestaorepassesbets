from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from ..models.beneficiary import BeneficiaryType
from ..models.redistribution import RedistributionSource, RedistributionStatus, ItemStatus
from ..models.messaging import TemplateOccasion


# ---------- Beneficiários ----------

class BeneficiaryBase(BaseModel):
    type: BeneficiaryType
    name: str
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    pix_key: Optional[str] = None
    notes: Optional[str] = None
    active: bool = True


class BeneficiaryCreate(BeneficiaryBase):
    pass


class BeneficiaryUpdate(BaseModel):
    type: Optional[BeneficiaryType] = None
    name: Optional[str] = None
    document: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    bank_name: Optional[str] = None
    bank_agency: Optional[str] = None
    bank_account: Optional[str] = None
    pix_key: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class BeneficiaryOut(BeneficiaryBase):
    id: int
    confederation_id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- Redistribuição ----------

class RedistributionItemIn(BaseModel):
    beneficiary_id: Optional[int] = None
    beneficiary_label: Optional[str] = None
    category: Optional[str] = None
    amount: Decimal
    notes: Optional[str] = None


class RedistributionItemOut(BaseModel):
    id: int
    beneficiary_id: Optional[int]
    beneficiary_label: Optional[str]
    category: Optional[str]
    amount: Decimal
    status: ItemStatus
    paid_date: Optional[date]
    proof_file_url: Optional[str]
    notes: Optional[str]

    class Config:
        from_attributes = True


class RedistributionCreate(BaseModel):
    confederation_id: int
    source_type: RedistributionSource = RedistributionSource.manual
    source_payment_id: Optional[int] = None
    source_endr_id: Optional[int] = None
    source_direct_payment_id: Optional[int] = None
    competition_name: Optional[str] = None
    reference_month: Optional[date] = None
    amount_received: Decimal
    received_date: date
    notes: Optional[str] = None
    items: List[RedistributionItemIn] = []


class RedistributionOut(BaseModel):
    id: int
    confederation_id: int
    source_type: RedistributionSource
    source_payment_id: Optional[int]
    source_endr_id: Optional[int]
    source_direct_payment_id: Optional[int] = None
    competition_name: Optional[str]
    reference_month: Optional[date]
    amount_received: Decimal
    received_date: date
    deadline_date: Optional[date]
    status: RedistributionStatus
    notes: Optional[str]
    created_at: datetime
    items: List[RedistributionItemOut]

    class Config:
        from_attributes = True


class ItemPayIn(BaseModel):
    paid_date: date
    notes: Optional[str] = None


# ---------- Templates ----------

class TemplateBase(BaseModel):
    name: str
    occasion: TemplateOccasion = TemplateOccasion.custom
    confederation_id: Optional[int] = None
    subject: str
    body: str
    active: bool = True


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    occasion: Optional[TemplateOccasion] = None
    confederation_id: Optional[int] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    active: Optional[bool] = None


class TemplateOut(TemplateBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ---------- E-mails (conciliação) ----------

class EmailMessageOut(BaseModel):
    id: int
    direction: str
    operator_id: Optional[int]
    confederation_id: Optional[int]
    cycle_id: Optional[int]
    subject: Optional[str]
    body_preview: Optional[str]
    from_addr: Optional[str]
    to_addr: Optional[str]
    matched: bool
    sent_at: Optional[datetime]
    received_at: Optional[datetime]

    class Config:
        from_attributes = True
