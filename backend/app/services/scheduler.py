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
    if today.day != 12:
        return

    db = SessionLocal()
    try:
        if today.month == 1:
            ref_month = date(today.year - 1, 12, 1)
        else:
            ref_month = date(today.year, today.month - 1, 1)

        confederations = db.query(Confederation).all()

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
    if today.day != 22:
        return

    db = SessionLocal()
    try:
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
            if not cycle:
                continue

            overdue = db.query(Payment).filter(
                Payment.cycle_id == cycle.id,
                Payment.status == PaymentStatus.pending
            ).all()

            for payment in overdue:
                op = db.query(BettingOperator).get(payment.operator_id)
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


def start_scheduler():
    scheduler.add_job(job_sync_operators, CronTrigger(hour=7, minute=0), id="sync_mf", replace_existing=True)
    scheduler.add_job(job_send_first_notifications, CronTrigger(hour=8, minute=0), id="notify_1", replace_existing=True)
    scheduler.add_job(job_check_compliance_day20, CronTrigger(hour=9, minute=0), id="check_20", replace_existing=True)
    scheduler.add_job(job_send_second_notifications, CronTrigger(hour=8, minute=30), id="notify_2", replace_existing=True)
    scheduler.add_job(job_final_compliance_and_report, CronTrigger(hour=9, minute=0), id="final_check", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started")
