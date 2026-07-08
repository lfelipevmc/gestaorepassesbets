"""Mensuração de um atendimento.

Com ANTHROPIC_API_KEY configurada, usa o Claude para resumir, classificar o tema,
estimar o esforço (em minutos) e detectar se houve providência.
Sem chave (ou em caso de falha), cai numa medição HEURÍSTICA — assim o sistema
funciona e demonstra valor mesmo sem IA ligada.

Observação importante: o VALOR EQUIVALENTE (R$) NÃO é definido pela IA. Ele é
calculado deterministicamente a partir dos minutos estimados e da hora de
referência do cliente (ver segmentacao.py) — para ser auditável e defensável.
"""
import json
import logging

from ..config import settings

logger = logging.getLogger("mensura.ai")

_PROVIDENCIA_KWS = [
    "revisar", "revisão", "revise", "elaborar", "elaboração", "minuta", "redigir",
    "contrato", "aditivo", "protocolar", "protocolo", "parecer", "notificação",
    "notificar", "recurso", "petição", "peticionar", "prazo", "distrato",
    "rescisão", "acordo", "procuração", "modelo", "documento",
]

_SCHEMA = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "tema": {"type": "string"},
        "complexidade": {"type": "string", "enum": ["baixa", "média", "alta"]},
        "minutos_estimados": {"type": "integer"},
        "gerou_providencia": {"type": "boolean"},
        "titulo_providencia": {"type": "string"},
    },
    "required": [
        "resumo", "tema", "complexidade", "minutos_estimados",
        "gerou_providencia", "titulo_providencia",
    ],
    "additionalProperties": False,
}

_client = None


def _get_client():
    """Cria o cliente Anthropic sob demanda. Retorna None se indisponível."""
    global _client
    if _client is not None:
        return _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic  # importado só quando há chave, para não exigir a lib no demo
        _client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        return _client
    except Exception as e:  # lib ausente ou erro de init
        logger.warning("IA indisponível (%s) — usando heurística.", e)
        return None


def _transcricao(mensagens) -> str:
    linhas = []
    for m in mensagens:
        quem = "Cliente" if m.direcao == "in" else "Advogado"
        linhas.append(f"{quem}: {(m.texto or '').strip()}")
    return "\n".join(linhas)


def medir_atendimento(mensagens) -> dict:
    """Retorna dict com resumo, tema, complexidade, minutos_estimados,
    gerou_providencia, titulo_providencia e fonte ('ia' | 'heuristica')."""
    cl = _get_client()
    if cl is None:
        return _heuristica(mensagens)

    transcricao = _transcricao(mensagens)
    prompt = (
        "Você é assistente de um advogado. Analise o atendimento consultivo abaixo, "
        "trocado por WhatsApp, e produza uma medição objetiva.\n\n"
        "Regras:\n"
        "- 'resumo': 1 a 2 frases sobre o que foi consultado e o direcionamento dado.\n"
        "- 'tema': área/assunto jurídico (ex.: trabalhista, contratos, societário, tributário).\n"
        "- 'complexidade': baixa, média ou alta.\n"
        "- 'minutos_estimados': tempo de trabalho consultivo que este atendimento representa.\n"
        "- 'gerou_providencia': true somente se o escritório precisa TOMAR UMA AÇÃO depois "
        "(revisar/elaborar documento, protocolar, emitir parecer). Dúvida respondida na "
        "conversa NÃO é providência.\n"
        "- 'titulo_providencia': se houver providência, um título curto; senão, string vazia.\n\n"
        f"Atendimento:\n{transcricao}"
    )
    try:
        resp = cl.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1024,
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
        )
        texto = next(b.text for b in resp.content if b.type == "text")
        data = json.loads(texto)
        data["fonte"] = "ia"
        data["minutos_estimados"] = int(data.get("minutos_estimados") or 0)
        return data
    except Exception as e:
        logger.warning("Falha na medição por IA (%s) — usando heurística.", e)
        return _heuristica(mensagens)


def _heuristica(mensagens) -> dict:
    """Medição sem IA: estima esforço pelo volume e detecta providência por palavras-chave."""
    n = len(mensagens)
    texto_cliente = " ".join(
        (m.texto or "") for m in mensagens if m.direcao == "in"
    ).strip()
    texto_todo = " ".join((m.texto or "") for m in mensagens).lower()
    total_chars = sum(len(m.texto or "") for m in mensagens)

    minutos = max(5, min(120, round(total_chars / 380 * 5) + 5))
    if n <= 4:
        complexidade = "baixa"
    elif n <= 12:
        complexidade = "média"
    else:
        complexidade = "alta"

    gerou = any(kw in texto_todo for kw in _PROVIDENCIA_KWS)
    titulo = "Revisar/elaborar documento ou tomar providência" if gerou else ""

    primeira = texto_cliente[:180].strip()
    if len(texto_cliente) > 180:
        primeira += "…"
    resumo = (
        f"Atendimento com {n} mensagem(ns)."
        + (f" Assunto do cliente: “{primeira}”." if primeira else "")
    )

    return {
        "resumo": resumo,
        "tema": "Não classificado (IA desativada)",
        "complexidade": complexidade,
        "minutos_estimados": minutos,
        "gerou_providencia": gerou,
        "titulo_providencia": titulo,
        "fonte": "heuristica",
    }
