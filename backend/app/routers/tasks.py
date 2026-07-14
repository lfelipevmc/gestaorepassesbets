"""Painel "A Fazer Hoje" — fila priorizada de tarefas operacionais e cadência de contato.

Agrega, a partir do estado atual do sistema, o que o escritório precisa fazer hoje:
notificações no prazo, repartições vencendo, e-mails a conciliar e Bets a cobrar —
cada item com um canal de contato sugerido (cadência inteligente).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import date, timedelta
from ..database import get_db
from ..models.collection import CollectionCycle, CollectionEvent, EventType, CycleStatus
from ..models.payment import Payment, PaymentStatus
from ..models.operator import BettingOperator, OperatorContact, ContactType, OperatorResponsible
from ..models.confederation import Confederation
from ..models.redistribution import Redistribution, RedistributionStatus
from ..models.messaging import EmailMessage, EmailDirection
from ..core.auth import get_current_user
from ..models.user import User

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _suggested_channel(db: Session, operator_id: int) -> str:
    """Cadência: sugere o melhor canal com base nos dados e no histórico de respostas."""
    # Se já respondeu por e-mail antes, mantém e-mail; senão prioriza WhatsApp se houver telefone.
    has_phone = db.query(OperatorContact).filter(
        OperatorContact.operator_id == operator_id,
        OperatorContact.type.in_([ContactType.phone, ContactType.whatsapp]),
    ).first() or db.query(OperatorResponsible).filter(
        OperatorResponsible.operator_id == operator_id, OperatorResponsible.phone.isnot(None)
    ).first()
    has_email = db.query(OperatorContact).filter(
        OperatorContact.operator_id == operator_id,
        OperatorContact.type == ContactType.email, OperatorContact.is_primary == True,
    ).first()
    if has_email:
        return "e-mail"
    if has_phone:
        return "WhatsApp"
    return "telefone/redes"


@router.get("/today")
def tasks_today(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today = date.today()
    conf_scope = current_user.confederation_id if current_user.role == "confederation_viewer" else None
    tasks = []

    confs = {c.id: c for c in db.query(Confederation).all()}

    # --- Ciclos que precisam de notificação hoje ---
    cyc_q = db.query(CollectionCycle).filter(CollectionCycle.status.in_([CycleStatus.open, CycleStatus.collecting]))
    if conf_scope:
        cyc_q = cyc_q.filter(CollectionCycle.confederation_id == conf_scope)
    from ..services.status_service import effective_conclusions
    for cycle in cyc_q.all():
        conf = confs.get(cycle.confederation_id)
        _eff = effective_conclusions(db, cycle.confederation_id, cycle.reference_month)
        pendentes = sum(1 for v in _eff.values() if v == "inadimplente")
        if pendentes == 0:
            continue
        sent1 = db.query(CollectionEvent).filter(
            CollectionEvent.cycle_id == cycle.id, CollectionEvent.event_type == EventType.notification_sent,
        ).count()
        day = today.day
        first_day = conf.first_notification_day if conf else 12
        second_day = conf.second_notification_day if conf else 22
        if sent1 == 0 and day >= first_day:
            tasks.append({
                "priority": 1, "type": "first_notification",
                "title": f"Enviar 1ª notificação — {conf.acronym if conf else ''}",
                "detail": f"{pendentes} agente(s) pendente(s) no ciclo de {cycle.reference_month.strftime('%m/%Y')}.",
                "link": f"/cobrancas/{cycle.id}", "channel": "e-mail", "count": pendentes,
            })
        elif sent1 > 0 and day >= second_day:
            tasks.append({
                "priority": 2, "type": "second_notification",
                "title": f"Enviar 2ª notificação — {conf.acronym if conf else ''}",
                "detail": f"{pendentes} agente(s) ainda pendente(s) após a 1ª notificação.",
                "link": f"/cobrancas/{cycle.id}", "channel": "e-mail + WhatsApp", "count": pendentes,
            })

    # --- Repartições vencendo (Fase 2) ---
    red_q = db.query(Redistribution).filter(Redistribution.status != RedistributionStatus.completed)
    if conf_scope:
        red_q = red_q.filter(Redistribution.confederation_id == conf_scope)
    overdue, soon = 0, 0
    for r in red_q.all():
        if not r.deadline_date:
            continue
        if r.deadline_date < today:
            overdue += 1
        elif r.deadline_date <= today + timedelta(days=7):
            soon += 1
    if overdue:
        tasks.append({"priority": 0, "type": "redistribution_overdue", "title": "Repartições com prazo vencido",
                      "detail": f"{overdue} repartição(ões) ultrapassaram o prazo legal de repasse.",
                      "link": "/financeiro", "channel": "—", "count": overdue})
    if soon:
        tasks.append({"priority": 2, "type": "redistribution_soon", "title": "Repartições vencem em 7 dias",
                      "detail": f"{soon} repartição(ões) a vencer — programar o repasse.",
                      "link": "/financeiro", "channel": "—", "count": soon})

    # --- E-mails a conciliar ---
    em_q = db.query(EmailMessage).filter(EmailMessage.direction == EmailDirection.inbound, EmailMessage.matched == False)
    if conf_scope:
        em_q = em_q.filter(EmailMessage.confederation_id == conf_scope)
    unmatched = em_q.count()
    if unmatched:
        tasks.append({"priority": 1, "type": "reconcile_email", "title": "Conciliar respostas de e-mail",
                      "detail": f"{unmatched} e-mail(s) recebido(s) aguardando vínculo a um operador.",
                      "link": "/financeiro", "channel": "—", "count": unmatched})

    # --- Bets pendentes sem contato recente (cadência) ---
    if not conf_scope:
        cutoff = today - timedelta(days=7)
        sugest = []
        for cycle in cyc_q.all():
            _effc = effective_conclusions(db, cycle.confederation_id, cycle.reference_month)
            pend_ids = [oid for oid, v in _effc.items() if v == "inadimplente"][:200]
            for _oid in pend_ids:
                last = db.query(CollectionEvent).filter(
                    CollectionEvent.cycle_id == cycle.id, CollectionEvent.operator_id == _oid,
                ).order_by(CollectionEvent.performed_at.desc()).first()
                if last and last.performed_at and last.performed_at.date() >= cutoff:
                    continue  # já contatado nos últimos 7 dias
                op = db.query(BettingOperator).get(_oid)
                if not op:
                    continue
                sugest.append({"operator_id": op.id, "label": op.fantasy_name or op.company_name,
                               "cycle_id": cycle.id, "channel": _suggested_channel(db, op.id)})
                if len(sugest) >= 30:
                    break
            if len(sugest) >= 30:
                break
        if sugest:
            tasks.append({"priority": 3, "type": "contact_bets", "title": "Cobrar Bets sem contato recente",
                          "detail": f"{len(sugest)} agente(s) sem contato nos últimos 7 dias.",
                          "link": "/cobrancas", "channel": "variado", "count": len(sugest), "items": sugest})

    tasks.sort(key=lambda t: t["priority"])
    return {"tasks": tasks, "generated_at": today.isoformat()}


# ======================== Painel "A Fazer" (board por categorias) ========================

from pydantic import BaseModel as _BM
from typing import Optional as _Opt
from ..models.todo import AdminReminder, TaskCheck
from ..services.audit_service import log_action


class _CheckIn(_BM):
    key: str
    done: bool = True


class _ReminderIn(_BM):
    title: str
    notes: _Opt[str] = None
    due_date: _Opt[date] = None


@router.get("/board")
def tasks_board(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Painel inteligente de atividades: pendências operacionais agrupadas por categoria,
    com chave estável por item (checkbox persistente) e prioridade."""
    from ..services.status_service import effective_conclusions
    from ..models.payment import DirectPayment
    from ..models.operator import OperatorConfederationInfo

    today = date.today()
    cur = today.replace(day=1)
    ym = cur.strftime("%Y-%m")
    checked = {c.task_key for c in db.query(TaskCheck).all()}
    confs = db.query(Confederation).order_by(Confederation.acronym).all()
    ops = db.query(BettingOperator).filter(BettingOperator.status == "active").all()

    def item(key, title, detail, link, priority, due=None):
        return {"key": key, "title": title, "detail": detail, "link": link,
                "priority": priority, "due": due, "done": key in checked}

    cats = []

    # 1) Cronograma dos ciclos de cobrança
    items = []
    cycles = db.query(CollectionCycle).filter(
        CollectionCycle.archived == False,
        CollectionCycle.status.in_([CycleStatus.open, CycleStatus.collecting, CycleStatus.checking]),
    ).all()
    for cy in cycles:
        conf = next((c for c in confs if c.id == cy.confederation_id), None)
        if not conf:
            continue
        eff = effective_conclusions(db, conf.id, cy.reference_month)
        inad = sum(1 for v in eff.values() if v == "inadimplente")
        sent = db.query(CollectionEvent).filter(
            CollectionEvent.cycle_id == cy.id, CollectionEvent.event_type == EventType.notification_sent).count()
        ref = cy.reference_month.strftime("%m/%Y")
        d1, d2 = conf.first_notification_day or 12, conf.second_notification_day or 22
        if sent == 0:
            items.append(item(f"cyc1:{cy.id}", f"1ª notificação — {conf.acronym} ({ref})",
                              f"{inad} inadimplente(s). Dia programado: {d1}.", f"/cobrancas/{cy.id}",
                              1 if today.day >= d1 else 2, f"dia {d1}"))
        elif inad > 0:
            items.append(item(f"cyc2:{cy.id}", f"2ª notificação — {conf.acronym} ({ref})",
                              f"{inad} ainda inadimplente(s) após 1º envio. Dia programado: {d2}.", f"/cobrancas/{cy.id}",
                              1 if today.day >= d2 else 2, f"dia {d2}"))

        # Prazos derivados do próprio ciclo (criados automaticamente na abertura — SSOT:
        # calculados do ciclo + configuração da confederação, sem duplicar dados)
        d_spa = min(d2 + 4, 28)
        if inad > 0:
            items.append(item(f"spa:{cy.id}", f"Ofício à SPA — {conf.acronym} ({ref})",
                              f"Após a 2ª notificação, comunicar os {inad} inadimplente(s) ao regulador (Gerar Ofício SPA no ciclo).",
                              f"/cobrancas/{cy.id}", 1 if today.day >= d_spa else 3, f"dia {d_spa}"))
        items.append(item(f"ativid:{cy.id}", f"Relatório de Atividades — {conf.acronym} ({ref})",
                          "Gerar o PDF de diligências do mês e arquivar/enviar ao cliente.",
                          f"/cobrancas/{cy.id}", 1 if today.day >= 26 else 3, "fim do mês"))
    cats.append({"id": "cronograma", "label": "Cronograma dos ciclos", "icon": "📅", "items": items})

    # 2) Respostas aguardando análise
    items = []
    for em in db.query(EmailMessage).filter(EmailMessage.direction == EmailDirection.inbound,
                                            EmailMessage.matched == False).limit(30).all():
        items.append(item(f"mail:{em.id}", f"Resposta a conciliar: {em.subject or '(sem assunto)'}",
                          f"De {em.from_addr or '—'}", "/financeiro", 1))
    cats.append({"id": "respostas", "label": "Respostas aguardando análise", "icon": "📨", "items": items})

    # 3) Contatos desatualizados/incompletos + 8) inconsistências cadastrais
    contatos, inconsist = [], []
    for op in ops:
        emails = [c for c in op.contacts if c.type == ContactType.email and c.value] + [r for r in op.responsibles if r.email]
        phones = [c for c in op.contacts if c.type in (ContactType.phone, ContactType.whatsapp) and c.value] + [r for r in op.responsibles if r.phone]
        problems = []
        if not emails:
            problems.append("sem e-mail")
        if not phones:
            problems.append("sem telefone")
        if problems:
            contatos.append(item(f"contact:{op.id}", op.fantasy_name or op.company_name,
                                 "Atualizar contatos: " + ", ".join(problems) + ".",
                                 f"/operadores/{op.id}", 2))
        probs2 = []
        digits = "".join(ch for ch in (op.cnpj or "") if ch.isdigit())
        if not op.cnpj:
            probs2.append("CNPJ ausente")
        elif len(digits) != 14:
            probs2.append("CNPJ inválido")
        if not (op.authorization_number or op.mf_license_number):
            probs2.append("sem nº de autorização")
        if probs2:
            inconsist.append(item(f"incons:{op.id}", op.fantasy_name or op.company_name,
                                  "Inconsistências: " + ", ".join(probs2) + ".",
                                  f"/operadores/{op.id}", 3))
    cats.append({"id": "contatos", "label": "Contatos a atualizar", "icon": "📇", "items": contatos[:40]})

    # 4) Relatórios pendentes (recebeu na competência mas sem relatório anexado)
    items = []
    for conf in confs:
        dps = db.query(DirectPayment).filter(DirectPayment.confederation_id == conf.id,
                                             DirectPayment.reference_month == cur).all()
        seen = set()
        for d in dps:
            if d.report_file_url or d.operator_id in seen:
                continue
            seen.add(d.operator_id)
            op = next((o for o in ops if o.id == d.operator_id), None)
            items.append(item(f"report:{d.operator_id}:{conf.id}:{ym}",
                              f"Cobrar relatório — {(op.fantasy_name or op.company_name) if op else d.operator_id} ({conf.acronym})",
                              f"Pagou a competência {cur.strftime('%m/%Y')} mas o relatório de apuração não foi anexado.",
                              f"/operadores/{d.operator_id}", 2))
    cats.append({"id": "relatorios", "label": "Relatórios a cobrar", "icon": "📄", "items": items})

    # 5) Agentes em tratativas (Consignação em Pagamento — acompanhamento)
    items = []
    infos = db.query(OperatorConfederationInfo).filter(
        OperatorConfederationInfo.conclusion_manual == True,
        OperatorConfederationInfo.conclusion == "consignacao").all()
    for i in infos:
        op = next((o for o in ops if o.id == i.operator_id), None)
        conf = next((c for c in confs if c.id == i.confederation_id), None)
        if op and conf:
            items.append(item(f"tratativa:{op.id}:{conf.id}:{ym}",
                              f"{op.fantasy_name or op.company_name} × {conf.acronym}",
                              (i.notes or "Em tratativa (consignação em pagamento).")[:140],
                              f"/confederacoes/{conf.id}", 2))
    cats.append({"id": "tratativas", "label": "Agentes em tratativas", "icon": "🤝", "items": items})

    # 6) Lembretes do administrador
    items = []
    for r in db.query(AdminReminder).filter(AdminReminder.done == False).order_by(AdminReminder.due_date.asc().nullslast()).all():
        overdue = r.due_date and r.due_date < today
        items.append({"key": f"reminder:{r.id}", "title": r.title, "detail": r.notes or "",
                      "link": None, "priority": 0 if overdue else 1,
                      "due": r.due_date.strftime("%d/%m/%Y") if r.due_date else None,
                      "done": False, "reminder_id": r.id})
    cats.append({"id": "lembretes", "label": "Lembretes", "icon": "📌", "items": items})

    # 7) Fechamento do mês
    items = []
    import calendar
    last_day = calendar.monthrange(today.year, today.month)[1]
    if today.day >= last_day - 4:
        items.append(item(f"fechamento:{ym}", "Inclusão final dos pagamentos do mês",
                          f"O mês encerra em {last_day - today.day} dia(s). Confira se todos os recebimentos e relatórios de {today.strftime('%m/%Y')} foram lançados.",
                          "/financeiro", 0, f"até {last_day}/{today.month:02d}"))
    cats.append({"id": "fechamento", "label": "Fechamento do mês", "icon": "⏳", "items": items})

    cats.append({"id": "inconsistencias", "label": "Inconsistências cadastrais", "icon": "⚠️", "items": inconsist[:40]})

    total = sum(len(c["items"]) for c in cats)
    pend = sum(1 for c in cats for i in c["items"] if not i["done"])
    return {"categories": cats, "total": total, "pending": pend, "generated_at": today.isoformat()}


