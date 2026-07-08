"""Modelos de dados do Mensura.

Cliente        — quem o escritório atende.
Mensagem       — cada mensagem trocada (entrada/saída) no WhatsApp.
Atendimento    — a UNIDADE DE VALOR: um grupo de mensagens que forma uma consulta.
Tarefa         — a exceção: nasce quando um atendimento gera providência do escritório.
"""
import re
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


def normalizar_telefone(valor: str) -> str:
    """Mantém apenas dígitos — chave estável para casar o remetente ao cliente."""
    return re.sub(r"\D", "", valor or "")


class Cliente(Base):
    __tablename__ = "clientes"
    id = Column(Integer, primary_key=True)
    nome = Column(String(200), nullable=False)
    telefone = Column(String(40), unique=True, index=True, nullable=False)
    empresa = Column(String(200), nullable=True)
    valor_contrato_mensal = Column(Float, default=0.0)   # mensalidade atual
    valor_hora = Column(Float, nullable=True)             # hora de referência do cliente
    observacoes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    mensagens = relationship(
        "Mensagem", back_populates="cliente", cascade="all, delete-orphan"
    )
    atendimentos = relationship(
        "Atendimento", back_populates="cliente", cascade="all, delete-orphan"
    )
    tarefas = relationship(
        "Tarefa", back_populates="cliente", cascade="all, delete-orphan"
    )


class Mensagem(Base):
    __tablename__ = "mensagens"
    id = Column(Integer, primary_key=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), index=True, nullable=False)
    direcao = Column(String(3), default="in")            # "in" (cliente) / "out" (escritório)
    texto = Column(Text, nullable=True)
    autor = Column(String(120), nullable=True)
    wa_message_id = Column(String(200), unique=True, nullable=True)  # dedupe do WhatsApp
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    cliente = relationship("Cliente", back_populates="mensagens")


class Atendimento(Base):
    __tablename__ = "atendimentos"
    id = Column(Integer, primary_key=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), index=True, nullable=False)
    assinatura = Column(String(64), index=True, nullable=True)  # hash das mensagens do grupo
    inicio = Column(DateTime, nullable=True)
    fim = Column(DateTime, nullable=True)
    num_mensagens = Column(Integer, default=0)

    # Mensuração
    resumo = Column(Text, nullable=True)
    tema = Column(String(160), nullable=True)
    complexidade = Column(String(20), nullable=True)     # baixa / média / alta
    minutos_estimados = Column(Integer, default=0)
    valor_equivalente = Column(Float, default=0.0)
    gerou_providencia = Column(Boolean, default=False)
    titulo_providencia = Column(String(240), nullable=True)
    medido = Column(Boolean, default=False)
    fonte_medicao = Column(String(20), default="")       # "ia" / "heuristica"
    created_at = Column(DateTime, default=datetime.utcnow)

    cliente = relationship("Cliente", back_populates="atendimentos")
    tarefas = relationship("Tarefa", back_populates="atendimento")


class Tarefa(Base):
    __tablename__ = "tarefas"
    id = Column(Integer, primary_key=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), index=True, nullable=False)
    atendimento_id = Column(
        Integer, ForeignKey("atendimentos.id"), nullable=True, index=True
    )
    titulo = Column(String(240), nullable=False)
    descricao = Column(Text, nullable=True)
    status = Column(String(20), default="aberta")        # aberta / concluida
    created_at = Column(DateTime, default=datetime.utcnow)

    cliente = relationship("Cliente", back_populates="tarefas")
    atendimento = relationship("Atendimento", back_populates="tarefas")
