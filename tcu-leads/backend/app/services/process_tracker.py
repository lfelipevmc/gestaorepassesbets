"""
Detecção de processos autuados no TCU por comparação dia-a-dia.

Mantém uma tabela de processos já conhecidos (TrackedProcess). Todo número de
processo inédito passa a constar com detection_date = dia da varredura, sendo
portanto tratado como "autuado do dia". A base é alimentada por:
  1. sync_from_leads: números vistos nas fontes do pipeline (editais/acórdãos/pautas);
  2. fetch_and_register_autuados: uma fonte dedicada de listagem de processos.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from ..models import TcuLead, TcuSourceKind
from ..models.process import TrackedProcess
from . import sources as src
from .parser import RE_PROCESSO, normalize_processo

logger = logging.getLogger(__name__)


def canonical_processo(numero: Optional[str]) -> Optional[str]:
    """Normaliza para 'TC nnn.nnn/aaaa-n' quando reconhecível."""
    if not numero:
        return None
    m = RE_PROCESSO.search(numero)
    if m:
        return "TC " + normalize_processo(m.group(1))
    cleaned = re.sub(r"\s+", " ", numero).strip()
    return cleaned or None


def register_process(db: Session, numero: str, *, source: str, detection_date: date,
                     meta: Optional[dict] = None, lead_id: Optional[int] = None) -> tuple[Optional[TrackedProcess], bool]:
    canon = canonical_processo(numero)
    if not canon:
        return None, False
    existing = db.query(TrackedProcess).filter(TrackedProcess.numero_processo == canon).first()
    if existing:
        # completa lead_id se agora existe
        if lead_id and not existing.lead_id:
            existing.lead_id = lead_id
        return existing, False
    meta = meta or {}
    tp = TrackedProcess(
        numero_processo=canon,
        natureza=meta.get("natureza"),
        tipo=meta.get("tipo"),
        orgao_entidade=meta.get("orgao_entidade"),
        relator=meta.get("relator"),
        colegiado=meta.get("colegiado"),
        uf=meta.get("uf"),
        municipio=meta.get("municipio"),
        titulo=meta.get("titulo"),
        first_source=source,
        detection_date=detection_date,
        lead_id=lead_id,
        raw=json.dumps(meta, ensure_ascii=False, default=str) if meta else None,
    )
    db.add(tp)
    db.flush()
    return tp, True


def sync_from_leads(db: Session, detection_date: date) -> int:
    """Registra como processo conhecido todo numero_processo de lead ainda não rastreado."""
    leads = db.query(TcuLead).filter(TcuLead.numero_processo.isnot(None)).all()
    new_count = 0
    for lead in leads:
        _, is_new = register_process(
            db, lead.numero_processo,
            source=lead.source_kind.value if lead.source_kind else "lead",
            detection_date=detection_date,
            meta={
                "natureza": lead.natureza_processo, "orgao_entidade": lead.orgao_entidade,
                "relator": lead.relator, "colegiado": lead.colegiado,
                "uf": lead.uf, "municipio": lead.municipio,
            },
            lead_id=lead.id,
        )
        if is_new:
            new_count += 1
    db.commit()
    return new_count


def fetch_and_register_autuados(db: Session, client: "src.TcuHttpClient", settings,
                                detection_date: date) -> dict:
    """Busca a lista de processos do dia e registra os inéditos como autuados.

    Se autuados_create_leads estiver ligado, cria um lead de baixo score para
    cada processo inédito (para acompanhamento).
    """
    items = src.fetch_processos_listing(client, settings)
    novos = 0
    leads_criados = 0
    for item in items:
        numero = src.extract_processo_from_item(item)
        if not numero:
            continue
        meta = {
            "natureza": item.get("naturezaProcesso") or item.get("natureza"),
            "tipo": item.get("tipoProcesso") or item.get("tipo"),
            "orgao_entidade": item.get("orgao") or item.get("orgaoEntidade"),
            "relator": item.get("nomeRelator") or item.get("relator"),
            "colegiado": item.get("nomeColegiado") or item.get("colegiado"),
            "uf": item.get("uf"), "municipio": item.get("municipio"),
            "titulo": item.get("titulo") or item.get("assunto"),
        }
        tp, is_new = register_process(db, numero, source="autuados_list",
                                      detection_date=detection_date, meta=meta)
        if not is_new or not tp:
            continue
        novos += 1
        if settings.autuados_create_leads:
            lead = _create_autuado_lead(db, tp, detection_date)
            if lead:
                tp.lead_id = lead.id
                leads_criados += 1
    db.commit()
    return {"fetched": len(items), "novos": novos, "leads_criados": leads_criados}


def _create_autuado_lead(db: Session, tp: TrackedProcess, detection_date: date):
    """Cria um lead de baixo score para um processo autuado inédito."""
    from .pipeline import upsert_lead  # import tardio (evita ciclo)
    data = {
        "act_type": "edital",
        "natureza_processo": tp.natureza,
        "tema": None,
        "numero_processo": tp.numero_processo,
        "colegiado": tp.colegiado,
        "relator": tp.relator,
        "orgao_entidade": tp.orgao_entidade,
        "uf": tp.uf, "municipio": tp.municipio,
        "responsavel": {"nome": None, "documento": None, "tipo_doc": None, "papel": None},
        "prazo_dias": None,
        "resumo": f"Processo autuado no TCU detectado em {detection_date.strftime('%d/%m/%Y')}"
                  f"{' — ' + tp.natureza if tp.natureza else ''}. Acompanhar para eventuais intimações.",
        "is_opportunity": False,
        "rationale": "Processo recém-autuado (sinal antecipado). Ainda sem intimação de parte.",
        "confidence": "low",
        "extracted_by_ai": False,
    }
    lead, _ = upsert_lead(db, data, source_kind=TcuSourceKind.processo_autuado,
                          publication=detection_date, source_key=f"autuado-{tp.numero_processo}")
    return lead
