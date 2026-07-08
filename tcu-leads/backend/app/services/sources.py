"""
Clientes HTTP das fontes de dados do TCU e do enriquecimento de CNPJ.

Boas práticas de coleta (roteiro §4 "Responsible scraping"):
  - APIs/CSVs oficiais têm preferência sobre scraping de HTML;
  - rate-limit (~1 req / 2-5 s), concorrência única, User-Agent descritivo;
  - back-off em 429/5xx; evitar a janela de manutenção 20h-21h;
  - nunca fazer varredura em massa das APIs de enriquecimento (BrasilAPI proíbe).

Todos os métodos degradam graciosamente: se a rede/serviço estiver indisponível,
retornam listas vazias / None e registram o erro, sem derrubar o pipeline.
"""
from __future__ import annotations

import time
import json
import logging
import re
import uuid as _uuid
from datetime import date, datetime
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Endpoints confirmados no roteiro técnico (§1)
ACORDAOS_URL = "https://dados-abertos.apps.tcu.gov.br/api/acordao/recupera-acordaos"
PAUTAS_URL = "http://dados-abertos.apps.tcu.gov.br/api/pautassessao"
BTCU_PDF_URL = "https://btcu.apps.tcu.gov.br/api/obterDocumentoPdf/{codigo}"
CERTIDOES_INABILITADOS = "https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-inabilitados"
CERTIDOES_INIDONEOS = "https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-inidoneos"
CERTIDOES_CONTAS_IRREGULARES = "https://certidoes.apps.tcu.gov.br/api/publico/responsaveis-contas-irregulares"
BRASILAPI_CNPJ = "https://brasilapi.com.br/api/cnpj/v1/{cnpj}"

DEFAULT_UA = "TCULeads/1.0 (monitoramento juridico interno; contato: escritorio)"


