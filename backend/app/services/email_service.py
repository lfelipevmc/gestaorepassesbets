import msal
import httpx
from ..config import settings
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

GRAPH = "https://graph.microsoft.com/v1.0"

# cache em memória dos ids de pasta já resolvidos (por nome), evita recriar/reconsultar
_folder_cache: dict = {}


def get_access_token() -> Optional[str]:
    if not all([settings.AZURE_CLIENT_ID, settings.AZURE_CLIENT_SECRET, settings.AZURE_TENANT_ID]):
        return None

    app = msal.ConfidentialClientApplication(
        settings.AZURE_CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}",
        client_credential=settings.AZURE_CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    return result.get("access_token")


def get_mailbox() -> Optional[str]:
    """Caixa ÚNICA usada para toda a comunicação com os agentes operadores.
    Prioriza REPASSES_MAILBOX; cai para OFFICE_EMAIL apenas por retrocompatibilidade."""
    return settings.REPASSES_MAILBOX or settings.OFFICE_EMAIL


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def send_email(to: List[str], subject: str, body: str, cc: Optional[List[str]] = None,
               attachments: Optional[List[dict]] = None,
               confederation_acronym: Optional[str] = None,
               mailbox: Optional[str] = None) -> bool:
    """Envia e-mail via Graph a partir da caixa dedicada de repasses.

    - `mailbox`: força uma caixa específica (padrão: a caixa dedicada de repasses).
    - `confederation_acronym`: se informado, guarda uma cópia do enviado na subpasta da
      confederação (na caixa dedicada), mantendo as comunicações organizadas.
    attachments: lista de {filename, content_bytes(base64 str), content_type,
                            is_inline(bool, opcional), content_id(str, opcional)} —
    anexos inline (is_inline+content_id) permitem referenciar imagens no corpo via cid:.
    """
    token = get_access_token()
    box = mailbox or get_mailbox()
    if not token or not box:
        logger.warning("Email service not configured (sem token ou caixa definida)")
        return False

    message = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body.replace("\n", "<br>")},
        "toRecipients": [{"emailAddress": {"address": addr}} for addr in to],
        "ccRecipients": [{"emailAddress": {"address": addr}} for addr in (cc or [])],
    }
    if attachments:
        atts = []
        for a in attachments:
            att = {
                "@odata.type": "#microsoft.graph.fileAttachment",
                "name": a["filename"],
                "contentType": a.get("content_type", "application/octet-stream"),
                "contentBytes": a["content_bytes"],
            }
            if a.get("is_inline"):
                att["isInline"] = True
                if a.get("content_id"):
                    att["contentId"] = a["content_id"]
            atts.append(att)
        message["attachments"] = atts

    # Envio organizado por confederação: cria o rascunho na subpasta da confederação e
    # dispara a partir dele, deixando a cópia arquivada naquela pasta.
    if confederation_acronym:
        folder_id = ensure_confederation_folder(confederation_acronym, box=box, token=token)
        if folder_id:
            try:
                created = httpx.post(
                    f"{GRAPH}/users/{box}/mailFolders/{folder_id}/messages",
                    headers=_headers(token), json=message, timeout=30,
                )
                if created.status_code in (200, 201):
                    msg_id = created.json().get("id")
                    sent = httpx.post(
                        f"{GRAPH}/users/{box}/messages/{msg_id}/send",
                        headers=_headers(token), timeout=30,
                    )
                    if sent.status_code in (200, 202):
                        return True
                    logger.error(f"Falha ao enviar rascunho: {sent.status_code} {sent.text}")
                else:
                    logger.error(f"Falha ao criar rascunho na pasta: {created.status_code} {created.text}")
            except Exception as e:
                logger.warning(f"Envio por pasta falhou ({e}); usando envio direto.")

    # Envio direto (sem pasta específica) — cópia vai para Itens Enviados
    payload = {"message": message, "saveToSentItems": True}
    resp = httpx.post(
        f"{GRAPH}/users/{box}/sendMail",
        headers=_headers(token), json=payload, timeout=30,
    )
    if resp.status_code == 202:
        return True
    logger.error(f"Email send failed: {resp.status_code} {resp.text}")
    return False


def ensure_confederation_folder(acronym: str, box: Optional[str] = None,
                                token: Optional[str] = None) -> Optional[str]:
    """Garante que exista a subpasta da confederação (dentro da pasta-mãe de repasses) e
    devolve o id dela. Cria a pasta-mãe e a subpasta se necessário. Retorna None se falhar."""
    token = token or get_access_token()
    box = box or get_mailbox()
    if not token or not box or not acronym:
        return None

    cache_key = f"{box}::{acronym}"
    if cache_key in _folder_cache:
        return _folder_cache[cache_key]

    root_name = settings.REPASSES_FOLDER_ROOT
    try:
        root_id = _get_or_create_folder(box, root_name, token, parent_id=None)
        if not root_id:
            return None
        child_id = _get_or_create_folder(box, acronym, token, parent_id=root_id)
        if child_id:
            _folder_cache[cache_key] = child_id
        return child_id
    except Exception as e:
        logger.warning(f"Não foi possível garantir a pasta da confederação {acronym}: {e}")
        return None


def _get_or_create_folder(box: str, name: str, token: str, parent_id: Optional[str]) -> Optional[str]:
    base = (f"{GRAPH}/users/{box}/mailFolders/{parent_id}/childFolders"
            if parent_id else f"{GRAPH}/users/{box}/mailFolders")
    # tenta localizar pela displayName
    q = httpx.get(base, headers=_headers(token),
                  params={"$filter": f"displayName eq '{name}'", "$select": "id,displayName", "$top": 1},
                  timeout=30)
    if q.status_code == 200:
        vals = q.json().get("value", [])
        if vals:
            return vals[0]["id"]
    # cria
    c = httpx.post(base, headers=_headers(token), json={"displayName": name}, timeout=30)
    if c.status_code in (200, 201):
        return c.json().get("id")
    logger.error(f"Falha ao criar/obter pasta '{name}': {c.status_code} {c.text}")
    return None


def move_message(message_id: str, folder_id: str, box: Optional[str] = None,
                 token: Optional[str] = None) -> bool:
    """Move uma mensagem para a pasta indicada na caixa dedicada."""
    token = token or get_access_token()
    box = box or get_mailbox()
    if not token or not box or not message_id or not folder_id:
        return False
    resp = httpx.post(
        f"{GRAPH}/users/{box}/messages/{message_id}/move",
        headers=_headers(token), json={"destinationId": folder_id}, timeout=30,
    )
    return resp.status_code in (200, 201)


def read_inbox_emails(folder: str = "inbox", top: int = 50, mailbox: Optional[str] = None) -> List[dict]:
    token = get_access_token()
    box = mailbox or get_mailbox()
    if not token or not box:
        return []

    resp = httpx.get(
        f"{GRAPH}/users/{box}/mailFolders/{folder}/messages",
        headers={"Authorization": f"Bearer {token}"},
        params={"$top": top, "$orderby": "receivedDateTime desc", "$select": "id,subject,from,receivedDateTime,body,isRead,conversationId"},
        timeout=30
    )

    if resp.status_code == 200:
        return resp.json().get("value", [])
    logger.error(f"Email read failed: {resp.status_code}")
    return []
