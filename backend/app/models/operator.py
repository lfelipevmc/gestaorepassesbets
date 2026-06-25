from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class OperatorStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    cancelled = "cancelled"
    pending = "pending"


class ContactType(str, enum.Enum):
    email = "email"
    phone = "phone"
    whatsapp = "whatsapp"
    social_media = "social_media"
    other = "other"


class BettingOperator(Base):
    __tablename__ = "betting_operators"
    id = Column(Integer, primary_key=True)
    company_name = Column(String, nullable=False)
    fantasy_name = Column(String, nullable=True)
    cnpj = Column(String(18), nullable=True, unique=True)
    mf_license_number = Column(String, nullable=True)
    mf_authorization_date = Column(DateTime, nullable=True)
    website = Column(String, nullable=True)
    status = Column(Enum(OperatorStatus), default=OperatorStatus.active)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    contacts = relationship("OperatorContact", back_populates="operator", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="operator")
    collection_events = relationship("CollectionEvent", back_populates="operator")
    documents = relationship("Document", back_populates="operator")


class OperatorContact(Base):
    __tablename__ = "operator_contacts"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    type = Column(Enum(ContactType), nullable=False)
    value = Column(String, nullable=False)
    label = Column(String, nullable=True)
    source = Column(String, nullable=True)
    is_primary = Column(Boolean, default=False)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    operator = relationship("BettingOperator", back_populates="contacts")
