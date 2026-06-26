from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class TemplateOccasion(str, enum.Enum):
    first_notification = "first_notification"
    second_notification = "second_notification"
    final_notice = "final_notice"
    report_request = "report_request"
    receipt_ack = "receipt_ack"
    custom = "custom"


class MessageTemplate(Base):
    """Texto padrão de cobrança por ocasião. Suporta placeholders substituídos no envio:
    {bet}, {confederacao}, {mes}, {valor}, {prazo}, {escritorio}.
    confederation_id nulo = template global (vale para todas)."""
    __tablename__ = "message_templates"
    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)
    occasion = Column(Enum(TemplateOccasion), default=TemplateOccasion.custom)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=True)
    subject = Column(String(300), nullable=False)
    body = Column(Text, nullable=False)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    confederation = relationship("Confederation")


class EmailDirection(str, enum.Enum):
    outbound = "outbound"
    inbound = "inbound"


class EmailMessage(Base):
    """Registro de e-mails enviados e respostas recebidas, para conciliação por Bet/cobrança.

    Respostas são casadas com o e-mail enviado via graph_conversation_id (thread do Outlook).
    """
    __tablename__ = "email_messages"
    id = Column(Integer, primary_key=True)
    direction = Column(Enum(EmailDirection), nullable=False)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=True)
    subject = Column(String(500), nullable=True)
    body_preview = Column(Text, nullable=True)
    from_addr = Column(String(300), nullable=True)
    to_addr = Column(String(500), nullable=True)
    graph_message_id = Column(String(400), nullable=True)
    graph_conversation_id = Column(String(400), nullable=True, index=True)
    protocol = Column(String(40), nullable=True)   # protocolo único de envio (comprovante)
    channel = Column(String(20), nullable=True)    # email / whatsapp / phone / social (registro do contato)
    matched = Column(Boolean, default=False)   # resposta vinculada a um envio
    sent_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    operator = relationship("BettingOperator")
