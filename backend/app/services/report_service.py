from sqlalchemy.orm import Session
from ..models.collection import CollectionCycle
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator
from ..models.confederation import Confederation
import io
from datetime import datetime


def get_compliance_report(db: Session, cycle_id: int) -> dict:
    cycle = db.query(CollectionCycle).get(cycle_id)
    if not cycle:
        return {}

    confederation = db.query(Confederation).get(cycle.confederation_id)
    payments = db.query(Payment).filter(Payment.cycle_id == cycle_id).all()

    # Adimplente = pagou E enviou relatório. report_pending = pagou mas relatório ainda pendente.
    paid = [p for p in payments if p.status == PaymentStatus.paid]
    report_pending = [p for p in payments if p.status == PaymentStatus.report_pending]
    overdue = [p for p in payments if p.status in [PaymentStatus.pending, PaymentStatus.overdue]]
    partial = [p for p in payments if p.status == PaymentStatus.partial]

    def payment_to_dict(p: Payment):
        op = db.query(BettingOperator).get(p.operator_id)
        return {
            "operator_id": op.id,
            "company_name": op.company_name,
            "fantasy_name": op.fantasy_name,
            "cnpj": op.cnpj,
            "status": p.status,
            "base_calculo": float(p.base_calculo) if p.base_calculo else None,
            "amount_due": float(p.amount_due) if p.amount_due else None,
            "amount_paid": float(p.amount_paid) if p.amount_paid else None,
            "payment_date": p.payment_date.isoformat() if p.payment_date else None,
            "report_received": bool(p.report_received),
            "report_reference_month": p.report_reference_month.isoformat() if p.report_reference_month else None,
            "payment_confirmed_at": p.payment_confirmed_at.isoformat() if p.payment_confirmed_at else None,
        }

    # Total recebido = regime de caixa (valor efetivamente recebido no ciclo)
    total_received = sum(float(p.amount_paid or 0) for p in payments)

    return {
        "cycle_id": cycle_id,
        "confederation": {"id": confederation.id, "name": confederation.name, "acronym": confederation.acronym},
        "reference_month": cycle.reference_month.strftime("%m/%Y"),
        "generated_at": datetime.now().isoformat(),
        "summary": {
            "total_operators": len(payments),
            "paid": len(paid),
            "report_pending": len(report_pending),
            "overdue": len(overdue),
            "partial": len(partial),
            "compliance_rate": round((len(paid) + len(report_pending)) / len(payments) * 100, 2) if payments else 0,
            "total_received_brl": total_received,
        },
        "compliant": [payment_to_dict(p) for p in paid],
        "report_pending_list": [payment_to_dict(p) for p in report_pending],
        "non_compliant": [payment_to_dict(p) for p in overdue],
        "partial": [payment_to_dict(p) for p in partial],
    }


STATUS_LABELS_PT = {
    "paid": "Adimplente",
    "report_pending": "Pendente de Relatório",
    "pending": "Inadimplente",
    "overdue": "Em Atraso",
    "partial": "Parcial",
}


