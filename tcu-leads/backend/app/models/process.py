"""
Rastreamento de processos autuados no TCU.

Ideia (pedido do escritório): a cada dia o sistema tira uma "fotografia" da lista
de processos do TCU e a compara com a já conhecida. Todo número de processo
inédito é considerado AUTUADO naquele dia (detection_date). Isso captura
integralmente os processos abertos no dia — e cada um pode revelar um lead.

A detecção é alimentada por duas vias:
  1. números de processo vistos em qualquer fonte do pipeline (editais, acórdãos,
     pautas) — registro automático;
  2. uma fonte dedicada de "listagem de processos" (configurável), que traz a
     lista completa do dia para a comparação.
"""
from sqlalchemy import Column, Integer, String, DateTime, Date, Text, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class TrackedProcess(Base):
    __tablename__ = "tracked_processes"

    id = Column(Integer, primary_key=True)
    numero_processo = Column(String(40), unique=True, nullable=False, index=True)

    # metadados quando disponíveis
    natureza = Column(String(200), nullable=True)
    tipo = Column(String(120), nullable=True)
    assunto = Column(String(500), nullable=True)         # assunto do processo
    orgao_entidade = Column(String(300), nullable=True)
    relator = Column(String(200), nullable=True)
    colegiado = Column(String(80), nullable=True)
    uf = Column(String(2), nullable=True)
    municipio = Column(String(120), nullable=True)
    titulo = Column(String(500), nullable=True)
    responsaveis_json = Column(Text, nullable=True)      # JSON: responsáveis do processo
    estado = Column(String(40), nullable=True)           # Aberto / Encerrado
    ultima_movimentacao = Column(String(500), nullable=True)
    data_autuacao = Column(Date, nullable=True)          # data do 1º andamento (autuação), se conhecida

    first_source = Column(String(40), nullable=True)     # onde foi visto pela primeira vez
    detection_date = Column(Date, nullable=True, index=True)  # dia em que foi detectado como inédito
    first_seen_at = Column(DateTime, server_default=func.now())

    lead_id = Column(Integer, ForeignKey("tcu_leads.id"), nullable=True)  # lead gerado, se houver
    raw = Column(Text, nullable=True)

    @property
    def responsaveis(self) -> list:
        import json as _json
        if self.responsaveis_json:
            try:
                data = _json.loads(self.responsaveis_json)
                if isinstance(data, list):
                    return data
            except (ValueError, TypeError):
                pass
        return []
