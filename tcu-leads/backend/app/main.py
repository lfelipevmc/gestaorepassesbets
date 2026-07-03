import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine, SessionLocal
from .config import settings
from .routers import auth, leads, monitor, processes
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
    try:
        start_scheduler()
    except Exception as e:
        logger.warning(f"Scheduler não iniciado: {e}")


def _run_light_migrations():
    """Adiciona colunas novas a tabelas já existentes (bancos antigos), de forma
    idempotente. create_all cria tabelas faltantes, mas não colunas novas."""
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
                    with engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN "{col.name}" {coltype}'))
                    logger.info(f"Migração: coluna {table.name}.{col.name} adicionada")
                except Exception as e:
                    logger.warning(f"Migração: falha em {table.name}.{col.name}: {e}")
    except Exception as e:
        logger.error(f"Migração leve falhou: {e}")


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


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}
