"""Urgent-mails (direct na het ophalen) en de wekelijkse digest."""
from datetime import date
from pathlib import Path

from . import db, emails, mailer

PREVIEW_FILE = Path("voorbeeld-mail.html")


def _preview(subject: str, html: str) -> None:
    PREVIEW_FILE.write_text(html, encoding="utf-8")
    print(f"Voorbeeld opgeslagen in {PREVIEW_FILE.resolve()}  (onderwerp: {subject})")


def send_urgent() -> int:
    """Stuurt één mail met alle urgente items die nog niet gemeld zijn. Geeft het aantal terug."""
    items = db.urgent_items_to_send()
    if not items:
        return 0
    if not mailer.is_configured():
        print(f"‼ {len(items)} urgent item(s), maar mail is niet ingesteld; volgende run opnieuw proberen.")
        return 0

    subject, html, text = emails.urgent_mail(items)
    mailer.send_email(subject, html, text)
    db.record_digest("urgent", len(items))
    db.update_items([i["id"] for i in items], {"urgent_sent_at": db.now_iso()})
    print(f"✉ Urgent-mail verstuurd: {subject}")
    return len(items)


def send_digest(preview: bool = False, include_baseline: bool = False) -> int:
    """Wekelijkse digest met alle nog niet verstuurde items. Geen mail als er niets nieuws is."""
    items = db.items_for_digest(include_baseline=include_baseline)
    if not items:
        print("Niets nieuws sinds de vorige digest; er gaat geen mail uit.")
        return 0

    subject, html, text = emails.digest_mail(items, week=date.today().isocalendar().week)
    if preview:
        _preview(subject, html)
        return len(items)

    mailer.send_email(subject, html, text)
    digest_id = db.record_digest("weekly", len(items))
    db.update_items([i["id"] for i in items], {"digest_id": digest_id})
    print(f"✉ Digest verstuurd: {subject}")
    return len(items)


def send_test() -> None:
    subject, html, text = emails.test_mail()
    mailer.send_email(subject, html, text)
    print("✉ Testmail verstuurd.")
