"""Mail versturen via de Emailit REST-API (https://api.emailit.com/v2/emails)."""
import uuid

import requests

from . import config


class MailError(RuntimeError):
    pass


def is_configured() -> bool:
    return bool(config.EMAILIT_API_KEY and config.EMAILIT_FROM and config.EMAILIT_TO)


def send_email(subject: str, html: str, text: str) -> None:
    """Verstuurt één mail naar EMAILIT_TO. `text` is een handgeschreven platte-tekstversie
    (geen gestripte HTML: dat scoort slecht bij spamfilters)."""
    if not is_configured():
        raise MailError("EMAILIT_API_KEY, EMAILIT_FROM en/of EMAILIT_TO ontbreken (zie .env.example).")

    body = {
        "from": config.EMAILIT_FROM,
        "to": config.EMAILIT_TO,
        "subject": subject,
        "html": html,
        "text": text,
        "headers": {
            "Auto-Submitted": "auto-generated",   # RFC 3834: systeemmail
            "X-Auto-Response-Suppress": "All",    # Outlook: geen afwezigheidsberichten
            "X-Entity-Ref-ID": str(uuid.uuid4()),
        },
    }
    if config.EMAILIT_REPLY_TO:
        body["reply_to"] = config.EMAILIT_REPLY_TO

    response = requests.post(
        "https://api.emailit.com/v2/emails",
        json=body,
        headers={"Authorization": f"Bearer {config.EMAILIT_API_KEY}"},
        timeout=30,
    )
    if response.status_code >= 400:
        raise MailError(f"Emailit {response.status_code}: {response.text[:300]}")
