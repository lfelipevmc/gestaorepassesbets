import anthropic
from ..config import settings
from typing import Optional
import json

client = None


def get_client():
    global client
    if client is None and settings.ANTHROPIC_API_KEY:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return client


def find_operator_contacts(company_name: str, fantasy_name: Optional[str], cnpj: Optional[str], website: Optional[str]) -> dict:
    cl = get_client()
    if not cl:
        return {"error": "API de IA não configurada"}

    prompt = f"""Você é um assistente especializado em pesquisa de contatos empresariais no Brasil.

Preciso encontrar contatos (email, telefone, WhatsApp, redes sociais) do seguinte agente operador de apostas:
- Razão Social: {company_name}
- Nome Fantasia: {fantasy_name or 'Não informado'}
- CNPJ: {cnpj or 'Não informado'}
- Website: {website or 'Não informado'}

Por favor:
1. Sugira onde buscar esses contatos (site oficial, CNPJ na Receita Federal, LinkedIn, Instagram, etc.)
2. Identifique padrões comuns de email corporativo baseado no domínio do site
3. Liste todas as informações de contato que você consegue inferir ou sugerir

Responda em formato JSON com a seguinte estrutura:
{{
  "search_suggestions": ["sugestão 1", "sugestão 2"],
  "inferred_contacts": [
    {{"type": "email", "value": "contato@exemplo.com", "confidence": "high/medium/low", "source": "website"}}
  ],
  "notes": "observações adicionais"
}}"""

    message = cl.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    try:
        return json.loads(message.content[0].text)
    except Exception:
        return {"raw_response": message.content[0].text}


def draft_collection_email(
    operator_name: str,
    confederation_name: str,
    reference_month: str,
    notification_number: int,
    calculated_amount: Optional[float] = None
) -> str:
    cl = get_client()
    if not cl:
        return ""

    amount_text = f"R$ {calculated_amount:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") if calculated_amount else "valor a ser declarado pelo agente operador"

    prompt = f"""Você é um advogado especializado em direito desportivo e apostas no Brasil.

Elabore uma notificação extrajudicial de cobrança formal (email) com os seguintes dados:
- Agente Operador: {operator_name}
- Confederação Credora: {confederation_name}
- Mês de referência: {reference_month}
- Número da notificação: {notification_number}ª Notificação
- Valor estimado: {amount_text}
- Base legal: Art. 30, §1º-A, III, 'a', da Lei nº 13.456/2018 c/c Portaria SPA/MF nº 41/2025

A notificação deve:
1. Ser formal e profissional
2. Citar a base legal
3. Solicitar o repasse do valor devido a título de direito de imagem
4. Informar que o não pagamento acarretará as medidas legais cabíveis
5. Solicitar confirmação de recebimento

Escreva apenas o corpo do email em português brasileiro formal."""

    message = cl.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        messages=[{"role": "user", "content": prompt}]
    )

    return message.content[0].text


def analyze_payment_email(email_body: str, operator_names: list) -> dict:
    cl = get_client()
    if not cl:
        return {"confirmed": False}

    prompt = f"""Analise o seguinte email do financeiro de uma confederação esportiva e determine se contém confirmação de pagamento de algum agente operador de apostas.

Email:
{email_body}

Agentes operadores monitorados: {', '.join(operator_names[:20])}

Responda em JSON:
{{
  "has_payment_confirmation": true/false,
  "confirmed_operators": ["nome do operador 1"],
  "payment_amounts": {{"nome do operador": valor_numerico_ou_null}},
  "payment_dates": {{"nome do operador": "data no email ou null"}},
  "notes": "observações"
}}"""

    message = cl.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    try:
        return json.loads(message.content[0].text)
    except Exception:
        return {"has_payment_confirmation": False, "raw": message.content[0].text}


def suggest_operator_for_email(from_addr: str, subject: str, body_preview: str, candidates: list) -> dict:
    """Sugere qual agente operador é o remetente de um e-mail não casado.

    candidates: lista de dicts {id, company_name, fantasy_name, domains: [..], emails: [..]}.
    Retorna {operator_id, confidence, reasoning} ou {operator_id: None} se incerto.
    """
    cl = get_client()
    if not cl:
        # Fallback heurístico sem IA: casa pelo domínio do e-mail
        domain = (from_addr or "").split("@")[-1].lower().strip()
        if domain:
            for c in candidates:
                doms = [d.lower() for d in (c.get("domains") or []) if d]
                if any(domain in d or d in domain for d in doms):
                    return {"operator_id": c["id"], "confidence": "medium",
                            "reasoning": f"Domínio do e-mail ({domain}) corresponde à marca cadastrada.", "ai": False}
        return {"operator_id": None, "confidence": "low", "reasoning": "IA não configurada e domínio não reconhecido.", "ai": False}

    candidates_text = "\n".join(
        f"- ID {c['id']}: {c['company_name']} (fantasia: {c.get('fantasy_name') or '-'}; "
        f"domínios: {', '.join(c.get('domains') or []) or '-'})"
        for c in candidates[:80]
    )

    prompt = f"""Você é um assistente que identifica de qual agente operador de apostas veio um e-mail.

E-mail recebido:
- Remetente: {from_addr}
- Assunto: {subject or '(sem assunto)'}
- Trecho: {(body_preview or '')[:600]}

Candidatos cadastrados:
{candidates_text}

Com base no domínio do remetente, no assunto e no corpo, identifique o agente operador mais provável.
Se não houver correspondência razoável, retorne operator_id null.

Responda APENAS em JSON:
{{"operator_id": <id ou null>, "confidence": "high|medium|low", "reasoning": "justificativa curta"}}"""

    message = cl.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}]
    )
    try:
        result = json.loads(message.content[0].text)
        result["ai"] = True
        return result
    except Exception:
        return {"operator_id": None, "confidence": "low", "reasoning": message.content[0].text[:200], "ai": True}
