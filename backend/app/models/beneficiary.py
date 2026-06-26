from sqlalchemy import Column, Integer, String, DateTime, Enum, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class BeneficiaryType(str, enum.Enum):
    confederacao = "confederacao"     # a própria confederação
    atleta = "atleta"                 # atleta brasileiro
    clube = "clube"                   # entidade de prática esportiva (clube)
    federacao = "federacao"           # federação estadual
    outro = "outro"


class Beneficiary(Base):
    """Beneficiário final da Fase 2 (reversão): atleta, clube, federação ou a confederação."""
    __tablename__ = "beneficiaries"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    type = Column(Enum(BeneficiaryType), nullable=False)
    name = Column(String(300), nullable=False)
    document = Column(String(20), nullable=True)        # CPF ou CNPJ
    email = Column(String(200), nullable=True)
    phone = Column(String(50), nullable=True)
    # Dados bancários (condição para repasse — CBW Art. 12)
    bank_name = Column(String(120), nullable=True)
    bank_agency = Column(String(30), nullable=True)
    bank_account = Column(String(40), nullable=True)
    pix_key = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    confederation = relationship("Confederation")
