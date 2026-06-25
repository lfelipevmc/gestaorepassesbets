from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Confederation(Base):
    __tablename__ = "confederations"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    acronym = Column(String(20), nullable=False, unique=True)
    # Dados empresariais
    cnpj = Column(String(20), nullable=True)
    website = Column(String(300), nullable=True)
    phone = Column(String(50), nullable=True)
    address = Column(String(500), nullable=True)
    # Presidente
    president_name = Column(String(200), nullable=True)
    president_email = Column(String(200), nullable=True)
    president_phone = Column(String(50), nullable=True)
    president_term = Column(String(100), nullable=True)
    # Logomarca
    logo_url = Column(String(500), nullable=True)
    # Regulamento e rateio
    regulation_text = Column(Text, nullable=True)
    rateio_rules = Column(Text, nullable=True)
    # Contatos e cobrança
    contact_email = Column(String, nullable=True)
    finance_email = Column(String, nullable=True)
    payment_due_day = Column(Integer, default=10)
    # Prazo (dias) para repasse aos beneficiários finais após o recebimento (ex: CBW 90 dias)
    redistribution_deadline_days = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    users = relationship("User", back_populates="confederation")
    collection_cycles = relationship("CollectionCycle", back_populates="confederation")
    payments = relationship("Payment", back_populates="confederation")
    documents = relationship("Document", back_populates="confederation")
    distribution_rules = relationship("DistributionRule", back_populates="confederation", cascade="all, delete-orphan")


class DistributionRule(Base):
    """Matriz de rateio por cenário de competição, conforme o regulamento interno da confederação.

    O rateio NÃO é um percentual fixo por bet: depende do tipo de competição (internacional/nacional),
    da participação de integrantes do Sinesp e é apurado por partida pelo próprio agente operador.
    Esta tabela documenta como a confederação redistribui as Contrapartidas recebidas.
    """
    __tablename__ = "distribution_rules"
    id = Column(Integer, primary_key=True)
    confederation_id = Column(Integer, ForeignKey("confederations.id"), nullable=False)
    scenario_code = Column(String(50), nullable=False)   # ex: intl_no_sinesp, intl_sinesp, nacional_sinesp
    scenario_label = Column(String(200), nullable=False)
    article_ref = Column(String(50), nullable=True)      # ex: "Art. 6º"
    # Percentuais fixos quando o regulamento os especifica (ex: CBW). Nulo quando "equânime/variável".
    confederation_pct = Column(Numeric(6, 4), nullable=True)
    athlete_pct = Column(Numeric(6, 4), nullable=True)        # atleta(s)
    entity_pct = Column(Numeric(6, 4), nullable=True)         # entidade de prática esportiva (clube)
    federation_pct = Column(Numeric(6, 4), nullable=True)     # federação estadual
    is_equanime = Column(Boolean, default=False)             # rateio igualitário entre participantes do Sinesp
    description = Column(Text, nullable=True)                # texto da regra (do regulamento)
    order_index = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    confederation = relationship("Confederation", back_populates="distribution_rules")
    updated_by = relationship("User")
