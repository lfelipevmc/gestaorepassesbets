from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import date, datetime
import logging
from ..database import SessionLocal
from ..models.collection import CollectionCycle, CollectionEvent, EventType, EventChannel, CycleStatus
from ..models.operator import BettingOperator, OperatorStatus
from ..models.payment import Payment, PaymentStatus
from ..models.confederation import Confederation
from .mf_scraper import scrape_mf_operators
from .notification_service import send_collection_notification
from .email_service import read_inbox_emails
from .ai_service import analyze_payment_email
from .audit_service import log_action

logger = logging.getLogger(__name__)


def is_endr_associated(db, operator_id: int, reference_month: date) -> bool:
    from ..models.operator import EndrAssociation
    assoc = db.query(EndrAssociation).filter(
        EndrAssociation.operator_id == operator_id,
        EndrAssociation.reference_month == reference_month,
        EndrAssociation.is_associated == True
    ).first()
    return assoc is not None


scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")


def get_or_create_cycle(db, confederation_id: int, reference_month: date) -> CollectionCycle:
    cycle = db.query(CollectionCycle).filter(
        CollectionCycle.confederation_id == confederation_id,
        CollectionCycle.reference_month == reference_month
    ).first()
    if not cycle:
        cycle = CollectionCycle(
            confederation_id=confederation_id,
            reference_month=reference_month,
            status=CycleStatus.open
        )
        db.add(cycle)
        db.flush()
        operators = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()
        for op in operators:
            payment = Payment(
                cycle_id=cycle.id,
                operator_id=op.id,
                confederation_id=confederation_id,
                status=PaymentStatus.pending
            )
            db.add(payment)
        db.commit()
        db.refresh(cycle)
    return cycle


def job_sync_operators():
    db = SessionLocal()
    try:
        result = scrape_mf_operators(db)
        logger.info(f"MF sync: {result}")
    except Exception as e:
        logger.error(f"MF sync job error: {e}")
    finally:
        db.close()


def job_send_first_notifications():
    today = date.today()

    db = SessionLocal()
    try:
        if today.month == 1:
            ref_month = date(today.year - 1, 12, 1)
        else:
            ref_month = date(today.year, today.month - 1, 1)

        # Cada confederação tem seu próprio dia configurável para a 1ª notificação (padrão dia 12)
        confederations = [c for c in db.query(Confederation).all() if (c.first_notification_day or 12) == today.day]

        for conf in confederations:
            cycle = get_or_create_cycle(db, conf.id, ref_month)
            cycle.status = CycleStatus.collecting
            db.commit()

            pending_payments = db.query(Payment).filter(
                Payment.cycle_id == cycle.id,
                Payment.status == PaymentStatus.pending
            ).all()

            for payment in pending_payments:
                op = db.query(BettingOperator).get(payment.operator_id)
                if is_endr_associated(db, op.id, ref_month):
                    event = CollectionEvent(
                        cycle_id=cycle.id,
                        operator_id=op.id,
                        event_type=EventType.manual_note,
                        channel=EventChannel.system,
                        notes="Operador associado ao ENDR — cobrança suspensa neste mês",
                    )
                    db.add(event)
                    db.commit()
                    continue
                send_collection_notification(
                    db=db,
                    cycle_id=cycle.id,
                    operator=op,
                    confederation=conf,
                    reference_month=ref_month.strftime("%m/%Y"),
                    notification_number=1,
                )

        log_action(db=db, action="AUTO_NOTIFICATION_1", description=f"1ª rodada de notificações automáticas - referência {ref_month}")
    except Exception as e:
        logger.error(f"First notification job error: {e}")
    finally:
        db.close()


def job_check_compliance_day20():
    today = date.today()
    if today.day != 20:
        return
    _check_email_compliance()


