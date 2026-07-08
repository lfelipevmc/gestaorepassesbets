"""Schemas Pydantic para as entradas da API (criação de cliente e simulação)."""
from typing import List, Optional

from pydantic import BaseModel


class ClienteIn(BaseModel):
    nome: str
    telefone: str
    empresa: Optional[str] = None
    valor_contrato_mensal: float = 0.0
    valor_hora: Optional[float] = None
    observacoes: Optional[str] = None


class MensagemSim(BaseModel):
    texto: str
    direcao: str = "in"           # "in" (cliente) / "out" (escritório)
    minutos_offset: int = 0       # minutos após o início da conversa


class SimulacaoIn(BaseModel):
    """Injeta uma conversa como se tivesse chegado pelo WhatsApp — para demonstração."""
    telefone: str
    nome: Optional[str] = None
    mensagens: List[MensagemSim]
