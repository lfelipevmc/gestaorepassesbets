"""Cliente da Claude API (extração estruturada). Opcional: sem a chave, o
sistema opera em modo degradado usando apenas o parser por regex."""
import anthropic
from ..config import settings

_client = None


def get_client():
    global _client
    if _client is None and settings.ANTHROPIC_API_KEY:
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client
