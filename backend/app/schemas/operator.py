from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date
from ..models.operator import OperatorStatus, ContactType, SuggestionStatus, ResponsibleRole


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


class BrandCreate(BaseModel):
    name: str
    domain: Optional[str] = None
    website: Optional[str] = None
    instagram: Optional[str] = None
    twitter: Optional[str] = None
    facebook: Optional[str] = None
    other_social: Optional[str] = None


class BrandUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    website: Optional[str] = None
    instagram: Optional[str] = None
    twitter: Optional[str] = None
    facebook: Optional[str] = None
    other_social: Optional[str] = None


class BrandOut(BaseModel):
    id: int
    name: str
    domain: Optional[str] = None
    website: Optional[str]
    instagram: Optional[str]
    twitter: Optional[str]
    facebook: Optional[str]
    other_social: Optional[str]
    created_at: datetime
    logo_url: Optional[str] = None

    class Config:
        from_attributes = True


class ResponsibleCreate(BaseModel):
    role: ResponsibleRole
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class ResponsibleUpdate(BaseModel):
    role: Optional[ResponsibleRole] = None
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None


class ResponsibleOut(BaseModel):
    id: int
    operator_id: int
    role: ResponsibleRole
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EndrAssociationCreate(BaseModel):
    reference_month: date
    is_associated: bool = True
    notes: Optional[str] = None


class EndrAssociationOut(BaseModel):
    id: int
    operator_id: int
    reference_month: date
    is_associated: bool
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class ContactSuggestionOut(BaseModel):
    id: int
    operator_id: int
    type: ContactType
    value: str
    source: str
    source_url: Optional[str] = None
    relationship_label: Optional[str] = None
    confidence: Optional[str] = None
    status: SuggestionStatus
    notes: Optional[str] = None
    found_at: datetime
    reviewed_at: Optional[datetime] = None

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
    # Address
    address_street: Optional[str] = None
    address_number: Optional[str] = None
    address_complement: Optional[str] = None
    address_neighborhood: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    # Authorization
    authorization_number: Optional[str] = None
    authorization_date: Optional[datetime] = None


class OperatorUpdate(BaseModel):
    company_name: Optional[str] = None
    fantasy_name: Optional[str] = None
    cnpj: Optional[str] = None
    website: Optional[str] = None
    status: Optional[OperatorStatus] = None
    notes: Optional[str] = None
    # Address
    address_street: Optional[str] = None
    address_number: Optional[str] = None
    address_complement: Optional[str] = None
    address_neighborhood: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    # Authorization
    authorization_number: Optional[str] = None
    authorization_date: Optional[datetime] = None


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
    # Address
    address_street: Optional[str] = None
    address_number: Optional[str] = None
    address_complement: Optional[str] = None
    address_neighborhood: Optional[str] = None
    address_city: Optional[str] = None
    address_state: Optional[str] = None
    address_zip: Optional[str] = None
    # Authorization
    authorization_number: Optional[str] = None
    authorization_date: Optional[datetime] = None
    # Relations
    brands: List[BrandOut] = []
    responsibles: List[ResponsibleOut] = []
    endr_associations: List[EndrAssociationOut] = []

    class Config:
        from_attributes = True