class TcuHttpClient:
    """Envelope httpx com rate-limit, retry exponencial e respeito à janela de manutenção."""

    def __init__(self, user_agent: Optional[str] = None, delay: float = 3.0,
                 contact_email: Optional[str] = None, use_browser: bool = False):
        ua = user_agent or DEFAULT_UA
        if contact_email:
            ua = f"{ua} <{contact_email}>"
        self.delay = max(0.0, float(delay or 0))
        self.headers = {"User-Agent": ua, "Accept": "application/json"}
        self._last_request_ts = 0.0
        # Cookies persistentes (essenciais para passar pelo firewall F5/BIG-IP do
        # TCU, que emite cookies "TS..." e exige que sejam reenviados nas chamadas
        # de API — o que o navegador faz e um cliente ingênuo não).
        self.cookies = httpx.Cookies()
        self._primed_hosts: set[str] = set()
        # Navegador headless (Playwright): quando ligado, as chamadas GET do TCU
        # passam pelo Chromium, que roda o desafio JavaScript do firewall F5.
        self.use_browser = bool(use_browser)
        self._browser = None
        self._browser_failed = False

    def _throttle(self):
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request_ts = time.monotonic()

    def cookie_names(self) -> list:
        if self.use_browser and self._browser is not None:
            return self._browser.cookie_names()
        try:
            return sorted({c.name for c in self.cookies.jar})
        except Exception:
            return []

    def _get_browser(self):
        """Abre (uma vez) e devolve a sessão de navegador headless, ou None se
        indisponível — caindo então para o cliente HTTP comum."""
        if not self.use_browser or self._browser_failed:
            return None
        if self._browser is None:
            from .browser import TcuBrowserSession
            b = TcuBrowserSession(self.headers.get("User-Agent"))
            if b.open() and b.prime():
                self._browser = b
                logger.info(f"Navegador headless pronto (cookies: {b.cookie_names()})")
            else:
                self._browser_failed = True
                b.close()
                return None
        return self._browser

    def close(self):
        """Fecha o navegador headless (libera memória). Seguro chamar sempre."""
        if self._browser is not None:
            self._browser.close()
            self._browser = None

    def prime(self, home_url: str, referer: Optional[str] = None):
        """Visita a home do serviço para receber (e validar) os cookies do firewall
        F5 (TS...) antes das chamadas de API. O F5 costuma emitir o cookie na 1ª
        resposta e validá-lo na 2ª — por isso visitamos duas vezes. Idempotente."""
        if self.use_browser:
            return  # o navegador headless faz seu próprio priming (com JS)
        host = home_url.split("/rest/")[0].rstrip("/")
        if host in self._primed_hosts:
            return
        self._primed_hosts.add(host)
        # Cookie de sessão do app (o Angular normalmente o cria via JS).
        try:
            import urllib.parse
            val = urllib.parse.quote(json.dumps({"uuid": SESSION_UUID, "dh": int(time.time() * 1000)}))
            self.cookies.set("PESQUISA_TEXTUAL_UUID", val, domain="pesquisa.apps.tcu.gov.br", path="/")
        except Exception:
            pass
        headers = {
            "User-Agent": self.headers.get("User-Agent"),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9",
        }
        if referer:
            headers["Referer"] = referer
        for _ in range(2):  # F5: valida o cookie na 2ª requisição
            try:
                self._throttle()
                with httpx.Client(timeout=20, headers=self.headers, cookies=self.cookies,
                                  follow_redirects=True) as client:
                    client.get(host + "/", headers=headers)
                    self.cookies = client.cookies
            except httpx.HTTPError as e:
                logger.warning(f"Prime {host} falhou (segue sem cookies): {e}")
                break
        logger.info(f"Prime {host}: cookies={self.cookie_names()}")

    @staticmethod
    def in_maintenance_window(now: Optional[datetime] = None) -> bool:
        """O TCU avisa que os serviços podem ficar indisponíveis entre 20h e 21h."""
        now = now or datetime.now()
        return now.hour == 20

    def request(self, method: str, url: str, *, max_retries: int = 4,
                expect_json: bool = True, **kwargs):
        """Faz a requisição com back-off (2s, 4s, 8s, 16s) em erros de rede/5xx/429."""
        if self.in_maintenance_window():
            logger.info("Janela de manutenção do TCU (20h-21h) — requisição adiada")
            return None

        backoff = 2
        for attempt in range(max_retries):
            self._throttle()
            try:
                with httpx.Client(timeout=30, headers=self.headers, cookies=self.cookies,
                                  follow_redirects=True) as client:
                    resp = client.request(method, url, **kwargs)
                    self.cookies = client.cookies   # persiste cookies do WAF
                if resp.status_code == 429 or resp.status_code >= 500:
                    logger.warning(f"{url} status {resp.status_code} (tentativa {attempt+1})")
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                if resp.status_code != 200:
                    logger.warning(f"{url} status {resp.status_code}")
                    return None
                if not expect_json:
                    return resp.content
                try:
                    return resp.json()
                except ValueError:
                    # 200 mas corpo não-JSON (vazio, comprimido ou página de bloqueio)
                    logger.warning(f"{url} respondeu 200 sem JSON válido: {resp.text[:200]!r}")
                    return None
            except (httpx.TransportError, httpx.HTTPError) as e:
                logger.warning(f"{url} erro de rede ({e}); tentativa {attempt+1}")
                time.sleep(backoff)
                backoff *= 2
        logger.error(f"{url} falhou após {max_retries} tentativas")
        return None

    def fetch_raw(self, method: str, url: str, *, max_retries: int = 2, **kwargs):
        """Como request(), mas devolve (status, headers, content_bytes) para
        diagnóstico — não tenta decodificar JSON. None em falha de rede.

        Em modo navegador, os GET passam pelo Chromium (desafio JS do firewall);
        se o navegador não estiver disponível, cai para o cliente HTTP comum."""
        if self.in_maintenance_window():
            return None
        if self.use_browser and method.upper() == "GET":
            b = self._get_browser()
            if b is not None:
                res = b.get(url, params=kwargs.get("params"), headers=kwargs.get("headers"))
                if res is not None:
                    return res
                # navegador não trouxe nada → tenta o caminho HTTP comum
        backoff = 2
        for attempt in range(max_retries):
            self._throttle()
            try:
                with httpx.Client(timeout=30, headers=self.headers, cookies=self.cookies,
                                  follow_redirects=True) as client:
                    resp = client.request(method, url, **kwargs)
                    self.cookies = client.cookies   # persiste cookies do WAF
                if resp.status_code == 429 or resp.status_code >= 500:
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                return resp.status_code, dict(resp.headers), resp.content
            except (httpx.TransportError, httpx.HTTPError) as e:
                logger.warning(f"{url} erro de rede ({e}); tentativa {attempt+1}")
                time.sleep(backoff)
                backoff *= 2
        return None


# --------------------------------------------------------------------------- #
# API de Acórdãos (paginação por índice — inicio/quantidade)
# --------------------------------------------------------------------------- #

def fetch_acordaos(client: TcuHttpClient, inicio: int = 0, quantidade: int = 50) -> list[dict]:
    """Recupera um lote de acórdãos. Retorna lista (possivelmente vazia)."""
    data = client.request(
        "GET", ACORDAOS_URL,
        params={"inicio": inicio, "quantidade": quantidade},
    )
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "acordaos" in data:
        return data["acordaos"]
    return []


