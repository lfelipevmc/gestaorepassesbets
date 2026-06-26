from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class DocumentType(str, enum.Enum):
    notification = "notification"
    receipt = "receipt"
    report = "report"
    regulation = "regulation"
    correspondence = "correspondence"
    ggr_report = "ggr_report"
    contract = "contract"
    other = "other"


class DocumentCategory(str, enum.Enum):
    """Natureza do documento: rascunho/minuta em elaboração ou documento oficial assinado/protocolado."""
    minuta = "minuta"
    documento_oficial = "documento_oficial"


class Document(Base):
    __tablename__ = "documents"
    id = Column(Integer, primary_key=True)
    operator_id = Column(Integer, ForeignKey("betting_operators.id"), nullable=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=True)
    cycle_id = Column(Integer, ForeignKey("collection_cycles.id"), nullable=True)
    payment_id = Column(Integer, ForeignKey("payments.id"), nullable=True)
    title = Column(String, nullable=False)
    document_type = Column(Enum(DocumentType), nullable=False)
    category = Column(Enum(DocumentCategory), nullable=False, default=DocumentCategory.documento_oficial)
    file_path = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    file_size = Column(BigInteger, nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    operator = relationship("BettingOperator", back_populates="documents")
    confederation = relationship("Confederation", back_populates="documents")
    uploaded_by = relationship("User")
