"""
Radar Externo — orquestração da coleta em fontes externas.

Fluxo por fonte: fetch → dedupe (ExternalSeenItem) → classify → cria lead.

Fontes:
  - DOU (Diário Oficial da União), por seção, no dia;
  - Fontes web/RSS cadastradas (embaixadas, estatais, grandes empresas...).

Tudo desagua na MESMA lista de Oportunidades (tabela tcu_leads), com selo de
origem (source_kind = dou | fonte_web) e categoria (licitação/sanção/nomeação/
palavra-chave). Só itens classificados como oportunidade viram lead; todos os
itens vistos são marcados para não reavaliar.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from ...models import (
    TcuLead, TcuSourceKind, MonitoredSource, ExternalSeenItem, TcuMonitorSettings,
)
from ..pipeline import upsert_lead
from . import dou as dou_src
from . import web as web_src
from . import classifier

logger = logging.getLogger(__name__)

# Tetos de segurança por execução (evita inundar a lista num dia atípico)
MAX_LEADS_DOU = 120
MAX_LEADS_SOURCE = 60


# --------------------------------------------------------------------------- #
# Utilidades
# --------------------------------------------------------------------------- #

def _split_keywords(raw: Optional[str]) -> list[str]:
    if not raw:
        return []
    parts: list[str] = []
    for chunk in str(raw).replace(";", "\n").replace(",", "\n").splitlines():
        c = chunk.strip()
        if c:
            parts.append(c)
    return parts


def _item_hash(source_ref: str, url: str, title: str) -> str:
    base = f"{source_ref}|{(url or title or '').strip().lower()}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _already_seen(db: Session, item_hash: str) -> bool:
    return db.query(ExternalSeenItem).filter(ExternalSeenItem.item_hash == item_hash).first() is not None


def _responsaveis_from_docs(documentos: list[dict], orgao: Optional[str]) -> list[dict]:
    """Monta a lista de responsáveis a partir dos documentos (CNPJ/CPF) achados.

    Sem enriquecer CPF (roteiro §3): o nome vem só se o próprio texto o trouxer,
    o que aqui não temos — então guardamos o documento e o órgão como referência.
    """
    resp = []
    for d in documentos or []:
        resp.append({
            "nome": None,
            "documento": d.get("valor"),
            "tipo_doc": d.get("tipo"),
            "papel": None,
        })
    return resp


def _build_lead_data(item: dict, cls: dict, fonte_nome: str) -> dict:
    """Converte item+classificação no dict que o upsert_lead entende."""
    documentos = cls.get("documentos") or []
    responsaveis = _responsaveis_from_docs(documentos, cls.get("orgao"))
    principal = responsaveis[0] if responsaveis else {
        "nome": None, "documento": None, "tipo_doc": None, "papel": None}
    categoria = cls.get("categoria") or "outro"
    titulo = (item.get("title") or "").strip()
    resumo = cls.get("resumo") or titulo
    cat_label = {
        "licitacao": "Licitação/contratação", "sancao": "Sanção/investigação",
        "nomeacao": "Nomeação/mudança de gestão", "palavra_chave": "Palavra-chave monitorada",
    }.get(categoria, "Sinal externo")
    kws = ", ".join(cls.get("keywords") or [])
    return {
        "act_type": "outro",
        "natureza_processo": cat_label,
        "categoria": categoria,
        "fonte_nome": fonte_nome,
        "tema": None,
        "numero_processo": None,
        "orgao_entidade": cls.get("orgao"),
        "responsavel": principal,
        "responsaveis": responsaveis,
        "prazo_dias": None,
        "resumo": (f"[{fonte_nome}] {titulo}\n{resumo}"
                   f"{' — termos: ' + kws if kws else ''}").strip(),
        "is_opportunity": bool(cls.get("is_opportunity")),
        "opportunity_score": cls.get("score"),
        "rationale": f"Sinal de {cat_label.lower()} detectado em fonte externa ({fonte_nome}).",
        "confidence": "low",
        "extracted_by_ai": False,
    }


# --------------------------------------------------------------------------- #
# Processa uma coleção de itens (comum a DOU e fontes web)
# --------------------------------------------------------------------------- #

def _process_items(db: Session, items: list[dict], *, source_ref: str, fonte_nome: str,
                   source_kind: TcuSourceKind, user_keywords: list[str],
                   categoria_padrao: Optional[str], detection_date: date,
                   max_leads: int) -> dict:
    seen = created = 0
    for item in items:
        title = (item.get("title") or "").strip()
        url = (item.get("url") or "").strip()
        if not title and not url:
            continue
        h = _item_hash(source_ref, url, title)
        if _already_seen(db, h):
            continue
        seen += 1
        cls = classifier.classify_item(
            title, item.get("body") or "", user_keywords=user_keywords,
            categoria_padrao=categoria_padrao)

        seen_row = ExternalSeenItem(source_ref=source_ref, item_hash=h,
                                    title=title[:600], url=url[:700] or None)
        db.add(seen_row)
        db.flush()

        if cls.get("is_opportunity") and created < max_leads:
            data = _build_lead_data(item, cls, fonte_nome)
            lead, is_new = upsert_lead(
                db, data, source_kind=source_kind, publication=detection_date,
                raw_text=(item.get("body") or title)[:4000],
                source_key=h, source_url=url or None)
            if is_new and lead:
                created += 1
                seen_row.lead_id = lead.id
    db.commit()
    return {"seen": seen, "created": created}


# --------------------------------------------------------------------------- #
# DOU
# --------------------------------------------------------------------------- #

def process_dou(db: Session, settings: TcuMonitorSettings, detection_date: date) -> dict:
    secoes = _split_keywords(getattr(settings, "dou_secoes", None) or "do1,do3")
    user_keywords = _split_keywords(getattr(settings, "dou_keywords", None))
    items, diag = dou_src.fetch_dou(secoes, detection_date)
    # agrupa por seção para dar um selo de origem legível
    result = {"fetched": len(items), "seen": 0, "created": 0, "diag": diag}
    by_secao: dict[str, list[dict]] = {}
    for it in items:
        by_secao.setdefault(it.get("secao") or "dou", []).append(it)
    for secao, sec_items in by_secao.items():
        label = dou_src.SECAO_LABELS.get(secao, f"DOU {secao}")
        r = _process_items(
            db, sec_items, source_ref=f"dou:{secao}", fonte_nome=label,
            source_kind=TcuSourceKind.dou, user_keywords=user_keywords,
            categoria_padrao=None, detection_date=detection_date,
            max_leads=MAX_LEADS_DOU)
        result["seen"] += r["seen"]
        result["created"] += r["created"]
    return result


# --------------------------------------------------------------------------- #
# Fontes web/RSS cadastradas
# --------------------------------------------------------------------------- #

def process_source(db: Session, source: MonitoredSource, detection_date: date) -> dict:
    user_keywords = _split_keywords(source.keywords)
    items = web_src.fetch_source_items(source.kind or "rss", source.url,
                                       item_selector=source.item_selector)
    r = _process_items(
        db, items, source_ref=f"monitored:{source.id}", fonte_nome=source.name,
        source_kind=TcuSourceKind.fonte_web, user_keywords=user_keywords,
        categoria_padrao=source.categoria_padrao, detection_date=detection_date,
        max_leads=MAX_LEADS_SOURCE)
    source.last_checked_at = datetime.utcnow()
    source.last_status = f"ok: {len(items)} itens, {r['created']} lead(s)"
    source.items_found = len(items)
    db.commit()
    return {"source": source.name, "fetched": len(items), **r}


def process_web_sources(db: Session, detection_date: date) -> dict:
    sources = db.query(MonitoredSource).filter(MonitoredSource.enabled.is_(True)).all()
    agg = {"sources": 0, "created": 0, "seen": 0, "detail": []}
    for source in sources:
        try:
            r = process_source(db, source, detection_date)
            agg["sources"] += 1
            agg["created"] += r["created"]
            agg["seen"] += r["seen"]
            agg["detail"].append(r)
        except Exception as e:
            logger.warning(f"Fonte web '{source.name}' falhou: {e}")
            source.last_checked_at = datetime.utcnow()
            source.last_status = f"erro: {e}"
            db.commit()
            agg["detail"].append({"source": source.name, "error": str(e)})
    return agg


# --------------------------------------------------------------------------- #
# Execução do Radar Externo (chamada pelo pipeline diário / manual)
# --------------------------------------------------------------------------- #

def run_external(db: Session, settings: TcuMonitorSettings, detection_date: Optional[date] = None) -> dict:
    detection_date = detection_date or date.today()
    out: dict = {}
    if getattr(settings, "dou_enabled", False):
        try:
            out["dou"] = process_dou(db, settings, detection_date)
        except Exception as e:
            logger.error(f"Radar DOU falhou: {e}")
            out["dou"] = {"error": str(e)}
    if getattr(settings, "fontes_web_enabled", True):
        try:
            out["web"] = process_web_sources(db, detection_date)
        except Exception as e:
            logger.error(f"Radar web falhou: {e}")
            out["web"] = {"error": str(e)}
    return out
