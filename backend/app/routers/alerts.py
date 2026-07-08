"""Central de alertas e ações pendentes — agrega informações críticas de todo o sistema."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date, timedelta
from ..database import get_db
from ..models.redistribution import Redistribution, RedistributionStatus
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator, OperatorContact, ContactType
from ..models.collection import CollectionCycle, CycleStatus
from ..models.confederation import Confederation
from ..core.auth import get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("/")
def get_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retorna alertas priorizados por nível (critical / warning / info)."""
    alerts = []
    today = date.today()
    conf_id = current_user.confederation_id if current_user.role == "confederation_viewer" else None

    # --- CRÍTICO: redistribuições com prazo vencido ---
    q = db.query(Redistribution).filter(
        Redistribution.deadline_date < today,
        Redistribution.status != RedistributionStatus.completed,
    )
    if conf_id:
        q = q.filter(Redistribution.confederation_id == conf_id)
    overdue_redis = q.count()
    if overdue_redis:
        alerts.append({
            "level": "critical",
            "type": "redistribution_overdue",
            "title": "Repartições com prazo vencido",
            "message": f"{overdue_redis} repartição(ões) ultrapassaram o prazo legal de repasse aos beneficiários.",
            "count": overdue_redis,
            "link": "/financeiro?tab=fase2",
        })

    # --- CRÍTICO: ciclos em cobrança com pagamentos muito atrasados (>30 dias do ciclo) ---
    if not conf_id:
        open_cycles = db.query(CollectionCycle).filter(
            CollectionCycle.status.in_([CycleStatus.collecting, CycleStatus.checking])
        ).all()
        overdue_in_cycle = 0
        for cycle in open_cycles:
            ref = cycle.reference_month
            if ref and (today - ref).days > 60:
                overdue_in_cycle += db.query(Payment).filter(
                    Payment.cycle_id == cycle.id,
                    Payment.status == PaymentStatus.pending,
                ).count()
        if overdue_in_cycle:
            alerts.append({
                "level": "critical",
                "type": "cycle_overdue_payments",
                "title": "Pagamentos pendentes em ciclos antigos",
                "message": f"{overdue_in_cycle} pagamento(s) ainda pendentes em ciclos com mais de 60 dias.",
                "count": overdue_in_cycle,
                "link": "/cobrancas",
            })

    # --- AVISO: redistribuições vencendo nos próximos 7 dias ---
    q2 = db.query(Redistribution).filter(
        Redistribution.deadline_date >= today,
        Redistribution.deadline_date <= today + timedelta(days=7),
        Redistribution.status != RedistributionStatus.completed,
    )
    if conf_id:
        q2 = q2.filter(Redistribution.confederation_id == conf_id)
    soon_redis = q2.count()
    if soon_redis:
        alerts.append({
            "level": "warning",
            "type": "redistribution_soon",
            "title": "Repartições vencem em breve",
            "message": f"{soon_redis} repartição(ões) vencem nos próximos 7 dias.",
            "count": soon_redis,
            "link": "/financeiro?tab=fase2",
        })

    # --- AVISO: operadores ativos sem email de contato primário ---
    if not conf_id:
        active_ops = db.query(BettingOperator).filter(
            BettingOperator.status == "active"
        ).all()
        ops_without_email = 0
        for op in active_ops:
            has_email = any(
                c.type == ContactType.email and c.is_primary for c in op.contacts
            )
            if not has_email:
                ops_without_email += 1
        if ops_without_email:
            alerts.append({
                "level": "warning",
                "type": "missing_primary_email",
                "title": "Operadores sem e-mail primário",
                "message": f"{ops_without_email} agente(s) operador(es) ativo(s) sem e-mail de contato principal cadastrado.",
                "count": ops_without_email,
                "link": "/operadores",
            })

    # --- INFO: relatórios de pagamento aguardando (pagos mas sem relatório) ---
    q3 = db.query(Payment).filter(Payment.status == PaymentStatus.report_pending)
    if conf_id:
        q3 = q3.filter(Payment.confederation_id == conf_id)
    pending_reports = q3.count()
    if pending_reports:
        alerts.append({
            "level": "info",
            "type": "pending_reports",
            "title": "Relatórios de GGR aguardando",
            "message": f"{pending_reports} pagamento(s) confirmado(s) aguardando recebimento do relatório de GGR do operador.",
            "count": pending_reports,
            "link": "/cobrancas",
        })

    return {"alerts": alerts, "total": len(alerts)}


