"""Páginas do painel (HTML): visão geral, cliente e relatório."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Cliente
from ..services import relatorio
from ..templating import templates

router = APIRouter(tags=["ui"])


def _resumo_cliente(cliente: Cliente) -> dict:
    medidos = [a for a in cliente.atendimentos if a.medido]
    valor = sum(a.valor_equivalente or 0.0 for a in medidos)
    minutos = sum(a.minutos_estimados or 0 for a in medidos)
    tarefas_abertas = sum(1 for t in cliente.tarefas if t.status == "aberta")
    ultimo = max((a.fim for a in medidos if a.fim), default=None)
    return {
        "cliente": cliente,
        "n_atendimentos": len(medidos),
        "valor": valor,
        "horas": round(minutos / 60.0, 1),
        "tarefas_abertas": tarefas_abertas,
        "ultimo": ultimo,
    }


@router.get("/")
def visao_geral(request: Request, db: Session = Depends(get_db)):
    clientes = db.query(Cliente).order_by(Cliente.nome.asc()).all()
    linhas = [_resumo_cliente(c) for c in clientes]
    linhas.sort(key=lambda x: x["valor"], reverse=True)
    totais = {
        "clientes": len(clientes),
        "atendimentos": sum(l["n_atendimentos"] for l in linhas),
        "valor": sum(l["valor"] for l in linhas),
        "tarefas": sum(l["tarefas_abertas"] for l in linhas),
    }
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {"linhas": linhas, "totais": totais},
    )


@router.get("/clientes/{cliente_id}")
def ver_cliente(cliente_id: int, request: Request, db: Session = Depends(get_db)):
    cliente = db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    ag = relatorio.agregar(db, cliente)
    atendimentos = sorted(
        [a for a in cliente.atendimentos if a.medido],
        key=lambda a: a.inicio or a.created_at,
        reverse=True,
    )
    tarefas = sorted(cliente.tarefas, key=lambda t: t.created_at, reverse=True)
    return templates.TemplateResponse(
        request,
        "cliente.html",
        {
            "cliente": cliente,
            "ag": ag,
            "atendimentos": atendimentos,
            "tarefas": tarefas,
        },
    )


@router.get("/clientes/{cliente_id}/relatorio")
def ver_relatorio(cliente_id: int, request: Request, db: Session = Depends(get_db)):
    cliente = db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    ag = relatorio.gerar_relatorio(db, cliente)  # também grava na pasta do cliente
    return templates.TemplateResponse(
        request, "relatorio.html", {"ag": ag, "cliente": cliente}
    )
