"""Relatório de Monitoramento em PDF — espelho da aba 📽 Apresentação.

Gerado a partir do MESMO agregador da tela (confederation_presentation),
garantindo que reunião e relatório mostrem números idênticos.
"""
import io
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

NAVY = colors.HexColor("#13294b")
BLUE = colors.HexColor("#3987e5")    # repasses diretos
GREEN = colors.HexColor("#199e70")   # ENDR
RED = colors.HexColor("#e66767")
GRID = colors.HexColor("#c9d2df")
MUTED = colors.HexColor("#5b6675")
HEADBG = colors.HexColor("#eef1f6")


def _brl(v):
    try:
        return "R$ {:,.2f}".format(float(v or 0)).replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "—"


def _styles():
    ss = getSampleStyleSheet()
    return {
        "h1": ParagraphStyle("ap_h1", parent=ss["Heading1"], fontSize=14, leading=17, textColor=NAVY, spaceAfter=1),
        "h2": ParagraphStyle("ap_h2", parent=ss["Heading2"], fontSize=10.5, leading=13, textColor=NAVY,
                             spaceBefore=8, spaceAfter=3),
        "meta": ParagraphStyle("ap_meta", parent=ss["Normal"], fontSize=8.5, leading=11),
        "small": ParagraphStyle("ap_small", parent=ss["Normal"], fontSize=7.5, leading=9.5, textColor=MUTED),
        "big": ParagraphStyle("ap_big", parent=ss["Normal"], fontSize=12, leading=14, textColor=NAVY,
                              fontName="Helvetica-Bold"),
    }


def _table(rows, widths, header=True, font=8.5):
    t = Table(rows, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("FONTSIZE", (0, 0), (-1, -1), font),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]
    if header:
        style.append(("BACKGROUND", (0, 0), (-1, 0), HEADBG))
        style.append(("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"))
    t.setStyle(TableStyle(style))
    return t


def _bar(direto, endr, vmax, width=5.2 * cm, height=0.28 * cm):
    """Barra horizontal empilhada (direto=azul, ENDR=verde) escalada por vmax."""
    d = Drawing(width, height)
    total = (direto or 0) + (endr or 0)
    if vmax <= 0 or total <= 0:
        return d
    w1 = width * (direto or 0) / vmax
    w2 = width * (endr or 0) / vmax
    if w1 > 0.5:
        d.add(Rect(0, 0, w1, height, fillColor=BLUE, strokeColor=None))
    if w2 > 0.5:
        d.add(Rect(w1 + (1 if w1 > 0.5 else 0), 0, max(w2 - 1, 0.5), height, fillColor=GREEN, strokeColor=None))
    return d