def get_cross_report(db: Session, confederation_id=None, month=None, operator_id=None, status=None) -> dict:
    """Relatório cruzado e individualizado por confederação, mês e Bet, com filtros combináveis.

    - confederation_id: filtra por confederação
    - month: filtra pelo mês de referência do ciclo (date YYYY-MM-01)
    - operator_id: filtra por Bet (agente operador)
    - status: filtra por situação (paid / report_pending / pending / overdue / partial)
    """
    q = db.query(Payment).join(CollectionCycle, Payment.cycle_id == CollectionCycle.id)
    if confederation_id:
        q = q.filter(Payment.confederation_id == confederation_id)
    if operator_id:
        q = q.filter(Payment.operator_id == operator_id)
    if month:
        q = q.filter(CollectionCycle.reference_month == month)
    if status:
        q = q.filter(Payment.status == status)

    payments = q.all()

    # caches para evitar N+1 repetido
    op_cache, conf_cache, cycle_cache = {}, {}, {}

    def op(i):
        if i not in op_cache:
            op_cache[i] = db.query(BettingOperator).get(i)
        return op_cache[i]

    def conf(i):
        if i not in conf_cache:
            conf_cache[i] = db.query(Confederation).get(i)
        return conf_cache[i]

    def cyc(i):
        if i not in cycle_cache:
            cycle_cache[i] = db.query(CollectionCycle).get(i)
        return cycle_cache[i]

    rows = []
    for p in payments:
        o = op(p.operator_id)
        c = conf(p.confederation_id)
        cy = cyc(p.cycle_id)
        rows.append({
            "payment_id": p.id,
            "operator_id": p.operator_id,
            "company_name": o.company_name if o else "?",
            "fantasy_name": o.fantasy_name if o else None,
            "cnpj": o.cnpj if o else None,
            "confederation_id": p.confederation_id,
            "confederation_acronym": c.acronym if c else "?",
            "reference_month": cy.reference_month.strftime("%m/%Y") if cy and cy.reference_month else None,
            "reference_month_iso": cy.reference_month.isoformat() if cy and cy.reference_month else None,
            "status": p.status.value if hasattr(p.status, "value") else p.status,
            "status_label": STATUS_LABELS_PT.get(p.status.value if hasattr(p.status, "value") else p.status, p.status),
            "base_calculo": float(p.base_calculo) if p.base_calculo else 0.0,
            "amount_due": float(p.amount_due) if p.amount_due else 0.0,
            "amount_paid": float(p.amount_paid) if p.amount_paid else 0.0,
            "report_received": bool(p.report_received),
            "report_reference_month": p.report_reference_month.isoformat() if p.report_reference_month else None,
            "payment_date": p.payment_date.isoformat() if p.payment_date else None,
        })

    # ordena por confederação, mês, Bet
    rows.sort(key=lambda r: (r["confederation_acronym"], r["reference_month_iso"] or "", r["company_name"]))

    def _agg(group_key, label_key):
        groups = {}
        for r in rows:
            k = r[group_key]
            g = groups.setdefault(k, {label_key: r.get(label_key) or k, "count": 0,
                                       "amount_due": 0.0, "amount_paid": 0.0,
                                       "adimplentes": 0, "pendente_relatorio": 0, "inadimplentes": 0})
            g["count"] += 1
            g["amount_due"] += r["amount_due"]
            g["amount_paid"] += r["amount_paid"]
            if r["status"] == "paid":
                g["adimplentes"] += 1
            elif r["status"] == "report_pending":
                g["pendente_relatorio"] += 1
            elif r["status"] in ("pending", "overdue"):
                g["inadimplentes"] += 1
        return list(groups.values())

    totals = {
        "count": len(rows),
        "amount_due": sum(r["amount_due"] for r in rows),
        "amount_paid": sum(r["amount_paid"] for r in rows),
        "adimplentes": len([r for r in rows if r["status"] == "paid"]),
        "pendente_relatorio": len([r for r in rows if r["status"] == "report_pending"]),
        "inadimplentes": len([r for r in rows if r["status"] in ("pending", "overdue")]),
    }

    return {
        "rows": rows,
        "totals": totals,
        "by_confederation": _agg("confederation_acronym", "confederation_acronym"),
        "by_month": _agg("reference_month", "reference_month"),
    }


