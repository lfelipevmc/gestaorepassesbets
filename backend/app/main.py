from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .database import Base, engine
from .routers import (auth, users, confederations, operators, collections, payments, reports,
                      documents, ai, audit, endr, beneficiaries, redistributions, templates, finance, alerts, office, tasks)
from .services.scheduler import start_scheduler
import os
import logging

logger = logging.getLogger(__name__)

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
    _run_light_migrations()
    for d in ["/app/uploads", "/app/uploads/logos", "/app/uploads/reports", "/app/uploads/redistributions", "/app/uploads/regulations", "/app/uploads/oficios", "/app/uploads/email_replies", "/app/uploads/office"]:
        os.makedirs(d, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="/app/uploads"), name="uploads")
    _seed_initial_data()
    start_scheduler()


def _run_light_migrations():
    """Migração leve e idempotente para bancos já existentes (volume persistente).

    O SQLAlchemy create_all() cria TABELAS faltantes, mas não adiciona COLUNAS novas a tabelas
    já existentes nem novos valores de ENUM. Aqui adicionamos colunas faltantes (nulas) e o novo
    valor de enum 'report_pending'. Tudo é IF NOT EXISTS — seguro para bancos novos ou antigos.
    """
    from sqlalchemy import inspect, text
    try:
        insp = inspect(engine)

        # Tipos enum novos precisam existir ANTES de adicionar colunas que os usem (Postgres).
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    "DO $$ BEGIN "
                    "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'documentcategory') THEN "
                    "CREATE TYPE documentcategory AS ENUM ('minuta', 'documento_oficial'); "
                    "END IF; END $$;"
                ))
        except Exception as e:
            logger.warning(f"Migração: tipo documentcategory já existe ou indisponível: {e}")

        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue  # tabela nova: create_all já criou com todas as colunas
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                try:
                    coltype = col.type.compile(dialect=engine.dialect)
                    with engine.begin() as conn:
                        conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN IF NOT EXISTS "{col.name}" {coltype}'))
                    logger.info(f"Migração: coluna {table.name}.{col.name} adicionada")
                except Exception as e:
                    logger.warning(f"Migração: falha ao adicionar {table.name}.{col.name}: {e}")

        # Novo valor de enum em PaymentStatus (Postgres). PG16 suporta ADD VALUE IF NOT EXISTS.
        for enum_val in ("report_pending", "not_sports", "judicialized"):
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TYPE paymentstatus ADD VALUE IF NOT EXISTS '{enum_val}'"))
            except Exception as e:
                logger.warning(f"Migração: enum paymentstatus '{enum_val}' indisponível: {e}")

        # Novo valor de evento: contato telefônico
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TYPE eventtype ADD VALUE IF NOT EXISTS 'phone_contact'"))
        except Exception as e:
            logger.warning(f"Migração: enum eventtype 'phone_contact' indisponível: {e}")

        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TYPE documenttype ADD VALUE IF NOT EXISTS 'contract'"))
        except Exception as e:
            logger.warning(f"Migração: enum documenttype já atualizado ou indisponível: {e}")
    except Exception as e:
        logger.error(f"Migração leve falhou: {e}")