@router.get("/inadimplencia-history")
def inadimplencia_history(
    start: str = "2025-01",   # "YYYY-MM" — início da janela
    months: int = 6,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Nº de operadores inadimplentes por confederação, mês a mês (janela navegável desde jan/2025).
    Classificação pela Conclusão efetiva (SSOT): exclui ENDR do mês, quem recebeu na competência
    e situações manuais (consignação/sem obrigação/adimplente)."""
    from ..services.status_service import effective_conclusions

    try:
        y, m = start.split("-")
        cur = date(int(y), int(m), 1)
    except Exception:
        cur = date(2025, 1, 1)
    if cur < date(2025, 1, 1):
        cur = date(2025, 1, 1)

    confs = db.query(Confederation).order_by(Confederation.acronym).all()
    if current_user.role == "confederation_viewer":
        confs = [c for c in confs if c.id == current_user.confederation_id]

    today_m = date.today().replace(day=1)
    labels, series = [], {c.acronym: [] for c in confs}
    mm = cur
    for _ in range(months):
        if mm > today_m:
            break
        labels.append(mm.strftime("%m/%Y"))
        for c in confs:
            eff = effective_conclusions(db, c.id, mm)
            series[c.acronym].append(sum(1 for v in eff.values() if v == "inadimplente"))
        mm = date(mm.year + (1 if mm.month == 12 else 0), 1 if mm.month == 12 else mm.month + 1, 1)

    return {
        "labels": labels,
        "series": [{"acronym": k, "confederation_id": next(c.id for c in confs if c.acronym == k), "data": v} for k, v in series.items()],
        "window_start": cur.strftime("%Y-%m"),
        "min_month": "2025-01",
        "max_month": today_m.strftime("%Y-%m"),
    }


@router.get("/transparency")
def transparency(
    confederation_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Linha do tempo de transparência — 'o que o escritório fez este mês' para o cliente."""
    from ..models.collection import CollectionEvent, EventType
    from ..models.messaging import EmailMessage, EmailDirection
    from ..models.payment import Payment
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id

    today = date.today()
    ref = date(today.year, today.month, 1)

    cyc_q = db.query(CollectionCycle).filter(CollectionCycle.reference_month == ref)
    if confederation_id:
        cyc_q = cyc_q.filter(CollectionCycle.confederation_id == confederation_id)
    cycle_ids = [c.id for c in cyc_q.all()]

    notifs = contatos = respostas = 0
    recuperado = 0.0
    if cycle_ids:
        events = db.query(CollectionEvent).filter(CollectionEvent.cycle_id.in_(cycle_ids)).all()
        notifs = len([e for e in events if e.event_type == EventType.notification_sent])
        contatos = len([e for e in events if e.event_type == EventType.phone_contact]) + \
            len([e for e in events if e.event_type == EventType.manual_note])
        respostas = db.query(EmailMessage).filter(
            EmailMessage.direction == EmailDirection.inbound,
            EmailMessage.cycle_id.in_(cycle_ids),
        ).count()
        pays = db.query(Payment).filter(Payment.cycle_id.in_(cycle_ids)).all()
        recuperado = sum(float(p.amount_paid or 0) for p in pays)
    # Recebimentos centrais (base única) da competência corrente
    from ..models.payment import DirectPayment as _DP
    dq = db.query(_DP).filter(_DP.reference_month == ref)
    if confederation_id:
        dq = dq.filter(_DP.confederation_id == confederation_id)
    recuperado += sum(float(d.amount_received or 0) for d in dq.all())

    return {
        "month": ref.strftime("%m/%Y"),
        "notificacoes": notifs,
        "contatos": contatos,
        "respostas": respostas,
        "recuperado": recuperado,
        "highlights": [
            f"{notifs} notificação(ões) formal(is) enviada(s)",
            f"{contatos} contato(s) ativo(s) realizado(s)",
            f"{respostas} resposta(s) recebida(s) e conciliada(s)",
        ],
    }


@router.get("/compliance-history")
def compliance_history(
    confederation_id: int = None,
    months: int = 6,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Evolução mensal da adimplência nos últimos N meses."""
    if current_user.role == "confederation_viewer":
        confederation_id = current_user.confederation_id

    today = date.today()
    history = []

    for i in range(months - 1, -1, -1):
        # Calcula o mês de referência
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        ref_month = date(y, m, 1)
        label = ref_month.strftime("%b/%y")

        cycles = db.query(CollectionCycle).filter(CollectionCycle.reference_month == ref_month)
        if confederation_id:
            cycles = cycles.filter(CollectionCycle.confederation_id == confederation_id)
        cycle_ids = [c.id for c in cycles.all()]

        if not cycle_ids:
            history.append({"month": label, "ref": ref_month.isoformat(), "rate": None, "paid": 0, "total": 0})
            continue

        pq = db.query(Payment).filter(Payment.cycle_id.in_(cycle_ids))
        if confederation_id:
            pq = pq.filter(Payment.confederation_id == confederation_id)
        payments = pq.all()
        total = len(payments)
        paid = len([p for p in payments if p.status in (PaymentStatus.paid, PaymentStatus.report_pending)])
        rate = round(paid / total * 100) if total else None
        history.append({"month": label, "ref": ref_month.isoformat(), "rate": rate, "paid": paid, "total": total})

    return {"history": history}
