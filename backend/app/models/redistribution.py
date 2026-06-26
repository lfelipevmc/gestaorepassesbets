from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Numeric, Date, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class RedistributionSource(str, enum.Enum):
    payment = "payment"   # repasse direto de uma operadora
    endr = "endr"         # repasse consolidado via ENDR
    manual = "manual"


class RedistributionStatus(str, enum.Enum):
    pending = "pending"       # nenhum item repassado
    partial = "partial"       # parte dos itens repassada
    completed = "completed"   # todos os beneficiários repassados


class ItemStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"


class Redistribution(Base):
    """Fase 2 — reversão de um valor recebido (por competição/repasse) aos beneficiários finais.

    O prazo (deadline_date) deriva de Confederation.redistribution_deadline_days
    (ex.: CBW Art. 13 = 90 dias do efetivo recebimento).
    """
    __tablename__ = "redistributions"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    source_type = Column(Enum(RedistributionSource), default=RedistributionSource.manual)
    source_payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    source_endr_id = Column(Integer, ForeignKey("endr_payments.id"), nullable=True)
    source_direct_payment_id = Column(Integer, ForeignKey("direct_payments.id"), nullable=True)
    competition_name = Column(String(300), nullable=True)
    reference_month = Column(Date, nullable=True)
    amount_received = Column(Numeric(15, 2), nullable=False)   # valor recebido (Fase 1) a redistribuir
    received_date = Column(Date, nullable=False)
    deadline_date = Column(Date, nullable=True)                # prazo final para repasse aos beneficiários
    status = Column(Enum(RedistributionStatus), default=RedistributionStatus.pending)
    notes = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    confederation = relationship("Confederation")
    items = relationship("RedistributionItem", back_populates="redistribution", cascade="all, delete-orphan")
    created_by = relationship("User")


class RedistributionItem(Base):
    """Parcela devida a um beneficiário dentro de uma redistribuição."""
    __tablename__ = "redistribution_items"
    id = Column(Integer, primary_key=True)
    redistribution_id = Column(Integer, ForeignKey("redistributions.id"), nullable=False)
    beneficiary_id = Column(Integer, ForeignKey("beneficiaries.id"), nullable=True)
    beneficiary_label = Column(String(300), nullable=True)   # snapshot do nome
    category = Column(String(30), nullable=True)             # confederacao/atleta/clube/federacao
    amount = Column(Numeric(15, 2), nullable=False)
    status = Column(Enum(ItemStatus), default=ItemStatus.pending)
    paid_date = Column(Date, nullable=True)
    proof_file_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)

    redistribution = relationship("Redistribution", back_populates="items")
    beneficiary = relationship("Beneficiary")
