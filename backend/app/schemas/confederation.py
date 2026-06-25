from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal


class OperatorRuleOut(BaseModel):
    id: int
    operator_id: int
    confederation_id: int
    percentage: Decimal
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class OperatorRuleCreate(BaseModel):
    operator_id: int
    percentage: Decimal
    notes: Optional[str] = None


class ConfederationCreate(BaseModel):
    name: str
    acronym: str
    cnpj: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    president_name: Optional[str] = None
    president_email: Optional[str] = None
    president_phone: Optional[str] = None
    president_term: Optional[str] = None
    logo_url: Optional[str] = None
    regulation_text: Optional[str] = None
    rateio_rules: Optional[str] = None
    contact_email: Optional[str] = None
    finance_email: Optional[str] = None
    payment_due_day: int = 10
    ggr_percentage: Optional[Decimal] = None


class ConfederationUpdate(BaseModel):
    name: Optional[str] = None
    cnpj: Optional[str] = None
    website: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    president_name: Optional[str] = None
    president_email: Optional[str] = None
    president_phone: Optional[str] = None
    president_term: Optional[str] = None
    logo_url: Optional[str] = None
    regulation_text: Optional[str] = None
    rateio_rules: Optional[str] = None
    finance_email: Optional[str] = None
    contact_email: Optional[str] = None
    payment_due_day: Optional[int] = None
    ggr_percentage: Optional[Decimal] = None


class ConfederationOut(BaseModel):
    id: int
    name: str
    acronym: str
    cnpj: Optional[str]
    website: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    president_name: Optional[str]
    president_email: Optional[str]
    president_phone: Optional[str]
    president_term: Optional[str]
    logo_url: Optional[str]
    regulation_text: Optional[str]
    rateio_rules: Optional[str]
    contact_email: Optional[str]
    finance_email: Optional[str]
    payment_due_day: int
    ggr_percentage: Optional[Decimal]
    created_at: datetime

    class Config:
        from_attributes = True
