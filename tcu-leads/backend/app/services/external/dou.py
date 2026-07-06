"""
Conector do DOU (Diário Oficial da União) — Imprensa Nacional.

Usa a "leitura do jornal" (in.gov.br/leiturajornal), que devolve a edição do dia
por seção com um JSON embutido na página (script#params → jsonArray). Cada item
traz título, resumo e o caminho da matéria.

Como o TCU, o alvo é público mas convém enviar cabeçalhos de navegador. Não é
testável do ambiente de desenvolvimento (rede externa bloqueada); calibrar no
servidor via "Testar fonte".
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DOU_BASE = "https://www.in.gov.br"
DOU_LEITURA = DOU_BASE + "/leiturajornal"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")

SECAO_LABELS = {"do1": "DOU Seção 1", "do2": "DOU Seção 2", "do3": "DOU Seção 3",
                "do1e": "DOU Seção 1 Extra", "do2e": "DOU Seção 2 Extra", "do3e": "DOU Seção 3 Extra"}


def _get(url: str, params: dict, timeout: int = 30) -> Optional[httpx.Response]:
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
    }
    backoff = 2
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout, headers=headers, follow_redirects=True) as c:
                resp = c.get(url, params=params)
            if resp.status_code == 200:
                return resp
            if resp.status_code == 429 or resp.status_code >= 500:
                import time; time.sleep(backoff); backoff *= 2; continue
            return None
        except httpx.HTTPError as e:
            logger.warning(f"DOU GET falhou ({e})")
            import time; time.sleep(backoff); backoff *= 2
    return None


def _parse_embedded_json(html: str) -> list[dict]:
    """Extrai o jsonArray da página de leitura do DOU."""
    # 1) script#params
    m = re.search(r'id=["\']params["\'][^>]*>(.*?)</script>', html, re.DOTALL)
    blob = m.group(1) if m else None
    if not blob:
        # 2) procura 'jsonArray' em qualquer script
        m2 = re.search(r'"jsonArray"\s*:\s*(\[.*?\])\s*[,}]', html, re.DOTALL)
        if m2:
            try:
                return json.loads(m2.group(1))
            except json.JSONDecodeError:
                return []
        return []
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        return []
    arr = data.get("jsonArray") if isinstance(data, dict) else None
    return arr if isinstance(arr, list) else []


def fetch_dou_secao(secao: str, dia: date) -> tuple[list[dict], dict]:
    """Baixa a edição de uma seção do DOU num dia. Retorna (itens, diagnóstico)."""
    params = {"secao": secao, "data": dia.strftime("%d-%m-%Y")}
    diag = {"secao": secao, "data": params["data"], "status": None, "count": 0, "error": None}
    resp = _get(DOU_LEITURA, params)
    if not resp:
        diag["error"] = "Sem resposta do DOU (bloqueio/timeout)."
        return [], diag
    arr = _parse_embedded_json(resp.text)
    items = []
    for it in arr:
        title = (it.get("title") or "").strip()
        url_title = it.get("urlTitle") or it.get("url") or ""
        url = url_title if str(url_title).startswith("http") else f"{DOU_BASE}/web/dou/-/{url_title}"
        body = re.sub(r"<[^>]+>", " ", it.get("content") or it.get("abstract") or "")
        items.append({
            "title": title, "url": url, "body": body.strip(),
            "secao": secao, "secao_label": SECAO_LABELS.get(secao, secao.upper()),
            "art_type": it.get("artType"), "pub_name": it.get("pubName"),
        })
    diag["status"] = "ok"
    diag["count"] = len(items)
    if not items:
        diag["error"] = ("Página do DOU carregou mas nenhum item foi lido "
                         "(estrutura da página pode ter mudado ou dia sem publicações).")
        diag["sample_html"] = resp.text[:300]
    return items, diag


def fetch_dou(secoes: list[str], dia: date) -> tuple[list[dict], dict]:
    """Baixa várias seções do DOU num dia."""
    all_items = []
    diags = {}
    for secao in secoes:
        items, d = fetch_dou_secao(secao.strip(), dia)
        all_items.extend(items)
        diags[secao.strip()] = d
    return all_items, {"secoes": diags, "count": len(all_items)}
