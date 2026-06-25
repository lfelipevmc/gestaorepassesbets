from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal


class DistributionRuleOut(BaseModel):
    id: int
    confederation_id: int
    scenario_code: str
    scenario_label: str
    article_ref: Optional[str]
    confederation_pct: Optional[Decimal]
    athlete_pct: Optional[Decimal]
    entity_pct: Optional[Decimal]
    federation_pct: Optional[Decimal]
    is_equanime: bool
    description: Optional[str]
    order_index: int

    class Config:
        from_attributes = True


class DistributionRuleCreate(BaseModel):
    scenario_code: str
    scenario_label: str
    article_ref: Optional[str] = None
    confederation_pct: Optional[Decimal] = None
    athlete_pct: Optional[Decimal] = None
    entity_pct: Optional[Decimal] = None
    federation_pct: Optional[Decimal] = None
    is_equanime: bool = False
    description: Optional[str] = None
    order_index: int = 0


class DistributionRuleUpdate(BaseModel):
    scenario_label: Optional[str] = None
    article_ref: Optional[str] = None
    confederation_pct: Optional[Decimal] = None
    athlete_pct: Optional[Decimal] = None
    entity_pct: Optional[Decimal] = None
    federation_pct: Optional[Decimal] = None
    is_equanime: Optional[bool] = None
    description: Optional[str] = None
    order_index: Optional[int] = None


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
    redistribution_deadline_days: Optional[int] = None


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
    redistribution_deadline_days: Optional[int] = None


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
    redistribution_deadline_days: Optional[int]
    created_at: datetime

    class Config:
        from_attributes = True