def acordao_is_condenatorio(ac: dict) -> bool:
    """Heurística: acórdão condenatório menciona débito/multa/irregular no sumário."""
    blob = " ".join(str(ac.get(k, "")) for k in ("sumario", "titulo", "situacao")).lower()
    return any(kw in blob for kw in ("débito", "debito", "multa", "irregular", "irregularidade"))


# --------------------------------------------------------------------------- #
# Pautas das sessões (early-warning)
# --------------------------------------------------------------------------- #

def fetch_pautas(client: TcuHttpClient) -> list[dict]:
    data = client.request("GET", PAUTAS_URL)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("pautas", "itens", "data"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


# --------------------------------------------------------------------------- #
# Download de PDF do BTCU (confirmado)
# --------------------------------------------------------------------------- #

def download_btcu_pdf(client: TcuHttpClient, codigo: str) -> Optional[bytes]:
    """Baixa o PDF de uma edição/documento pelo código de autenticidade."""
    return client.request(
        "GET", BTCU_PDF_URL.format(codigo=codigo),
        expect_json=False,
    )


def fetch_btcu_listing(client: TcuHttpClient, settings) -> list[dict]:
    """Consulta o endpoint de LISTAGEM de edições do BTCU.

    ATENÇÃO: este endpoint não é documentado publicamente (lacuna do roteiro,
    §Caveats). A URL/corpo deve ser capturada via DevTools e configurada em
    TcuMonitorSettings. Se não configurada, retorna [] (o pipeline segue com
    as demais fontes).

    Espera-se que a resposta contenha objetos com ao menos um campo de código
    ('codigo'/'codigoAutenticidade'/'key') que sirva ao download do PDF.
    """
    url = getattr(settings, "btcu_listing_url", None)
    if not url:
        return []

    today = date.today().strftime("%Y-%m-%d")
    url = url.replace("{data_inicio}", today).replace("{data_fim}", today).replace("{data}", today)

    method = (getattr(settings, "btcu_listing_method", "GET") or "GET").upper()
    kwargs = {}
    if method == "POST":
        body = getattr(settings, "btcu_listing_body", None)
        if body:
            body = body.replace("{data_inicio}", today).replace("{data_fim}", today).replace("{data}", today)
            try:
                kwargs["json"] = json.loads(body)
            except json.JSONDecodeError:
                logger.error("btcu_listing_body não é JSON válido")
                return []

    data = client.request(method, url, **kwargs)
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "itens", "content", "documentos", "edicoes"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def extract_codigo_from_listing_item(item: dict) -> Optional[str]:
    for key in ("codigo", "codigoAutenticidade", "codigo_autenticidade", "key", "id"):
        val = item.get(key)
        if val:
            return str(val)
    return None


# --------------------------------------------------------------------------- #
# Listagem de processos (para a detecção de autuados do dia)
# --------------------------------------------------------------------------- #

RE_PROCESSO_ANY = re.compile(r"\b(\d{3}\.?\d{3}\s*/\s*\d{4}\s*-?\s*\d)\b")


def _subst_datas(text: Optional[str], data_inicio: str, data_fim: str) -> Optional[str]:
    if not text:
        return text
    return (text.replace("{data_inicio}", data_inicio)
                .replace("{data_fim}", data_fim)
                .replace("{data}", data_inicio))


def _extract_list(data) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("data", "itens", "items", "content", "conteudo", "processos",
                    "results", "resultados", "hits", "documentos", "registros"):
            val = data.get(key)
            if isinstance(val, list):
                return val
            # nível aninhado comum: {"hits": {"hits": [...]}}
            if isinstance(val, dict):
                for k2 in ("hits", "content", "items", "data"):
                    if isinstance(val.get(k2), list):
                        return val[k2]
    return []


# --- Pesquisa Integrada de Processos (confirmado) ------------------------- #
# Endpoint público, GET, parâmetros na URL. Protegido por WAF: só responde a
# requisições com "cara de navegador" (User-Agent real + Sec-Fetch-* + Referer).
PESQUISA_PROC_URL = "https://pesquisa.apps.tcu.gov.br/rest/publico/base/processo/documentosResumidos"
# Registro COMPLETO do processo (mesma base/params do resumido, porém com todos os
# campos — inclusive RESPONSÁVEIS / INTERESSADOS com nome + CPF mascarado).
PESQUISA_PROC_DOC_URL = "https://pesquisa.apps.tcu.gov.br/rest/publico/base/processo/documento"
# UA de navegador real (Chrome/macOS), como no cURL capturado do site.
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")
# UUID de sessão (o app Angular envia no header 'uuid'); um por processo basta.
SESSION_UUID = str(_uuid.uuid4())


def _pesquisa_headers(referer: str) -> dict:
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "User-Agent": BROWSER_UA,
        "Origin": "https://pesquisa.apps.tcu.gov.br",
        "Referer": referer,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "origem": "angular",
        "todas-bases": "false",
        "uuid": SESSION_UUID,
    }


