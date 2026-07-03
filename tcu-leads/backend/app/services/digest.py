"""
Resumo diário por e-mail — enviado apenas quando há oportunidades novas e
relevantes (score >= DIGEST_MIN_SCORE), respeitando a escolha do escritório de
não receber e-mails em dias vazios. Usa SMTP simples; se não configurado, apenas
registra e não envia.
"""
from __future__ import annotations

import smtplib
import logging
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

from ..config import settings
from ..models import TcuLead, TcuLeadStatus

logger = logging.getLogger(__name__)


def _fmt_brl(v) -> str:
    if not v:
        return "—"
    return ("R$ " + f"{float(v):,.2f}").replace(",", "X").replace(".", ",").replace("X", ".")


def collect_digest_leads(db: Session, since_hours: int = 26) -> list[TcuLead]:
    cutoff = datetime.utcnow() - timedelta(hours=since_hours)
    return (
        db.query(TcuLead)
        .filter(
            TcuLead.created_at >= cutoff,
            TcuLead.is_opportunity.is_(True),
            TcuLead.lgpd_objection.is_(False),
            TcuLead.status == TcuLeadStatus.novo,
            TcuLead.opportunity_score >= settings.DIGEST_MIN_SCORE,
        )
        .order_by(TcuLead.opportunity_score.desc())
        .limit(50)
        .all()
    )


def build_email_html(leads: list[TcuLead]) -> str:
    rows = []
    for l in leads:
        valor = _fmt_brl(l.valor_debito or l.valor_multa)
        prazo = l.prazo_final.strftime("%d/%m/%Y") if l.prazo_final else "—"
        rows.append(
            f"<tr>"
            f"<td style='padding:6px 10px;font-weight:bold'>{l.opportunity_score or '-'}</td>"
            f"<td style='padding:6px 10px'>{(l.act_type.value if l.act_type else '') .replace('_',' ')}</td>"
            f"<td style='padding:6px 10px'>{l.responsavel_nome or l.numero_processo or '—'}</td>"
            f"<td style='padding:6px 10px'>{l.tema or '—'}</td>"
            f"<td style='padding:6px 10px;text-align:right'>{valor}</td>"
            f"<td style='padding:6px 10px'>{prazo}</td>"
            f"</tr>"
        )
    return (
        "<div style='font-family:Arial,sans-serif;color:#1e293b'>"
        "<h2>TCU Leads — novas oportunidades</h2>"
        f"<p>{len(leads)} nova(s) oportunidade(s) relevante(s) nas últimas 24h.</p>"
        "<table style='border-collapse:collapse;font-size:13px' border='0'>"
        "<tr style='background:#f1f5f9'>"
        "<th style='padding:6px 10px;text-align:left'>Score</th>"
        "<th style='padding:6px 10px;text-align:left'>Ato</th>"
        "<th style='padding:6px 10px;text-align:left'>Responsável / Processo</th>"
        "<th style='padding:6px 10px;text-align:left'>Tema</th>"
        "<th style='padding:6px 10px;text-align:right'>Valor</th>"
        "<th style='padding:6px 10px;text-align:left'>Prazo</th></tr>"
        + "".join(rows) +
        "</table>"
        "<p style='color:#64748b;font-size:12px;margin-top:16px'>"
        "Uso interno para qualificação de oportunidades. Sem contato ativo com as partes "
        "(vedação de captação — OAB Prov. 205/2021). Acesse o painel para os detalhes.</p>"
        "</div>"
    )


def send_daily_digest(db: Session) -> dict:
    recipients = [r.strip() for r in (settings.DIGEST_TO or "").split(",") if r.strip()]
    if not (settings.SMTP_HOST and settings.SMTP_FROM and recipients):
        return {"sent": False, "reason": "SMTP/destinatários não configurados"}

    leads = collect_digest_leads(db)
    if not leads:
        return {"sent": False, "reason": "nada relevante", "count": 0}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"TCU Leads — {len(leads)} nova(s) oportunidade(s)"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(build_email_html(leads), "html", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
            server.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, recipients, msg.as_string())
        logger.info(f"Resumo diário enviado a {len(recipients)} destinatário(s): {len(leads)} leads")
        return {"sent": True, "count": len(leads), "recipients": len(recipients)}
    except Exception as e:
        logger.error(f"Falha ao enviar resumo: {e}")
        return {"sent": False, "reason": str(e)}
