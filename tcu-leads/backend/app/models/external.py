"""
Radar Externo — fontes externas monitoradas para captação de leads.

Cobre:
  - DOU (Diário Oficial da União) via API da Imprensa Nacional (embutido);
  - Sites/portais e feeds RSS que o escritório cadastra (embaixadas, estatais,
    grandes empresas, etc.).

Cada achado novo vira um lead na lista de Oportunidades, com selo de origem
(source_kind = dou | fonte_web) e categoria (licitação/sanção/nomeação/palavra-chave).
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Text
from sqlalchemy.sql import func
import enum
from ..database import Base


class MonitoredSourceKind(str, enum.Enum):
    rss = "rss"           # feed RSS/Atom
    webpage = "webpage"   # página HTML (extrai links/itens)


class MonitoredSource(Base):
    """Fonte web cadastrada pelo usuário (embaixada, empresa, portal...)."""
    __tablename__ = "monitored_sources"

    id = Column(Integer, primary_key=True)
    name = Column(String(200), nullable=False)          # ex.: "Embaixada da França — Licitações"
    kind = Column(String(20), default="rss")            # rss | webpage
    url = Column(String(700), nullable=False)
    enabled = Column(Boolean, default=True)
    keywords = Column(Text, nullable=True)              # palavras-chave (uma por linha ou vírgula)
    categoria_padrao = Column(String(30), nullable=True)  # categoria a aplicar por padrão (opcional)
    notes = Column(Text, nullable=True)
    # seletor CSS opcional para páginas HTML (itens); vazio = heurística de links
    item_selector = Column(String(300), nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    last_status = Column(String(200), nullable=True)
    items_found = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ExternalSeenItem(Base):
    """Itens já vistos numa fonte (dedupe por hash de URL/título)."""
    __tablename__ = "external_seen_items"

    id = Column(Integer, primary_key=True)
    source_ref = Column(String(120), index=True)   # "dou:do3" ou "monitored:<id>"
    item_hash = Column(String(64), unique=True, index=True)
    title = Column(String(600), nullable=True)
    url = Column(String(700), nullable=True)
    lead_id = Column(Integer, nullable=True)
    seen_at = Column(DateTime, server_default=func.now())
