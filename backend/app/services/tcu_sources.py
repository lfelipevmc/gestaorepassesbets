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

DEFAULT_UA = "RadarTCU/1.0 (monitoramento juridico interno; contato: escritorio)"


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
