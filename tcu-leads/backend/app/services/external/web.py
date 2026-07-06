"""
Coleta de itens de fontes web: feeds RSS/Atom e páginas HTML.

Retorna itens no formato {title, url, body}. Degrada com segurança (retorna []).
"""
from __future__ import annotations

import logging
import re
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

logger = logging.getLogger(__name__)

BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")


def _get(url: str, timeout: int = 25) -> Optional[httpx.Response]:
    headers = {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    }
    for attempt in range(3):
        try:
            with httpx.Client(timeout=timeout, headers=headers, follow_redirects=True) as c:
                resp = c.get(url)
            if resp.status_code == 200:
                return resp
            if resp.status_code in (429,) or resp.status_code >= 500:
                continue
            return None
        except httpx.HTTPError as e:
            logger.warning(f"GET {url} falhou ({e})")
    return None


def fetch_rss(url: str, limit: int = 40) -> list[dict]:
    resp = _get(url)
    if not resp:
        return []
    try:
        import feedparser
    except ImportError:
        logger.error("feedparser não instalado")
        return []
    feed = feedparser.parse(resp.content)
    out = []
    for e in feed.entries[:limit]:
        title = (e.get("title") or "").strip()
        link = (e.get("link") or "").strip()
        body = (e.get("summary") or e.get("description") or "")
        body = re.sub(r"<[^>]+>", " ", body)  # tira HTML do resumo
        if title or link:
            out.append({"title": title, "url": link, "body": body.strip()})
    return out


def fetch_webpage_items(url: str, item_selector: Optional[str] = None, limit: int = 40) -> list[dict]:
    """Extrai itens de uma página HTML.

    Se item_selector (CSS) for dado, usa-o para achar os itens; senão, aplica uma
    heurística: links com texto significativo dentro do conteúdo principal.
    """
    resp = _get(url)
    if not resp:
        return []
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        logger.error("beautifulsoup4 não instalado")
        return []
    soup = BeautifulSoup(resp.text, "html.parser")
    base = url
    out = []
    seen = set()

    if item_selector:
        for el in soup.select(item_selector)[:limit]:
            a = el.find("a") if el.name != "a" else el
            href = a.get("href") if a else None
            title = el.get_text(" ", strip=True)
            link = urljoin(base, href) if href else url
            if title and title not in seen:
                seen.add(title)
                out.append({"title": title[:400], "url": link, "body": ""})
        return out

    # heurística: âncoras com texto razoável
    host = urlparse(url).netloc
    for a in soup.find_all("a", href=True):
        title = a.get_text(" ", strip=True)
        if len(title) < 25 or len(title) > 300:
            continue
        low = title.lower()
        if low in ("leia mais", "saiba mais", "voltar", "início", "home"):
            continue
        href = urljoin(base, a["href"])
        # mantém apenas links do mesmo domínio (evita menus externos)
        if urlparse(href).netloc and urlparse(href).netloc != host:
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title, "url": href, "body": ""})
        if len(out) >= limit:
            break
    return out


def fetch_source_items(kind: str, url: str, item_selector: Optional[str] = None) -> list[dict]:
    if kind == "rss":
        return fetch_rss(url)
    return fetch_webpage_items(url, item_selector=item_selector)
