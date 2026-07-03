"""Agendador do TCU Leads — executa a coleta diária no horário configurado."""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from ..database import SessionLocal

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="America/Sao_Paulo")


def job_daily_monitor():
    db = SessionLocal()
    try:
        from .pipeline import get_settings, run_pipeline
        s = get_settings(db)
        if not s.enabled:
            logger.info("TCU Leads: coleta desabilitada — pipeline não executado")
            return
        result = run_pipeline(db, trigger="scheduler")
        logger.info(f"TCU Leads: {result.get('leads_created')} leads, status {result.get('status')}")
    except Exception as e:
        logger.error(f"Job diário falhou: {e}")
    finally:
        db.close()


def reschedule_job(settings=None):
    hour, minute = 7, 30
    if settings is not None:
        hour = settings.run_hour if settings.run_hour is not None else 7
        minute = settings.run_minute if settings.run_minute is not None else 30
    scheduler.add_job(job_daily_monitor, CronTrigger(hour=hour, minute=minute),
                      id="daily_monitor", replace_existing=True)
    logger.info(f"Coleta diária agendada para {hour:02d}:{minute:02d}")


def start_scheduler():
    db = SessionLocal()
    try:
        from .pipeline import get_settings
        s = get_settings(db)
    except Exception as e:
        logger.warning(f"Falha ao ler configurações (usando padrão 07:30): {e}")
        s = None
    finally:
        db.close()
    reschedule_job(s)
    scheduler.start()
    logger.info("Scheduler iniciado")
