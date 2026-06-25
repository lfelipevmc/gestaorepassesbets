from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import Base, engine
from .routers import auth, users, confederations, operators, collections, payments, reports, documents, ai, audit, endr
from .services.scheduler import start_scheduler
import os

app = FastAPI(title="Gestão de Haveres de Bets", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    for d in ["/app/uploads", "/app/uploads/logos", "/app/uploads/reports"]:
        os.makedirs(d, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")
    _seed_initial_data()
    start_scheduler()


def _seed_initial_data():
    from .database import SessionLocal
    from .models.confederation import Confederation
    from .models.user import User, UserRole
    from .core.auth import get_password_hash
    from decimal import Decimal

    db = SessionLocal()
    try:
        if db.query(Confederation).count() == 0:
            confederations = [
                Confederation(name="Confederação Brasileira de Tênis de Mesa", acronym="CBTM", ggr_percentage=Decimal("0.25")),
                Confederation(name="Confederação Brasileira de Tênis", acronym="CBT", ggr_percentage=Decimal("0.25")),
                Confederation(name="Confederação Brasileira de Wrestling", acronym="CBW", ggr_percentage=Decimal("0.25")),
                Confederation(name="Confederação Brasileira de Hipismo", acronym="CBH", ggr_percentage=Decimal("0.25")),
            ]
            for c in confederations:
                db.add(c)
            db.commit()

        if db.query(User).count() == 0:
            admin = User(
                email="admin@escritorio.com.br",
                name="Administrador",
                hashed_password=get_password_hash("admin123"),
                role=UserRole.admin,
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(confederations.router)
app.include_router(operators.router)
app.include_router(collections.router)
app.include_router(payments.router)
app.include_router(reports.router)
app.include_router(documents.router)
app.include_router(ai.router)
app.include_router(audit.router)
app.include_router(endr.router)


@app.get("/health")
def health():
    return {"status": "ok"}
