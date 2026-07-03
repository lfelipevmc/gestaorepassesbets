from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Banco de dados (SQLite por padrão — zero configuração; troque por Postgres em produção)
    DATABASE_URL: str = "sqlite:///./tcu_leads.db"

    # Segurança
    SECRET_KEY: str = "troque-por-um-segredo-longo-e-aleatorio-em-producao"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # IA (extração estruturada dos editais/acórdãos)
    ANTHROPIC_API_KEY: Optional[str] = None

    # Usuário administrador inicial (criado no primeiro start)
    ADMIN_EMAIL: str = "admin@tculeads.com.br"
    ADMIN_PASSWORD: str = "admin123"
    ADMIN_NAME: str = "Administrador"

    # Resumo diário por e-mail (SMTP). Se não configurado, o envio é apenas ignorado.
    SMTP_HOST: Optional[str] = None
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM: Optional[str] = None
    DIGEST_TO: Optional[str] = None          # destinatários separados por vírgula
    DIGEST_MIN_SCORE: int = 40               # só inclui/dispara com oportunidades acima deste score

    # App
    APP_NAME: str = "TCU Leads"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"


settings = Settings()
