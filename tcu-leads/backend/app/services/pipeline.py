"""
Orquestração do pipeline diário do Radar TCU.

Fluxo (roteiro §4): discover → fetch → parse → classify & extract → dedupe →
enrich → store. Cada execução gera um TcuMonitorRun para auditoria.

Fontes:
  - API de Acórdãos (confirmada) — varre do índice mais recente;
  - BTCU "Deliberações" (endpoint de listagem configurável) — baixa PDFs e parseia;
  - Pautas das sessões (early-warning);
  - Ingestão manual de PDF/texto (contorna a lacuna do endpoint de listagem).
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from ..models import (
    TcuLead, TcuLeadNote, TcuCnpjEnrichment, TcuMonitorRun, TcuMonitorSettings,
    TcuActType, TcuDocType, TcuSourceKind, TcuRunStatus, TcuLeadStatus,
)
from . import sources as src
from .parser import parse_caderno, extract_text_from_pdf, compute_deadline, ParsedBlock
from .extractor import extract_block, score_opportunity
from .audit import log_action

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Settings singleton
# --------------------------------------------------------------------------- #

def get_settings(db: Session) -> TcuMonitorSettings:
    s = db.query(TcuMonitorSettings).first()
    if not s:
        s = TcuMonitorSettings(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def _client(settings: TcuMonitorSettings, *, use_browser: Optional[bool] = None) -> src.TcuHttpClient:
    if use_browser is None:
        use_browser = getattr(settings, "autuados_use_browser", True)
    return src.TcuHttpClient(
        user_agent=settings.user_agent,
        delay=float(settings.request_delay_seconds or 3.0),
        contact_email=settings.contact_email,
        use_browser=use_browser,
    )


# --------------------------------------------------------------------------- #
# Persistência de um lead (com dedupe por content_hash)
# --------------------------------------------------------------------------- #

def _to_decimal(v) -> Optional[Decimal]:
    if v is None:
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _to_date(v) -> Optional[date]:
    if not v:
        return None
    if isinstance(v, date):
        return v
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def _act_type(value: Optional[str]) -> TcuActType:
    try:
        return TcuActType(value)
    except (ValueError, KeyError):
        return TcuActType.outro


def _doc_type(value: Optional[str]) -> TcuDocType:
    if value == "cnpj":
        return TcuDocType.cnpj
    if value == "cpf":
        return TcuDocType.cpf
    return TcuDocType.desconhecido


def _hash_for(numero_processo, act_type, documento, fallback: str) -> str:
    import hashlib
    base = "|".join([str(numero_processo or ""), str(act_type or ""),
                     str(documento or ""), str(fallback or "")]).lower()
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def upsert_lead(db: Session, data: dict, *, source_kind: TcuSourceKind,
                publication: Optional[date], raw_text: Optional[str] = None,
                source_codigo: Optional[str] = None, source_key: Optional[str] = None,
                source_url: Optional[str] = None) -> tuple[Optional[TcuLead], bool]:
    """Cria (ou detecta duplicado) um lead a partir do dict estruturado.

    Retorna (lead, created). Se duplicado, retorna (lead_existente, False).
    """
    resp = data.get("responsavel") or {}
    responsaveis = data.get("responsaveis") or []
    # se não veio o principal mas há lista, usa o 1º da lista
    if not resp.get("documento") and responsaveis:
        resp = responsaveis[0]
    documento = resp.get("documento")
    act = data.get("act_type")
    numero = data.get("numero_processo")

    content_hash = _hash_for(numero, act, documento,
                             fallback=source_key or source_codigo or (raw_text or "")[:120])

    existing = db.query(TcuLead).filter(TcuLead.content_hash == content_hash).first()
    if existing:
        return existing, False

    prazo_dias = data.get("prazo_dias")
    prazo_final = compute_deadline(publication, prazo_dias) if publication else None

    # Categoria: fontes externas informam explicitamente; origens TCU são "tcu".
    categoria = data.get("categoria")
    if not categoria and source_kind not in (TcuSourceKind.dou, TcuSourceKind.fonte_web):
        categoria = "tcu"

    lead = TcuLead(
        act_type=_act_type(act),
        natureza_processo=data.get("natureza_processo"),
        tema=data.get("tema"),
        categoria=categoria,
        fonte_nome=data.get("fonte_nome"),
        numero_processo=numero,
        edital_numero=data.get("edital_numero"),
        acordao_ref=data.get("acordao_ref"),
        colegiado=data.get("colegiado"),
        relator=data.get("relator"),
        unidade_tecnica=data.get("unidade_tecnica"),
        responsavel_nome=resp.get("nome"),
        responsavel_documento=documento,
        responsaveis_json=json.dumps(responsaveis, ensure_ascii=False) if responsaveis else None,
        doc_type=_doc_type(resp.get("tipo_doc")),
        papel=resp.get("papel"),
        orgao_entidade=data.get("orgao_entidade"),
        uf=(data.get("uf") or None),
        municipio=data.get("municipio"),
        ja_representado=bool(data.get("ja_representado")),
        valor_debito=_to_decimal(data.get("valor_debito")),
        valor_multa=_to_decimal(data.get("valor_multa")),
        data_referencia_valor=_to_date(data.get("data_referencia_valor")),
        prazo_dias=prazo_dias,
        data_publicacao=publication,
        prazo_final=prazo_final,
        resumo=data.get("resumo"),
        is_opportunity=bool(data.get("is_opportunity", True)),
        opportunity_score=data.get("opportunity_score") if data.get("opportunity_score") is not None else score_opportunity(data),
        rationale=data.get("rationale"),
        confidence=data.get("confidence"),
        extracted_by_ai=bool(data.get("extracted_by_ai")),
        source_kind=source_kind,
        source_codigo=source_codigo,
        source_key=source_key,
        source_url=source_url,
        content_hash=content_hash,
        raw_text=(raw_text or "")[:8000] or None,
        status=TcuLeadStatus.novo,
    )
    db.add(lead)
    db.flush()
    return lead, True


# --------------------------------------------------------------------------- #
# Enriquecimento de CNPJ (com cache)
# --------------------------------------------------------------------------- #

def enrich_lead_cnpj(db: Session, lead: TcuLead, client: src.TcuHttpClient,
                     cache_days: int = 40) -> Optional[TcuCnpjEnrichment]:
    if lead.doc_type != TcuDocType.cnpj or not lead.responsavel_documento:
        return None
    if lead.enrichment:
        return lead.enrichment

    import re
    cnpj_digits = re.sub(r"\D", "", lead.responsavel_documento)
    if len(cnpj_digits) != 14:
        return None

    # Cache: reaproveita enriquecimento recente do mesmo CNPJ
    cutoff = datetime.utcnow() - timedelta(days=cache_days)
    cached = (
        db.query(TcuCnpjEnrichment)
        .filter(TcuCnpjEnrichment.cnpj == cnpj_digits, TcuCnpjEnrichment.fetched_at >= cutoff)
        .order_by(TcuCnpjEnrichment.fetched_at.desc())
        .first()
    )
    if cached:
        data = {c.name: getattr(cached, c.name) for c in TcuCnpjEnrichment.__table__.columns
                if c.name not in ("id", "lead_id", "fetched_at")}
        enr = TcuCnpjEnrichment(lead_id=lead.id, **data)
        db.add(enr)
        db.flush()
        return enr

    result = src.enrich_cnpj(client, cnpj_digits)
    if not result:
        return None

    enr = TcuCnpjEnrichment(
        lead_id=lead.id,
        cnpj=result["cnpj"],
        razao_social=result.get("razao_social"),
        nome_fantasia=result.get("nome_fantasia"),
        situacao_cadastral=result.get("situacao_cadastral"),
        porte=result.get("porte"),
        cnae_principal=result.get("cnae_principal"),
        natureza_juridica=result.get("natureza_juridica"),
        capital_social=result.get("capital_social"),
        logradouro=result.get("logradouro"),
        municipio=result.get("municipio"),
        uf=result.get("uf"),
        cep=result.get("cep"),
        email=result.get("email"),
        telefone=result.get("telefone"),
        socios=json.dumps(result.get("socios") or [], ensure_ascii=False),
        raw=json.dumps(result.get("raw") or {}, ensure_ascii=False, default=str),
        source="BrasilAPI",
    )
    db.add(enr)
    # completa UF/município do lead se ausentes
    if not lead.uf and result.get("uf"):
        lead.uf = result["uf"]
    if not lead.municipio and result.get("municipio"):
        lead.municipio = result["municipio"]
    db.flush()
    return enr


# --------------------------------------------------------------------------- #
# Limpeza de ruído (acórdãos sem parte identificada)
# --------------------------------------------------------------------------- #

def cleanup_noise(db: Session) -> dict:
    """Remove leads de baixo valor: acórdãos da API sem responsável identificado.

    São os milhares de acórdãos antigos que poluem a lista — sem responsável,
    órgão ou valor não servem para avaliação de lead.
    """
    from ..models.process import TrackedProcess
    q = db.query(TcuLead).filter(
        TcuLead.source_kind == TcuSourceKind.acordaos_api,
        TcuLead.responsavel_documento.is_(None),
    )
    ids = [l.id for l in q.all()]
    removed = 0
    if ids:
        # desvincula processos que apontavam para esses leads
        db.query(TrackedProcess).filter(TrackedProcess.lead_id.in_(ids)).update(
            {TrackedProcess.lead_id: None}, synchronize_session=False)
        db.query(TcuLeadNote).filter(TcuLeadNote.lead_id.in_(ids)).delete(synchronize_session=False)
        removed = q.delete(synchronize_session=False)
        db.commit()
    return {"removed": removed}


# --------------------------------------------------------------------------- #
# Ingestão de blocos → leads
# --------------------------------------------------------------------------- #

def _ingest_blocks(db: Session, blocks: list[ParsedBlock], *, source_kind: TcuSourceKind,
                   publication: Optional[date], source_codigo: Optional[str] = None,
                   source_key: Optional[str] = None, source_url: Optional[str] = None,
                   run: Optional[TcuMonitorRun] = None) -> dict:
    created = duplicated = 0
    created_ids = []
    for block in blocks:
        data = extract_block(block)
        lead, is_new = upsert_lead(
            db, data, source_kind=source_kind, publication=publication,
            raw_text=block.raw_text, source_codigo=source_codigo,
            source_key=source_key, source_url=source_url,
        )
        if is_new and lead:
            created += 1
            created_ids.append(lead.id)
        else:
            duplicated += 1
    if run:
        run.blocks_parsed = (run.blocks_parsed or 0) + len(blocks)
        run.leads_created = (run.leads_created or 0) + created
        run.leads_duplicated = (run.leads_duplicated or 0) + duplicated
    db.commit()
    return {"created": created, "duplicated": duplicated, "created_ids": created_ids}


def ingest_text(db: Session, text: str, *, publication: Optional[date] = None,
                user_id: Optional[int] = None) -> dict:
    """Ingestão manual: recebe o texto de um caderno e cria leads.

    Contorna a lacuna do endpoint de listagem do BTCU e serve para backfill.
    """
    blocks = parse_caderno(text or "")
    if not blocks:
        return {"created": 0, "duplicated": 0, "created_ids": [], "message": "Nenhum edital/acórdão reconhecido no texto."}
    result = _ingest_blocks(db, blocks, source_kind=TcuSourceKind.ingestao_manual,
                            publication=publication or date.today())
    log_action(db=db, action="TCU_INGEST_TEXT", entity_type="TcuLead",
               description=f"Ingestão manual de texto: {result['created']} leads",
               new_values={k: v for k, v in result.items() if k != "created_ids"}, user_id=user_id)
    return result


def ingest_pdf(db: Session, pdf_bytes: bytes, *, publication: Optional[date] = None,
               source_codigo: Optional[str] = None, user_id: Optional[int] = None) -> dict:
    """Ingestão manual de um PDF do BTCU."""
    text = extract_text_from_pdf(pdf_bytes)
    if not text.strip():
        return {"created": 0, "duplicated": 0, "created_ids": [],
                "message": "Não foi possível extrair texto do PDF (verifique se pdfplumber/PyMuPDF estão instalados ou se é PDF de imagem)."}
    blocks = parse_caderno(text)
    result = _ingest_blocks(db, blocks, source_kind=TcuSourceKind.btcu_deliberacoes,
                            publication=publication or date.today(), source_codigo=source_codigo)
    log_action(db=db, action="TCU_INGEST_PDF", entity_type="TcuLead",
               description=f"Ingestão de PDF BTCU: {result['created']} leads",
               new_values={k: v for k, v in result.items() if k != "created_ids"}, user_id=user_id)
    return result


# --------------------------------------------------------------------------- #
# Fontes de API
# --------------------------------------------------------------------------- #

def _process_acordaos(db: Session, client: src.TcuHttpClient, settings: TcuMonitorSettings,
                      run: TcuMonitorRun) -> dict:
    # Acórdãos da API raramente trazem responsável/órgão — só viram leads se o
    # usuário optar explicitamente (evita inundar a lista com acórdãos antigos).
    if not getattr(settings, "acordaos_create_leads", False):
        return {"fetched": 0, "created": 0, "duplicated": 0, "skipped": "acordaos_create_leads=off"}
    page_size = min(int(settings.acordaos_page_size or 50), 200)  # teto de segurança
    acordaos = src.fetch_acordaos(client, inicio=0, quantidade=page_size)[:page_size]
    created = duplicated = 0
    for ac in acordaos:
        if not src.acordao_is_condenatorio(ac):
            continue
        numero = f"{ac.get('numeroAcordao')}/{ac.get('anoAcordao')}" if ac.get("numeroAcordao") else None
        data = {
            "act_type": "acordao_condenatorio",
            "natureza_processo": ac.get("tipo"),
            "tema": None,
            "numero_processo": None,
            "acordao_ref": numero,
            "colegiado": ac.get("colegiado"),
            "relator": ac.get("relator"),
            "responsavel": {"nome": None, "documento": None, "tipo_doc": None, "papel": "responsável"},
            "valor_debito": None, "valor_multa": None,
            "prazo_dias": 15,
            "resumo": (ac.get("sumario") or ac.get("titulo") or "")[:1000],
            "is_opportunity": True,
            "rationale": "Acórdão condenatório (impõe débito/multa) — janela recursal.",
            "confidence": "low",
            "extracted_by_ai": False,
        }
        data["opportunity_score"] = score_opportunity(data)
        pub = _to_date(_iso_from_ddmmyyyy(ac.get("dataSessao")))
        lead, is_new = upsert_lead(
            db, data, source_kind=TcuSourceKind.acordaos_api, publication=pub,
            raw_text=ac.get("sumario"), source_key=ac.get("key"),
            source_url=ac.get("urlAcordao") or ac.get("urlArquivoPDF"),
        )
        if is_new and lead:
            created += 1
        else:
            duplicated += 1
    run.leads_created = (run.leads_created or 0) + created
    run.leads_duplicated = (run.leads_duplicated or 0) + duplicated
    db.commit()
    return {"fetched": len(acordaos), "created": created, "duplicated": duplicated}


def _process_pautas(db: Session, client: src.TcuHttpClient, run: TcuMonitorRun) -> dict:
    pautas = src.fetch_pautas(client)
    created = duplicated = 0
    for p in pautas:
        numero = p.get("numeroProcesso")
        if not numero:
            continue
        data = {
            "act_type": "edital",
            "natureza_processo": p.get("naturezaProcesso") or p.get("tipoProcesso"),
            "tema": None,
            "numero_processo": numero,
            "colegiado": p.get("nomeColegiado") or p.get("siglaColegiado"),
            "relator": p.get("nomeRelator") or p.get("siglaRelator"),
            "responsavel": {"nome": None, "documento": None, "tipo_doc": None, "papel": None},
            "prazo_dias": None,
            "resumo": f"Processo pautado para {p.get('dataSessao')} ({p.get('naturezaProcesso') or ''}). Early-warning: acompanhar antes do julgamento.",
            "is_opportunity": False,
            "rationale": "Sinal antecipado (pauta). Ainda sem intimação de parte.",
            "confidence": "low",
            "extracted_by_ai": False,
        }
        data["opportunity_score"] = score_opportunity(data)
        pub = _to_date(_iso_from_ddmmyyyy(p.get("dataSessao")))
        lead, is_new = upsert_lead(
            db, data, source_kind=TcuSourceKind.pauta_sessao, publication=pub,
            source_key=f"pauta-{numero}-{p.get('dataSessao')}",
        )
        if is_new and lead:
            created += 1
        else:
            duplicated += 1
    run.leads_created = (run.leads_created or 0) + created
    run.leads_duplicated = (run.leads_duplicated or 0) + duplicated
    db.commit()
    return {"fetched": len(pautas), "created": created, "duplicated": duplicated}


def _process_btcu(db: Session, client: src.TcuHttpClient, settings: TcuMonitorSettings,
                  run: TcuMonitorRun) -> dict:
    items = src.fetch_btcu_listing(client, settings)
    editions = 0
    agg = {"created": 0, "duplicated": 0}
    for item in items:
        codigo = src.extract_codigo_from_listing_item(item)
        if not codigo:
            continue
        pdf = src.download_btcu_pdf(client, codigo)
        if not pdf:
            continue
        editions += 1
        text = extract_text_from_pdf(pdf)
        if not text.strip():
            continue
        blocks = parse_caderno(text)
        res = _ingest_blocks(
            db, blocks, source_kind=TcuSourceKind.btcu_deliberacoes,
            publication=date.today(), source_codigo=codigo,
            source_url=src.BTCU_PDF_URL.format(codigo=codigo), run=run,
        )
        agg["created"] += res["created"]
        agg["duplicated"] += res["duplicated"]
    run.editions_processed = (run.editions_processed or 0) + editions
    db.commit()
    return {"editions": editions, **agg}


def _iso_from_ddmmyyyy(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%d/%m/%Y").strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# Enriquecimento em lote (pós-coleta, respeitando rate-limit)
# --------------------------------------------------------------------------- #

def _enrich_new_leads(db: Session, client: src.TcuHttpClient, settings: TcuMonitorSettings) -> int:
    if not settings.enrich_cnpj:
        return 0
    pending = (
        db.query(TcuLead)
        .filter(TcuLead.doc_type == TcuDocType.cnpj)
        .outerjoin(TcuCnpjEnrichment)
        .filter(TcuCnpjEnrichment.id.is_(None))
        .limit(50)   # nunca varredura em massa
        .all()
    )
    enriched = 0
    for lead in pending:
        try:
            if enrich_lead_cnpj(db, lead, client, cache_days=int(settings.enrich_cache_days or 40)):
                enriched += 1
        except Exception as e:
            logger.warning(f"Enriquecimento do lead {lead.id} falhou: {e}")
    db.commit()
    return enriched


# --------------------------------------------------------------------------- #
# Execução completa do pipeline
# --------------------------------------------------------------------------- #

def run_pipeline(db: Session, trigger: str = "scheduler", user_id: Optional[int] = None) -> dict:
    settings = get_settings(db)
    run = TcuMonitorRun(status=TcuRunStatus.running, trigger=trigger)
    db.add(run)
    db.commit()
    db.refresh(run)

    detail = {}
    errors = []
    client = _client(settings)

    if settings.acordaos_enabled:
        try:
            detail["acordaos"] = _process_acordaos(db, client, settings, run)
        except Exception as e:
            logger.error(f"Fonte acórdãos falhou: {e}")
            errors.append(f"acordaos: {e}")

    if settings.pautas_enabled:
        try:
            detail["pautas"] = _process_pautas(db, client, run)
        except Exception as e:
            logger.error(f"Fonte pautas falhou: {e}")
            errors.append(f"pautas: {e}")

    if settings.btcu_enabled and settings.btcu_listing_url:
        try:
            detail["btcu"] = _process_btcu(db, client, settings, run)
        except Exception as e:
            logger.error(f"Fonte BTCU falhou: {e}")
            errors.append(f"btcu: {e}")

    try:
        detail["enriched"] = _enrich_new_leads(db, client, settings)
    except Exception as e:
        logger.error(f"Enriquecimento falhou: {e}")
        errors.append(f"enrich: {e}")

    # Detecção de processos autuados do dia (compara a lista de hoje com a já conhecida)
    try:
        from . import process_tracker
        today = date.today()
        detail["processos_novos"] = process_tracker.sync_from_leads(db, detection_date=today)
        if settings.autuados_enabled:
            detail["autuados"] = process_tracker.fetch_and_register_autuados(
                db, client, settings, detection_date=today)
    except Exception as e:
        logger.error(f"Detecção de autuados falhou: {e}")
        errors.append(f"autuados: {e}")

    # Radar Externo: DOU + fontes web/RSS (embaixadas, estatais, empresas)
    try:
        from .external import pipeline as ext_pipeline
        ext = ext_pipeline.run_external(db, settings, detection_date=date.today())
        detail["radar_externo"] = ext
        ext_created = (ext.get("dou", {}).get("created", 0) if isinstance(ext.get("dou"), dict) else 0) \
            + (ext.get("web", {}).get("created", 0) if isinstance(ext.get("web"), dict) else 0)
        run.leads_created = (run.leads_created or 0) + ext_created
    except Exception as e:
        logger.error(f"Radar Externo falhou: {e}")
        errors.append(f"radar_externo: {e}")

    # Libera o navegador headless (memória) assim que a coleta no TCU termina.
    try:
        client.close()
    except Exception:
        pass

    # Resumo diário por e-mail (apenas quando houver oportunidades relevantes)
    try:
        from .digest import send_daily_digest
        detail["digest"] = send_daily_digest(db)
    except Exception as e:
        logger.error(f"Envio do resumo falhou: {e}")
        errors.append(f"digest: {e}")

    run.finished_at = datetime.utcnow()
    run.detail = json.dumps(detail, ensure_ascii=False, default=str)
    run.last_acordao_index = settings.last_acordao_index
    if errors and run.leads_created:
        run.status = TcuRunStatus.partial
        run.error = "; ".join(errors)
    elif errors:
        run.status = TcuRunStatus.error
        run.error = "; ".join(errors)
    else:
        run.status = TcuRunStatus.success
    db.commit()

    log_action(db=db, action="TCU_PIPELINE_RUN", entity_type="TcuMonitorRun", entity_id=run.id,
               description=f"Pipeline TCU ({trigger}): {run.leads_created} leads, {run.leads_duplicated} duplicados",
               new_values=detail, user_id=user_id)

    return {
        "run_id": run.id,
        "status": run.status.value,
        "editions_processed": run.editions_processed,
        "blocks_parsed": run.blocks_parsed,
        "leads_created": run.leads_created,
        "leads_duplicated": run.leads_duplicated,
        "detail": detail,
        "errors": errors,
    }