def generate_presentation_pdf(db, data: dict, logo_office=True, logo_conf=True) -> bytes:
    from .report_service import logo_header_flowables

    st = _styles()
    s = data["summary"]
    story = []
    story += logo_header_flowables(db, include_office=logo_office,
                                   confederation_id=data["confederation"]["id"] if logo_conf else None)
    story.append(Paragraph(f"RELATÓRIO DE MONITORAMENTO — {data['confederation']['acronym']}", st["h1"]))
    story.append(Paragraph(
        f"{data['confederation']['name']} · Competência {data['month_label']} · "
        f"Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')} · Fonte única: base central do sistema.",
        st["small"]))
    story.append(Spacer(1, 0.25 * cm))

    # 1. Resumo executivo
    story.append(Paragraph("1. Resumo Executivo", st["h2"]))
    resumo = [
        [Paragraph("<b>Total recebido (acumulado)</b>", st["meta"]), Paragraph(_brl(s["total_acumulado"]), st["big"]),
         Paragraph(f"Direto: {_brl(s['acumulado_direto'])}<br/>via ENDR: {_brl(s['acumulado_endr'])}", st["small"])],
        [Paragraph(f"<b>Recebido em {data['month_label']}</b>", st["meta"]), Paragraph(_brl(s["recebido_mes"]), st["big"]),
         Paragraph(f"Direto: {_brl(s['recebido_mes_direto'])}<br/>via ENDR: {_brl(s['recebido_mes_endr'])}", st["small"])],
        [Paragraph("<b>Conformidade no mês</b>", st["meta"]),
         Paragraph(f"{s['taxa_conformidade']}%", st["big"]),
         Paragraph(f"{s['em_conformidade']} de {s['bets_total']} bets em conformidade · "
                   f"{s['counts'].get('inadimplente', 0)} inadimplente(s)", st["small"])],
    ]
    story.append(_table(resumo, [4.6 * cm, 4.2 * cm, 7.7 * cm], header=False))

    c = s["counts"]
    lab = s.get("labels", {})
    story.append(Spacer(1, 0.12 * cm))
    story.append(Paragraph(
        " · ".join(f"{lab.get(k, k)}: <b>{v}</b>" for k, v in c.items()), st["meta"]))

    # 2. Trabalho desenvolvido
    t = data["trabalho"]
    story.append(Paragraph("2. Trabalho Desenvolvido pelo Escritório", st["h2"]))
    story.append(_table([
        [Paragraph("<b>Notificações enviadas</b>", st["meta"]), Paragraph("<b>Respostas recebidas</b>", st["meta"]),
         Paragraph("<b>Ofícios à SPA</b>", st["meta"]), Paragraph("<b>Relatórios anexados</b>", st["meta"])],
        [Paragraph(f"{t['notificacoes_total']} no total · {t['notificacoes_mes']} no mês", st["meta"]),
         Paragraph(f"{t['respostas_total']} no total · {t['respostas_mes']} no mês", st["meta"]),
         Paragraph(str(t["oficios_spa"]), st["meta"]),
         Paragraph(str(t["relatorios_anexados"]), st["meta"])],
    ], [4.2 * cm, 4.6 * cm, 3.5 * cm, 4.2 * cm]))

    # 3. Recebimentos — evolução 12 meses
    story.append(Paragraph("3. Recebimentos — Evolução Mensal (repasses diretos ■ azul · via ENDR ■ verde)", st["h2"]))
    vmax = max([(mo["direto"] + mo["endr"]) for mo in data["monthly"]] + [1])
    rows = [[Paragraph("<b>Mês</b>", st["meta"]), Paragraph("<b>Direto</b>", st["meta"]),
             Paragraph("<b>ENDR</b>", st["meta"]), Paragraph("<b>Total</b>", st["meta"]), ""]]
    for mo in data["monthly"]:
        rows.append([Paragraph(mo["label"], st["meta"]), Paragraph(_brl(mo["direto"]), st["meta"]),
                     Paragraph(_brl(mo["endr"]), st["meta"]),
                     Paragraph(f"<b>{_brl(mo['direto'] + mo['endr'])}</b>", st["meta"]),
                     _bar(mo["direto"], mo["endr"], vmax)])
    story.append(_table(rows, [1.7 * cm, 3.1 * cm, 3.1 * cm, 3.3 * cm, 5.4 * cm]))

    # Recebimentos do mês
    if data["recebimentos_mes"]:
        story.append(Paragraph(f"Recebimentos individualizados em {data['month_label']}", st["h2"]))
        rrows = [[Paragraph("<b>Agente Operador</b>", st["meta"]), Paragraph("<b>Valor</b>", st["meta"]),
                  Paragraph("<b>Último pagamento</b>", st["meta"]), Paragraph("<b>Relatório</b>", st["meta"])]]
        for r in data["recebimentos_mes"][:25]:
            dt = r["last_date"]
            rrows.append([Paragraph(r["label"], st["meta"]), Paragraph(_brl(r["total"]), st["meta"]),
                          Paragraph(f"{dt[8:10]}/{dt[5:7]}/{dt[:4]}" if dt else "—", st["meta"]),
                          Paragraph("Sim" if r["report_url"] else "—", st["meta"])])
        story.append(_table(rrows, [7.5 * cm, 3.3 * cm, 3.2 * cm, 2.5 * cm]))

    # 4. ENDR
    e = data["endr"]
    story.append(Paragraph("4. Repasses via ENDR", st["h2"]))
    story.append(Paragraph(
        f"Total repassado: <b>{_brl(e['total'])}</b> em {e['count']} repasse(s) · "
        f"{e['associadas_mes']} bet(s) associadas no mês · "
        f"{e['pendentes_relatorio']} repasse(s) aguardando relatório de detalhamento.", st["meta"]))
    if e["ultimos"]:
        erows = [[Paragraph("<b>Recebido em</b>", st["meta"]), Paragraph("<b>Valor</b>", st["meta"]),
                  Paragraph("<b>Competência</b>", st["meta"]), Paragraph("<b>Bets</b>", st["meta"]),
                  Paragraph("<b>Relatório</b>", st["meta"])]]
        for r in e["ultimos"]:
            dt = r["received_date"]
            erows.append([Paragraph(f"{dt[8:10]}/{dt[5:7]}/{dt[:4]}" if dt else "—", st["meta"]),
                          Paragraph(_brl(r["amount"]), st["meta"]),
                          Paragraph(r["competencia"], st["meta"]),
                          Paragraph(str(r["bets"] or "—"), st["meta"]),
                          Paragraph("Sim" if r["report_url"] else "Pendente", st["meta"])])
        story.append(_table(erows, [2.8 * cm, 3.3 * cm, 4.2 * cm, 2.0 * cm, 4.2 * cm]))

    # 5. Pendências
    story.append(Paragraph(f"5. Pendências — Inadimplentes em {data['month_label']}", st["h2"]))
    if not data["pendencias"]:
        story.append(Paragraph("Nenhuma bet inadimplente na competência. ✔", st["meta"]))
    else:
        prow = [[Paragraph("<b>Agente Operador</b>", st["meta"]), Paragraph("<b>Valor declarado</b>", st["meta"]),
                 Paragraph("<b>Notificações</b>", st["meta"]), Paragraph("<b>Última notificação</b>", st["meta"]),
                 Paragraph("<b>Resposta</b>", st["meta"])]]
        for p in data["pendencias"]:
            dt = p["last_notification_at"]
            prow.append([Paragraph(p["label"], st["meta"]),
                         Paragraph(_brl(p["amount_due"]) if p["amount_due"] else "—", st["meta"]),
                         Paragraph(str(p["notif_count"]), st["meta"]),
                         Paragraph(f"{dt[8:10]}/{dt[5:7]}/{dt[:4]}" if dt else "—", st["meta"]),
                         Paragraph("Respondeu" if p["replied"] else "Sem resposta", st["meta"])])
        story.append(_table(prow, [6.0 * cm, 3.0 * cm, 2.2 * cm, 2.8 * cm, 2.5 * cm]))

    # 6. Próximos passos
    p6 = data["proximos"]
    story.append(Paragraph("6. Próximos Passos", st["h2"]))
    if p6["cronograma"]:
        crow = [[Paragraph("<b>Etapa do ciclo</b>", st["meta"]), Paragraph("<b>Prazo</b>", st["meta"])]]
        for cta in p6["cronograma"]:
            dt = cta["due"]
            crow.append([Paragraph(cta["label"], st["meta"]),
                         Paragraph(f"{dt[8:10]}/{dt[5:7]}/{dt[:4]}" if dt else "—", st["meta"])])
        story.append(_table(crow, [12.5 * cm, 4.0 * cm]))
    if p6["next_steps"]:
        story.append(Spacer(1, 0.12 * cm))
        story.append(Paragraph("<b>Encaminhamentos combinados</b>", st["meta"]))
        txt = p6["next_steps"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
        bt = Table([[Paragraph(txt, st["meta"])]], colWidths=[16.5 * cm])
        bt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, GRID),
                                ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                                ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        story.append(bt)

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.4 * cm, rightMargin=1.4 * cm,
                      topMargin=1.1 * cm, bottomMargin=1.1 * cm).build(story)
    return buf.getvalue()
