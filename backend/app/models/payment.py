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
    not_sports = "not_sports"      # não explora esporte (não deve contrapartida neste mês)
    judicialized = "judicialized"  # questão judicializada — cobrança suspensa/sub judice


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    # IMPORTANTE: o valor NÃO é calculado pelo escritório. Quem apura é o agente operador
    # (CBT/CBTM Art. 4º e 8º §2º; CBW Art. 10 §único). O escritório apenas registra o valor
    # informado/repassado pelo operador e concilia com o relatório recebido.
    base_calculo = Column(Numeric(15, 2), nullable=True)       # Base de Cálculo apurada pelo operador (do relatório)
    amount_due = Column(Numeric(15, 2), nullable=True)          # Valor devido informado pelo operador
    amount_paid = Column(Numeric(15, 2), nullable=True)         # Valor efetivamente recebido (regime de caixa)
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
    receipts = relationship("PaymentReceipt", back_populates="payment", cascade="all, delete-orphan")


class PaymentReceipt(Base):
    """Repasse individual recebido. Uma Bet pode repassar em mais de uma oportunidade no mesmo
    mês/confederação — cada repasse é um receipt. Payment.amount_paid = soma dos receipts."""
    __tablename__ = "payment_receipts"
    id = Column(Integer, primary_key=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    received_date = Column(Date, nullable=False)
    report_received = Column(Boolean, default=False)
    report_reference_month = Column(Date, nullable=True)
    report_notes = Column(Text, nullable=True)
    report_file_url = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    confirmed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    payment = relationship("Payment", back_populates="receipts")
    confirmed_by = relationship("User")


class ENDRPayment(Base):
    """Repasse único do ENDR cobrindo múltiplas bets.

    IMPORTANTE (regra de negócio): quando o ENDR repassa, ainda NÃO se sabe a competência
    nem quais operadores estão cobertos — isso só chega com o relatório (~30 dias depois),
    que informa total, competência e a lista de operadores (sem individualizar valores).
    Por isso reference_month e bet_links podem ser preenchidos posteriormente."""
    __tablename__ = "endr_payments"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    reference_month = Column(Date, nullable=True)   # competência: definida ao receber o relatório
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


class DirectPayment(Base):
    """Lançamento avulso de valor recebido de uma Bet, sem vínculo com ciclo de cobrança."""
    __tablename__ = "direct_payments"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    # Mês de competência: pode ser desconhecido no ato do recebimento (só se sabe com o relatório
    # da Bet). Nulo = "a definir"; o usuário informa depois via edição do lançamento.
    reference_month = Column(Date, nullable=True)
    amount_received = Column(Numeric(15, 2), nullable=False)
    received_date = Column(Date, nullable=False)     # data em que o valor foi recebido (regime de caixa)
    notes = Column(Text, nullable=True)
    report_file_url = Column(String(500), nullable=True)
    registered_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    operator = relationship("BettingOperator")
    confederation = relationship("Confederation")
    registered_by = relationship("User")
