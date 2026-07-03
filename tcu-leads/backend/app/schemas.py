from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal
from .models.lead import TcuActType, TcuDocType, TcuLeadStatus, TcuSourceKind, TcuRunStatus


# ------------------------------ Auth ------------------------------ #

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_active: bool

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str = "membro"


# ------------------------------ Leads ------------------------------ #

class LeadNoteCreate(BaseModel):
    body: str
    kind: str = "nota"


class LeadNoteOut(BaseModel):
    id: int
    lead_id: int
    author_id: Optional[int] = None
    kind: str
    body: str
    created_at: datetime

    class Config:
        from_attributes = True


class CnpjEnrichmentOut(BaseModel):
    id: int
    cnpj: str
    razao_social: Optional[str] = None
    nome_fantasia: Optional[str] = None
    situacao_cadastral: Optional[str] = None
    porte: Optional[str] = None
    cnae_principal: Optional[str] = None
    natureza_juridica: Optional[str] = None
    capital_social: Optional[float] = None
    logradouro: Optional[str] = None
    municipio: Optional[str] = None
    uf: Optional[str] = None
    cep: Optional[str] = None
    email: Optional[str] = None
    telefone: Optional[str] = None
    socios: Optional[str] = None
    source: Optional[str] = None
    fetched_at: datetime

    class Config:
        from_attributes = True


class LeadOut(BaseModel):
    id: int
    act_type: TcuActType
    natureza_processo: Optional[str] = None
    tema: Optional[str] = None
    numero_processo: Optional[str] = None
    edital_numero: Optional[str] = None
    acordao_ref: Optional[str] = None
    colegiado: Optional[str] = None
    relator: Optional[str] = None
    unidade_tecnica: Optional[str] = None
    responsavel_nome: Optional[str] = None
    responsavel_documento: Optional[str] = None
    doc_type: TcuDocType
    papel: Optional[str] = None
    orgao_entidade: Optional[str] = None
    uf: Optional[str] = None
    municipio: Optional[str] = None
    ja_representado: bool
    valor_debito: Optional[Decimal] = None
    valor_multa: Optional[Decimal] = None
    data_referencia_valor: Optional[date] = None
    prazo_dias: Optional[int] = None
    data_publicacao: Optional[date] = None
    prazo_final: Optional[date] = None
    resumo: Optional[str] = None
    is_opportunity: bool
    opportunity_score: Optional[int] = None
    rationale: Optional[str] = None
    confidence: Optional[str] = None
    extracted_by_ai: bool
    source_kind: TcuSourceKind
    source_codigo: Optional[str] = None
    source_key: Optional[str] = None
    source_url: Optional[str] = None
    status: TcuLeadStatus
    assignee_id: Optional[int] = None
    lgpd_objection: bool
    legitimate_interest_basis: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LeadDetail(LeadOut):
    raw_text: Optional[str] = None
    notes: List[LeadNoteOut] = []
    enrichment: Optional[CnpjEnrichmentOut] = None


class LeadUpdate(BaseModel):
    status: Optional[TcuLeadStatus] = None
    assignee_id: Optional[int] = None
    tema: Optional[str] = None
    natureza_processo: Optional[str] = None
    is_opportunity: Optional[bool] = None
    lgpd_objection: Optional[bool] = None
    legitimate_interest_basis: Optional[str] = None


class IngestText(BaseModel):
    text: str
    publication_date: Optional[date] = None


# ------------------------------ Processos autuados ------------------------------ #

class TrackedProcessOut(BaseModel):
    id: int
    numero_processo: str
    natureza: Optional[str] = None
    tipo: Optional[str] = None
    orgao_entidade: Optional[str] = None
    relator: Optional[str] = None
    colegiado: Optional[str] = None
    uf: Optional[str] = None
    municipio: Optional[str] = None
    titulo: Optional[str] = None
    first_source: Optional[str] = None
    detection_date: Optional[date] = None
    first_seen_at: datetime
    lead_id: Optional[int] = None

    class Config:
        from_attributes = True


# ------------------------------ Configuração ------------------------------ #

class SettingsOut(BaseModel):
    id: int
    enabled: bool
    run_hour: int
    run_minute: int
    acordaos_enabled: bool
    acordaos_page_size: int
    btcu_enabled: bool
    btcu_listing_url: Optional[str] = None
    btcu_listing_method: str
    btcu_listing_body: Optional[str] = None
    pautas_enabled: bool
    autuados_enabled: bool
    autuados_listing_url: Optional[str] = None
    autuados_listing_method: str
    autuados_listing_body: Optional[str] = None
    autuados_create_leads: bool
    enrich_cnpj: bool
    enrich_cache_days: int
    min_debito_alerta: Optional[Decimal] = None
    request_delay_seconds: float
    user_agent: str
    contact_email: Optional[str] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    run_hour: Optional[int] = None
    run_minute: Optional[int] = None
    acordaos_enabled: Optional[bool] = None
    acordaos_page_size: Optional[int] = None
    btcu_enabled: Optional[bool] = None
    btcu_listing_url: Optional[str] = None
    btcu_listing_method: Optional[str] = None
    btcu_listing_body: Optional[str] = None
    pautas_enabled: Optional[bool] = None
    autuados_enabled: Optional[bool] = None
    autuados_listing_url: Optional[str] = None
    autuados_listing_method: Optional[str] = None
    autuados_listing_body: Optional[str] = None
    autuados_create_leads: Optional[bool] = None
    enrich_cnpj: Optional[bool] = None
    enrich_cache_days: Optional[int] = None
    min_debito_alerta: Optional[Decimal] = None
    request_delay_seconds: Optional[float] = None
    user_agent: Optional[str] = None
    contact_email: Optional[str] = None


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: Optional[datetime] = None
    status: TcuRunStatus
    trigger: str
    editions_processed: int
    blocks_parsed: int
    leads_created: int
    leads_duplicated: int
    error: Optional[str] = None

    class Config:
        from_attributes = True
