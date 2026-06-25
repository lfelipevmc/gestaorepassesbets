from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Boolean, Text, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class SuggestionStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


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

    # Address (from CNPJ)
    address_street = Column(String, nullable=True)
    address_number = Column(String(20), nullable=True)
    address_complement = Column(String, nullable=True)
    address_neighborhood = Column(String, nullable=True)
    address_city = Column(String, nullable=True)
    address_state = Column(String(2), nullable=True)
    address_zip = Column(String(9), nullable=True)  # 00000-000

    # Authorization
    authorization_number = Column(String, nullable=True)   # portaria/número da autorização
    authorization_date = Column(DateTime, nullable=True)   # data da autorização MF (cobrança só a partir desta data)

    contacts = relationship("OperatorContact", back_populates="operator", cascade="all, delete-orphan")
    payments = relationship("Payment", back_populates="operator")
    collection_events = relationship("CollectionEvent", back_populates="operator")
    documents = relationship("Document", back_populates="operator")
    brands = relationship("OperatorBrand", back_populates="operator", cascade="all, delete-orphan")
    endr_associations = relationship("EndrAssociation", back_populates="operator", cascade="all, delete-orphan")
    contact_suggestions = relationship("ContactSuggestion", back_populates="operator", cascade="all, delete-orphan")


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


class OperatorBrand(Base):
    """Marcas vinculadas a um agente operador (até 3 por operador)."""
    __tablename__ = "operator_brands"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    name = Column(String, nullable=False)           # nome da marca
    website = Column(String, nullable=True)
    instagram = Column(String, nullable=True)
    twitter = Column(String, nullable=True)
    facebook = Column(String, nullable=True)
    other_social = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    operator = relationship("BettingOperator", back_populates="brands")


class ENDREntity(Base):
    """Dados cadastrais do ENDR (entidade única no sistema)."""
    __tablename__ = "endr_entity"
    id = Column(Integer, primary_key=True, default=1)
    name = Column(String(300), default="ENDR – Escritório Nacional de Direitos de Rateio")
    cnpj = Column(String(20), nullable=True)
    website = Column(String(300), nullable=True)
    phone = Column(String(50), nullable=True)
    email = Column(String(200), nullable=True)
    address = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime, onupdate=func.now())


class EndrAssociation(Base):
    """Associação mensal ao ENDR (Escritório Nacional de Rateios).
    Se associada em dado mês, a bet não deve ser cobrada naquele mês."""
    __tablename__ = "endr_associations"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    reference_month = Column(Date, nullable=False)  # primeiro dia do mês de referência
    is_associated = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    operator = relationship("BettingOperator", back_populates="endr_associations")
    updated_by = relationship("User")


class ContactSuggestion(Base):
    """Sugestões de contato encontradas automaticamente, aguardando revisão humana."""
    __tablename__ = "contact_suggestions"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    type = Column(Enum(ContactType), nullable=False)
    value = Column(String, nullable=False)
    source = Column(String, nullable=False)
    source_url = Column(String, nullable=True)
    relationship_label = Column("relationship", String, nullable=True)
    confidence = Column(String(10), nullable=True)  # "high", "medium", "low"
    status = Column(Enum(SuggestionStatus), default=SuggestionStatus.pending)
    notes = Column(Text, nullable=True)
    found_at = Column(DateTime, server_default=func.now())
    reviewed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    operator = relationship("BettingOperator", back_populates="contact_suggestions")
    reviewed_by = relationship("User")
