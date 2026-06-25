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
    OFFICE_EMAIL: Optional[str] = None

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
