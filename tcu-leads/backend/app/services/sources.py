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
                 contact_email: Optional[str] = None):
        ua = user_agent or DEFAULT_UA
        if contact_email:
            ua = f"{ua} <{contact_email}>"
        self.delay = max(0.0, float(delay or 0))
        self.headers = {"User-Agent": ua, "Accept": "application/json"}
        self._last_request_ts = 0.0

    def _throttle(self):
        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_request_ts = time.monotonic()

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
                with httpx.Client(timeout=30, headers=self.headers, follow_redirects=True) as client:
                    resp = client.request(method, url, **kwargs)
                if resp.status_code == 429 or resp.status_code >= 500:
                    logger.warning(f"{url} status {resp.status_code} (tentativa {attempt+1})")
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                if resp.status_code != 200:
                    logger.warning(f"{url} status {resp.status_code}")
                    return None
                return resp.json() if expect_json else resp.content
            except (httpx.TransportError, httpx.HTTPError) as e:
                logger.warning(f"{url} erro de rede ({e}); tentativa {attempt+1}")
                time.sleep(backoff)
                backoff *= 2
        logger.error(f"{url} falhou após {max_retries} tentativas")
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
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")


def _pesquisa_headers(referer: str) -> dict:
    return {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": BROWSER_UA,
        "Origin": "https://pesquisa.apps.tcu.gov.br",
        "Referer": referer,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "origem": "angular",
        "todas-bases": "false",
    }


def _yyyymmdd(data_iso: str) -> str:
    return re.sub(r"\D", "", data_iso)[:8]


def fetch_pesquisa_processos(client: "TcuHttpClient", data_iso: str, *,
                             filtro_campo: str = "DTAUTUACAO", page_size: int = 100,
                             max_total: int = 500) -> tuple[list, dict]:
    """Lista processos do TCU numa data via Pesquisa Integrada, com paginação.

    filtro_campo: DTAUTUACAO (autuados na data) ou DTATUALIZACAO (movimentados).
    Retorna (documentos, diagnóstico).
    """
    import urllib.parse
    d = _yyyymmdd(data_iso)
    filtro = f"{filtro_campo}:[{d} to {d}]"
    # Referer com o filtro duplo-codificado (como o front-end Angular faz)
    referer = ("https://pesquisa.apps.tcu.gov.br/resultado/processo/*/"
               + urllib.parse.quote(urllib.parse.quote(filtro, safe=""), safe=""))
    headers = _pesquisa_headers(referer)

    diag = {"url": PESQUISA_PROC_URL, "filtro": filtro, "status": None,
            "count": 0, "total": None, "sample": None, "raw_sample": None, "error": None}

    documentos = []
    inicio = 0
    total = None
    while True:
        params = {
            "termo": "*", "filtro": filtro,
            "ordenacao": "DTAUTUACAOORDENACAO desc, NUMEROCOMZEROS desc,KEY asc",
            "quantidade": page_size, "inicio": inicio,
        }
        data = client.request("GET", PESQUISA_PROC_URL, params=params, headers=headers, max_retries=3)
        if data is None:
            if not documentos:
                diag["error"] = "Sem resposta do TCU (bloqueio do firewall, timeout ou manutenção)."
            break
        if isinstance(data, dict) and data.get("documentos") is None and total is None:
            # resposta inesperada (ex.: HTML de bloqueio veio como texto → não é dict com documentos)
            diag["error"] = "Resposta inesperada (possível bloqueio do firewall)."
            diag["raw_sample"] = str(data)[:400]
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

    if not custom_url:  # caminho padrão: Pesquisa Integrada
        campo = getattr(settings, "autuados_filtro_campo", None) or "DTAUTUACAO"
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

    # Responsáveis: a Pesquisa Integrada (documentosResumidos) NÃO retorna as
    # partes; ficam vazias aqui (o órgão/UJ é o principal sinal). Fontes
    # customizadas podem trazê-las.
    responsaveis = []
    resp_raw = _deep_first(item, ("responsaveis", "responsavel", "partes", "interessados"))
    if isinstance(resp_raw, list):
        for r in resp_raw:
            if isinstance(r, dict):
                nome = r.get("nome") or r.get("name")
                doc = r.get("cpf") or r.get("cnpj") or r.get("documento") or r.get("numeroRegistro")
                tdoc = "cnpj" if (r.get("cnpj") or (doc and len(re.sub(r"\D", "", str(doc))) == 14)) else "cpf" if doc else None
                if nome or doc:
                    responsaveis.append({"nome": nome, "documento": doc, "tipo_doc": tdoc, "papel": r.get("papel")})
            elif isinstance(r, str):
                responsaveis.append({"nome": r, "documento": None, "tipo_doc": None, "papel": None})

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


def probe_processos_source(client: "TcuHttpClient", settings, data_str: Optional[str] = None) -> dict:
    """Diagnóstico da fonte de processos (para o botão "Testar fonte")."""
    _, diag = fetch_processos_listing(client, settings, data_inicio=data_str, data_fim=data_str)
    return diag


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