def job_send_second_notifications():
    today = date.today()

    db = SessionLocal()
    try:
        if today.month == 1:
            ref_month = date(today.year - 1, 12, 1)
        else:
            ref_month = date(today.year, today.month - 1, 1)

        # Dia configurável da 2ª notificação por confederação (padrão dia 22)
        confederations = [c for c in db.query(Confederation).all() if (c.second_notification_day or 22) == today.day]
        for conf in confederations:
            cycle = db.query(CollectionCycle).filter(
                CollectionCycle.confederation_id == conf.id,
                CollectionCycle.reference_month == ref_month
            ).first()
            if not cycle:
                continue

            overdue = db.query(Payment).filter(
                Payment.cycle_id == cycle.id,
                Payment.status == PaymentStatus.pending
            ).all()

            for payment in overdue:
                op = db.query(BettingOperator).get(payment.operator_id)
                if is_endr_associated(db, op.id, ref_month):
                    event = CollectionEvent(
                        cycle_id=cycle.id,
                        operator_id=op.id,
                        event_type=EventType.manual_note,
                        channel=EventChannel.system,
                        notes="Operador associado ao ENDR — cobrança suspensa neste mês",
                    )
                    db.add(event)
                    continue
                send_collection_notification(
                    db=db, cycle_id=cycle.id, operator=op, confederation=conf,
                    reference_month=ref_month.strftime("%m/%Y"), notification_number=2,
                )
                payment.status = PaymentStatus.overdue

            db.commit()

        log_action(db=db, action="AUTO_NOTIFICATION_2", description=f"2ª rodada de notificações automáticas")
    except Exception as e:
        logger.error(f"Second notification job error: {e}")
    finally:
        db.close()


def job_final_compliance_and_report():
    today = date.today()
    if today.day != 1:
        return

    _check_email_compliance()
    _generate_monthly_reports()


def _check_email_compliance():
    db = SessionLocal()
    try:
        emails = read_inbox_emails(top=100)
        operators = db.query(BettingOperator).all()
        op_names = [op.fantasy_name or op.company_name for op in operators]

        for email in emails:
            body = email.get("body", {}).get("content", "")
            result = analyze_payment_email(body, op_names)

            if result.get("has_payment_confirmation"):
                for op_name in result.get("confirmed_operators", []):
                    op = next((o for o in operators if (o.fantasy_name or o.company_name).lower() in op_name.lower()), None)
                    if op:
                        payments = db.query(Payment).filter(
                            Payment.operator_id == op.id,
                            Payment.status.in_([PaymentStatus.pending, PaymentStatus.overdue])
                        ).all()
                        for p in payments:
                            p.payment_confirmed_at = datetime.utcnow()
                            p.status = PaymentStatus.paid
                            event = CollectionEvent(
                                cycle_id=p.cycle_id,
                                operator_id=op.id,
                                event_type=EventType.payment_confirmed,
                                channel=EventChannel.email,
                                notes=f"Confirmado via leitura automática de email: {email.get('subject', '')}",
                            )
                            db.add(event)

                db.commit()

        log_action(db=db, action="EMAIL_COMPLIANCE_CHECK", description=f"Verificação de adimplência via email: {len(emails)} emails analisados")
    except Exception as e:
        logger.error(f"Email compliance check error: {e}")
    finally:
        db.close()


def _generate_monthly_reports():
    db = SessionLocal()
    try:
        today = date.today()
        if today.month == 1:
            ref_month = date(today.year - 1, 12, 1)
        else:
            ref_month = date(today.year, today.month - 1, 1)

        confederations = db.query(Confederation).all()
        for conf in confederations:
            cycle = db.query(CollectionCycle).filter(
                CollectionCycle.confederation_id == conf.id,
                CollectionCycle.reference_month == ref_month
            ).first()
            if cycle:
                cycle.status = CycleStatus.closed
                db.commit()

        log_action(db=db, action="AUTO_REPORT_GENERATED", description=f"Relatórios mensais gerados automaticamente para {ref_month}")
    except Exception as e:
        logger.error(f"Report generation error: {e}")
    finally:
        db.close()


def job_weekly_contact_research():
    """Every Sunday: research contacts for all active operators."""
    db = SessionLocal()
    try:
        from .contact_researcher import research_all_operators
        result = research_all_operators(db)
        logger.info(f"Weekly contact research: {result}")
    except Exception as e:
        logger.error(f"Weekly research job error: {e}")
    finally:
        db.close()


def job_sync_inbox():
    """Diário: lê a caixa de entrada e importa respostas das Bets, casando por remetente."""
    db = SessionLocal()
    try:
        from .email_matcher import sync_inbox
        result = sync_inbox(db)
        logger.info(f"Inbox sync: {result}")
    except Exception as e:
        logger.error(f"Inbox sync job error: {e}")
    finally:
        db.close()


