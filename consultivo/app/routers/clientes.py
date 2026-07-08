"""API de ações: criar cliente, simular conversa, popular demonstração, recomputar."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Cliente, normalizar_telefone
from ..schemas import ClienteIn, SimulacaoIn
from ..services import segmentacao
from ..services.whatsapp import ingerir_mensagem

router = APIRouter(prefix="/api", tags=["api"])


@router.post("/clientes")
def criar_cliente(dados: ClienteIn, db: Session = Depends(get_db)):
    tel = normalizar_telefone(dados.telefone)
    if db.query(Cliente).filter(Cliente.telefone == tel).first():
        raise HTTPException(400, "Já existe cliente com esse telefone.")
    cliente = Cliente(
        nome=dados.nome,
        telefone=tel,
        empresa=dados.empresa,
        valor_contrato_mensal=dados.valor_contrato_mensal,
        valor_hora=dados.valor_hora,
        observacoes=dados.observacoes,
    )
    db.add(cliente)
    db.commit()
    return {"id": cliente.id, "nome": cliente.nome}


@router.post("/simular")
def simular(dados: SimulacaoIn, db: Session = Depends(get_db)):
    """Injeta uma conversa como se tivesse chegado pelo WhatsApp e a mensura."""
    base = datetime.utcnow() - timedelta(hours=2)
    cliente = None
    for i, msg in enumerate(dados.mensagens):
        cliente = ingerir_mensagem(
            db,
            telefone=dados.telefone,
            nome=dados.nome,
            texto=msg.texto,
            direcao=msg.direcao,
            wa_message_id=f"sim-{normalizar_telefone(dados.telefone)}-{int(base.timestamp())}-{i}",
            quando=base + timedelta(minutes=msg.minutos_offset),
        )
    db.commit()
    resultado = segmentacao.recompute_atendimentos(db, cliente)
    return {"cliente_id": cliente.id, **resultado}


@router.post("/clientes/{cliente_id}/recomputar")
def recomputar(cliente_id: int, db: Session = Depends(get_db)):
    cliente = db.get(Cliente, cliente_id)
    if not cliente:
        raise HTTPException(404, "Cliente não encontrado.")
    return segmentacao.recompute_atendimentos(db, cliente)


@router.post("/seed-demo")
def seed_demo():
    from ..seed import rodar

    criados = rodar()
    return {"clientes_demo_criados": criados}
