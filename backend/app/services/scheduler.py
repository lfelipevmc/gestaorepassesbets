"""Rotinas agendadas do sistema.

╔══════════════════════════════════════════════════════════════════════════╗
║  POLÍTICA INEGOCIÁVEL (incidente de 12/07/2026):                          ║
║  O sistema NUNCA envia e-mails ou mensagens automáticas aos agentes       ║
║  operadores. Todo envio é iniciado manualmente por um usuário, revisado   ║
║  na tela e CONFIRMADO COM A SENHA DE LOGIN (endpoint send-confirmed).     ║
║  Nenhum job deste arquivo pode chamar send_email/notificações para Bets.  ║
╚══════════════════════════════════════════════════════════════════════════╝

Jobs permitidos: sincronizações de LEITURA (planilha MF, caixa de entrada),
pesquisas de contato, alertas internos e o relatório mensal ao e-mail do
PRÓPRIO escritório.
"""
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import date
import logging
from ..database import SessionLocal
from ..models.collection import CollectionCycle, CycleStatus
from ..models.confederation import Confederation
from .mf_scraper import scrape_mf_operators
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
        # Ciclo-espelho: NÃO cria lista própria de operadores (usa a base central + Conclusão)
        cycle = CollectionCycle(
            confederation_id=confederation_id,
            reference_month=reference_month,
            status=CycleStatus.open
        )
        db.add(cycle)
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


# ─────────────────────────────────────────────────────────────────────────────
# REMOVIDO EM 13/07/2026 (incidente): job_send_first_notifications e
# job_send_second_notifications disparavam notificações automáticas às Bets
# (8h00/8h30, no dia configurado de cada confederação). Envio agora é
# EXCLUSIVAMENTE manual, via Ciclo → Preparar Notificação, com revisão dos
# destinatários/mensagem e confirmação por senha de login.
# Também removida a marcação automática de pagamento por IA
# (_check_email_compliance) — mudanças de estado financeiro são manuais.
# ─────────────────────────────────────────────────────────────────────────────


def job_monthly_cycle_close():
    """Dia 1º: apenas fecha (status) os ciclos do mês anterior. NÃO envia nada."""
    today = date.today()
    if today.day != 1:
        return
    _generate_monthly_reports()


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
    """Somente rotinas de LEITURA/organização e um e-mail interno ao escritório.
    PROIBIDO adicionar aqui qualquer job que envie mensagem a agentes operadores."""
    scheduler.add_job(job_sync_operators, CronTrigger(hour=7, minute=0), id="sync_mf", replace_existing=True)
    scheduler.add_job(
        job_weekly_contact_research,
        CronTrigger(day_of_week="sun", hour=6, minute=0),
        id="weekly_research",
        replace_existing=True,
    )
    # Conciliação de respostas de e-mail (apenas LEITURA da caixa dedicada): 3x ao dia
    scheduler.add_job(job_sync_inbox, CronTrigger(hour="8,13,18", minute=15), id="sync_inbox", replace_existing=True)
    # Alerta interno de prazo de repasse aos beneficiários (registro em auditoria)
    scheduler.add_job(job_redistribution_deadline_alerts, CronTrigger(hour=7, minute=30), id="redis_deadline", replace_existing=True)
    # Fechamento de status dos ciclos do mês anterior (dia 1º) — sem envios
    scheduler.add_job(job_monthly_cycle_close, CronTrigger(day=1, hour=5, minute=30), id="cycle_close", replace_existing=True)
    # Relatório mensal ao e-mail do PRÓPRIO escritório (dia 1º às 6h) — interno
    scheduler.add_job(job_monthly_office_report, CronTrigger(day=1, hour=6, minute=0), id="monthly_report", replace_existing=True)
    scheduler.start()
    logger.info("Scheduler started (sem envios automáticos a operadores)")