@router.post("/check")
def check_task(data: _CheckIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Marca/desmarca uma tarefa automática (checkbox persistente)."""
    existing = db.query(TaskCheck).filter(TaskCheck.task_key == data.key).first()
    if data.done and not existing:
        db.add(TaskCheck(task_key=data.key, checked_by_id=current_user.id))
    elif not data.done and existing:
        db.delete(existing)
    db.commit()
    return {"ok": True}


@router.get("/reminders")
def list_reminders(include_done: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    q = db.query(AdminReminder)
    if not include_done:
        q = q.filter(AdminReminder.done == False)
    return [{"id": r.id, "title": r.title, "notes": r.notes,
             "due_date": r.due_date.isoformat() if r.due_date else None, "done": r.done}
            for r in q.order_by(AdminReminder.due_date.asc().nullslast()).all()]


@router.post("/reminders")
def create_reminder(data: _ReminderIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = AdminReminder(title=data.title, notes=data.notes, due_date=data.due_date, created_by_id=current_user.id)
    db.add(r)
    db.commit()
    log_action(db=db, action="CREATE_REMINDER", entity_type="AdminReminder", entity_id=r.id, user_id=current_user.id)
    return {"ok": True, "id": r.id}


@router.patch("/reminders/{rid}")
def toggle_reminder(rid: int, done: bool = True, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(AdminReminder).get(rid)
    if not r:
        from fastapi import HTTPException
        raise HTTPException(404, "Lembrete não encontrado")
    r.done = done
    db.commit()
    return {"ok": True}


@router.delete("/reminders/{rid}")
def delete_reminder(rid: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    r = db.query(AdminReminder).get(rid)
    if r:
        db.delete(r)
        db.commit()
    return {"ok": True}
