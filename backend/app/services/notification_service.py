from sqlalchemy.orm import Session
from ..models.collection import CollectionEvent, EventType, EventChannel
from ..models.operator import BettingOperator, ContactType
from ..models.confederation import Confederation
from .email_service import send_email
from .ai_service import draft_collection_email
from .audit_service import log_action
import logging

logger = logging.getLogger(__name__)


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

    body = draft_collection_email(
        operator_name=operator.fantasy_name or operator.company_name,
        confederation_name=confederation.name,
        reference_month=reference_month,
        notification_number=notification_number,
        calculated_amount=calculated_amount
    )

    if not body:
        body = f"""
Prezado(a) representante de {operator.fantasy_name or operator.company_name},

Notificamos V.Sas. sobre a obrigação de repasse do direito de imagem previsto no Art. 30, §1º-A, III, 'a', da Lei nº 13.456/2018 c/c Portaria SPA/MF nº 41/2025, referente ao mês de {reference_month}, em favor da {confederation.name}.

Solicitamos o envio do relatório detalhado de GGR e a realização do repasse.

Atenciosamente,
Escritório Jurídico - Gestão de Haveres de Bets
"""

    to_addresses = [c.value for c in email_contacts[:3]]
    success = send_email(
        to=to_addresses,
        subject=f"{notification_number}ª Notificação - Repasse Direito de Imagem {reference_month} - {confederation.acronym}",
        body=body
    )

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
