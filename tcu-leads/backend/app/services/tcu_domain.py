"""
Domínio TCU — terminologia e regras do Regimento Interno (Resolução TCU 246/2011)
e da Lei Orgânica (Lei 8.443/92), usadas para reconhecer e pontuar oportunidades.

Referência (RITCU/LOTCU):
  - As COMUNICAÇÕES processuais que "chamam" um particular ao processo são a
    CITAÇÃO (há débito → 15 dias p/ alegações de defesa ou recolhimento),
    a AUDIÊNCIA (irregularidade sem débito → 15 dias p/ razões de justificativa),
    a OITIVA (manifestação de interessado/parte), a NOTIFICAÇÃO (ciência de
    decisão) e a DILIGÊNCIA (pedido de informação, em regra ao órgão).
  - O RELATOR determina, por DESPACHO singular, a citação/audiência.
  - A UNIDADE TÉCNICA elabora a INSTRUÇÃO, que apura responsabilidades e PROPÕE
    a citação/audiência — é onde primeiro surgem os nomes dos responsáveis.
  - A comunicação é acompanhada da instrução, do despacho do relator ou do
    acórdão. Editais suprem a comunicação quando a parte não é localizada.

O lead mais valioso é o particular (PF/PJ) chamado a se defender e que ainda não
constituiu advogado — captado no momento mais cedo possível (instrução/despacho/
autuação), respeitada a vedação de captação ativa (OAB 205/2021): uso interno.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional


def _strip(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", s or "") if not unicodedata.combining(c))
    return s.lower()


# --------------------------------------------------------------------------- #
# Comunicações processuais (quem chama alguém ao processo)
# --------------------------------------------------------------------------- #
# chave -> (rótulo, valor_lead 0..1, prazo_dias, gatilhos)
COMUNICACOES = {
    "citacao": {
        "label": "Citação (débito)", "valor": 1.0, "prazo": 15,
        "gatilhos": ["cite-se", "citacao", "citar o responsavel", "fica citado",
                     "alegacoes de defesa", "recolher aos cofres", "recolhimento do debito",
                     "debito imputado"],
    },
    "audiencia": {
        "label": "Audiência (justificativa)", "valor": 0.9, "prazo": 15,
        "gatilhos": ["audiencia do responsavel", "razoes de justificativa", "em audiencia",
                     "realizar a audiencia", "promover a audiencia", "audiencia previa"],
    },
    "oitiva": {
        "label": "Oitiva", "valor": 0.6, "prazo": 15,
        "gatilhos": ["oitiva", "manifestacao do interessado", "manifeste-se o interessado"],
    },
    "notificacao": {
        "label": "Notificação", "valor": 0.5, "prazo": None,
        "gatilhos": ["notifique-se", "notificacao", "dar ciencia", "cientificar"],
    },
    "diligencia": {
        "label": "Diligência", "valor": 0.2, "prazo": None,
        "gatilhos": ["diligencia", "diligenciar", "requisicao de informacoes"],
    },
    "cobranca_executiva": {
        "label": "Cobrança executiva", "valor": 0.85, "prazo": None,
        "gatilhos": ["cobranca executiva", "titulo executivo", "execucao do acordao",
                     "cobranca judicial"],
    },
}

# Ordem de prioridade quando várias comunicações aparecem
_COMUNIC_PRIORIDADE = ["citacao", "cobranca_executiva", "audiencia", "oitiva", "notificacao", "diligencia"]

# Mapeia a comunicação → act_type do modelo TcuLead
COMUNIC_TO_ACT = {
    "citacao": "citacao", "audiencia": "audiencia", "oitiva": "audiencia",
    "notificacao": "notificacao", "cobranca_executiva": "citacao", "diligencia": "outro",
}


# --------------------------------------------------------------------------- #
# Natureza do processo (quais geram particular chamável)
# --------------------------------------------------------------------------- #
# valor_lead 0..1 por natureza (peso na priorização)
NATUREZAS = [
    ("tomada_contas_especial", 1.0, ["tomada de contas especial", "tce"]),
    ("cobranca_executiva", 0.9, ["cobranca executiva"]),
    ("representacao", 0.8, ["representacao"]),
    ("denuncia", 0.8, ["denuncia"]),
    ("prestacao_contas", 0.7, ["prestacao de contas", "tomada de contas", "contas ordinarias"]),
    ("recurso", 0.55, ["recurso", "pedido de reexame", "recurso de reconsideracao",
                       "embargos de declaracao", "agravo", "recurso de revisao"]),
    ("auditoria", 0.5, ["auditoria", "fiscalizacao", "inspecao", "levantamento"]),
    ("acompanhamento", 0.45, ["acompanhamento", "monitoramento"]),
    ("ato_pessoal", 0.35, ["aposentadoria", "pensao", "admissao", "ato de pessoal",
                           "reforma"]),
    ("solicitacao", 0.2, ["solicitacao do congresso", "solicitacao"]),
    ("consulta", 0.15, ["consulta"]),
    ("administrativo", 0.1, ["administrativo"]),
]


# --------------------------------------------------------------------------- #
# Tipos de documento/peça que costumam nomear responsáveis
# --------------------------------------------------------------------------- #
DOCUMENTOS = {
    "instrucao": ["instrucao", "instrucao de merito", "unidade tecnica", "secex", "audcontratacoes",
                  "proposta de encaminhamento", "propoe-se"],
    "despacho": ["despacho", "despacho singular", "despacho do relator"],
    "acordao": ["acordao"],
    "relacao": ["relacao", "por relacao"],
    "edital": ["edital", "edital de citacao", "edital de audiencia"],
    "voto": ["voto do relator", "voto"],
    "relatorio": ["relatorio do relator", "relatorio de auditoria"],
}


# --------------------------------------------------------------------------- #
# Detecção
# --------------------------------------------------------------------------- #

def detect_comunicacoes(text: str) -> list[str]:
    """Retorna as comunicações processuais presentes no texto, em ordem de prioridade."""
    up = _strip(text)
    found = set()
    for chave, cfg in COMUNICACOES.items():
        for g in cfg["gatilhos"]:
            if g in up:
                found.add(chave)
                break
    return [c for c in _COMUNIC_PRIORIDADE if c in found]


def strongest_comunicacao(text: str) -> Optional[str]:
    achados = detect_comunicacoes(text)
    return achados[0] if achados else None


def detect_documento(text: str) -> Optional[str]:
    up = _strip(text)
    for tipo, gatilhos in DOCUMENTOS.items():
        for g in gatilhos:
            if g in up:
                return tipo
    return None


def classify_natureza(text: str) -> tuple[Optional[str], float]:
    """Classifica a natureza do processo e devolve (chave, valor_lead)."""
    up = _strip(text)
    for chave, valor, gatilhos in NATUREZAS:
        for g in gatilhos:
            if g in up:
                return chave, valor
    return None, 0.3  # desconhecida: peso neutro-baixo


def scan_movimentacoes(movimentacoes) -> dict:
    """Varre as movimentações de um processo e detecta eventos de lead.

    Aceita lista de strings ou string única. Retorna sinais e a comunicação mais
    forte encontrada (útil para elevar o score e definir o act_type)."""
    if isinstance(movimentacoes, str):
        movs = [movimentacoes]
    elif isinstance(movimentacoes, (list, tuple)):
        movs = [str(m) for m in movimentacoes if m]
    else:
        movs = []
    joined = " \n ".join(movs)
    comunic = detect_comunicacoes(joined)
    docs = [t for t in DOCUMENTOS if detect_documento_in(joined, t)]
    return {
        "comunicacoes": comunic,
        "comunicacao_forte": comunic[0] if comunic else None,
        "documentos": docs,
        "tem_citacao": "citacao" in comunic,
        "tem_audiencia": "audiencia" in comunic,
        "tem_despacho": "despacho" in docs,
        "tem_instrucao": "instrucao" in docs,
        "n_movimentacoes": len(movs),
    }


def detect_documento_in(text: str, tipo: str) -> bool:
    up = _strip(text)
    return any(g in up for g in DOCUMENTOS.get(tipo, []))


# --------------------------------------------------------------------------- #
# Score de oportunidade específico do TCU (0..100)
# --------------------------------------------------------------------------- #

def tcu_lead_score(*, natureza_texto: Optional[str] = None, movimentacoes=None,
                   tem_responsavel: bool = False, tem_documento_pj: bool = False,
                   valor: float = 0.0) -> tuple[int, str]:
    """Pontua um lead do TCU combinando natureza, comunicação (movimentações),
    presença de responsável identificado e valor. Retorna (score, rationale)."""
    _, nat_valor = classify_natureza(natureza_texto or "")
    sig = scan_movimentacoes(movimentacoes)
    comunic = sig.get("comunicacao_forte")
    comunic_valor = COMUNICACOES[comunic]["valor"] if comunic else 0.0

    # base pela natureza (até 30) + comunicação (até 45)
    score = 30 * nat_valor + 45 * comunic_valor
    partes = []
    if comunic:
        partes.append(f"{COMUNICACOES[comunic]['label'].lower()} detectada nas movimentações")
    if not comunic and sig.get("tem_instrucao"):
        score += 12
        partes.append("instrução da unidade técnica (apura responsabilidade)")
    if not comunic and sig.get("tem_despacho"):
        score += 8
        partes.append("despacho do relator")

    if tem_responsavel:
        score += 10
        partes.append("responsável identificado")
    if tem_documento_pj:
        score += 5
    if valor and valor >= 1_000_000:
        score += 10
    elif valor and valor >= 100_000:
        score += 5

    if not partes:
        partes.append("processo recém-autuado (aproximação antecipada)")
    score = int(max(0, min(100, round(score))))
    return score, "; ".join(partes) + "."


def act_type_for(natureza_texto: Optional[str], movimentacoes=None) -> str:
    """Deriva o act_type do TcuLead a partir da comunicação mais forte (ou natureza)."""
    comunic = scan_movimentacoes(movimentacoes).get("comunicacao_forte")
    if comunic:
        return COMUNIC_TO_ACT.get(comunic, "outro")
    nat, _ = classify_natureza(natureza_texto or "")
    if nat == "cobranca_executiva":
        return "citacao"
    return "edital"  # autuado sem comunicação ainda: acompanhamento (early-warning)


def prazo_for(movimentacoes=None) -> Optional[int]:
    comunic = scan_movimentacoes(movimentacoes).get("comunicacao_forte")
    if comunic:
        return COMUNICACOES[comunic].get("prazo")
    return None
