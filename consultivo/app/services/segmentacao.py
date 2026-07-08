"""Segmentação e mensuração.

Corta o fluxo contínuo de mensagens de um cliente em ATENDIMENTOS (por intervalo
de tempo), mede cada atendimento ainda não medido e, quando há providência, cria
a tarefa correspondente.

Idempotência: cada grupo recebe uma 'assinatura' (hash das mensagens que o compõem).
Enquanto um grupo não muda, seu atendimento permanece medido e não é refeito.
"""
import hashlib
from datetime import timedelta

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Atendimento, Cliente, Mensagem, Tarefa
from . import ai


def _assinatura(grupo: list[Mensagem]) -> str:
    ids = ",".join(str(m.id) for m in grupo)
    return hashlib.sha1(ids.encode()).hexdigest()


def _agrupar(mensagens: list[Mensagem], gap_min: int) -> list[list[Mensagem]]:
    grupos: list[list[Mensagem]] = []
    atual: list[Mensagem] = []
    limite = timedelta(minutes=gap_min)
    anterior = None
    for m in mensagens:
        if atual and anterior is not None and (m.timestamp - anterior) > limite:
            grupos.append(atual)
            atual = []
        atual.append(m)
        anterior = m.timestamp
    if atual:
        grupos.append(atual)
    return grupos


def recompute_atendimentos(db: Session, cliente: Cliente) -> dict:
    """(Re)constrói os atendimentos do cliente, mede os novos e gera tarefas."""
    mensagens = (
        db.query(Mensagem)
        .filter(Mensagem.cliente_id == cliente.id)
        .order_by(Mensagem.timestamp.asc(), Mensagem.id.asc())
        .all()
    )
    grupos = _agrupar(mensagens, settings.GAP_MINUTES)
    assinaturas_atuais = {_assinatura(g): g for g in grupos if g}

    existentes = {
        a.assinatura: a
        for a in db.query(Atendimento).filter(Atendimento.cliente_id == cliente.id).all()
    }

    # Remove atendimentos cuja composição mudou (ex.: grupo que cresceu)
    for assinatura, at in list(existentes.items()):
        if assinatura not in assinaturas_atuais:
            for t in list(at.tarefas):
                t.atendimento_id = None  # preserva a tarefa, solta o vínculo
            db.delete(at)
            existentes.pop(assinatura, None)

    valor_hora = cliente.valor_hora or settings.VALOR_HORA_PADRAO
    novos, tarefas_criadas = 0, 0

    for assinatura, grupo in assinaturas_atuais.items():
        at = existentes.get(assinatura)
        if at is None:
            at = Atendimento(cliente_id=cliente.id, assinatura=assinatura)
            db.add(at)
            db.flush()
            novos += 1

        at.inicio = grupo[0].timestamp
        at.fim = grupo[-1].timestamp
        at.num_mensagens = len(grupo)

        if not at.medido:
            m = ai.medir_atendimento(grupo)
            at.resumo = m["resumo"]
            at.tema = m["tema"]
            at.complexidade = m["complexidade"]
            at.minutos_estimados = int(m["minutos_estimados"])
            at.valor_equivalente = round(at.minutos_estimados / 60.0 * valor_hora, 2)
            at.gerou_providencia = bool(m["gerou_providencia"])
            at.titulo_providencia = m.get("titulo_providencia") or None
            at.fonte_medicao = m.get("fonte", "")
            at.medido = True

            if at.gerou_providencia and not at.tarefas:
                db.add(
                    Tarefa(
                        cliente_id=cliente.id,
                        atendimento_id=at.id,
                        titulo=at.titulo_providencia or "Providência do atendimento",
                        descricao=at.resumo,
                    )
                )
                tarefas_criadas += 1

    db.commit()
    return {
        "atendimentos": len(assinaturas_atuais),
        "novos": novos,
        "tarefas_criadas": tarefas_criadas,
    }
