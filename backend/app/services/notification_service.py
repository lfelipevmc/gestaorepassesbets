from sqlalchemy.orm import Session
from ..models.collection import CollectionEvent, EventType, EventChannel
from ..models.operator import BettingOperator, ContactType
from ..models.confederation import Confederation
from .email_service import send_email
from .ai_service import draft_collection_email
from .audit_service import log_action
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


def _find_template(db: Session, confederation_id: int, notification_number: int):
    """Busca template para a ocasião (confederação específica tem prioridade sobre global)."""
    from ..models.messaging import MessageTemplate, TemplateOccasion
    occasion = TemplateOccasion.first_notification if notification_number == 1 else TemplateOccasion.second_notification
    tmpl = db.query(MessageTemplate).filter(
        MessageTemplate.occasion == occasion,
        MessageTemplate.active == True,
        MessageTemplate.confederation_id == confederation_id,
    ).first()
    if tmpl:
        return tmpl
    return db.query(MessageTemplate).filter(
        MessageTemplate.occasion == occasion,
        MessageTemplate.active == True,
        MessageTemplate.confederation_id.is_(None),
    ).first()


def render_placeholders(text: str, operator, confederation, reference_month: str, amount=None) -> str:
    """Substitui placeholders padronizados no texto do template."""
    valor = "R$ {:,.2f}".format(float(amount)).replace(",", "X").replace(".", ",").replace("X", ".") if amount else "valor a ser apurado pelo agente operador"
    return (text or "").format(
        bet=operator.fantasy_name or operator.company_name,
        confederacao=confederation.name,
        mes=reference_month,
        valor=valor,
        prazo="10 (dez) dias",
        escritorio="Escritório Jurídico - Gestão de Haveres de Bets",
    )


def _render_template(tmpl, operator, confederation, reference_month: str, amount=None):
    try:
        subject = render_placeholders(tmpl.subject, operator, confederation, reference_month, amount)
        body = render_placeholders(tmpl.body, operator, confederation, reference_month, amount)
        return subject, body
    except Exception:
        return None, None


def send_collection_notification(
    db: Session,
    cycle_id: int,
    operator: BettingOperator,
    confederation: Confederation,
    reference_month: str,
    notification_number: int,
    performed_by_id: int = None,
    calculated_amount: float = None
) -> bool:
    email_contacts = [c for c in operator.contacts if c.type == ContactType.email and c.value]

    if not email_contacts:
        event = CollectionEvent(
            cycle_id=cycle_id,
            operator_id=operator.id,
            event_type=EventType.notification_sent,
            channel=EventChannel.email,
            notes=f"[FALHOU] Nenhum email cadastrado para {operator.company_name}",
            performed_by_id=performed_by_id,
        )
        db.add(event)
        db.commit()
        return False

    # 1) Prioridade: texto padrão (template) cadastrado para a ocasião
    subject = None
    body = None
    tmpl = _find_template(db, confederation.id, notification_number)
    if tmpl:
        subject, body = _render_template(tmpl, operator, confederation, reference_month, calculated_amount)

    # 2) Fallback: rascunho por IA
    if not body:
        body = draft_collection_email(
            operator_name=operator.fantasy_name or operator.company_name,
            confederation_name=confederation.name,
            reference_month=reference_month,
            notification_number=notification_number,
            calculated_amount=calculated_amount
        )

    # 3) Fallback final: texto fixo
    if not body:
        body = f"""
Prezado(a) representante de {operator.fantasy_name or operator.company_name},

Notificamos V.Sas. sobre a obrigação de repasse do direito de imagem previsto no Art. 30, §1º-A, III, 'a', da Lei nº 13.756/2018 c/c Portaria SPA/MF nº 41/2025, referente ao mês de {reference_month}, em favor da {confederation.name}.

Solicitamos o envio do relatório detalhado e a realização do repasse.

Atenciosamente,
Escritório Jurídico - Gestão de Haveres de Bets
"""

    if not subject:
        subject = f"{notification_number}ª Notificação - Repasse Direito de Imagem {reference_month} - {confederation.acronym}"

    to_addresses = [c.value for c in email_contacts[:3]]
    success = send_email(to=to_addresses, subject=subject, body=body)

    # Registra o e-mail enviado para conciliação posterior com as respostas
    try:
        from ..models.messaging import EmailMessage, EmailDirection
        db.add(EmailMessage(
            direction=EmailDirection.outbound,
            operator_id=operator.id,
            confederation_id=confederation.id,
            cycle_id=cycle_id,
            subject=subject,
            body_preview=(body or "")[:1000],
            to_addr=", ".join(to_addresses),
            matched=success,
            sent_at=datetime.utcnow(),
        ))
    except Exception:
        pass

    event = CollectionEvent(
        cycle_id=cycle_id,
        operator_id=operator.id,
        event_type=EventType.notification_sent,
        channel=EventChannel.email,
        notes=f"{'Enviado' if success else 'Falha ao enviar'} para: {', '.join(to_addresses)}",
        performed_by_id=performed_by_id,
    )
    db.add(event)

    log_action(
        db=db,
        action="SEND_NOTIFICATION",
        entity_type="BettingOperator",
        entity_id=operator.id,
        description=f"{notification_number}ª notificação {'enviada' if success else 'falhou'} para {operator.company_name} - ciclo {cycle_id}",
        user_id=performed_by_id,
    )

    db.commit()
    return success