def _yyyymmdd(data_iso: str) -> str:
    return re.sub(r"\D", "", data_iso)[:8]


def fetch_pesquisa_processos(client: "TcuHttpClient", data_iso: str, *,
                             filtro_campo: str = "DTAUTUACAO", page_size: int = 100,
                             max_total: int = 500, full: bool = False,
                             max_retries: int = 3) -> tuple[list, dict]:
    """Lista processos do TCU numa data via Pesquisa Integrada, com paginação.

    filtro_campo: DTAUTUACAO (autuados na data) ou DTATUALIZACAO (movimentados).
    full=True usa o endpoint 'documento' (registro completo, com responsáveis/
    interessados) em vez do 'documentosResumidos' (só o resumo).
    Retorna (documentos, diagnóstico).
    """
    import urllib.parse
    d = _yyyymmdd(data_iso)
    filtro = f"{filtro_campo}:[{d} to {d}]"
    # Registro completo é mais pesado — pagina de a poucos por vez.
    base_url = PESQUISA_PROC_DOC_URL if full else PESQUISA_PROC_URL
    if full and page_size > 30:
        page_size = 30
    # Referer com o filtro duplo-codificado (como o front-end Angular faz)
    ref_path = "documento" if full else "resultado"
    referer = (f"https://pesquisa.apps.tcu.gov.br/{ref_path}/processo/*/"
               + urllib.parse.quote(urllib.parse.quote(filtro, safe=""), safe=""))
    headers = _pesquisa_headers(referer)
    client.prime(PESQUISA_PROC_URL, referer=referer)  # cookies do firewall F5

    diag = {"url": base_url, "filtro": filtro, "status": None, "full": full,
            "count": 0, "total": None, "sample": None, "raw_sample": None, "error": None,
            "http_status": None, "content_encoding": None, "body_len": None}

    documentos = []
    inicio = 0
    total = None
    while True:
        params = {
            "termo": "*", "filtro": filtro,
            "ordenacao": "DTAUTUACAOORDENACAO desc, NUMEROCOMZEROS desc,KEY asc",
            "quantidade": page_size, "inicio": inicio,
        }
        raw = client.fetch_raw("GET", base_url, params=params, headers=headers, max_retries=max_retries)
        if raw is None:
            if not documentos:
                diag["error"] = "Sem resposta do TCU (erro de rede, 5xx ou manutenção)."
            break
        http_status, resp_headers, content = raw
        text = content.decode("utf-8", "replace") if isinstance(content, (bytes, bytearray)) else str(content or "")
        if total is None:  # registra o diagnóstico da 1ª página
            diag["http_status"] = http_status
            diag["content_encoding"] = (resp_headers or {}).get("content-encoding")
            diag["body_len"] = len(text)
        if http_status != 200:
            diag["error"] = f"TCU respondeu HTTP {http_status} (possível bloqueio do firewall)."
            diag["raw_sample"] = text[:400]
            break
        try:
            data = json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            data = None
        if data is None:
            diag["error"] = ("Resposta não é JSON — corpo vazio ou página de bloqueio "
                             f"(tamanho={len(text)}, encoding={diag['content_encoding'] or 'nenhum'}).")
            diag["raw_sample"] = text[:400]
            break
        if isinstance(data, dict) and data.get("documentos") is None and total is None:
            diag["error"] = "Resposta JSON sem a lista 'documentos' (estrutura inesperada)."
            diag["raw_sample"] = json.dumps(data, ensure_ascii=False)[:400]
            break
        page = (data or {}).get("documentos") or _extract_list(data)
        if total is None:
            total = (data or {}).get("quantidadeEncontrada")
            diag["total"] = total
            if page:
                diag["raw_sample"] = {k: page[0].get(k) for k in list(page[0].keys())[:14]}
        documentos.extend(page)
        if not page or len(page) < page_size or len(documentos) >= (total or 0) or len(documentos) >= max_total:
            break
        inicio += page_size

    diag["status"] = "ok" if not diag["error"] else "erro"
    diag["count"] = len(documentos)
    if documentos:
        diag["sample"] = extract_processo_fields(documentos[0])
    return documentos, diag


