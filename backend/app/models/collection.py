from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Date
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class CycleStatus(str, enum.Enum):
    open = "open"
    collecting = "collecting"
    checking = "checking"
    closed = "closed"


class EventType(str, enum.Enum):
    notification_sent = "notification_sent"
    check_performed = "check_performed"
    payment_confirmed = "payment_confirmed"
    payment_unconfirmed = "payment_unconfirmed"
    report_requested = "report_requested"
    report_received = "report_received"
    manual_note = "manual_note"
    email_read = "email_read"
    phone_contact = "phone_contact"


class EventChannel(str, enum.Enum):
    email = "email"
    whatsapp = "whatsapp"
    phone = "phone"
    system = "system"
    manual = "manual"


class CollectionCycle(Base):
    __tablename__ = "collection_cycles"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    reference_month = Column(Date, nullable=False)
    status = Column(Enum(CycleStatus), default=CycleStatus.open)
    template_id = Column(Integer, ForeignKey("message_templates.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    confederation = relationship("Confederation", back_populates="collection_cycles")
    events = relationship("CollectionEvent", back_populates="cycle")
    payments = relationship("Payment", back_populates="cycle")
    template = relationship("MessageTemplate")


class CollectionEvent(Base):
    __tablename__ = "collection_events"
    id = Column(Integer, primary_key=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=False)
    event_type = Column(Enum(EventType), nullable=False)
    channel = Column(Enum(EventChannel), nullable=False)
    notes = Column(Text, nullable=True)
    performed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    performed_at = Column(DateTime, server_default=func.now())

    cycle = relationship("CollectionCycle", back_populates="events")
    operator = relationship("BettingOperator", back_populates="collection_events")
    performed_by = relationship("User")
