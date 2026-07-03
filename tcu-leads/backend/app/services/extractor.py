"""
Extração estruturada e pontuação de oportunidade dos blocos do Diário/TCU.

Usa a Claude API (mesmo cliente de ai_service) para transformar um bloco de
edital/acórdão em JSON estrito e para pontuar a força da oportunidade.
Se a API não estiver configurada, cai para o resultado do parser por regex
(tcu_parser) e um score determinístico — o sistema funciona degradado, sem IA.

Design do prompt (roteiro §4):
  - system prompt fixa o papel;
  - schema JSON estrito (null quando ausente; valores em decimal; datas ISO);
  - temperatura 0; apenas o bloco relevante é enviado (nunca o Diário inteiro).
"""
from __future__ import annotations

import json
import logging
import re
from decimal import Decimal
from typing import Optional

from .ai import get_client
from .parser import ParsedBlock

logger = logging.getLogger(__name__)

TCU_MODEL = "claude-sonnet-4-6"

SYSTEM_PROMPT = (
    "Você extrai dados estruturados de editais e acórdãos do Tribunal de Contas "
    "da União (TCU). Responda SEMPRE e APENAS com um único objeto JSON válido, "
    "sem comentários e sem texto fora do JSON. Use null quando um campo não "
    "estiver presente no texto. Valores monetários em número decimal (ponto como "
    "separador). Datas no formato ISO 8601 (AAAA-MM-DD)."
)

# Esquema textual + few-shot embutidos no prompt do usuário
_SCHEMA = """{
  "act_type": "citacao|audiencia|notificacao|acordao_condenatorio|edital|outro",
  "natureza_processo": "string|null (ex.: Tomada de Contas Especial, Representação, Denúncia, Recurso)",
  "tema": "string|null (área: educacao_fnde, saude, assistencia_social, infraestrutura, cultura_fnc, previdencia, licitacoes, convenios, outro)",
  "numero_processo": "string|null (formato TC nnn.nnn/aaaa-n)",
  "acordao_ref": "string|null (nnnn/aaaa)",
  "colegiado": "string|null (Plenário, Primeira Câmara, Segunda Câmara)",
  "relator": "string|null",
  "unidade_tecnica": "string|null",
  "responsavel": {"nome": "string|null", "documento": "string|null", "tipo_doc": "cpf|cnpj|null", "papel": "string|null"},
  "orgao_entidade": "string|null",
  "uf": "string|null (2 letras)",
  "municipio": "string|null",
  "ja_representado": "boolean (true se há advogado constituído / OAB / 'Representação legal')",
  "valor_debito": "number|null",
  "valor_multa": "number|null",
  "data_referencia_valor": "string|null (ISO)",
  "prazo_dias": "number|null",
  "resumo": "string (2-3 frases objetivas)",
  "is_opportunity": "boolean",
  "rationale": "string (por que é/ não é oportunidade)",
  "confidence": "high|medium|low",
  "opportunity_score": "number 0-100"
}"""

