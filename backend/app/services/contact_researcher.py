"""
Pesquisa automática de contatos para agentes operadores.
Usa BrasilAPI (CNPJ), DuckDuckGo e Claude AI.
Todos os resultados ficam pendentes para revisão humana.
"""
import httpx
import json
import logging
import re
from datetime import datetime
from sqlalchemy.orm import Session
from ..models.operator import BettingOperator, ContactSuggestion, ContactType, SuggestionStatus
from .audit_service import log_action
from .ai_service import get_client

logger = logging.getLogger(__name__)

BRASIL_API_URL = "https://brasilapi.com.br/api/cnpj/v1/{cnpj}"
DUCKDUCKGO_URL = "https://api.duckduckgo.com/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; GestaoBets/1.0; research-bot)",
    "Accept": "application/json",
}


def research_operator(db: Session, operator_id: int, user_id: int = None) -> dict:
    """Pesquisa contatos de um operador usando todas as fontes disponíveis."""
    op = db.query(BettingOperator).get(operator_id)
    if not op:
        return {"error": "Operador não encontrado"}

    suggestions_found = []
    errors = []

    # 1. BrasilAPI — dados do CNPJ (gratuito, sem API key)
    if op.cnpj:
        result = _search_cnpj_brasilapi(db, op)
        suggestions_found.extend(result["suggestions"])
        if result.get("error"):
            errors.append(f"BrasilAPI: {result['error']}")

    # 2. DuckDuckGo — busca web
    search_terms = _build_search_terms(op)
    for term in search_terms:
        result = _search_duckduckgo(db, op, term)
        suggestions_found.extend(result["suggestions"])
        if result.get("error"):
            errors.append(f"DuckDuckGo '{term}': {result['error']}")

    # 3. Dedução determinística de e-mails pelo domínio (sem depender de IA/web)
    suggestions_found.extend(_deduce_domain_emails(op, suggestions_found))

    # 4. Claude AI — análise inteligente e sugestões adicionais
    result = _search_with_claude(db, op, suggestions_found)
    suggestions_found.extend(result.get("new_suggestions", []))

    # Remove duplicates already in contact_suggestions or OperatorContact
    existing_values = {c.value.lower() for c in op.contacts}
    existing_suggestions = {s.value.lower() for s in op.contact_suggestions}

    new_count = 0
    for s in suggestions_found:
        val = s.get("value", "").lower().strip()
        if not val or val in existing_values or val in existing_suggestions:
            continue

        suggestion = ContactSuggestion(
            operator_id=operator_id,
            type=s.get("type", ContactType.other),
            value=s["value"].strip(),
            source=s.get("source", "Pesquisa automática"),
            source_url=s.get("source_url"),
            relationship_label=s.get("relationship"),
            confidence=s.get("confidence", "medium"),
            status=SuggestionStatus.pending,
            notes=s.get("notes"),
        )
        db.add(suggestion)
        existing_suggestions.add(val)
        new_count += 1

    db.commit()

    log_action(
        db=db,
        action="CONTACT_RESEARCH",
        entity_type="BettingOperator",
        entity_id=operator_id,
        description=f"Pesquisa de contatos: {new_count} novas sugestões encontradas",
        new_values={"new_suggestions": new_count, "errors": errors},
        user_id=user_id,
    )

    return {
        "operator_id": operator_id,
        "operator_name": op.company_name,
        "new_suggestions": new_count,
        "total_found": len(suggestions_found),
        "errors": errors,
        "researched_at": datetime.now().isoformat(),
    }


def _search_cnpj_brasilapi(db: Session, op: BettingOperator) -> dict:
    """Busca dados do CNPJ na BrasilAPI (Receita Federal)."""
    suggestions = []
    cnpj_digits = re.sub(r'\D', '', op.cnpj or '')
    if len(cnpj_digits) != 14:
        return {"suggestions": [], "error": "CNPJ inválido"}

    try:
        resp = httpx.get(
            BRASIL_API_URL.format(cnpj=cnpj_digits),
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code != 200:
            return {"suggestions": [], "error": f"Status {resp.status_code}"}

        data = resp.json()

        # Email do cadastro
        email = data.get("email")
        if email and "@" in email:
            suggestions.append({
                "type": ContactType.email,
                "value": email.lower(),
                "source": "BrasilAPI / Receita Federal",
                "source_url": f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digits}",
                "relationship": "E-mail cadastrado no CNPJ",
                "confidence": "high",
                "notes": "E-mail constante no cadastro CNPJ da Receita Federal",
            })

        # Telefone do cadastro
        telefone = data.get("ddd_telefone_1") or data.get("telefone")
        if telefone and len(re.sub(r'\D', '', telefone)) >= 8:
            suggestions.append({
                "type": ContactType.phone,
                "value": telefone.strip(),
                "source": "BrasilAPI / Receita Federal",
                "source_url": f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digits}",
                "relationship": "Telefone cadastrado no CNPJ",
                "confidence": "high",
                "notes": "Telefone constante no cadastro CNPJ da Receita Federal",
            })

        # QSA — Quadro Societário e Administradores
        qsa = data.get("qsa", [])
        for socio in qsa:
            nome = socio.get("nome_socio") or socio.get("nome")
            qualificacao = socio.get("qualificacao_socio") or socio.get("qualificacao", "Sócio")
            if nome:
                suggestions.append({
                    "type": ContactType.other,
                    "value": nome,
                    "source": "BrasilAPI / Receita Federal — QSA",
                    "source_url": f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digits}",
                    "relationship": f"{qualificacao} (QSA/Receita Federal)",
                    "confidence": "high",
                    "notes": "Nome constante no Quadro Societário e de Administradores do CNPJ. Pesquisar contatos desta pessoa.",
                })

        return {"suggestions": suggestions, "data": data}

    except Exception as e:
        logger.error(f"BrasilAPI error for {op.cnpj}: {e}")
        return {"suggestions": [], "error": str(e)}


