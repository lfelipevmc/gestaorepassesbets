import msal
import httpx
from ..config import settings
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)


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


def send_email(to: List[str], subject: str, body: str, cc: Optional[List[str]] = None) -> bool:
    token = get_access_token()
    if not token or not settings.OFFICE_EMAIL:
        logger.warning("Email service not configured")
        return False

    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "HTML", "content": body.replace("\n", "<br>")},
            "toRecipients": [{"emailAddress": {"address": addr}} for addr in to],
            "ccRecipients": [{"emailAddress": {"address": addr}} for addr in (cc or [])],
        },
        "saveToSentItems": True
    }

    resp = httpx.post(
        f"https://graph.microsoft.com/v1.0/users/{settings.OFFICE_EMAIL}/sendMail",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=30
    )

    if resp.status_code == 202:
        return True
    logger.error(f"Email send failed: {resp.status_code} {resp.text}")
    return False


def read_inbox_emails(folder: str = "inbox", top: int = 50) -> List[dict]:
    token = get_access_token()
    if not token or not settings.OFFICE_EMAIL:
        return []

    resp = httpx.get(
        f"https://graph.microsoft.com/v1.0/users/{settings.OFFICE_EMAIL}/mailFolders/{folder}/messages",
        headers={"Authorization": f"Bearer {token}"},
        params={"$top": top, "$orderby": "receivedDateTime desc", "$select": "id,subject,from,receivedDateTime,body,isRead,conversationId"},
        timeout=30
    )

    if resp.status_code == 200:
        return resp.json().get("value", [])
    logger.error(f"Email read failed: {resp.status_code}")
    return []
