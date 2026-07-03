"""Registro simples de ações (auditoria interna)."""
import json
import logging
from typing import Optional
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def log_action(db: Session, action: str, entity_type: Optional[str] = None,
               entity_id: Optional[int] = None, description: Optional[str] = None,
               new_values=None, old_values=None, user_id: Optional[int] = None):
    """Log leve (stdout). Mantido como função para compatibilidade com o pipeline
    portado; pode evoluir para uma tabela de auditoria se necessário."""
    try:
        payload = {"action": action, "entity": entity_type, "id": entity_id,
                   "desc": description, "user_id": user_id}
        logger.info("AUDIT %s", json.dumps(payload, ensure_ascii=False, default=str))
    except Exception:
        logger.info("AUDIT %s %s", action, description or "")