def generate_cross_excel(db: Session, confederation_id=None, month=None, operator_id=None, status=None) -> bytes:
    import pandas as pd
    rep = get_cross_report(db, confederation_id, month, operator_id, status)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        detail = [{
            "Confederação": r["confederation_acronym"],
            "Mês de Referência": r["reference_month"] or "",
            "Razão Social": r["company_name"],
            "Nome Fantasia": r["fantasy_name"] or "",
            "CNPJ": r["cnpj"] or "",
            "Situação": r["status_label"],
            "Base de Cálculo (R$)": r["base_calculo"],
            "Valor Devido (R$)": r["amount_due"],
            "Valor Recebido (R$)": r["amount_paid"],
            "Relatório Recebido": "Sim" if r["report_received"] else "Não",
            "Mês de Competência": r["report_reference_month"] or "",
            "Data Recebimento": r["payment_date"] or "",
        } for r in rep["rows"]]
        (pd.DataFrame(detail) if detail else pd.DataFrame(columns=["Confederação"])).to_excel(
            writer, sheet_name="Individualizado", index=False)

        by_conf = [{
            "Confederação": g["confederation_acronym"], "Qtd. Bets": g["count"],
            "Valor Devido (R$)": g["amount_due"], "Valor Recebido (R$)": g["amount_paid"],
            "Adimplentes": g["adimplentes"], "Pend. Relatório": g["pendente_relatorio"],
            "Inadimplentes": g["inadimplentes"],
        } for g in rep["by_confederation"]]
        (pd.DataFrame(by_conf) if by_conf else pd.DataFrame(columns=["Confederação"])).to_excel(
            writer, sheet_name="Por Confederação", index=False)

        by_month = [{
            "Mês de Referência": g["reference_month"], "Qtd. Bets": g["count"],
            "Valor Devido (R$)": g["amount_due"], "Valor Recebido (R$)": g["amount_paid"],
            "Adimplentes": g["adimplentes"], "Pend. Relatório": g["pendente_relatorio"],
            "Inadimplentes": g["inadimplentes"],
        } for g in rep["by_month"]]
        (pd.DataFrame(by_month) if by_month else pd.DataFrame(columns=["Mês de Referência"])).to_excel(
            writer, sheet_name="Por Mês", index=False)
    return output.getvalue()


def generate_excel_report(db: Session, cycle_id: int) -> bytes:
    import pandas as pd
    report = get_compliance_report(db, cycle_id)

    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        all_data = []
        for p in (report.get("compliant", []) + report.get("report_pending_list", [])
                  + report.get("non_compliant", []) + report.get("partial", [])):
            all_data.append({
                "Razão Social": p["company_name"],
                "Nome Fantasia": p["fantasy_name"] or "",
                "CNPJ": p["cnpj"] or "",
                "Status": {"paid": "Adimplente", "report_pending": "Pendente de Relatório", "pending": "Inadimplente", "overdue": "Em Atraso", "partial": "Parcial"}.get(p["status"], p["status"]),
                "Base de Cálculo (R$)": p["base_calculo"] or "",
                "Valor Devido (R$)": p["amount_due"] or "",
                "Valor Recebido (R$)": p["amount_paid"] or "",
                "Data Recebimento": p["payment_date"] or "",
                "Relatório Recebido": "Sim" if p["report_received"] else "Não",
                "Mês de Competência": p["report_reference_month"] or "",
            })

        df = pd.DataFrame(all_data)
        df.to_excel(writer, sheet_name="Relatório", index=False)

    return output.getvalue()


