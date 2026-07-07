import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine, SessionLocal
from .config import settings
from .routers import auth, leads, monitor, processes, external
from .services.scheduler import start_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.APP_NAME, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    import app.models  # registra todos os modelos
    Base.metadata.create_all(bind=engine)
    _run_light_migrations()
    _seed()
    _backfill_settings_defaults()
    try:
        start_scheduler()
    except Exception as e:
        logger.warning(f"Scheduler não iniciado: {e}")


def _scalar_default_sql(col):
    """SQL do valor padrão (Python scalar) de uma coluna, ou None se não houver."""
    d = col.default
    if d is None or not getattr(d, "is_scalar", False):
        return None
    val = d.arg
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return "'" + val.replace("'", "''") + "'"
    return None


def _run_light_migrations():
    """Adiciona colunas novas a tabelas já existentes (bancos antigos), de forma
    idempotente. create_all cria tabelas faltantes, mas não colunas novas.
    Ao adicionar uma coluna com valor padrão, preenche as linhas já existentes."""
    from sqlalchemy import inspect, text
    try:
        insp = inspect(engine)
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                try:
                    coltype = col.type.compile(dialect=engine.dialect)
                    default_sql = _scalar_default_sql(col)
                    with engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {coltype}'))
                        if default_sql is not None:
                            conn.execute(text(
                                f'UPDATE {table.name} SET "{col.name}" = {default_sql} '
                                f'WHERE "{col.name}" IS NULL'))
                    logger.info(f"Migração: coluna {table.name}.{col.name} adicionada")
                except Exception as e:
                    logger.warning(f"Migração: falha em {table.name}.{col.name}: {e}")
    except Exception as e:
        logger.error(f"Migração leve falhou: {e}")


def _backfill_settings_defaults():
    """Preenche valores NULL do singleton de configuração com seus padrões.

    Colunas adicionadas por migração a um banco antigo ficam NULL nas linhas já
    existentes. Como o schema de resposta exige bool/valores concretos, um NULL
    quebraria a leitura das configurações. Aqui garantimos valores válidos."""
    from .models.lead import TcuMonitorSettings
    db = SessionLocal()
    try:
        s = db.query(TcuMonitorSettings).first()
        if not s:
            return
        changed = False
        for col in TcuMonitorSettings.__table__.columns:
            d = col.default
            if getattr(s, col.name) is None and d is not None and getattr(d, "is_scalar", False):
                setattr(s, col.name, d.arg)
                changed = True
        if changed:
            db.commit()
            logger.info("Configurações: valores padrão preenchidos em colunas novas")
    except Exception as e:
        logger.warning(f"Backfill de configurações falhou: {e}")
    finally:
        db.close()


def _seed():
    from .models.user import User
    from .models.lead import TcuMonitorSettings
    from .core.auth import get_password_hash
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            db.add(User(
                email=settings.ADMIN_EMAIL.lower(),
                name=settings.ADMIN_NAME,
                role="admin",
                hashed_password=get_password_hash(settings.ADMIN_PASSWORD),
            ))
            db.commit()
            logger.info(f"Usuário admin criado: {settings.ADMIN_EMAIL}")
        if db.query(TcuMonitorSettings).first() is None:
            db.add(TcuMonitorSettings(id=1))
            db.commit()
    finally:
        db.close()


app.include_router(auth.router)
app.include_router(leads.router)
app.include_router(monitor.router)
app.include_router(processes.router)
app.include_router(external.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}
