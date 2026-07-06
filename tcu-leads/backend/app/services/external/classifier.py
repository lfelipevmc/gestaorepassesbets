"""
Classificação de itens externos (DOU, sites, RSS) em possíveis leads.

Determina a CATEGORIA do sinal (licitação / sanção / nomeação / palavra-chave),
se é oportunidade, um resumo e um score — por heurística de palavras-chave, com
refino opcional pela IA (Claude). Também tenta extrair CNPJ/CPF e órgão.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

# Categorias e seus gatilhos (busca sem acento, minúsculas)
CATEGORIA_KEYWORDS = [
    ("sancao", [
        "declaracao de inidoneidade", "inidone", "impedimento de licitar", "impedida de licitar",
        "suspensao temporaria", "penalidade", "inabilitacao", "ceis", "cnep", "improbidade",
        "tomada de contas especial", "condenacao", "acordao condenatorio", "multa aplicada",
        "processo administrativo sancionador", "rescisao contratual", "descredenciamento",
    ]),
    ("licitacao", [
        "aviso de licitacao", "edital de licitacao", "pregao", "concorrencia", "tomada de precos",
        "chamamento publico", "credenciamento", "manifestacao de interesse", "concurso publico",
        "contratacao", "dispensa de licitacao", "inexigibilidade", "licitacao", "srp",
        "registro de precos", "aviso de contratacao", "request for proposal", "call for tenders",
        "procurement", "tender", "bid",
    ]),
    ("nomeacao", [
        "nomear", "nomeacao", "exonerar", "exoneracao", "designar", "designacao", "dar posse",
        "torna sem efeito a nomeacao", "dispensa do cargo", "cessao", "requisicao de servidor",
    ]),
]


def _strip(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c))
    return s.lower()


RE_CNPJ = re.compile(r"\b(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})\b")
RE_CPF = re.compile(r"\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b")
# Nome de órgão/empresa em maiúsculas (heurística)
RE_ORG = re.compile(r"\b([A-ZÀ-Ú][A-ZÀ-Ú&\.\- ]{6,80}(?:LTDA|S\.?A\.?|EIRELI|ME|EPP|MUNIC[IÍ]PIO|PREFEITURA|SECRETARIA|MINIST[EÉ]RIO|EMBAIXADA|UNIVERSIDADE|INSTITUTO|FUNDA[ÇC][ÃA]O|EMPRESA))")


def match_keywords(text: str, keywords: list[str]) -> list[str]:
    up = _strip(text)
    hits = []
    for kw in keywords:
        kw2 = _strip(kw).strip()
        if kw2 and kw2 in up:
            hits.append(kw)
    return hits


def classify_item(title: str, body: str = "", user_keywords: Optional[list[str]] = None,
                  categoria_padrao: Optional[str] = None) -> dict:
    """Classifica um item. Retorna dict com categoria, is_opportunity, resumo, score,
    keywords_casadas, documentos (CNPJ/CPF) e orgao."""
    text = f"{title}\n{body}"
    user_keywords = [k for k in (user_keywords or []) if k.strip()]

    # 1) categoria por gatilhos temáticos
    categoria = None
    triggered = []
    for cat, kws in CATEGORIA_KEYWORDS:
        hits = match_keywords(text, kws)
        if hits:
            categoria = categoria or cat
            triggered.extend(hits)

    # 2) palavras-chave do usuário
    user_hits = match_keywords(text, user_keywords)
    if user_hits and not categoria:
        categoria = "palavra_chave"

    if not categoria and categoria_padrao:
        categoria = categoria_padrao

    is_opportunity = bool(categoria and categoria != "outro")

    # 3) entidades
    documentos = []
    for m in RE_CNPJ.finditer(text):
        documentos.append({"tipo": "cnpj", "valor": _fmt_doc(m.group(1))})
    for m in RE_CPF.finditer(text):
        d = _digits(m.group(1))
        if len(d) == 11:
            documentos.append({"tipo": "cpf", "valor": _fmt_doc(m.group(1))})
    orgao = None
    om = RE_ORG.search(text)
    if om:
        orgao = re.sub(r"\s+", " ", om.group(1)).strip().title()

    # 4) score heurístico
    score = 0
    score += {"sancao": 60, "licitacao": 55, "nomeacao": 35, "palavra_chave": 45}.get(categoria or "", 10)
    if documentos:
        score += 12
    if user_hits:
        score += 10
    score = max(0, min(100, score))

    resumo = _snippet(body or title, 320)

    return {
        "categoria": categoria or "outro",
        "is_opportunity": is_opportunity,
        "score": score,
        "keywords": sorted(set(triggered + user_hits)),
        "documentos": documentos[:8],
        "orgao": orgao,
        "resumo": resumo,
    }


def _snippet(text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    return t[:n] + ("…" if len(t) > n else "")


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _fmt_doc(s: str) -> str:
    d = _digits(s)
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    return s
