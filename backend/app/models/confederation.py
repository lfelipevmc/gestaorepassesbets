from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Confederation(Base):
    __tablename__ = "confederations"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    acronym = Column(String(20), nullable=False, unique=True)
    # Dados empresariais
    cnpj = Column(String(20), nullable=True)
    website = Column(String(300), nullable=True)
    phone = Column(String(50), nullable=True)
    address = Column(String(500), nullable=True)
    # Presidente
    president_name = Column(String(200), nullable=True)
    president_email = Column(String(200), nullable=True)
    president_phone = Column(String(50), nullable=True)
    president_term = Column(String(100), nullable=True)
    # Logomarca
    logo_url = Column(String(500), nullable=True)
    # Regulamento e rateio
    regulation_text = Column(Text, nullable=True)
    rateio_rules = Column(Text, nullable=True)
    # Contatos e cobrança
    contact_email = Column(String, nullable=True)
    finance_email = Column(String, nullable=True)
    payment_due_day = Column(Integer, default=10)
    # Percentual padrão (sobrescrito por OperatorConfederationRule quando configurado por bet)
    ggr_percentage = Column(Numeric(10, 6), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    users = relationship("User", back_populates="confederation")
    collection_cycles = relationship("CollectionCycle", back_populates="confederation")
    payments = relationship("Payment", back_populates="confederation")
    documents = relationship("Document", back_populates="confederation")
    operator_rules = relationship("OperatorConfederationRule", back_populates="confederation")


class OperatorConfederationRule(Base):
    """Percentual de rateio específico por agente operador por confederação."""
    __tablename__ = "operator_confederation_rules"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    percentage = Column(Numeric(10, 6), nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    confederation = relationship("Confederation", back_populates="operator_rules")
    operator = relationship("BettingOperator")
    updated_by = relationship("User")
