"""Integração com o WhatsApp Business Cloud API (canal oficial da Meta).

- parse_webhook(): traduz o payload que a Meta envia num formato interno simples.
- ingerir_mensagem(): grava a mensagem e casa o remetente ao cliente (cria lead se novo).
- enviar_mensagem(): envia resposta pelo número oficial (best-effort).

A mesma função de ingestão é usada pelo webhook real e pelo endpoint de simulação,
de modo que o pipeline exercitado na demonstração é idêntico ao de produção.
"""
import logging
from datetime import datetime

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Cliente, Mensagem, normalizar_telefone

logger = logging.getLogger("mensura.whatsapp")


def parse_webhook(payload: dict) -> list[dict]:
    """Extrai mensagens de texto recebidas do payload da Cloud API."""
    resultados: list[dict] = []
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value", {}) or {}
            perfis = {
                c.get("wa_id"): (c.get("profile", {}) or {}).get("name")
                for c in value.get("contacts", []) or []
            }
            for msg in value.get("messages", []) or []:
                if msg.get("type") != "text":
                    continue
                wa_id = msg.get("from")
                ts = msg.get("timestamp")
                try:
                    quando = datetime.utcfromtimestamp(int(ts)) if ts else datetime.utcnow()
                except (TypeError, ValueError):
                    quando = datetime.utcnow()
                resultados.append(
                    {
                        "wa_id": wa_id,
                        "nome": perfis.get(wa_id),
                        "texto": (msg.get("text", {}) or {}).get("body", ""),
                        "wa_message_id": msg.get("id"),
                        "timestamp": quando,
                        "direcao": "in",
                    }
                )
    return resultados


def obter_ou_criar_cliente(db: Session, telefone: str, nome: str | None) -> Cliente:
    tel = normalizar_telefone(telefone)
    cliente = db.query(Cliente).filter(Cliente.telefone == tel).first()
    if cliente is None:
        cliente = Cliente(
            nome=nome or f"Contato {tel[-4:] or tel}",
            telefone=tel,
            valor_hora=settings.VALOR_HORA_PADRAO,
        )
        db.add(cliente)
        db.flush()  # garante id
    elif nome and cliente.nome.startswith("Contato "):
        cliente.nome = nome  # promove o lead quando o nome do perfil chega
    return cliente


def ingerir_mensagem(
    db: Session,
    telefone: str,
    nome: str | None,
    texto: str,
    direcao: str = "in",
    wa_message_id: str | None = None,
    quando: datetime | None = None,
) -> Cliente:
    """Grava a mensagem (deduplicando por wa_message_id) e retorna o cliente."""
    cliente = obter_ou_criar_cliente(db, telefone, nome)

    if wa_message_id:
        existe = (
            db.query(Mensagem).filter(Mensagem.wa_message_id == wa_message_id).first()
        )
        if existe:
            return cliente

    db.add(
        Mensagem(
            cliente_id=cliente.id,
            direcao=direcao,
            texto=texto,
            autor=nome if direcao == "in" else "Escritório",
            wa_message_id=wa_message_id,
            timestamp=quando or datetime.utcnow(),
        )
    )
    return cliente


def enviar_mensagem(telefone: str, texto: str) -> bool:
    """Envia texto pelo número oficial via Graph API. Retorna False se não configurado."""
    if not (settings.WA_PHONE_NUMBER_ID and settings.WA_ACCESS_TOKEN):
        logger.info("Envio WhatsApp não configurado — mensagem não enviada.")
        return False
    url = (
        f"https://graph.facebook.com/{settings.WA_API_VERSION}/"
        f"{settings.WA_PHONE_NUMBER_ID}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": normalizar_telefone(telefone),
        "type": "text",
        "text": {"body": texto},
    }
    try:
        r = httpx.post(
            url,
            headers={"Authorization": f"Bearer {settings.WA_ACCESS_TOKEN}"},
            json=payload,
            timeout=20,
        )
        return r.status_code in (200, 201)
    except Exception as e:
        logger.warning("Falha ao enviar WhatsApp: %s", e)
        return False
