from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://postgres:postgres@db:5432/gestaobets"
    SECRET_KEY: str = "changeme-use-strong-secret-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # Microsoft 365
    AZURE_CLIENT_ID: Optional[str] = None
    AZURE_CLIENT_SECRET: Optional[str] = None
    AZURE_TENANT_ID: Optional[str] = None
    # Caixa do escritório — destino da REVISÃO INTERNA (dossiês mensais). Não é usada para
    # falar com os agentes operadores.
    OFFICE_EMAIL: Optional[str] = None
    # Caixa ÚNICA e dedicada para toda a comunicação com os agentes operadores (envio de
    # cobranças/contatos e leitura de respostas). Ex.: gestaorepasses@vascav.com.br.
    # Se vazia, usa OFFICE_EMAIL como retrocompatibilidade.
    REPASSES_MAILBOX: Optional[str] = None
    # Nome da pasta-mãe onde são criadas as subpastas por confederação na caixa dedicada.
    REPASSES_FOLDER_ROOT: str = "Gestão de Repasses"

    # Anthropic
    ANTHROPIC_API_KEY: Optional[str] = None

    # File storage
    UPLOAD_DIR: str = "/app/uploads"

    # App
    APP_NAME: str = "Gestão de Haveres de Bets"
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"


settings = Settings()
