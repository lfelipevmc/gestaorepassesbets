"""Configuração do sistema, lida de variáveis de ambiente (.env)."""
import os
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../consultivo
DATA_DIR = os.path.join(BASE_DIR, "data")
PASTAS_DIR = os.path.join(DATA_DIR, "pastas")  # "pasta do cliente"

# Garante que os diretórios existam antes de abrir o banco / gravar relatórios
os.makedirs(PASTAS_DIR, exist_ok=True)


class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", f"sqlite:///{os.path.join(DATA_DIR, 'consultivo.db')}"
    )
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    AI_MODEL: str = os.getenv("AI_MODEL", "claude-opus-4-8")

    WA_VERIFY_TOKEN: str = os.getenv("WA_VERIFY_TOKEN", "mensura-verify")
    WA_PHONE_NUMBER_ID: str = os.getenv("WA_PHONE_NUMBER_ID", "")
    WA_ACCESS_TOKEN: str = os.getenv("WA_ACCESS_TOKEN", "")
    WA_API_VERSION: str = os.getenv("WA_API_VERSION", "v21.0")

    GAP_MINUTES: int = int(os.getenv("SEGMENT_GAP_MINUTES", "360"))
    VALOR_HORA_PADRAO: float = float(os.getenv("VALOR_HORA_PADRAO", "350"))


settings = Settings()