_FEWSHOT = """Exemplo 1 (citação com débito):
TEXTO: "EDITAL 0456/2026-TCU/SEPROC. Processo TC 012.345/2024-7. Em razão do Acórdão 1234/2026-TCU-Plenário, fica CITADO EMILIO HUCS GALLO, CPF: 123.456.789-00, para, no prazo de quinze (15) dias, apresentar alegações de defesa ou recolher aos cofres do FNDE. Valor total atualizado monetariamente até 31/12/2025: R$ 1.234.567,89; em solidariedade com Construtora Merenda Escolar LTDA, CNPJ: 12.345.678/0001-99."
JSON: {"act_type":"citacao","natureza_processo":"Tomada de Contas Especial","tema":"educacao_fnde","numero_processo":"TC 012.345/2024-7","acordao_ref":"1234/2026","colegiado":"Plenário","relator":null,"unidade_tecnica":null,"responsavel":{"nome":"EMILIO HUCS GALLO","documento":"123.456.789-00","tipo_doc":"cpf","papel":"responsável (solidário)"},"orgao_entidade":"FNDE","uf":null,"municipio":null,"ja_representado":false,"valor_debito":1234567.89,"valor_multa":null,"data_referencia_valor":"2025-12-31","prazo_dias":15,"resumo":"Citação em TCE por débito na aplicação de recursos do FNDE, com prazo de 15 dias para alegações de defesa. Responsável pessoa física em solidariedade com empresa.","is_opportunity":true,"rationale":"Parte física citada com débito quantificado e prazo curto — demanda urgente de defesa.","confidence":"high","opportunity_score":88}

Exemplo 2 (acórdão condenatório):
TEXTO: "Acórdão 5678/2026-TCU-Primeira Câmara. Julga irregulares as contas e condena o responsável ao pagamento de multa de R$ 30.000,00, fixando prazo de 15 dias para recolhimento."
JSON: {"act_type":"acordao_condenatorio","natureza_processo":"Prestação de Contas","tema":null,"numero_processo":null,"acordao_ref":"5678/2026","colegiado":"Primeira Câmara","relator":null,"unidade_tecnica":null,"responsavel":{"nome":null,"documento":null,"tipo_doc":null,"papel":"responsável"},"orgao_entidade":null,"uf":null,"municipio":null,"ja_representado":false,"valor_debito":null,"valor_multa":30000.00,"data_referencia_valor":null,"prazo_dias":15,"resumo":"Acórdão que julga contas irregulares e aplica multa de R$ 30 mil, com prazo de 15 dias para recolhimento; abre janela para recursos.","is_opportunity":true,"rationale":"Condenação com multa gera necessidade de recurso (reconsideração/embargos).","confidence":"medium","opportunity_score":70}"""