def fetch_processo_detail(client: "TcuHttpClient", data_iso: str, index: int, *,
                          filtro_campo: str = "DTAUTUACAO") -> tuple[Optional[dict], dict]:
    """Busca o registro COMPLETO de UM processo (com RESPONSÁVEIS/INTERESSADOS),
    pela POSIÇÃO na lista — exatamente como o site do TCU faz:
    documento?termo=*&filtro=<data>&ordenacao=<...>&quantidade=1&inicio=<index>.

    Retorna (item, diagnóstico). item=None se não vier nada.
    """
    import urllib.parse
    d = _yyyymmdd(data_iso)
    filtro = f"{filtro_campo}:[{d} to {d}]"
    referer = ("https://pesquisa.apps.tcu.gov.br/documento/processo/*/"
               + urllib.parse.quote(urllib.parse.quote(filtro, safe=""), safe=""))
    headers = _pesquisa_headers(referer)
    client.prime(PESQUISA_PROC_URL, referer=referer)
    params = {
        "termo": "*", "filtro": filtro,
        "ordenacao": "DTAUTUACAOORDENACAO desc, NUMEROCOMZEROS desc,KEY asc",
        "quantidade": 1, "inicio": index,
    }
    diag = {"index": index, "status": None, "http_status": None, "body_len": None,
            "content_encoding": None, "error": None, "raw_sample": None}
    raw = client.fetch_raw("GET", PESQUISA_PROC_DOC_URL, params=params, headers=headers, max_retries=1)
    if raw is None:
        diag["error"] = "Sem resposta"
        return None, diag
    http_status, resp_headers, content = raw
    text = content.decode("utf-8", "replace") if isinstance(content, (bytes, bytearray)) else str(content or "")
    diag.update(http_status=http_status, body_len=len(text),
                content_encoding=(resp_headers or {}).get("content-encoding"))
    if http_status != 200:
        diag["error"] = f"HTTP {http_status}"
        diag["raw_sample"] = text[:300]
        return None, diag
    try:
        data = json.loads(text) if text.strip() else None
    except json.JSONDecodeError:
        data = None
    if not data:
        diag["error"] = f"Corpo não-JSON (tamanho={len(text)}, encoding={diag['content_encoding'] or 'nenhum'})."
        diag["raw_sample"] = text[:300]
        return None, diag
    docs = (data or {}).get("documentos") or _extract_list(data)
    item = docs[0] if docs else None
    diag["status"] = "ok" if item else "vazio"
    return item, diag


def fetch_processos_listing(client: "TcuHttpClient", settings, *,
                            data_inicio: Optional[str] = None,
                            data_fim: Optional[str] = None) -> tuple[list, dict]:
    """Lista processos do TCU numa data.

    Por padrão usa a Pesquisa Integrada (confirmada). Se o usuário configurar uma
    URL customizada em settings.autuados_listing_url, usa-a no lugar.
    """
    di = data_inicio or date.today().strftime("%Y-%m-%d")
    dfim = data_fim or di
    custom_url = getattr(settings, "autuados_listing_url", None)

    if not custom_url:  # caminho padrão: Pesquisa Integrada (lista resumida, rápida)
        campo = getattr(settings, "autuados_filtro_campo", None) or "DTAUTUACAO"
        # A lista vem do resumido; os responsáveis são buscados 1 a 1 no registro
        # completo (fetch_processo_detail), como o próprio site do TCU faz.
        return fetch_pesquisa_processos(client, di, filtro_campo=campo)

    # caminho customizado (URL/corpo com marcadores de data)
    url = _subst_datas(custom_url, di, dfim)
    diag = {"url": url, "status": None, "count": 0, "sample": None, "error": None}
    method = (getattr(settings, "autuados_listing_method", "GET") or "GET").upper()
    kwargs = {}
    if method == "POST":
        body = _subst_datas(getattr(settings, "autuados_listing_body", None), di, dfim)
        if body:
            try:
                kwargs["json"] = json.loads(body)
            except json.JSONDecodeError:
                diag["error"] = "Corpo (JSON) da fonte de processos é inválido."
                return [], diag
    data = client.request(method, url, **kwargs)
    if data is None:
        diag["error"] = "Sem resposta (bloqueio, timeout ou erro de rede)."
        return [], diag
    items = _extract_list(data)
    diag["status"] = "ok"
    diag["count"] = len(items)
    if items:
        diag["sample"] = extract_processo_fields(items[0])
    return items, diag