def _domain_from(op: BettingOperator):
    """Extrai um domínio a partir do site ou de marcas/e-mails cadastrados."""
    src = op.website or ""
    if not src:
        for b in (op.brands or []):
            if b.domain or b.website:
                src = b.website or b.domain
                break
    if not src:
        for c in op.contacts:
            if c.type == ContactType.email and c.value and "@" in c.value:
                return c.value.split("@")[-1].strip().lower()
    if not src:
        return None
    dom = re.sub(r'https?://(www\.)?', '', src).strip().rstrip('/')
    dom = dom.split('/')[0]
    return dom.lower() or None


def _deduce_domain_emails(op: BettingOperator, found_so_far: list) -> list:
    """Gera e-mails corporativos prováveis a partir do domínio (revisão humana obrigatória)."""
    dom = _domain_from(op)
    if not dom or "." not in dom:
        return []
    prefixes = ["contato", "juridico", "financeiro", "compliance", "atendimento", "legal"]
    existing = {s.get("value", "").lower() for s in found_so_far}
    out = []
    for p in prefixes:
        val = f"{p}@{dom}"
        if val in existing:
            continue
        out.append({
            "type": ContactType.email,
            "value": val,
            "source": "Dedução por domínio",
            "source_url": f"https://{dom}",
            "relationship": "E-mail corporativo provável",
            "confidence": "low",
            "notes": f"Padrão comum de e-mail no domínio {dom}. Confirmar antes de usar.",
        })
    return out


def _build_search_terms(op: BettingOperator) -> list:
    """Constrói termos de busca para o operador."""
    terms = []
    name = op.fantasy_name or op.company_name
    cnpj = op.cnpj

    terms.append(f"{name} contato email apostas")
    terms.append(f"{name} site:linkedin.com")
    terms.append(f"{name} CNPJ {cnpj} representante legal")
    if op.website:
        domain = re.sub(r'https?://(www\.)?', '', op.website).rstrip('/')
        terms.append(f"site:{domain} contato email")

    return terms[:4]  # máximo 4 buscas para não sobrecarregar


def _search_duckduckgo(db: Session, op: BettingOperator, query: str) -> dict:
    """Busca no DuckDuckGo usando a API instantânea (sem API key)."""
    suggestions = []
    try:
        resp = httpx.get(
            DUCKDUCKGO_URL,
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
            headers=HEADERS,
            timeout=10,
        )
        if resp.status_code != 200:
            return {"suggestions": [], "error": f"DuckDuckGo status {resp.status_code}"}

        data = resp.json()

        # Extrai texto dos resultados
        abstract = data.get("Abstract", "") + " " + data.get("AbstractText", "")
        related = " ".join([r.get("Text", "") for r in data.get("RelatedTopics", [])[:5]])
        full_text = abstract + " " + related

        # Extrai emails do texto
        emails = re.findall(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}', full_text)
        for email in set(emails):
            if any(skip in email.lower() for skip in ["example", "test", "noreply", "duckduckgo"]):
                continue
            suggestions.append({
                "type": ContactType.email,
                "value": email.lower(),
                "source": "DuckDuckGo",
                "source_url": data.get("AbstractURL") or f"https://duckduckgo.com/?q={query}",
                "relationship": "Encontrado via busca web",
                "confidence": "low",
                "notes": f"Encontrado na busca: '{query}'",
            })

        # URLs de redes sociais
        for result in data.get("RelatedTopics", []):
            url = result.get("FirstURL", "")
            text = result.get("Text", "")
            if "linkedin.com/in/" in url or "linkedin.com/company/" in url:
                suggestions.append({
                    "type": ContactType.social_media,
                    "value": url,
                    "source": "DuckDuckGo → LinkedIn",
                    "source_url": url,
                    "relationship": "Perfil LinkedIn",
                    "confidence": "medium",
                    "notes": text[:200] if text else None,
                })
            elif "instagram.com/" in url:
                suggestions.append({
                    "type": ContactType.social_media,
                    "value": url,
                    "source": "DuckDuckGo → Instagram",
                    "source_url": url,
                    "relationship": "Perfil Instagram",
                    "confidence": "medium",
                    "notes": text[:200] if text else None,
                })

        return {"suggestions": suggestions}

    except Exception as e:
        logger.error(f"DuckDuckGo error for '{query}': {e}")
        return {"suggestions": [], "error": str(e)}


