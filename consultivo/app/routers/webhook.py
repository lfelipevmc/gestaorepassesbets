"""Webhook do WhatsApp Business Cloud API (canal oficial da Meta).

GET  /webhook  — verificação exigida pela Meta ao configurar o webhook.
POST /webhook  — recebe as mensagens, grava e recomputa os atendimentos.
"""
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..services import segmentacao, whatsapp

logger = logging.getLogger("mensura.webhook")
router = APIRouter(tags=["webhook"])


@router.get("/webhook")
def verificar(request: Request):
    params = request.query_params
    if (
        params.get("hub.mode") == "subscribe"
        and params.get("hub.verify_token") == settings.WA_VERIFY_TOKEN
    ):
        return PlainTextResponse(params.get("hub.challenge", ""))
    return PlainTextResponse("token inválido", status_code=403)


@router.post("/webhook")
async def receber(request: Request, db: Session = Depends(get_db)):
    payload = await request.json()
    mensagens = whatsapp.parse_webhook(payload)

    clientes_afetados = {}
    for m in mensagens:
        cliente = whatsapp.ingerir_mensagem(
            db,
            telefone=m["wa_id"],
            nome=m.get("nome"),
            texto=m.get("texto", ""),
            direcao="in",
            wa_message_id=m.get("wa_message_id"),
            quando=m.get("timestamp"),
        )
        clientes_afetados[cliente.id] = cliente
    db.commit()

    for cliente in clientes_afetados.values():
        segmentacao.recompute_atendimentos(db, cliente)

    return {"status": "ok", "recebidas": len(mensagens)}