def _deep_first(item, keys: tuple, _depth: int = 0):
    """Busca (recursiva rasa) o primeiro valor não-vazio para uma das chaves."""
    if _depth > 3 or not isinstance(item, dict):
        return None
    for k in keys:
        for real_k in item.keys():
            if real_k.lower() == k.lower():
                v = item[real_k]
                if v not in (None, "", [], {}):
                    return v
    for v in item.values():
        if isinstance(v, dict):
            r = _deep_first(v, keys, _depth + 1)
            if r is not None:
                return r
    return None


def _join_if_list(v) -> Optional[str]:
    if isinstance(v, list):
        return "; ".join(str(x) for x in v if x) or None
    return v


# Uma entrada de responsável costuma vir como "Nome Completo - (XXX.303.302-XX)".
RE_RESP_STR = re.compile(r"^\s*(.+?)\s*[-–—]\s*\(?\s*([\dXx][\dXx.\-/]{4,})\s*\)?\s*$")


def _doc_type_from(doc: Optional[str]) -> Optional[str]:
    if not doc:
        return None
    s = str(doc)
    digits = re.sub(r"\D", "", s)
    if len(digits) == 14:
        return "cnpj"
    if "X" in s.upper() or len(digits) in (9, 11):
        return "cpf"
    return None


def _parse_responsaveis(resp_raw, papel_default: Optional[str] = None) -> list:
    """Normaliza responsáveis/interessados de várias formas (lista de strings no
    formato 'Nome - (CPF)', lista de dicts, ou string com quebras de linha)."""
    out = []
    seen = set()

    def add(nome, doc, papel=None):
        nome = (str(nome).strip() if nome else None) or None
        doc = (str(doc).strip() if doc else None) or None
        if not nome and not doc:
            return
        key = (nome or "", doc or "")
        if key in seen:
            return
        seen.add(key)
        out.append({"nome": nome, "documento": doc, "tipo_doc": _doc_type_from(doc),
                    "papel": papel or papel_default})

    items = resp_raw
    if isinstance(resp_raw, str):
        items = [x for x in re.split(r"[\n;]+", resp_raw) if x.strip()]
    if not isinstance(items, list):
        return out

    for r in items:
        if isinstance(r, dict):
            nome = _deep_first(r, ("nome", "name", "nomeResponsavel", "razaoSocial"))
            doc = _deep_first(r, ("cpf", "cnpj", "documento", "numeroRegistro", "cpfCnpj", "numero"))
            add(nome, doc, _deep_first(r, ("papel", "tipo", "qualificacao")))
        elif isinstance(r, str):
            m = RE_RESP_STR.match(r.strip())
            if m:
                add(m.group(1), m.group(2))
            else:
                add(r, None)
    return out


def extract_processo_fields(item: dict) -> dict:
    """Extrai campos de um item de processo.

    Reconhece o formato da Pesquisa Integrada (chaves MAIÚSCULAS) e cai para
    nomes genéricos em fontes customizadas.
    """
    if not isinstance(item, dict):
        return {"numero": None}

    numero = (item.get("NUMEROFORMATADO")
              or _deep_first(item, ("numeroProcesso", "numero_processo", "numeroProcessoFormatado",
                                    "processo", "numero", "nup")))
    if not numero:
        blob = json.dumps(item, ensure_ascii=False, default=str)
        m = RE_PROCESSO_ANY.search(blob)
        numero = m.group(1) if m else None

    movs = item.get("MOVIMENTACOES")
    ultima = movs[0] if isinstance(movs, list) and movs else _deep_first(item, ("ultimaMovimentacao",))

    # Responsáveis / Interessados: o registro RESUMIDO (documentosResumidos) NÃO
    # os traz; o registro COMPLETO (endpoint 'documento') traz — com nome e CPF
    # mascarado. O rótulo varia com o tipo processual ("Responsáveis" na maioria;
    # "Interessados" em processos administrativos). Capturamos ambos.
    responsaveis = []
    for keys, papel in (
        (("responsaveis", "responsavel"), "responsável"),
        (("interessados", "interessado"), "interessado"),
        (("partes",), None),
    ):
        raw = _deep_first(item, keys)
        if raw:
            responsaveis.extend(_parse_responsaveis(raw, papel))
        if responsaveis:
            break

    orgao = (_join_if_list(item.get("UNIDADESJURISDICIONADAS"))
             or _deep_first(item, ("orgao", "orgaoEntidade", "orgao_entidade",
                                   "unidadeJurisdicionada", "entidade")))

    return {
        "numero": str(numero).strip() if numero else None,
        "natureza": item.get("TIPO") or _deep_first(item, ("naturezaProcesso", "natureza", "classe", "tipoProcesso", "tipo")),
        "tipo": item.get("TIPO") or _deep_first(item, ("tipoProcesso", "tipo")),
        "assunto": item.get("ASSUNTO") or _deep_first(item, ("assunto", "titulo", "descricao", "ementa")),
        "orgao_entidade": orgao,
        "relator": item.get("RELATOR") or _deep_first(item, ("nomeRelator", "relator")),
        "colegiado": _deep_first(item, ("nomeColegiado", "colegiado", "siglaColegiado")),
        "uf": _deep_first(item, ("uf", "sigla_uf")),
        "estado": item.get("ESTADO") or _deep_first(item, ("estadoProcesso", "situacao", "estado_processo")),
        "ultima_movimentacao": ultima,
        "data_autuacao": _deep_first(item, ("dataAutuacao", "data_autuacao", "dataAutuado")),
        "source_url": item.get("URLSISTEMAPUSH"),
        "responsaveis": responsaveis,
    }


