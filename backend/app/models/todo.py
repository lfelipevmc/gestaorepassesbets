"""Painel "A Fazer": lembretes do administrador e estado de conclusão (checkbox)
das tarefas geradas automaticamente pelo sistema."""
from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, Text, ForeignKey
from sqlalchemy.sql import func
from ..database import Base


class AdminReminder(Base):
    __tablename__ = "admin_reminders"
    id = Column(Integer, primary_key=True)
    title = Column(String(300), nullable=False)
    notes = Column(Text, nullable=True)
    due_date = Column(Date, nullable=True)
    done = Column(Boolean, default=False)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class TaskCheck(Base):
    """Marca uma tarefa automática como concluída. A chave (task_key) é estável e
    normalmente inclui a competência (ex.: 'report:12:3:2026-07'), de modo que as
    tarefas 'renascem' no mês seguinte quando aplicável."""
    __tablename__ = "task_checks"
    id = Column(Integer, primary_key=True)
    task_key = Column(String(200), nullable=False, index=True)
    checked_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    checked_at = Column(DateTime, server_default=func.now())
