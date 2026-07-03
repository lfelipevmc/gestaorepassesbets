"""
Modelos do módulo "Radar TCU" — captação de oportunidades a partir do
Diário Eletrônico/BTCU e das APIs abertas do Tribunal de Contas da União.

Postura de conformidade (roteiro técnico §3 e Recomendação 4):
  Este módulo é uma FERRAMENTA INTERNA DE INTELIGÊNCIA para priorizar trabalho
  e qualificar oportunidades a partir de dados públicos (Diário Oficial/BTCU).
  NÃO realiza contato ativo/automático com as partes intimadas (vedação da
  captação de clientela — OAB Provimento 205/2021, arts. 3º e 6º). Cada lead
  carrega uma flag de objeção LGPD e o registro da base de legítimo interesse.
"""
from sqlalchemy import (
    Column, Integer, String, DateTime, Enum, ForeignKey, Boolean, Text, Date, Numeric, Float
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from ..database import Base


class TcuActType(str, enum.Enum):
    """Instrumento processual que originou a oportunidade (roteiro §2)."""
    citacao = "citacao"                      # débito — 15 dias p/ alegações de defesa (mais forte)
    audiencia = "audiencia"                  # irregularidade sem débito — razões de justificativa
    notificacao = "notificacao"              # ciência de acórdão à parte/advogado
    acordao_condenatorio = "acordao_condenatorio"
    edital = "edital"                        # edital SEPROC genérico
    outro = "outro"


class TcuDocType(str, enum.Enum):
    cpf = "cpf"
    cnpj = "cnpj"
    desconhecido = "desconhecido"


class TcuLeadStatus(str, enum.Enum):
    """Fluxo CRM interno de qualificação (roteiro §4 — componente CRM)."""
    novo = "novo"
    qualificado = "qualificado"
    em_analise = "em_analise"
    contatado = "contatado"
    em_atendimento = "em_atendimento"
    descartado = "descartado"


class TcuSourceKind(str, enum.Enum):
    btcu_deliberacoes = "btcu_deliberacoes"  # PDF do caderno "Deliberações dos Colegiados"
    acordaos_api = "acordaos_api"            # webservice de Acórdãos (dados abertos)
    pauta_sessao = "pauta_sessao"            # pautas das sessões (early-warning)
    ingestao_manual = "ingestao_manual"      # PDF/texto colado manualmente


class TcuRunStatus(str, enum.Enum):
    running = "running"
    success = "success"
    partial = "partial"
    error = "error"


class TcuLead(Base):
    """Oportunidade extraída do Diário/APIs do TCU, pendente de qualificação humana."""
    __tablename__ = "tcu_leads"

    id = Column(Integer, primary_key=True)

    # --- Classificação do ato ---
    act_type = Column(Enum(TcuActType), default=TcuActType.outro, index=True)
    natureza_processo = Column(String(200), nullable=True)   # TCE, Representação, Denúncia, Recurso...
    tema = Column(String(80), nullable=True, index=True)     # educacao_fnde, saude, licitacoes...

    # --- Processo / referências ---
    numero_processo = Column(String(40), nullable=True, index=True)  # TC nnn.nnn/aaaa-n
    edital_numero = Column(String(20), nullable=True)                # nnnn/aaaa (SEPROC)
    acordao_ref = Column(String(20), nullable=True)                  # nnnn/aaaa
    colegiado = Column(String(60), nullable=True)                    # Plenário / 1ª Câmara / 2ª Câmara
    relator = Column(String(200), nullable=True)
    unidade_tecnica = Column(String(120), nullable=True)             # AudTCE, SecexEstado...

    # --- Responsável (parte) ---
    responsavel_nome = Column(String(300), nullable=True, index=True)
    responsavel_documento = Column(String(20), nullable=True, index=True)  # CPF/CNPJ mascarado
    doc_type = Column(Enum(TcuDocType), default=TcuDocType.desconhecido)
    papel = Column(String(120), nullable=True)               # responsável / solidário / representante legal
    orgao_entidade = Column(String(300), nullable=True)      # órgão/entidade lesada
    uf = Column(String(2), nullable=True, index=True)
    municipio = Column(String(120), nullable=True)
    ja_representado = Column(Boolean, default=False)         # "Representação legal" / OAB no texto

    # --- Valores ---
    valor_debito = Column(Numeric(16, 2), nullable=True)
    valor_multa = Column(Numeric(16, 2), nullable=True)
    data_referencia_valor = Column(Date, nullable=True)

    # --- Prazos ---
    prazo_dias = Column(Integer, nullable=True)
    data_publicacao = Column(Date, nullable=True, index=True)
    prazo_final = Column(Date, nullable=True, index=True)

    # --- Resumo / score IA ---
    resumo = Column(Text, nullable=True)
    is_opportunity = Column(Boolean, default=True, index=True)
    opportunity_score = Column(Integer, nullable=True)       # 0-100
    rationale = Column(Text, nullable=True)
    confidence = Column(String(10), nullable=True)           # high | medium | low
    extracted_by_ai = Column(Boolean, default=False)

    # --- Proveniência ---
    source_kind = Column(Enum(TcuSourceKind), default=TcuSourceKind.btcu_deliberacoes)
    source_codigo = Column(String(60), nullable=True)        # código de autenticidade do PDF
    source_key = Column(String(120), nullable=True)          # key da Pesquisa Integrada / Acórdão
    source_url = Column(String(500), nullable=True)
    content_hash = Column(String(64), nullable=True, unique=True, index=True)
    raw_text = Column(Text, nullable=True)

    # --- CRM ---
    status = Column(Enum(TcuLeadStatus), default=TcuLeadStatus.novo, index=True)
    assignee_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # --- Conformidade LGPD/OAB ---
    lgpd_objection = Column(Boolean, default=False)          # titular exerceu direito de oposição
    legitimate_interest_basis = Column(Text, nullable=True)  # registro do teste de balanceamento por lead

    created_at = Column(DateTime, server_default=func.now(), index=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    assignee = relationship("User")
    notes = relationship("TcuLeadNote", back_populates="lead", cascade="all, delete-orphan",
                         order_by="TcuLeadNote.created_at.desc()")
    enrichment = relationship("TcuCnpjEnrichment", back_populates="lead", uselist=False,
                              cascade="all, delete-orphan")


class TcuLeadNote(Base):
    """Anotação / evento na linha do tempo de um lead (trilha de qualificação)."""
    __tablename__ = "tcu_lead_notes"

    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("tcu_leads.id"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    kind = Column(String(30), default="nota")   # nota | status_change | contato | lembrete
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    lead = relationship("TcuLead", back_populates="notes")
    author = relationship("User")


class TcuCnpjEnrichment(Base):
    """Cache do enriquecimento de CNPJ (BrasilAPI/Receita) associado a um lead PJ.

    CPF NÃO é enriquecido (roteiro §3): apenas o que o TCU já publica.
    """
    __tablename__ = "tcu_cnpj_enrichment"

    id = Column(Integer, primary_key=True)
    lead_id = Column(Integer, ForeignKey("tcu_leads.id"), nullable=False, unique=True)
    cnpj = Column(String(20), nullable=False, index=True)
    razao_social = Column(String(300), nullable=True)
    nome_fantasia = Column(String(300), nullable=True)
    situacao_cadastral = Column(String(60), nullable=True)
    porte = Column(String(60), nullable=True)
    cnae_principal = Column(String(200), nullable=True)
    natureza_juridica = Column(String(200), nullable=True)
    capital_social = Column(Float, nullable=True)
    logradouro = Column(String(300), nullable=True)
    municipio = Column(String(120), nullable=True)
    uf = Column(String(2), nullable=True)
    cep = Column(String(12), nullable=True)
    email = Column(String(200), nullable=True)
    telefone = Column(String(60), nullable=True)
    socios = Column(Text, nullable=True)          # JSON serializado do QSA
    raw = Column(Text, nullable=True)             # JSON bruto (auditoria)
    source = Column(String(60), default="BrasilAPI")
    fetched_at = Column(DateTime, server_default=func.now())

    lead = relationship("TcuLead", back_populates="enrichment")


class TcuMonitorRun(Base):
    """Registro de cada execução do pipeline diário (auditoria + estado de fonte)."""
    __tablename__ = "tcu_monitor_runs"

    id = Column(Integer, primary_key=True)
    started_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)
    status = Column(Enum(TcuRunStatus), default=TcuRunStatus.running)
    trigger = Column(String(20), default="scheduler")   # scheduler | manual | ingest
    editions_processed = Column(Integer, default=0)
    blocks_parsed = Column(Integer, default=0)
    leads_created = Column(Integer, default=0)
    leads_duplicated = Column(Integer, default=0)
    last_acordao_index = Column(Integer, nullable=True)  # estado de paginação da API de Acórdãos
    detail = Column(Text, nullable=True)                 # JSON com fontes/erros
    error = Column(Text, nullable=True)


class TcuMonitorSettings(Base):
    """Configuração única (singleton, id=1) do radar TCU."""
    __tablename__ = "tcu_monitor_settings"

    id = Column(Integer, primary_key=True, default=1)
    enabled = Column(Boolean, default=False)             # liga o job diário
    run_hour = Column(Integer, default=7)                # hora (evitar janela 20-21h de manutenção)
    run_minute = Column(Integer, default=30)

    # Fonte Acórdãos (confirmada)
    acordaos_enabled = Column(Boolean, default=True)
    acordaos_page_size = Column(Integer, default=50)
    last_acordao_index = Column(Integer, nullable=True)

    # Fonte BTCU "Deliberações" — endpoint de LISTAGEM não é documentado (lacuna do roteiro).
    # Deve ser capturado via DevTools e colado aqui. Ex.: URL com placeholders {data} etc.
    btcu_enabled = Column(Boolean, default=False)
    btcu_listing_url = Column(String(500), nullable=True)   # capturado do front-end (DevTools → Network)
    btcu_listing_method = Column(String(6), default="GET")
    btcu_listing_body = Column(Text, nullable=True)         # corpo JSON (se POST), com {data_inicio}/{data_fim}

    # Fonte pautas (early-warning)
    pautas_enabled = Column(Boolean, default=True)

    # Enriquecimento
    enrich_cnpj = Column(Boolean, default=True)
    enrich_cache_days = Column(Integer, default=40)

    # Filtro de oportunidade (para priorização; não exclui do banco)
    min_debito_alerta = Column(Numeric(16, 2), nullable=True)

    # Rede
    request_delay_seconds = Column(Float, default=3.0)
    user_agent = Column(String(200), default="RadarTCU/1.0 (monitoramento juridico interno)")
    contact_email = Column(String(200), nullable=True)

    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
