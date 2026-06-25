from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from ..models.operator import OperatorStatus, ContactType


class ContactCreate(BaseModel):
    type: ContactType
    value: str
    label: Optional[str] = None
    source: Optional[str] = None
    is_primary: bool = False


class ContactOut(BaseModel):
    id: int
    type: ContactType
    value: str
    label: Optional[str]
    source: Optional[str]
    is_primary: bool
    created_at: datetime

    class Config:
        from_attributes = True


class OperatorCreate(BaseModel):
    company_name: str
    fantasy_name: Optional[str] = None
    cnpj: Optional[str] = None
    mf_license_number: Optional[str] = None
    website: Optional[str] = None
    status: OperatorStatus = OperatorStatus.active
    notes: Optional[str] = None


class OperatorUpdate(BaseModel):
    company_name: Optional[str] = None
    fantasy_name: Optional[str] = None
    cnpj: Optional[str] = None
    website: Optional[str] = None
    status: Optional[OperatorStatus] = None
    notes: Optional[str] = None


class OperatorOut(BaseModel):
    id: int
    company_name: str
    fantasy_name: Optional[str]
    cnpj: Optional[str]
    mf_license_number: Optional[str]
    website: Optional[str]
    status: OperatorStatus
    notes: Optional[str]
    contacts: List[ContactOut] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
