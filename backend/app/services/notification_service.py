"""Utilidades de texto para as notificações de cobrança.

POLÍTICA: este módulo NÃO envia e-mails. O envio a agentes operadores acontece
exclusivamente em POST /api/collections/{id}/send-confirmed, com revisão humana
e confirmação por senha de login (ver incidente de 12/07/2026)."""
import logging

logger = logging.getLogger(__name__)


class _SafeDict(dict):
    """Mantém intactas as chaves desconhecidas em vez de lançar KeyError."""
    def __missing__(self, key):
        return "{" + key + "}"


def render_placeholders(text: str, operator, confederation, reference_month: str, amount=None, prazo: str = None, escritorio: str = None, usuario: str = None, logomarca: str = None) -> str:
    """Substitui placeholders padronizados no texto do template.

    reference_month no formato "MM/AAAA". Chaves suportadas:
    {bet} {confederacao} {confederacaosigla} {mes} {ano} {valor} {prazo} {escritorio} {usuario} {logomarca}
    Chaves desconhecidas são preservadas (não quebram o envio).
    """
    valor = "R$ {:,.2f}".format(float(amount)).replace(",", "X").replace(".", ",").replace("X", ".") if amount else "valor a ser apurado pelo agente operador"
    mes = reference_month or ""
    ano = ""
    if reference_month and "/" in reference_month:
        partes = reference_month.split("/")
        mes = partes[0]
        ano = partes[-1]
    data = _SafeDict(
        bet=operator.fantasy_name or operator.company_name,
        confederacao=confederation.name,
        confederacaosigla=confederation.acronym,
        mes=mes,
        ano=ano,
        valor=valor,
        prazo=prazo or "10 (dez) dias",
        escritorio=escritorio or "Escritório Jurídico - Gestão de Haveres de Bets",
        usuario=usuario or "",
        logomarca=logomarca or "",
    )
    try:
        return (text or "").format_map(data)
    except Exception:
        return text or ""



# ─────────────────────────────────────────────────────────────────────────────
# REMOVIDO EM 13/07/2026 (incidente de envio automático):
# a função send_collection_notification() permitia disparar notificação a uma
# Bet sem revisão humana. Todo envio agora passa EXCLUSIVAMENTE pelo endpoint
# POST /api/collections/{id}/send-confirmed, que exige revisão dos
# destinatários/mensagem e CONFIRMAÇÃO COM A SENHA do usuário logado.
# ─────────────────────────────────────────────────────────────────────────────
