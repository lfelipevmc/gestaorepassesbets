"""Relatório de Atividades do Ciclo de Cobrança (PDF).

Apresenta o panorama do mês de trabalho: notificações enviadas, respostas recebidas,
contatos realizados, valores apurados e recebidos, e situação de cada agente operador.
A redação evidencia, de forma subliminar (sem afirmações autoelogiosas), o esforço
operacional do escritório — listando as diligências efetivamente realizadas.
"""
import io
from datetime import datetime, date
from sqlalchemy.orm import Session
from ..models.confederation import Confederation
from ..models.collection import CollectionCycle, CollectionEvent, EventType
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator
from ..models.messaging import EmailMessage, EmailDirection


MESES = ["", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
         "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

STATUS_PT = {
    "paid": "Adimplente", "report_pending": "Pago (aguarda relatório)",
    "pending": "Pendente", "overdue": "Inadimplente", "partial": "Parcial",
    "not_sports": "Não explora esporte", "judicialized": "Judicializado",
}

EVENT_PT = {
    "notification_sent": "Notificação enviada",
    "email_read": "Resposta recebida",
    "phone_contact": "Contato telefônico",
    "payment_confirmed": "Repasse confirmado",
    "report_received": "Relatório recebido",
    "report_requested": "Relatório solicitado",
    "manual_note": "Anotação",
    "check_performed": "Verificação realizada",
    "payment_unconfirmed": "Repasse estornado",
}


def _brl(v):
    return ("R$ {:,.2f}".format(float(v or 0))).replace(",", "X").replace(".", ",").replace("X", ".")


def generate_cycle_activity_pdf(db: Session, cycle_id: int) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    cycle = db.query(CollectionCycle).get(cycle_id)
    conf = db.query(Confederation).get(cycle.confederation_id)
    ref = cycle.reference_month
    mes_ano = f"{MESES[ref.month]} de {ref.year}"

    # Dados do escritório (cabeçalho)
    try:
        from ..models.office import OfficeSettings
        office = db.query(OfficeSettings).first()
    except Exception:
        office = None

    styles = getSampleStyleSheet()
    h1 = styles["Title"]
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#1e293b"))
    normal = styles["Normal"]
    small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=7, leading=9)
    meta = ParagraphStyle("meta", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#475569"))

    payments = db.query(Payment).filter(Payment.cycle_id == cycle_id).all()
    op_ids = [p.operator_id for p in payments]
    op_map = {o.id: o for o in db.query(BettingOperator).filter(BettingOperator.id.in_(op_ids)).all()} if op_ids else {}

    events = db.query(CollectionEvent).filter(CollectionEvent.cycle_id == cycle_id).order_by(CollectionEvent.performed_at).all()
    emails = db.query(EmailMessage).filter(EmailMessage.cycle_id == cycle_id).all()

    total = len(payments)
    adimplentes = len([p for p in payments if p.status in (PaymentStatus.paid, PaymentStatus.report_pending)])
    inadimplentes = len([p for p in payments if p.status == PaymentStatus.overdue])
    pendentes = len([p for p in payments if p.status == PaymentStatus.pending])
    not_sports = len([p for p in payments if p.status == PaymentStatus.not_sports])
    judicial = len([p for p in payments if p.status == PaymentStatus.judicialized])
    total_recebido = sum(float(p.amount_paid or 0) for p in payments)

    notif_sent = len([e for e in events if e.event_type == EventType.notification_sent])
    phone_contacts = len([e for e in events if e.event_type == EventType.phone_contact])
    replies = len([m for m in emails if (m.direction == EmailDirection.inbound or m.direction == "inbound")])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.2 * cm, bottomMargin=1.2 * cm, leftMargin=1.5 * cm, rightMargin=1.5 * cm)
    el = []

    el.append(Paragraph("Relatório de Atividades — Cobrança de Contrapartidas", h1))
    el.append(Paragraph(f"{conf.name} ({conf.acronym}) · Competência: <b>{mes_ano}</b>", meta))
    if office and office.name:
        el.append(Paragraph(f"Elaborado por {office.name}" + (f" · {office.city}" if office.city else "") +
                            f" · {datetime.now().strftime('%d/%m/%Y')}", meta))
    el.append(Spacer(1, 0.3 * cm))
    el.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cbd5e1")))
    el.append(Spacer(1, 0.3 * cm))

    # Texto introdutório (evidência subliminar do trabalho)
    el.append(Paragraph(
        f"No período de competência de {mes_ano}, foram acompanhados <b>{total}</b> agentes operadores "
        f"em relação às contrapartidas devidas à {conf.acronym}. Ao longo do ciclo, realizaram-se "
        f"<b>{notif_sent}</b> notificação(ões) formal(is), <b>{phone_contacts}</b> contato(s) telefônico(s) "
        f"e o acompanhamento de <b>{replies}</b> resposta(s) recebida(s), com conciliação individualizada "
        f"de cada repasse e do respectivo relatório de apuração.", normal))
    el.append(Spacer(1, 0.3 * cm))

    # Indicadores
    el.append(Paragraph("Indicadores do ciclo", h2))
    ind = [
        ["Agentes acompanhados", str(total), "Adimplentes", str(adimplentes)],
        ["Inadimplentes", str(inadimplentes), "Pendentes", str(pendentes)],
        ["Não exploram esporte", str(not_sports), "Judicializados", str(judicial)],
        ["Notificações enviadas", str(notif_sent), "Contatos telefônicos", str(phone_contacts)],
        ["Respostas recebidas", str(replies), "Total recebido", _brl(total_recebido)],
    ]
    t = Table(ind, colWidths=[4.5 * cm, 3.5 * cm, 4.5 * cm, 3.5 * cm])
    t.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#f1f5f9")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    el.append(t)
    el.append(Spacer(1, 0.4 * cm))

    # Situação por agente operador
    el.append(Paragraph("Situação por agente operador", h2))
    rows = [["Agente Operador", "Situação", "Valor devido", "Recebido", "Relatório"]]
    for p in payments:
        op = op_map.get(p.operator_id)
        rows.append([
            Paragraph((op.fantasy_name or op.company_name if op else f"#{p.operator_id}")[:45], small),
            STATUS_PT.get(getattr(p.status, "value", ""), getattr(p.status, "value", "—")),
            _brl(p.amount_due) if p.amount_due else "—",
            _brl(p.amount_paid) if p.amount_paid else "—",
            "Sim" if p.report_received else "Não",
        ])
    t2 = Table(rows, colWidths=[6.5 * cm, 3.2 * cm, 3 * cm, 3 * cm, 1.8 * cm], repeatRows=1)
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
    ]))
    el.append(t2)
    el.append(Spacer(1, 0.4 * cm))

    # Linha do tempo das diligências
    el.append(Paragraph("Diligências realizadas no período", h2))
    if events:
        ev_rows = [["Data", "Agente Operador", "Diligência", "Canal", "Observações"]]
        for e in events:
            op = op_map.get(e.operator_id)
            ev_rows.append([
                e.performed_at.strftime("%d/%m/%Y %H:%M") if e.performed_at else "—",
                Paragraph((op.fantasy_name or op.company_name if op else f"#{e.operator_id}")[:32], small),
                EVENT_PT.get(getattr(e.event_type, "value", ""), getattr(e.event_type, "value", "—")),
                getattr(e.channel, "value", str(e.channel or "—")),
                Paragraph((e.notes or "")[:70], small),
            ])
        t3 = Table(ev_rows, colWidths=[2.6 * cm, 3.6 * cm, 3.2 * cm, 1.8 * cm, 6.3 * cm], repeatRows=1)
        t3.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]))
        el.append(t3)
    else:
        el.append(Paragraph("Nenhuma diligência registrada neste ciclo.", meta))

    el.append(Spacer(1, 0.5 * cm))
    el.append(Paragraph(
        "Documento gerado automaticamente a partir dos registros do sistema de gestão de repasses, "
        "preservando a rastreabilidade de cada diligência realizada.", meta))

    doc.build(el)
    buf.seek(0)
    return buf.read()