def generate_cross_pdf(db: Session, confederation_id=None, month=None, operator_id=None, status=None, logos: dict = None) -> bytes:
    """Gera o relatório consolidado/individualizado em PDF, respeitando os filtros aplicados."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    rep = get_cross_report(db, confederation_id, month, operator_id, status)
    rows = rep["rows"]
    totals = rep["totals"]

    def brl(v):
        return ("R$ {:,.2f}".format(v or 0)).replace(",", "X").replace(".", ",").replace("X", ".")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), topMargin=1*cm, bottomMargin=1*cm, leftMargin=1*cm, rightMargin=1*cm)
    styles = getSampleStyleSheet()
    small = styles["BodyText"]; small.fontSize = 7; small.leading = 9

    logos = logos or {}
    elements = logo_header_flowables(db, include_office=logos.get("office"),
                                     confederation_id=confederation_id if logos.get("confederation") else None,
                                     include_endr=logos.get("endr"))
    elements += [Paragraph("Relatório Consolidado de Repasses", styles["Title"])]
    filtros = []
    if confederation_id:
        c = db.query(Confederation).get(confederation_id)
        filtros.append(f"Confederação: {c.acronym if c else confederation_id}")
    if month: filtros.append(f"Mês: {month.strftime('%m/%Y')}")
    if operator_id:
        o = db.query(BettingOperator).get(operator_id)
        filtros.append(f"Bet: {(o.fantasy_name or o.company_name) if o else operator_id}")
    if status: filtros.append(f"Situação: {STATUS_LABELS_PT.get(getattr(status, 'value', status), status)}")
    elements.append(Paragraph("Filtros: " + (" · ".join(filtros) if filtros else "nenhum") +
                              f" — Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Normal"]))
    elements.append(Spacer(1, 0.3*cm))
    elements.append(Paragraph(
        f"Total de registros: {totals['count']} · Adimplentes: {totals['adimplentes']} · "
        f"Pend. relatório: {totals['pendente_relatorio']} · Inadimplentes: {totals['inadimplentes']} · "
        f"Recebido: {brl(totals['amount_paid'])}", styles["Normal"]))
    elements.append(Spacer(1, 0.4*cm))

    data = [["Confederação", "Mês", "Bet", "CNPJ", "Situação", "Devido", "Recebido", "Relatório"]]
    for r in rows:
        data.append([
            r["confederation_acronym"], r["reference_month"] or "—",
            Paragraph((r["fantasy_name"] or r["company_name"] or "")[:60], small),
            r["cnpj"] or "—", r["status_label"],
            brl(r["amount_due"]), brl(r["amount_paid"]),
            "Sim" if r["report_received"] else "Não",
        ])
    table = Table(data, colWidths=[2.5*cm, 1.8*cm, 7*cm, 3*cm, 3.2*cm, 3*cm, 3*cm, 2*cm], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
    ]))
    elements.append(table)
    doc.build(elements)
    buf.seek(0)
    return buf.getvalue()


def logo_header_flowables(db: Session, include_office=False, confederation_id=None, include_endr=False):
    """Linha de logomarcas no cabeçalho dos PDFs — escolhida pelo usuário no popup de geração.
    Bets: a logomarca é POR MARCA e aparece nos relatórios de listagem de operadores."""
    import os
    from reportlab.lib.units import cm
    from reportlab.platypus import Image, Table as _T, Spacer as _S

    urls = []
    if include_office:
        from ..models.office import OfficeSettings
        off = db.query(OfficeSettings).first()
        if off and off.logo_url:
            urls.append(off.logo_url)
    if confederation_id:
        c = db.query(Confederation).get(confederation_id)
        if c and getattr(c, "logo_url", None):
            urls.append(c.logo_url)
    if include_endr:
        from ..models.operator import ENDREntity
        e = db.query(ENDREntity).first()
        if e and getattr(e, "logo_url", None):
            urls.append(e.logo_url)

    imgs = []
    for u in urls:
        fp = ("/app" + u) if u.startswith("/uploads") else u
        if not os.path.exists(fp):
            continue
        try:
            img = Image(fp)
            ratio = (img.drawWidth / img.drawHeight) if img.drawHeight else 1
            img.drawHeight = 1.6 * cm
            img.drawWidth = min(5.5 * cm, 1.6 * cm * ratio)
            imgs.append(img)
        except Exception:
            continue
    if not imgs:
        return []
    t = _T([imgs])
    t.hAlign = "LEFT"
    return [t, _S(1, 10)]


def brand_logo_image(brand, height_cm=0.8):
    """Miniatura da logomarca de uma MARCA para linhas de tabela (ou None)."""
    import os
    from reportlab.lib.units import cm
    from reportlab.platypus import Image
    u = getattr(brand, "logo_url", None)
    if not u:
        return None
    fp = ("/app" + u) if u.startswith("/uploads") else u
    if not os.path.exists(fp):
        return None
    try:
        img = Image(fp)
        ratio = (img.drawWidth / img.drawHeight) if img.drawHeight else 1
        img.drawHeight = height_cm * cm
        img.drawWidth = min(3 * cm, height_cm * cm * ratio)
        return img
    except Exception:
        return None
