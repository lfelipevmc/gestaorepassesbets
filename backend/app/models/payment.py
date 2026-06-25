from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Numeric, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    partial = "partial"
    paid = "paid"
    overdue = "overdue"


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    ggr_declared = Column(Numeric(15, 2), nullable=True)
    calculated_amount = Column(Numeric(15, 2), nullable=True)
    amount_paid = Column(Numeric(15, 2), nullable=True)
    payment_date = Column(Date, nullable=True)
    payment_confirmed_at = Column(DateTime, nullable=True)
    confirmed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(Enum(PaymentStatus), default=PaymentStatus.pending)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    cycle = relationship("CollectionCycle", back_populates="payments")
    operator = relationship("BettingOperator", back_populates="payments")
    confederation = relationship("Confederation", back_populates="payments")
    confirmed_by = relationship("User")