def job_redistribution_deadline_alerts():
    """Diário: registra alerta para redistribuições com prazo vencido e não concluídas."""
    db = SessionLocal()
    try:
        from ..models.redistribution import Redistribution, RedistributionStatus
        today = date.today()
        overdue = db.query(Redistribution).filter(
            Redistribution.deadline_date < today,
            Redistribution.status != RedistributionStatus.completed,
        ).all()
        if overdue:
            log_action(db=db, action="REDISTRIBUTION_DEADLINE_ALERT",
                       description=f"{len(overdue)} redistribuição(ões) com prazo de repasse vencido",
                       new_values={"ids": [r.id for r in overdue]})
        logger.info(f"Redistribution deadline alerts: {len(overdue)} vencidas")
    except Exception as e:
        logger.error(f"Redistribution deadline job error: {e}")
    finally:
        db.close()


def job_monthly_office_report():
    """Dia 1º: gera o dossiê de evidências do mês anterior por confederação e envia ao e-mail
    do escritório para revisão antes do encaminhamento à confederação."""
    db = SessionLocal()
    try:
        import base64
        from ..services.evidence_report import generate_evidence_pdf
        from ..services.email_service import send_email
        from ..models.office import OfficeSettings
        from ..models.confederation import Confederation as _Conf
        office = db.query(OfficeSettings).first()
        if not office or not office.email:
            logger.info("Monthly office report: e-mail do escritório não cadastrado, pulando")
            return
        today = date.today()
        m = today.month - 1
        y = today.year
        if m <= 0:
            m += 12
            y -= 1
        ref = date(y, m, 1)
        sent = 0
        for conf in db.query(_Conf).all():
            try:
                pdf = generate_evidence_pdf(db, ref, conf.id)
                fname = f"evidencias_{conf.acronym}_{ref.strftime('%Y_%m')}.pdf"
                ok = send_email(
                    to=[office.email],
                    subject=f"[Revisão] Relatório de Evidências {ref.strftime('%m/%Y')} — {conf.acronym}",
                    body=f"Segue o relatório de evidências de {ref.strftime('%m/%Y')} ({conf.acronym}) para revisão interna antes do encaminhamento à confederação.",
                    attachments=[{"filename": fname, "content_bytes": base64.b64encode(pdf).decode(), "content_type": "application/pdf"}],
                )
                if ok:
                    sent += 1
            except Exception as e:
                logger.error(f"Monthly report for {conf.acronym} failed: {e}")
        log_action(db=db, action="MONTHLY_REPORT_JOB", description=f"Relatórios de {ref.strftime('%m/%Y')} enviados ao escritório: {sent}")
        logger.info(f"Monthly office report: {sent} enviados")
    except Exception as e:
        logger.error(f"Monthly office report job error: {e}")
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(job_sync_operators, CronTrigger(hour=7, minute=0), id="sync_mf", replace_existing=True)
    scheduler.add_job(job_send_first_notifications, CronTrigger(hour=8, minute=0), id="notify_1", replace_existing=True)
    scheduler.add_job(job_check_compliance_day20, CronTrigger(hour=9, minute=0), id="check_20", replace_existing=True)
    scheduler.add_job(job_send_second_notifications, CronTrigger(hour=8, minute=30), id="notify_2", replace_existing=True)
    scheduler.add_job(job_final_compliance_and_report, CronTrigger(hour=9, minute=0), id="final_check", replace_existing=True)
    scheduler.add_job(
        job_weekly_contact_research,
        CronTrigger(day_of_week="sun", hour=6, minute=0),
        id="weekly_research",
        replace_existing=True,
    )
    # Conciliação de respostas de e-mail: 3x ao dia
    scheduler.add_job(job_sync_inbox, CronTrigger(hour="8,13,18", minute=15), id="sync_inbox", replace_existing=True)
    # Alerta de prazo de repasse aos beneficiários
    scheduler.add_job(job_redistribution_deadline_alerts, CronTrigger(hour=7, minute=30), id="redis_deadline", replace_existing=True)
    # Relatório mensal ao escritório (dia 1º às 6h)
    scheduler.add_job(job_monthly_office_report, CronTrigger(day=1, hour=6, minute=0), id="monthly_report", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started")
