"""
Parser dos cadernos do Diário Eletrônico / BTCU do TCU.

Responsável por:
  1. Extrair texto de PDFs do BTCU (pdfplumber, com PyMuPDF como fallback);
  2. Segmentar o texto em blocos de editais SEPROC e de acórdãos;
  3. Extrair, por regex, os campos determinísticos de cada bloco (número do
     processo, responsável, CPF/CNPJ, valor, prazo, tipo do ato).

O parser é 100% Python puro (sem rede) — o objetivo é entregar blocos limpos e
campos "âncora" que a camada de IA (tcu_extractor) depois refina/estrutura.
As âncoras de detecção seguem o roteiro técnico (editais SEPROC do caderno
"Deliberações dos Colegiados").
"""
from __future__ import annotations

import re
import hashlib
import logging
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Extração de texto do PDF
# --------------------------------------------------------------------------- #

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extrai o texto de um PDF do BTCU.

    Tenta pdfplumber (layout-aware, lida bem com múltiplas colunas) e cai para
    PyMuPDF (fitz), mais rápido, se pdfplumber não estiver disponível ou falhar.
    Retorna string vazia se nenhum extrator estiver instalado — o chamador deve
    tratar isso como "sem texto" e registrar no run.
    """
    # 1) pdfplumber
    try:
        import pdfplumber  # type: ignore
        import io

        parts = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        text = "\n".join(parts)
        if text.strip():
            return text
    except ImportError:
        logger.warning("pdfplumber indisponível; tentando PyMuPDF")
    except Exception as e:
        logger.warning(f"pdfplumber falhou ({e}); tentando PyMuPDF")

    # 2) PyMuPDF (fitz)
    try:
        import fitz  # type: ignore

        parts = []
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for page in doc:
                parts.append(page.get_text() or "")
        return "\n".join(parts)
    except ImportError:
        logger.error("Nenhum extrator de PDF instalado (pdfplumber/PyMuPDF)")
    except Exception as e:
        logger.error(f"PyMuPDF falhou: {e}")

    return ""


# --------------------------------------------------------------------------- #
# Regex âncora (roteiro técnico §2)
# --------------------------------------------------------------------------- #

# Cabeçalho de edital do SEPROC: "EDITAL 1234/2026-TCU/SEPROC"
RE_EDITAL_HEADER = re.compile(
    r"EDITAL\s+n?º?\s*([0-9]{1,5}\s*/\s*[0-9]{4})\s*[-–]?\s*TCU\s*/\s*SEPROC",
    re.IGNORECASE,
)

# Número de processo do TCU: "TC 012.345/2026-7" (aceita variações de espaço)
RE_PROCESSO = re.compile(
    r"\bTC\s*([0-9]{3}\.?[0-9]{3}\s*/\s*[0-9]{4}\s*-?\s*[0-9])",
    re.IGNORECASE,
)

# Número de acórdão: "Acórdão 1234/2026-TCU-Plenário" / "-Primeira Câmara"
RE_ACORDAO = re.compile(
    r"AC[ÓO]RD[ÃA]O\s+n?º?\s*([0-9]{1,5}\s*/\s*[0-9]{4})\s*[-–]\s*TCU\s*[-–]\s*"
    r"(Plen[áa]rio|Primeira\s+C[âa]mara|Segunda\s+C[âa]mara|1[ªa]?\s*C[âa]mara|2[ªa]?\s*C[âa]mara)",
    re.IGNORECASE,
)

# CPF: 000.000.000-00  (com ou sem máscara)
RE_CPF = re.compile(r"CPF[:\s]*([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})", re.IGNORECASE)
# CNPJ: 00.000.000/0000-00
RE_CNPJ = re.compile(
    r"CNPJ[:\s]*([0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2})", re.IGNORECASE
)

# Valor atualizado: "Valor total atualizado monetariamente até 31/12/2025: R$ 1.234.567,89"
RE_VALOR = re.compile(
    r"Valor\s+(?:total\s+)?atualizado(?:\s+monetariamente)?(?:\s+at[ée]\s+"
    r"(\d{2}/\d{2}/\d{4}))?[:\s]*R\$\s*([\d\.]+,\d{2})",
    re.IGNORECASE,
)
# Valor genérico R$ ... (fallback)
RE_VALOR_GENERICO = re.compile(r"R\$\s*([\d\.]+,\d{2})")

# Multa: "multa ... R$ ..."
RE_MULTA = re.compile(r"multa[^.\n]{0,80}?R\$\s*([\d\.]+,\d{2})", re.IGNORECASE)

# Prazo: "no prazo de quinze (15) dias" / "no prazo de 15 dias"
RE_PRAZO = re.compile(
    r"no\s+prazo\s+de\s+(quinze|dez|trinta|cinco|\d{1,3})\s*(?:\(\s*\d{1,3}\s*\))?\s*dias",
    re.IGNORECASE,
)

# Nome do responsável em CITADO/NOTIFICADO/AUDIÊNCIA
RE_CITADO = re.compile(
    r"fica\s+(?:o\s+respons[áa]vel\s+)?CITAD[OA]?\s*(?:\(a\))?\s*[,:]?\s*"
    r"(?:o\s+(?:sr|senhor)\.?\s+|a\s+(?:sra|senhora)\.?\s+)?"
    r"([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú'.\s]{3,80}?)"
    r"(?=\s*,?\s*(?:CPF|CNPJ|inscrit|portador|na\s+pessoa|para|CPF/))",
    re.IGNORECASE,
)
RE_NOTIFICADO = re.compile(
    r"fica\s+NOTIFICAD[OA]?\s*(?:\(a\))?\s*[,:]?\s*"
    r"(?:o\s+(?:sr|senhor)\.?\s+|a\s+(?:sra|senhora)\.?\s+)?"
    r"([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú'.\s]{3,80}?)"
    r"(?=\s*,?\s*(?:CPF|CNPJ|inscrit|portador|na\s+pessoa|para))",
    re.IGNORECASE,
)
RE_AUDIENCIA = re.compile(
    r"(?:fica\s+determinada\s+a\s+)?AUDI[ÊE]NCIA\s+d[eo]\s*[,:]?\s*"
    r"([A-ZÀ-Ú][A-ZÀ-Úa-zà-ú'.\s]{3,80}?)"
    r"(?=\s*,?\s*(?:CPF|CNPJ|inscrit|portador|na\s+pessoa|para))",
    re.IGNORECASE,
)

# Já constituiu advogado? ("Representação legal: ... (OAB/XX 12345)")
RE_OAB = re.compile(r"OAB[\s/-]*([A-Z]{2})?[\s/-]*([0-9]{2,6})", re.IGNORECASE)
RE_REPRESENTACAO = re.compile(r"Representa[çc][ãa]o\s+legal", re.IGNORECASE)

# Palavras-chave que caracterizam a oportunidade
KW_ALEGACOES = re.compile(r"alega[çc][õo]es\s+de\s+defesa", re.IGNORECASE)
KW_JUSTIFICATIVA = re.compile(r"raz[õo]es\s+de\s+justificativa", re.IGNORECASE)
KW_RECOLHER = re.compile(r"recolher\s+aos\s+cofres", re.IGNORECASE)

PRAZO_EXTENSO = {
    "cinco": 5, "dez": 10, "quinze": 15, "trinta": 30,
}

# Temas (área do processo) por palavra-chave — heurística de apoio à IA
TEMA_KEYWORDS = [
    ("educacao_fnde", ["FNDE", "PNAE", "PNATE", "educação", "merenda", "FUNDEB"]),
    ("saude", ["FNS", "Funasa", "SUS", "saúde", "hospital"]),
    ("assistencia_social", ["FNAS", "assistência social", "SUAS"]),
    ("infraestrutura", ["DNIT", "obra", "pavimenta", "rodovia", "infraestrutura"]),
    ("cultura_fnc", ["FNC", "cultura", "Lei Rouanet", "audiovisual"]),
    ("previdencia", ["INSS", "previdência", "RPPS"]),
    ("licitacoes", ["licita", "pregão", "Lei 14.133", "Lei 8.666", "contrato administrativo"]),
    ("convenios", ["convênio", "transferência voluntária", "prestação de contas"]),
]


# --------------------------------------------------------------------------- #
# Estrutura de bloco
# --------------------------------------------------------------------------- #

@dataclass
class ParsedBlock:
    """Bloco bruto de edital/acórdão com campos-âncora já extraídos por regex."""
    raw_text: str
    kind: str = "outro"                      # citacao | audiencia | notificacao | acordao | outro
    edital_numero: Optional[str] = None
    numero_processo: Optional[str] = None
    acordao_ref: Optional[str] = None
    colegiado: Optional[str] = None
    responsavel_nome: Optional[str] = None
    responsavel_documento: Optional[str] = None
    tipo_documento: Optional[str] = None      # cpf | cnpj
    valor_debito: Optional[float] = None
    valor_multa: Optional[float] = None
    data_referencia_valor: Optional[date] = None
    prazo_dias: Optional[int] = None
    tem_representacao: bool = False
    tema_sugerido: Optional[str] = None

    @property
    def content_hash(self) -> str:
        base = "|".join([
            self.numero_processo or "",
            self.kind,
            self.responsavel_documento or self.responsavel_nome or "",
        ]).lower()
        return hashlib.sha256(base.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def _parse_brl(value: str) -> Optional[float]:
    """Converte '1.234.567,89' -> 1234567.89."""
    if not value:
        return None
    try:
        return float(value.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _parse_ddmmyyyy(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d/%m/%Y").date()
    except (ValueError, TypeError):
        return None


def normalize_processo(num: str) -> str:
    """Normaliza para o formato TC nnn.nnn/aaaa-n."""
    digits = re.sub(r"\s+", "", num)
    return digits


def _clean_nome(nome: str) -> str:
    nome = re.sub(r"\s+", " ", nome).strip(" ,.;:")
    # remove prefixos de tratamento/qualificação que às vezes entram na captura
    nome = re.sub(
        r"^(?:o|a|os|as|do|da)\s+respons[áa]ve(?:l|is)\s+",
        "", nome, flags=re.IGNORECASE,
    ).strip()
    nome = re.sub(r"^(?:sr|sra|senhor|senhora|dr|dra)\.?\s+", "", nome, flags=re.IGNORECASE).strip()
    # remove ruídos comuns de quebra de linha/coluna
    nome = re.sub(r"\b(inscrit[oa]|portador[a]?|no\s+cpf|no\s+cnpj)\b.*$", "", nome, flags=re.IGNORECASE).strip()
    return nome.title() if nome.isupper() else nome


def detect_tema(text: str) -> Optional[str]:
    up = _strip_accents(text).lower()
    for tema, kws in TEMA_KEYWORDS:
        for kw in kws:
            if _strip_accents(kw).lower() in up:
                return tema
    return None


# --------------------------------------------------------------------------- #
# Segmentação
# --------------------------------------------------------------------------- #

def segment_blocks(text: str) -> list[str]:
    """Divide o texto do caderno em blocos candidatos.

    Estratégia: usa os cabeçalhos "EDITAL nnn/aaaa-TCU/SEPROC" como divisores.
    Cada bloco vai de um cabeçalho ao próximo. Se não houver nenhum edital,
    divide por ocorrências de "Acórdão nnn/aaaa-TCU-<colegiado>".
    """
    if not text:
        return []

    edital_positions = [m.start() for m in RE_EDITAL_HEADER.finditer(text)]
    if edital_positions:
        bounds = edital_positions + [len(text)]
        return [text[bounds[i]:bounds[i + 1]].strip() for i in range(len(bounds) - 1)]

    acordao_positions = [m.start() for m in RE_ACORDAO.finditer(text)]
    if acordao_positions:
        bounds = acordao_positions + [len(text)]
        return [text[bounds[i]:bounds[i + 1]].strip() for i in range(len(bounds) - 1)]

    return [text.strip()]


def _detect_kind(block: str) -> str:
    if RE_CITADO.search(block) or KW_ALEGACOES.search(block):
        return "citacao"
    if RE_AUDIENCIA.search(block) or KW_JUSTIFICATIVA.search(block):
        return "audiencia"
    if RE_NOTIFICADO.search(block):
        return "notificacao"
    if RE_ACORDAO.search(block):
        return "acordao"
    return "outro"


def parse_block(block: str) -> ParsedBlock:
    """Extrai campos-âncora de um bloco de texto."""
    pb = ParsedBlock(raw_text=block.strip())

    kind = _detect_kind(block)
    pb.kind = kind

    m = RE_EDITAL_HEADER.search(block)
    if m:
        pb.edital_numero = re.sub(r"\s+", "", m.group(1))

    m = RE_PROCESSO.search(block)
    if m:
        pb.numero_processo = "TC " + normalize_processo(m.group(1))

    m = RE_ACORDAO.search(block)
    if m:
        pb.acordao_ref = re.sub(r"\s+", "", m.group(1))
        pb.colegiado = re.sub(r"\s+", " ", m.group(2)).strip().title()

    # Nome do responsável conforme o tipo de ato
    name_match = None
    if kind == "citacao":
        name_match = RE_CITADO.search(block)
    elif kind == "audiencia":
        name_match = RE_AUDIENCIA.search(block)
    elif kind == "notificacao":
        name_match = RE_NOTIFICADO.search(block)
    if not name_match:  # tenta todos
        name_match = RE_CITADO.search(block) or RE_NOTIFICADO.search(block) or RE_AUDIENCIA.search(block)
    if name_match:
        pb.responsavel_nome = _clean_nome(name_match.group(1))

    # Documento (prioriza o que aparecer primeiro, junto do nome)
    cnpj_m = RE_CNPJ.search(block)
    cpf_m = RE_CPF.search(block)
    if cnpj_m and (not cpf_m or cnpj_m.start() <= cpf_m.start()):
        pb.responsavel_documento = _fmt_cnpj(cnpj_m.group(1))
        pb.tipo_documento = "cnpj"
    elif cpf_m:
        pb.responsavel_documento = _fmt_cpf(cpf_m.group(1))
        pb.tipo_documento = "cpf"

    # Valor / débito
    vm = RE_VALOR.search(block)
    if vm:
        pb.valor_debito = _parse_brl(vm.group(2))
        pb.data_referencia_valor = _parse_ddmmyyyy(vm.group(1))
    else:
        vg = RE_VALOR_GENERICO.search(block)
        if vg and (KW_RECOLHER.search(block) or kind in ("citacao", "acordao")):
            pb.valor_debito = _parse_brl(vg.group(1))

    mm = RE_MULTA.search(block)
    if mm:
        pb.valor_multa = _parse_brl(mm.group(1))

    # Prazo
    pm = RE_PRAZO.search(block)
    if pm:
        token = pm.group(1).lower()
        pb.prazo_dias = PRAZO_EXTENSO.get(token) or (int(token) if token.isdigit() else None)
    elif kind in ("citacao", "audiencia"):
        pb.prazo_dias = 15  # padrão legal (art. 202/250 RI)

    pb.tem_representacao = bool(RE_REPRESENTACAO.search(block) or RE_OAB.search(block))
    pb.tema_sugerido = detect_tema(block)

    return pb


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def _fmt_cpf(s: str) -> str:
    d = _digits(s)
    if len(d) != 11:
        return s
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"


def _fmt_cnpj(s: str) -> str:
    d = _digits(s)
    if len(d) != 14:
        return s
    return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"


def parse_caderno(text: str) -> list[ParsedBlock]:
    """Parseia o texto completo de um caderno e retorna os blocos relevantes.

    Mantém apenas blocos que tenham ao menos um sinal de lead
    (citação/audiência/notificação/acórdão OU número de processo com documento).
    """
    blocks = []
    for raw in segment_blocks(text):
        if len(raw) < 40:
            continue
        pb = parse_block(raw)
        is_relevant = (
            pb.kind in ("citacao", "audiencia", "notificacao", "acordao")
            or (pb.numero_processo and pb.responsavel_documento)
        )
        if is_relevant:
            blocks.append(pb)
    return blocks


def compute_deadline(publication: date, prazo_dias: Optional[int]) -> Optional[date]:
    """Prazo final = data de publicação + prazo (dias corridos)."""
    if not prazo_dias:
        return None
    return publication + timedelta(days=prazo_dias)
