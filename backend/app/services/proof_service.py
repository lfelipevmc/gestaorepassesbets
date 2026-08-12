"""Comprovantes de envio de notificação em PDF.

- Comprovante individual COMPACTO (1 página): cabeçalho com a logomarca do
  escritório, protocolo em destaque, quadro de metadados e o texto enviado.
- Comprovantes consolidados do ciclo, em dois formatos:
    * mode="list": lista de todos os envios (protocolo, operador, destinatários,
      data/hora) + o texto padrão da notificação impresso uma única vez;
    * mode="full": todos os comprovantes individuais completos, um por página,
      reunidos sequencialmente em um único arquivo.
"""
import io
import re
from datetime import datetime

from sqlalchemy.orm import Session
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
)

from ..models.messaging import EmailMessage, EmailDirection
from ..models.collection import CollectionCycle
from ..models.confederation import Confederation
from ..models.operator import BettingOperator

NAVY = colors.HexColor("#13294b")
GRID = colors.HexColor("#c9d2df")
MUTED = colors.HexColor("#5b6675")


def _styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("pf_title", parent=ss["Heading1"], fontSize=13, leading=16,
                                textColor=NAVY, spaceAfter=2),
        "small": ParagraphStyle("pf_small", parent=ss["Normal"], fontSize=7.5, leading=9.5,
                                textColor=MUTED),
        "meta": ParagraphStyle("pf_meta", parent=ss["Normal"], fontSize=8.5, leading=11),
        "body": ParagraphStyle("pf_body", parent=ss["Normal"], fontSize=8, leading=10.5),
        "proto": ParagraphStyle("pf_proto", parent=ss["Normal"], fontSize=10, leading=13,
                                textColor=NAVY, fontName="Helvetica-Bold"),
    }


def _clean_body(text: str) -> str:
    """Corpo enviado sem tags HTML (ex.: a logomarca inline), pronto para Paragraph."""
    t = text or ""
    t = re.sub(r"<img[^>]*>", "[logomarca do escritório]", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return t.replace("\n", "<br/>")


def _operator_label(op) -> str:
    if not op:
        return "—"
    return op.fantasy_name or op.company_name or f"Operador #{op.id}"


def _proof_story(db: Session, em: EmailMessage, cycle, conf, st, include_body=True):
    """Flowables de UM comprovante compacto (cabe em 1 página A4)."""
    from .report_service import logo_header_flowables

    op = db.query(BettingOperator).get(em.operator_id) if em.operator_id else None
    story = []
    story += logo_header_flowables(db, include_office=True)
    story.append(Paragraph("COMPROVANTE DE ENVIO DE NOTIFICAÇÃO", st["title"]))
    story.append(Paragraph(
        "Documento gerado pelo sistema de Gestão de Haveres de Bets — registro auditável do envio.",
        st["small"]))
    story.append(Spacer(1, 0.25 * cm))
    if em.protocol:
        story.append(Paragraph(f"Protocolo: {em.protocol}", st["proto"]))
        story.append(Spacer(1, 0.15 * cm))

    razao = op.company_name if op and op.company_name else None
    rows = [
        ["Agente Operador", _operator_label(op) + (f" — {razao}" if razao and razao != _operator_label(op) else "")],
        ["CNPJ", (op.cnpj if op and op.cnpj else "—")],
        ["Confederação", f"{conf.acronym} — {conf.name}" if conf else "—"],
        ["Competência", cycle.reference_month.strftime("%m/%Y") if cycle and cycle.reference_month else "—"],
        ["Destinatários", em.to_addr or "—"],
        ["Enviado em", em.sent_at.strftime("%d/%m/%Y %H:%M") if em.sent_at else "—"],
        ["Assunto", em.subject or "(sem assunto)"],
    ]
    t = Table([[Paragraph(f"<b>{k}</b>", st["meta"]), Paragraph(str(v), st["meta"])] for k, v in rows],
              colWidths=[3.2 * cm, 13.3 * cm])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef1f6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    story.append(t)

    if include_body:
        story.append(Spacer(1, 0.25 * cm))
        story.append(Paragraph("<b>Conteúdo enviado</b>", st["meta"]))
        story.append(Spacer(1, 0.08 * cm))
        bt = Table([[Paragraph(_clean_body(em.body_preview), st["body"])]], colWidths=[16.5 * cm])
        bt.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(bt)

    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(
        f"Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')} · O envio fica registrado na auditoria do sistema "
        "com o usuário que autorizou o disparo (autorização por e-mail e senha).", st["small"]))
    return story