def extract_processo_from_item(item: dict) -> Optional[str]:
    return extract_processo_fields(item).get("numero")


def _probe_responsaveis(docs: list) -> dict:
    """Resume os responsáveis achados numa amostra de processos."""
    com_resp = 0
    exemplo = None
    for it in docs:
        fields = extract_processo_fields(it)
        if fields.get("responsaveis"):
            com_resp += 1
            if exemplo is None:
                exemplo = {"numero": fields.get("numero"),
                           "responsaveis": [r.get("nome") for r in fields["responsaveis"] if r.get("nome")][:12]}
    return {"com_responsaveis": com_resp, "exemplo_responsaveis": exemplo}


def _n_firewall_cookies(client) -> int:
    """Conta os cookies do firewall F5 (nome começa com 'TS')."""
    try:
        return len([n for n in client.cookie_names() if str(n).upper().startswith("TS")])
    except Exception:
        return 0


def probe_processos_source(client: "TcuHttpClient", settings, data_str: Optional[str] = None) -> dict:
    """Diagnóstico RÁPIDO da fonte de processos (botão "Testar fonte").

    Reproduz o caminho REAL do sistema (lista + registro completo). Além do filtro
    configurado, roda uma tentativa de VALIDAÇÃO por "qualquer movimentação"
    (DTATUALIZACAO), que costuma ter muitos processos — se ela vier cheia e com
    responsáveis, prova que a captação funciona ponta a ponta (e que um filtro de
    autuados vazio é apenas ausência de autuados naquela data).
    """
    di = data_str or date.today().strftime("%Y-%m-%d")
    campo = (getattr(settings, "autuados_filtro_campo", None) or "DTAUTUACAO")
    custom_url = getattr(settings, "autuados_listing_url", None)
    attempts = []

    def add_list(campo_x, label):
        docs, d = fetch_pesquisa_processos(client, di, filtro_campo=campo_x, full=False,
                                           page_size=8, max_total=8, max_retries=1)
        attempts.append({
            "label": label, "status": d.get("status"), "count": d.get("count"),
            "total": d.get("total"), "error": d.get("error"),
            "http_status": d.get("http_status"), "content_encoding": d.get("content_encoding"),
            "body_len": d.get("body_len"), "raw_sample": d.get("raw_sample"),
            "campos": (list(docs[0].keys()) if docs and isinstance(docs[0], dict) else []),
            "com_responsaveis": 0, "exemplo_responsaveis": None,
        })
        return docs

    def add_detail(campo_x, label, scan=1):
        # Varre as primeiras posições até achar um processo COM responsáveis
        # (nem todo tipo de processo os lista — ex.: relatórios de auditoria).
        cr, ex, det, dd, any_det = 0, None, None, {}, False
        for idx in range(max(1, scan)):
            det_i, dd = fetch_processo_detail(client, di, idx, filtro_campo=campo_x)
            if det_i:
                any_det = True
                det = det_i
                f = extract_processo_fields(det_i)
                if f.get("responsaveis"):
                    cr = 1
                    ex = {"numero": f.get("numero"),
                          "responsaveis": [r["nome"] for r in f["responsaveis"] if r.get("nome")][:12]}
                    break
            else:
                break  # posição vazia → não adianta continuar
        attempts.append({
            "label": label, "status": dd.get("status"), "count": 1 if any_det else 0, "total": None,
            "error": dd.get("error"), "http_status": dd.get("http_status"),
            "content_encoding": dd.get("content_encoding"), "body_len": dd.get("body_len"),
            "raw_sample": dd.get("raw_sample"),
            "campos": (list(det.keys()) if isinstance(det, dict) else []),
            "com_responsaveis": cr, "exemplo_responsaveis": ex,
        })

    # 1) filtro configurado (por padrão, autuados)
    add_list(campo, "Lista de processos (resumido)")
    add_detail(campo, "Registro completo do 1º processo (responsáveis)")

    # 2) validação por "qualquer movimentação" (se o configurado não for esse) —
    #    varre alguns processos para achar um com responsáveis e provar a captura.
    if campo.upper() != "DTATUALIZACAO":
        docs_val = add_list("DTATUALIZACAO", "Validação — qualquer movimentação (lista)")
        if docs_val:
            add_detail("DTATUALIZACAO", "Validação — responsáveis (qualquer movimentação)", scan=8)

    best = next((a for a in attempts if a["com_responsaveis"]), None) \
        or next((a for a in attempts if a["count"]), None) or attempts[0]

    return {
        "status": best.get("status") or ("ok" if best.get("count") else "erro"),
        "endpoint": best.get("label"),
        "count": best.get("count", 0),
        "total": best.get("total"),
        "error": best.get("error"),
        "com_responsaveis": sum(a["com_responsaveis"] for a in attempts),
        "exemplo_responsaveis": next((a["exemplo_responsaveis"] for a in attempts if a["exemplo_responsaveis"]), None),
        "campos_retornados": best.get("campos", []),
        "cookies_firewall": _n_firewall_cookies(client),
        "cookies_nomes": client.cookie_names() if hasattr(client, "cookie_names") else [],
        "custom_url_configurada": bool(custom_url),
        "diagnostics": attempts,
    }