def extract_block(block: ParsedBlock) -> dict:
    """Estrutura um bloco. Usa Claude quando disponível; senão, usa o parser regex."""
    client = get_client()
    if not client:
        return _from_parser(block)

    prompt = (
        f"Extraia os dados do texto abaixo no schema JSON a seguir.\n\n"
        f"SCHEMA:\n{_SCHEMA}\n\n{_FEWSHOT}\n\n"
        f"Agora processe:\nTEXTO: \"\"\"\n{block.raw_text[:6000]}\n\"\"\"\nJSON:"
    )
    try:
        msg = client.messages.create(
            model=TCU_MODEL,
            max_tokens=1500,
            temperature=0,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        text = msg.content[0].text
        data = _parse_json(text)
        if not data:
            return _from_parser(block)
        data["extracted_by_ai"] = True
        # Preenche lacunas da IA com o que o regex já achou (mais confiável em nº/doc/valor)
        return _merge_with_parser(data, block)
    except Exception as e:
        logger.error(f"Extração IA falhou: {e}")
        return _from_parser(block)


def _parse_json(text: str) -> Optional[dict]:
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


def _merge_with_parser(data: dict, block: ParsedBlock) -> dict:
    """Prefere campos determinísticos do parser quando a IA deixou nulo."""
    resp = data.get("responsavel") or {}
    if not data.get("numero_processo") and block.numero_processo:
        data["numero_processo"] = block.numero_processo
    if not data.get("acordao_ref") and block.acordao_ref:
        data["acordao_ref"] = block.acordao_ref
    if not data.get("colegiado") and block.colegiado:
        data["colegiado"] = block.colegiado
    if not resp.get("documento") and block.responsavel_documento:
        resp["documento"] = block.responsavel_documento
        resp["tipo_doc"] = block.tipo_documento
    if not resp.get("nome") and block.responsavel_nome:
        resp["nome"] = block.responsavel_nome
    data["responsavel"] = resp
    if data.get("valor_debito") in (None, 0) and block.valor_debito:
        data["valor_debito"] = block.valor_debito
    if data.get("valor_multa") in (None, 0) and block.valor_multa:
        data["valor_multa"] = block.valor_multa
    if not data.get("prazo_dias") and block.prazo_dias:
        data["prazo_dias"] = block.prazo_dias
    if not data.get("tema") and block.tema_sugerido:
        data["tema"] = block.tema_sugerido
    if "opportunity_score" not in data or data.get("opportunity_score") is None:
        data["opportunity_score"] = score_opportunity(data)
    return data


def _from_parser(block: ParsedBlock) -> dict:
    """Constrói o dict estruturado apenas com o resultado do parser (sem IA)."""
    act_map = {
        "citacao": "citacao", "audiencia": "audiencia",
        "notificacao": "notificacao", "acordao": "acordao_condenatorio",
    }
    data = {
        "act_type": act_map.get(block.kind, "outro" if block.kind == "outro" else "edital"),
        "natureza_processo": None,
        "tema": block.tema_sugerido,
        "numero_processo": block.numero_processo,
        "acordao_ref": block.acordao_ref,
        "colegiado": block.colegiado,
        "relator": None,
        "unidade_tecnica": None,
        "responsavel": {
            "nome": block.responsavel_nome,
            "documento": block.responsavel_documento,
            "tipo_doc": block.tipo_documento,
            "papel": None,
        },
        "orgao_entidade": None,
        "uf": None,
        "municipio": None,
        "ja_representado": block.tem_representacao,
        "valor_debito": block.valor_debito,
        "valor_multa": block.valor_multa,
        "data_referencia_valor": block.data_referencia_valor.isoformat() if block.data_referencia_valor else None,
        "prazo_dias": block.prazo_dias,
        "resumo": _fallback_resumo(block),
        "is_opportunity": block.kind in ("citacao", "audiencia", "acordao"),
        "rationale": "Extração por regex (IA indisponível).",
        "confidence": "medium" if block.responsavel_documento else "low",
        "extracted_by_ai": False,
    }
    data["opportunity_score"] = score_opportunity(data)
    return data


def _fallback_resumo(block: ParsedBlock) -> str:
    tipo = {
        "citacao": "Citação (débito) com prazo para alegações de defesa",
        "audiencia": "Audiência (sem débito) com prazo para razões de justificativa",
        "notificacao": "Notificação de acórdão à parte",
        "acordao": "Acórdão do colegiado",
    }.get(block.kind, "Deliberação do TCU")
    who = block.responsavel_nome or "responsável não identificado"
    proc = block.numero_processo or "processo não identificado"
    val = f" Valor: R$ {block.valor_debito:,.2f}.".replace(",", "X").replace(".", ",").replace("X", ".") if block.valor_debito else ""
    return f"{tipo}. {who} — {proc}.{val}"


def score_opportunity(data: dict) -> int:
    """Score determinístico 0-100 da força da oportunidade (roteiro §4).

    Pondera: valor do débito/multa, tipo do ato, PF vs PJ, se já há advogado,
    e existência de prazo curto ativo.
    """
    score = 0
    act = data.get("act_type")
    score += {
        "citacao": 45, "acordao_condenatorio": 35, "audiencia": 30,
        "notificacao": 15, "edital": 10,
    }.get(act, 5)

    debito = _num(data.get("valor_debito")) or 0
    multa = _num(data.get("valor_multa")) or 0
    valor = max(debito, multa)
    if valor >= 1_000_000:
        score += 30
    elif valor >= 250_000:
        score += 22
    elif valor >= 50_000:
        score += 14
    elif valor > 0:
        score += 7

    resp = data.get("responsavel") or {}
    if resp.get("tipo_doc") == "cnpj":
        score += 8   # PJ tende a ter capacidade de contratar
    elif resp.get("tipo_doc") == "cpf":
        score += 5

    if data.get("prazo_dias"):
        score += 6

    if data.get("ja_representado"):
        score -= 20  # já tem advogado — oportunidade fraca

    return max(0, min(100, score))


def _num(v) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