def _doc(buf):
    return SimpleDocTemplate(buf, pagesize=A4,
                             leftMargin=1.4 * cm, rightMargin=1.4 * cm,
                             topMargin=1.1 * cm, bottomMargin=1.1 * cm)


def generate_email_proof_pdf(db: Session, cycle_id: int, email_id: int) -> bytes:
    """Comprovante individual — 1 página."""
    em = db.query(EmailMessage).filter(EmailMessage.id == email_id, EmailMessage.cycle_id == cycle_id).first()
    if not em:
        return b""
    cycle = db.query(CollectionCycle).get(cycle_id)
    conf = db.query(Confederation).get(cycle.confederation_id) if cycle else None
    st = _styles()
    buf = io.BytesIO()
    _doc(buf).build(_proof_story(db, em, cycle, conf, st))
    return buf.getvalue()


def generate_cycle_proofs_pdf(db: Session, cycle_id: int, mode: str = "list") -> bytes:
    """Comprovantes de TODOS os envios do ciclo em um único PDF (mode: list | full)."""
    from .report_service import logo_header_flowables

    cycle = db.query(CollectionCycle).get(cycle_id)
    conf = db.query(Confederation).get(cycle.confederation_id) if cycle else None
    emails = (db.query(EmailMessage)
              .filter(EmailMessage.cycle_id == cycle_id, EmailMessage.direction == EmailDirection.outbound)
              .order_by(EmailMessage.sent_at.asc(), EmailMessage.id.asc()).all())
    st = _styles()
    buf = io.BytesIO()

    if mode == "full":
        story = []
        for i, em in enumerate(emails):
            if i:
                story.append(PageBreak())
            story += _proof_story(db, em, cycle, conf, st)
        _doc(buf).build(story)
        return buf.getvalue()

    # mode == "list": consolidado em lista + texto padrão impresso uma única vez
    story = []
    story += logo_header_flowables(db, include_office=True)
    story.append(Paragraph("COMPROVANTE CONSOLIDADO DE ENVIO DE NOTIFICAÇÕES", st["title"]))
    ref = cycle.reference_month.strftime("%m/%Y") if cycle and cycle.reference_month else "—"
    story.append(Paragraph(
        f"Confederação: <b>{(conf.acronym + ' — ' + conf.name) if conf else '—'}</b> · Competência: <b>{ref}</b> · "
        f"{len(emails)} envio(s) registrado(s).", st["meta"]))
    story.append(Spacer(1, 0.3 * cm))

    header = [Paragraph(f"<b>{h}</b>", st["meta"]) for h in ["Protocolo", "Agente Operador", "Destinatários", "Enviado em"]]
    rows = [header]
    for em in emails:
        op = db.query(BettingOperator).get(em.operator_id) if em.operator_id else None
        rows.append([
            Paragraph(em.protocol or "—", st["meta"]),
            Paragraph(_operator_label(op), st["meta"]),
            Paragraph(em.to_addr or "—", st["small"]),
            Paragraph(em.sent_at.strftime("%d/%m/%Y %H:%M") if em.sent_at else "—", st["meta"]),
        ])
    t = Table(rows, colWidths=[3.4 * cm, 4.6 * cm, 6.0 * cm, 2.5 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef1f6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    story.append(t)

    if emails:
        story.append(Spacer(1, 0.35 * cm))
        story.append(Paragraph("<b>Texto padrão da notificação</b> (idêntico para todos os agentes, "
                               "personalizado apenas com o nome de cada Bet)", st["meta"]))
        story.append(Spacer(1, 0.08 * cm))
        ex = emails[0]
        story.append(Paragraph(f"<b>Assunto (exemplo):</b> {ex.subject or '(sem assunto)'}", st["body"]))
        story.append(Spacer(1, 0.08 * cm))
        bt = Table([[Paragraph(_clean_body(ex.body_preview), st["body"])]], colWidths=[16.5 * cm])
        bt.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.4, GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(bt)

    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(f"Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')}.", st["small"]))
    _doc(buf).build(story)
    return buf.getvalue()