def _seed_initial_data():
    from .database import SessionLocal
    from .models.confederation import Confederation
    from .models.user import User, UserRole
    from .core.auth import get_password_hash

    db = SessionLocal()
    try:
        if db.query(Confederation).count() == 0:
            confederations = [
                Confederation(name="Confederação Brasileira de Tênis de Mesa", acronym="CBTM"),
                Confederation(name="Confederação Brasileira de Tênis", acronym="CBT"),
                Confederation(name="Confederação Brasileira de Wrestling", acronym="CBW", redistribution_deadline_days=90),
                Confederation(name="Confederação Brasileira de Hipismo", acronym="CBH"),
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

        _seed_distribution_rules(db)
    finally:
        db.close()


def _seed_distribution_rules(db):
    """Semeia a matriz de rateio de cada confederação conforme seus regulamentos."""
    from .models.confederation import Confederation, DistributionRule
    from decimal import Decimal

    if db.query(DistributionRule).count() > 0:
        return

    def conf_id(acr):
        c = db.query(Confederation).filter(Confederation.acronym == acr).first()
        return c.id if c else None

    rules = []

    # CBW — percentuais fixos (Regulamento CBW, Cap. II)
    cbw = conf_id("CBW")
    if cbw:
        rules += [
            DistributionRule(confederation_id=cbw, scenario_code="intl_no_brasil", order_index=1,
                scenario_label="Evento Internacional sem atleta brasileiro", article_ref="Art. 3º",
                confederation_pct=Decimal("1.0"),
                description="Contrapartidas de luta sem participação de atleta brasileiro: 100% à CBW."),
            DistributionRule(confederation_id=cbw, scenario_code="intl_com_brasil", order_index=2,
                scenario_label="Evento Internacional com atleta brasileiro", article_ref="Art. 4º",
                confederation_pct=Decimal("0.5"), athlete_pct=Decimal("0.5"),
                description="50% à CBW e 50% ao(s) atleta(s) brasileiro(s) participante(s)."),
            DistributionRule(confederation_id=cbw, scenario_code="nac_atleta", order_index=3,
                scenario_label="Evento Nacional – referência só ao atleta", article_ref="Art. 5º",
                confederation_pct=Decimal("0.5"), athlete_pct=Decimal("0.5"),
                description="50% à CBW e 50% ao(s) atleta(s) referenciado(s)."),
            DistributionRule(confederation_id=cbw, scenario_code="nac_atleta_clube", order_index=4,
                scenario_label="Evento Nacional – atleta + clube", article_ref="Art. 6º",
                confederation_pct=Decimal("0.5"), entity_pct=Decimal("0.3"), athlete_pct=Decimal("0.2"),
                description="50% à CBW, 30% à entidade de prática esportiva, 20% ao atleta."),
            DistributionRule(confederation_id=cbw, scenario_code="nac_atleta_federacao", order_index=5,
                scenario_label="Evento Nacional – atleta + federação estadual", article_ref="Art. 7º",
                confederation_pct=Decimal("0.5"), federation_pct=Decimal("0.2"), athlete_pct=Decimal("0.3"),
                description="50% à CBW, 20% à federação estadual, 30% ao atleta."),
        ]

    # CBT e CBTM — rateio equânime (Regulamentos CBT/CBTM, Cap. III)
    for acr in ("CBT", "CBTM"):
        cid = conf_id(acr)
        if not cid:
            continue
        rules += [
            DistributionRule(confederation_id=cid, scenario_code="intl_no_sinesp", order_index=1,
                scenario_label="Competição Internacional sem integrantes do Sinesp", article_ref="Art. 5º",
                confederation_pct=Decimal("1.0"),
                description="Recursos integralmente revertidos à confederação."),
            DistributionRule(confederation_id=cid, scenario_code="intl_com_sinesp", order_index=2,
                scenario_label="Competição Internacional com integrantes do Sinesp", article_ref="Art. 6º",
                is_equanime=True,
                description="Rateio equânime, em percentuais idênticos, entre confederação, entidade de prática "
                            "e/ou atleta cujos direitos foram explorados, por partida/jogo. Duplas/equipes "
                            "dividem igualmente a parcela do atleta."),
            DistributionRule(confederation_id=cid, scenario_code="nac_com_sinesp", order_index=3,
                scenario_label="Competição Nacional com integrantes do Sinesp", article_ref="Art. 7º",
                is_equanime=True,
                description="Rateio equânime, em percentuais idênticos, entre todos os integrantes do Sinesp "
                            "que participaram do jogo/partida apostada."),
        ]

    for r in rules:
        db.add(r)
    db.commit()
    _seed_templates(db)


def _seed_templates(db):
    """Semeia textos padrão de cobrança (globais) para cada ocasião."""
    from .models.messaging import MessageTemplate, TemplateOccasion
    if db.query(MessageTemplate).count() > 0:
        return
    base = (
        "Prezados representantes de {bet},\n\n"
        "{corpo}\n\n"
        "Trata-se da contrapartida pelo uso de direito de imagem prevista no art. 30, §1º-A, III, "
        "alínea 'a', da Lei nº 13.756/2018 e na Portaria SPA/MF nº 41/2025, referente ao mês de {mes}, "
        "em favor da {confederacao}.\n\n"
        "Atenciosamente,\n{escritorio}"
    )
    seeds = [
        ("1ª Notificação de Cobrança", TemplateOccasion.first_notification,
         "Cobrança – Direito de Imagem ({confederacao}) – {mes}",
         base.format(bet="{bet}", confederacao="{confederacao}", mes="{mes}", escritorio="{escritorio}",
                     corpo="Solicitamos o repasse da contrapartida e o envio do relatório detalhado de individualização dos valores.")),
        ("2ª Notificação de Cobrança", TemplateOccasion.second_notification,
         "Reiteração de Cobrança – Direito de Imagem ({confederacao}) – {mes}",
         base.format(bet="{bet}", confederacao="{confederacao}", mes="{mes}", escritorio="{escritorio}",
                     corpo="Reiteramos a cobrança em aberto. Até o momento não identificamos o repasse referente ao período. Solicitamos regularização no prazo de {prazo}.")),
        ("Notificação Final", TemplateOccasion.final_notice,
         "Notificação Final – Direito de Imagem ({confederacao}) – {mes}",
         base.format(bet="{bet}", confederacao="{confederacao}", mes="{mes}", escritorio="{escritorio}",
                     corpo="Esta é a notificação final referente ao período. A ausência de regularização ensejará as medidas cabíveis perante a SPA/MF.")),
        ("Solicitação de Relatório", TemplateOccasion.report_request,
         "Solicitação de Relatório – {confederacao} – {mes}",
         base.format(bet="{bet}", confederacao="{confederacao}", mes="{mes}", escritorio="{escritorio}",
                     corpo="Identificamos o repasse, mas pendente o relatório de individualização. Solicitamos o envio do relatório com a base de cálculo por competição e os beneficiários.")),
    ]
    for name, occ, subject, body in seeds:
        db.add(MessageTemplate(name=name, occasion=occ, subject=subject, body=body, confederation_id=None))
    db.commit()


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
app.include_router(beneficiaries.router)
app.include_router(redistributions.router)
app.include_router(templates.router)
app.include_router(finance.router)
app.include_router(alerts.router)
app.include_router(office.router)
app.include_router(tasks.router)


@app.get("/health")
def health():
    return {"status": "ok"}
