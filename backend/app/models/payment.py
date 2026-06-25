from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Numeric, Date, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    partial = "partial"
    paid = "paid"              # pago + relatório recebido
    report_pending = "report_pending"  # pago mas aguardando relatório (adimplente sem relatório)
    overdue = "overdue"


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    ggr_declared = Column(Numeric(15, 2), nullable=True)
    operator_percentage = Column(Numeric(10, 6), nullable=True)  # % individual da bet
    calculated_amount = Column(Numeric(15, 2), nullable=True)
    amount_paid = Column(Numeric(15, 2), nullable=True)
    payment_date = Column(Date, nullable=True)
    payment_confirmed_at = Column(DateTime, nullable=True)
    confirmed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.pending)
    notes = Column(Text, nullable=True)
    # Relatório (regime de caixa: valor recebido no mês X pode ser referente ao mês Y)
    report_received = Column(Boolean, default=False)
    report_reference_month = Column(Date, nullable=True)  # mês de competência informado no relatório
    report_notes = Column(Text, nullable=True)
    report_file_url = Column(String(500), nullable=True)
    report_received_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    cycle = relationship("CollectionCycle", back_populates="payments")
    operator = relationship("BettingOperator", back_populates="payments")
    confederation = relationship("Confederation", back_populates="payments")
    confirmed_by = relationship("User")


class ENDRPayment(Base):
    """Repasse único do ENDR cobrindo múltiplas bets."""
    __tablename__ = "endr_payments"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    reference_month = Column(Date, nullable=False)
    amount_received = Column(Numeric(15, 2), nullable=False)
    received_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=True)
    report_file_url = Column(String(500), nullable=True)
    registered_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    confederation = relationship("Confederation")
    registered_by = relationship("User")
    bet_links = relationship("ENDRPaymentBetLink", back_populates="endr_payment", cascade="all, delete-orphan")


class ENDRPaymentBetLink(Base):
    """Quais bets fizeram repasse via ENDR em determinado mês."""
    __tablename__ = "endr_payment_bet_links"
    id = Column(Integer, primary_key=True)
    endr_payment_id = Column(Integer, ForeignKey("endr_payments.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    notes = Column(String(300), nullable=True)

    endr_payment = relationship("ENDRPayment", back_populates="bet_links")
    operator = relationship("BettingOperator")
