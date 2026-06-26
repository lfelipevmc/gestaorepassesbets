from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from ..database import Base


class OfficeSettings(Base):
    """Dados cadastrais do escritório (registro único — id=1)."""
    __tablename__ = "office_settings"
    id = Column(Integer, primary_key=True, default=1)
    name = Column(String(300), default="Escritório Jurídico")
    legal_name = Column(String(300), nullable=True)   # razão social
    cnpj = Column(String(20), nullable=True)
    email = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    website = Column(String(200), nullable=True)
    address = Column(String(500), nullable=True)
    city = Column(String(120), nullable=True)
    logo_url = Column(String(500), nullable=True)
    signature_name = Column(String(200), nullable=True)   # nome de quem assina as comunicações
    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime, onupdate=func.now())
