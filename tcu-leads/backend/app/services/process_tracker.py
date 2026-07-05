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
    resp = meta.get("responsaveis")
    tp = TrackedProcess(
        numero_processo=canon,
        natureza=meta.get("natureza"),
        tipo=meta.get("tipo"),
        assunto=meta.get("assunto"),
        orgao_entidade=meta.get("orgao_entidade"),
        relator=meta.get("relator"),
        colegiado=meta.get("colegiado"),
        uf=(meta.get("uf") or "")[:2] or None,
        municipio=meta.get("municipio"),
        titulo=meta.get("titulo") or meta.get("assunto"),
        responsaveis_json=json.dumps(resp, ensure_ascii=False) if resp else None,
        estado=meta.get("estado"),
        ultima_movimentacao=(str(meta.get("ultima_movimentacao"))[:500] if meta.get("ultima_movimentacao") else None),
        data_autuacao=meta.get("data_autuacao_date"),
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
                "responsaveis": lead.responsaveis,
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
    di = detection_date.strftime("%Y-%m-%d")
    items, diag = src.fetch_processos_listing(client, settings, data_inicio=di, data_fim=di)
    # Se o filtro é por DATA DE AUTUAÇÃO, todo processo retornado foi autuado nesse dia
    filtro_campo = (getattr(settings, "autuados_filtro_campo", None) or "DTAUTUACAO").upper()
    is_autuacao_filter = filtro_campo == "DTAUTUACAO"
    novos = 0
    leads_criados = 0
    for item in items:
        fields = src.extract_processo_fields(item)
        numero = fields.get("numero")
        if not numero:
            continue
        # Abordagem (ii): data de autuação. Com o filtro DTAUTUACAO, é a própria data-alvo.
        autuacao = _parse_any_date(fields.get("data_autuacao")) or (detection_date if is_autuacao_filter else None)
        meta = dict(fields)
        meta["titulo"] = fields.get("assunto")
        meta["data_autuacao_date"] = autuacao
        tp, is_new = register_process(db, numero, source="autuados_list",
                                      detection_date=detection_date, meta=meta)
        if not is_new or not tp:
            continue
        novos += 1
        if settings.autuados_create_leads:
            lead = _create_autuado_lead(db, tp, detection_date, fields)
            if lead:
                tp.lead_id = lead.id
                leads_criados += 1
    db.commit()
    return {"fetched": len(items), "novos": novos, "leads_criados": leads_criados, "diag": diag}


def _parse_any_date(v):
    if not v:
        return None
    if isinstance(v, date):
        return v
    s = str(v)[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            from datetime import datetime as _dt
            return _dt.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _create_autuado_lead(db: Session, tp: TrackedProcess, detection_date: date, fields: dict = None):
    """Cria um lead para um processo autuado inédito (com órgão/assunto/responsáveis)."""
    from .pipeline import upsert_lead  # import tardio (evita ciclo)
    fields = fields or {}
    responsaveis = fields.get("responsaveis") or []
    principal = responsaveis[0] if responsaveis else {"nome": None, "documento": None, "tipo_doc": None, "papel": None}
    nomes = "; ".join(r["nome"] for r in responsaveis if r.get("nome"))
    assunto = tp.assunto or fields.get("assunto")
    data = {
        "act_type": "edital",
        "natureza_processo": tp.natureza or tp.tipo,
        "tema": None,
        "numero_processo": tp.numero_processo,
        "colegiado": tp.colegiado,
        "relator": tp.relator,
        "orgao_entidade": tp.orgao_entidade,
        "uf": tp.uf, "municipio": tp.municipio,
        "responsavel": principal,
        "responsaveis": responsaveis,
        "prazo_dias": None,
        "resumo": (f"Processo autuado no TCU em {detection_date.strftime('%d/%m/%Y')}"
                   f"{' — ' + tp.natureza if tp.natureza else ''}."
                   f"{' Responsável(is): ' + nomes + '.' if nomes else ''}"
                   f" Órgão: {tp.orgao_entidade or '—'}."
                   f"{' Assunto: ' + assunto[:200] + '.' if assunto else ''}"
                   f" Momento ideal de aproximação (recém-autuado)."),
        "is_opportunity": True,
        "rationale": "Processo recém-autuado — descoberta antecipada, antes de qualquer intimação.",
        "confidence": "medium",
        "extracted_by_ai": False,
    }
    lead, _ = upsert_lead(db, data, source_kind=TcuSourceKind.processo_autuado,
                          publication=detection_date, source_key=f"autuado-{tp.numero_processo}",
                          source_url=fields.get("source_url"))
    return lead
