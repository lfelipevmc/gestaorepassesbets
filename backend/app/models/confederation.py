from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Confederation(Base):
    __tablename__ = "confederations"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    acronym = Column(String(20), nullable=False, unique=True)
    regulation_text = Column(Text, nullable=True)
    ggr_percentage = Column(Numeric(10, 6), nullable=True)
    payment_due_day = Column(Integer, default=10)
    contact_email = Column(String, nullable=True)
    finance_email = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    users = relationship("User", back_populates="confederation")
    collection_cycles = relationship("CollectionCycle", back_populates="confederation")
    payments = relationship("Payment", back_populates="confederation")
    documents = relationship("Document", back_populates="confederation")
