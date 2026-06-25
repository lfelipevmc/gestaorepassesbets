from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal


class ConfederationCreate(BaseModel):
    name: str
    acronym: str
    regulation_text: Optional[str] = None
    ggr_percentage: Optional[Decimal] = None
    payment_due_day: int = 10
    contact_email: Optional[str] = None
    finance_email: Optional[str] = None


class ConfederationUpdate(BaseModel):
    name: Optional[str] = None
    regulation_text: Optional[str] = None
    ggr_percentage: Optional[Decimal] = None
    finance_email: Optional[str] = None
    contact_email: Optional[str] = None


class ConfederationOut(BaseModel):
    id: int
    name: str
    acronym: str
    regulation_text: Optional[str]
    ggr_percentage: Optional[Decimal]
    payment_due_day: int
    contact_email: Optional[str]
    finance_email: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