# --------------------------------------------------------------------------- #
# Enriquecimento de CNPJ (BrasilAPI) — nunca em massa
# --------------------------------------------------------------------------- #

def enrich_cnpj(client: TcuHttpClient, cnpj: str) -> Optional[dict]:
    """Consulta um único CNPJ na BrasilAPI. Retorna o dict normalizado ou None."""
    digits = re.sub(r"\D", "", cnpj or "")
    if len(digits) != 14:
        return None

    data = client.request("GET", BRASILAPI_CNPJ.format(cnpj=digits), max_retries=2)
    if not isinstance(data, dict):
        return None

    socios = []
    for s in data.get("qsa", []) or []:
        nome = s.get("nome_socio") or s.get("nome")
        qual = s.get("qualificacao_socio") or s.get("qualificacao")
        if nome:
            socios.append({"nome": nome, "qualificacao": qual})

    return {
        "cnpj": digits,
        "razao_social": data.get("razao_social") or data.get("nome"),
        "nome_fantasia": data.get("nome_fantasia"),
        "situacao_cadastral": data.get("descricao_situacao_cadastral") or data.get("situacao"),
        "porte": data.get("porte") or data.get("descricao_porte"),
        "cnae_principal": data.get("cnae_fiscal_descricao"),
        "natureza_juridica": data.get("natureza_juridica"),
        "capital_social": _to_float(data.get("capital_social")),
        "logradouro": _join_address(data),
        "municipio": data.get("municipio"),
        "uf": data.get("uf"),
        "cep": data.get("cep"),
        "email": (data.get("email") or "").lower() or None,
        "telefone": data.get("ddd_telefone_1") or data.get("telefone"),
        "socios": socios,
        "raw": data,
    }


def _to_float(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _join_address(data: dict) -> Optional[str]:
    parts = [
        data.get("descricao_tipo_de_logradouro"), data.get("logradouro"),
        data.get("numero"), data.get("complemento"), data.get("bairro"),
    ]
    joined = " ".join(str(p) for p in parts if p).strip()
    return joined or None


# --------------------------------------------------------------------------- #
# Certidões — checagem de sanções prévias (opcional, enriquece o dossiê)
# --------------------------------------------------------------------------- #

def check_prior_sanctions(client: TcuHttpClient, *, cpf: Optional[str] = None,
                          cnpj: Optional[str] = None, nome: Optional[str] = None) -> dict:
    """Consulta as certidões públicas do TCU por sanções prévias do responsável."""
    body = {}
    if cpf:
        body["cpf"] = re.sub(r"\D", "", cpf)
    if cnpj:
        body["cnpj"] = re.sub(r"\D", "", cnpj)
    if nome:
        body["parteNome"] = nome
    if not body:
        return {}

    result = {}
    for label, url in (
        ("inabilitado", CERTIDOES_INABILITADOS),
        ("inidoneo", CERTIDOES_INIDONEOS),
        ("contas_irregulares", CERTIDOES_CONTAS_IRREGULARES),
    ):
        data = client.request("POST", url, json=body, max_retries=2)
        if isinstance(data, list):
            result[label] = data
        elif isinstance(data, dict) and isinstance(data.get("data"), list):
            result[label] = data["data"]
    return result