def _search_with_claude(db: Session, op: BettingOperator, found_so_far: list) -> dict:
    """Usa Claude AI para analisar os dados coletados e sugerir contatos adicionais."""
    client = get_client()
    if not client:
        return {"new_suggestions": []}

    try:
        found_summary = "\n".join([
            f"- {s.get('type')}: {s.get('value')} ({s.get('relationship')}, fonte: {s.get('source')})"
            for s in found_so_far[:20]
        ]) or "Nenhum contato encontrado ainda."

        prompt = f"""Você é um especialista em pesquisa de contatos empresariais no Brasil, trabalhando para um escritório jurídico que precisa contatar agentes operadores de apostas para cobrança de direitos de imagem.

**Agente Operador:**
- Razão Social: {op.company_name}
- Nome Fantasia: {op.fantasy_name or 'Não informado'}
- CNPJ: {op.cnpj or 'Não informado'}
- Site: {op.website or 'Não informado'}

**Contatos já encontrados:**
{found_summary}

**Tarefa:**
1. Analise os dados acima e sugira estratégias específicas de pesquisa para encontrar:
   - E-mails de contato (comercial, jurídico, compliance)
   - Telefones (especialmente WhatsApp corporativo)
   - Perfis em LinkedIn, Instagram, X/Twitter
   - Representantes legais, advogados ou contadores vinculados ao CNPJ
   - Empresas do mesmo grupo econômico

2. Se o site foi informado, deduza e-mails prováveis (ex: contato@dominio.com, juridico@dominio.com, compliance@dominio.com)

3. Forneça apenas sugestões verificáveis ou altamente prováveis.

Responda em JSON com esta estrutura:
{{
  "suggested_contacts": [
    {{
      "type": "email|phone|whatsapp|social_media|other",
      "value": "valor do contato",
      "source": "Claude AI",
      "relationship": "descrição do vínculo com a bet",
      "confidence": "high|medium|low",
      "notes": "explicação de por que este contato é provável"
    }}
  ],
  "search_recommendations": ["recomendação 1", "recomendação 2"]
}}"""

        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )

        text = message.content[0].text
        # Extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            result = json.loads(json_match.group())
            return {
                "new_suggestions": result.get("suggested_contacts", []),
                "recommendations": result.get("search_recommendations", []),
            }
        return {"new_suggestions": []}

    except Exception as e:
        logger.error(f"Claude contact search error: {e}")
        return {"new_suggestions": []}


def research_all_operators_bg() -> dict:
    """Wrapper para tarefa em segundo plano: abre a própria sessão (a da requisição já foi fechada)."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        return research_all_operators(db)
    finally:
        db.close()


def research_all_operators(db: Session) -> dict:
    """Pesquisa contatos de todos os operadores ativos. Usado pelo job semanal."""
    from ..models.operator import OperatorStatus
    operators = db.query(BettingOperator).filter(BettingOperator.status == OperatorStatus.active).all()

    total_new = 0
    results = []
    for op in operators:
        try:
            result = research_operator(db, op.id)
            total_new += result.get("new_suggestions", 0)
            results.append(result)
        except Exception as e:
            logger.error(f"Research error for operator {op.id}: {e}")

    log_action(
        db=db,
        action="WEEKLY_CONTACT_RESEARCH",
        description=f"Pesquisa semanal de contatos: {len(operators)} operadores, {total_new} novas sugestões",
        new_values={"operators_researched": len(operators), "total_new_suggestions": total_new},
    )

    return {
        "operators_researched": len(operators),
        "total_new_suggestions": total_new,
        "results": results,
    }


def get_pending_suggestions(db: Session, operator_id: int = None) -> list:
    q = db.query(ContactSuggestion).filter(ContactSuggestion.status == SuggestionStatus.pending)
    if operator_id:
        q = q.filter(ContactSuggestion.operator_id == operator_id)
    return q.order_by(ContactSuggestion.found_at.desc()).all()
