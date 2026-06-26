"""Relatório de Evidências Mensal (ISO 9001).

Consolida em um único PDF, para um mês de competência, todas as evidências do ciclo de
cobrança e repasse: notificações enviadas, respostas recebidas, valores declarados/recebidos,
relatórios de GGR e repartições aos beneficiários. Serve como 'dossiê do mês' para auditoria.
"""
import io
from datetime import datetime, date
from sqlalchemy.orm import Session
from ..models.confederation import Confederation
from ..models.collection import CollectionCycle, CollectionEvent
from ..models.payment import Payment, PaymentStatus, DirectPayment
from ..models.operator import BettingOperator
from ..models.redistribution import Redistribution, RedistributionItem, ItemStatus
from ..models.messaging import EmailMessage, EmailDirection


STATUS_PT = {
    "paid": "Adimplente", "report_pending": "Pago (aguarda relatório)",
    "pending": "Pendente", "overdue": "Inadimplente", "partial": "Parcial",
}


def _brl(v):
    return ("R$ {:,.2f}".format(float(v or 0))).replace(",", "X").replace(".", ",").replace("X", ".")


def generate_evidence_pdf(db: Session, month: date, confederation_id=None) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

    styles = getSampleStyleSheet()
    h1 = styles["Title"]
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=12, spaceBefore=10, spaceAfter=4, textColor=colors.HexColor("#1e293b"))
    normal = styles["Normal"]
    small = ParagraphStyle("small", parent=styles["BodyText"], fontSize=7, leading=9)
    meta = ParagraphStyle("meta", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#475569"))

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.2*cm, bottomMargin=1.2*cm, leftMargin=1.5*cm, rightMargin=1.5*cm)

    confs = db.query(Confederation)
    if confederation_id:
        confs = confs.filter(Confederation.id == confederation_id)
    confs = confs.all()

    el = []
    el.append(Paragraph("Relatório de Evidências — Gestão de Repasses", h1))
    el.append(Paragraph(
        f"Mês de competência: <b>{month.strftime('%m/%Y')}</b> · "
        f"Documento gerado em {datetime.now().strftime('%d/%m/%Y às %H:%M')}", meta))
    el.append(Paragraph(
        "Este documento consolida as evidências do processo de cobrança e repasse para fins de "
        "controle de qualidade e rastreabilidade (ISO 9001 — 7.5 Informação documentada / 8.5 Produção e "
        "provisão de serviço).", meta))
    el.append(Spacer(1, 0.3*cm))
    el.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cbd5e1")))

    def table(data, col_widths, header=True):
        t = Table(data, colWidths=col_widths, repeatRows=1 if header else 0)
        style = [
            ("FONTSIZE", (0, 0), (-1, -1), 7),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ]
        if header:
            style += [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ]
        t.setStyle(TableStyle(style))
        return t

    for conf in confs:
        el.append(Spacer(1, 0.4*cm))
        el.append(Paragraph(f"{conf.acronym} — {conf.name}", h2))

        cycles = db.query(CollectionCycle).filter(
            CollectionCycle.confederation_id == conf.id,
            CollectionCycle.reference_month == month,
        ).all()
        cycle_ids = [c.id for c in cycles]

        # --- 1. Resumo de cobrança ---
        payments = db.query(Payment).filter(Payment.cycle_id.in_(cycle_ids)).all() if cycle_ids else []
        directs = db.query(DirectPayment).filter(
            DirectPayment.confederation_id == conf.id,
            DirectPayment.reference_month == month,
        ).all()
        total_recebido = sum(float(p.amount_paid or 0) for p in payments) + sum(float(d.amount_received or 0) for d in directs)
        adimplentes = len([p for p in payments if p.status in (PaymentStatus.paid, PaymentStatus.report_pending)])
        inadimplentes = len([p for p in payments if p.status == PaymentStatus.overdue])

        el.append(Paragraph(
            f"<b>1. Resumo da cobrança</b> — Ciclos: {len(cycles)} · Cobranças emitidas: {len(payments)} · "
            f"Adimplentes: {adimplentes} · Inadimplentes: {inadimplentes} · "
            f"Lançamentos avulsos: {len(directs)} · Total recebido no mês: <b>{_brl(total_recebido)}</b>", normal))
        el.append(Spacer(1, 0.2*cm))

        # --- 2. Notificações enviadas (eventos do ciclo) ---
        events = []
        if cycle_ids:
            events = db.query(CollectionEvent).filter(
                CollectionEvent.cycle_id.in_(cycle_ids)
            ).order_by(CollectionEvent.created_at).all()
        notif_rows = [["Data", "Bet", "Tipo de evento", "Canal", "Observações"]]
        op_cache = {}
        def op_name(oid):
            if oid not in op_cache:
                o = db.query(BettingOperator).get(oid) if oid else None
                op_cache[oid] = (o.fantasy_name or o.company_name) if o else "—"
            return op_cache[oid]
        for ev in events:
            notif_rows.append([
                ev.created_at.strftime("%d/%m/%Y %H:%M") if ev.created_at else "—",
                Paragraph(op_name(ev.operator_id)[:40], small),
                getattr(ev.event_type, "value", str(ev.event_type or "—")),
                getattr(ev.channel, "value", str(ev.channel or "—")),
                Paragraph((ev.notes or "")[:80], small),
            ])
        el.append(Paragraph("<b>2. Notificações e eventos registrados</b>", normal))
        if len(notif_rows) > 1:
            el.append(table(notif_rows, [2.6*cm, 4*cm, 3.2*cm, 2*cm, 6*cm]))
        else:
            el.append(Paragraph("Nenhum evento de notificação registrado neste mês.", meta))
        el.append(Spacer(1, 0.2*cm))

        # --- 3. Respostas recebidas ---
        replies = db.query(EmailMessage).filter(
            EmailMessage.direction == EmailDirection.inbound,
            EmailMessage.cycle_id.in_(cycle_ids) if cycle_ids else False,
        ).all() if cycle_ids else []
        el.append(Paragraph("<b>3. Respostas recebidas das Bets</b>", normal))
        if replies:
            rep_rows = [["Recebido", "De", "Assunto", "Vinculada"]]
            for r in replies:
                rep_rows.append([
                    r.received_at.strftime("%d/%m/%Y") if r.received_at else "—",
                    Paragraph((r.from_addr or "—")[:40], small),
                    Paragraph((r.subject or "—")[:50], small),
                    "Sim" if r.matched else "Não",
                ])
            el.append(table(rep_rows, [2.4*cm, 5*cm, 7.4*cm, 2*cm]))
        else:
            el.append(Paragraph("Nenhuma resposta vinculada a este ciclo.", meta))
        el.append(Spacer(1, 0.2*cm))

        # --- 4. Valores declarados vs. recebidos ---
        el.append(Paragraph("<b>4. Valores declarados x recebidos</b>", normal))
        val_rows = [["Bet", "Situação", "Devido", "Recebido", "Relatório GGR"]]
        for p in payments:
            val_rows.append([
                Paragraph(op_name(p.operator_id)[:40], small),
                STATUS_PT.get(getattr(p.status, "value", ""), getattr(p.status, "value", "—")),
                _brl(p.amount_due), _brl(p.amount_paid),
                "Recebido" if p.report_received else "Pendente",
            ])
        for d in directs:
            val_rows.append([
                Paragraph(op_name(d.operator_id)[:40] + " (avulso)", small),
                "Recebido", "—", _brl(d.amount_received),
                "Recebido" if d.report_file_url else "Pendente",
            ])
        if len(val_rows) > 1:
            el.append(table(val_rows, [5.4*cm, 3.4*cm, 3*cm, 3*cm, 2.6*cm]))
        else:
            el.append(Paragraph("Nenhuma cobrança ou recebimento neste mês.", meta))
        el.append(Spacer(1, 0.2*cm))

        # --- 5. Repartições aos beneficiários (Fase 2) ---
        redis = db.query(Redistribution).filter(
            Redistribution.confederation_id == conf.id,
            Redistribution.reference_month == month,
        ).all()
        el.append(Paragraph("<b>5. Repartições aos beneficiários (Fase 2)</b>", normal))
        if redis:
            for r in redis:
                el.append(Paragraph(
                    f"Repartição #{r.id} · {r.competition_name or 'Geral'} · Recebido {_brl(r.amount_received)} em "
                    f"{r.received_date.strftime('%d/%m/%Y') if r.received_date else '—'} · "
                    f"Prazo: {r.deadline_date.strftime('%d/%m/%Y') if r.deadline_date else '—'}", meta))
                items = db.query(RedistributionItem).filter(RedistributionItem.redistribution_id == r.id).all()
                if items:
                    it_rows = [["Beneficiário", "Categoria", "Valor", "Situação", "Pago em"]]
                    for it in items:
                        it_rows.append([
                            Paragraph((it.beneficiary_label or "—")[:40], small),
                            it.category or "—", _brl(it.amount),
                            "Repassado" if it.status == ItemStatus.paid else "Pendente",
                            it.paid_date.strftime("%d/%m/%Y") if it.paid_date else "—",
                        ])
                    el.append(table(it_rows, [5.4*cm, 3*cm, 3*cm, 2.6*cm, 3.4*cm]))
                el.append(Spacer(1, 0.15*cm))
        else:
            el.append(Paragraph("Nenhuma repartição registrada para este mês.", meta))

        el.append(Spacer(1, 0.2*cm))
        el.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0")))

    el.append(Spacer(1, 0.5*cm))
    el.append(Paragraph(
        "Documento gerado automaticamente pelo sistema de Gestão de Haveres de Bets. "
        "As evidências aqui consolidadas têm origem nos registros de auditoria e nos documentos "
        "anexados ao sistema, preservando a rastreabilidade exigida pela norma ISO 9001.", meta))

    doc.build(el)
    buf.seek(0)
    return buf.read()
