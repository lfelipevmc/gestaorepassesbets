"""Aplicação Mensura — MVP do sistema de mensuração do consultivo por WhatsApp."""
import logging

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import models  # noqa: F401  (registra as tabelas)
from .config import PASTAS_DIR
from .database import Base, engine
from .routers import clientes, dashboard, webhook

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Mensura — Consultivo")


@app.on_event("startup")
def _startup():
    Base.metadata.create_all(bind=engine)


app.include_router(dashboard.router)
app.include_router(clientes.router)
app.include_router(webhook.router)

# Serve os relatórios gravados na "pasta do cliente"
app.mount("/pastas", StaticFiles(directory=PASTAS_DIR), name="pastas")
