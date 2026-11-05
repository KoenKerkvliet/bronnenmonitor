"""Ophalers per brontype. Elke ophaler krijgt een bron (dict) en geeft een lijst Items terug."""
import hashlib
import html
import re
from dataclasses import dataclass, field
from datetime import datetime

from .. import config


@dataclass
class Item:
    item_key: str
    title: str
    url: str | None = None
    summary: str | None = None
    published_at: datetime | None = None
    tags: list[str] = field(default_factory=list)


def clean_text(value: str | None) -> str:
    """HTML-tags en overbodige witruimte weghalen, en inkorten."""
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > config.MAX_SUMMARY_LENGTH:
        text = text[: config.MAX_SUMMARY_LENGTH].rsplit(" ", 1)[0] + " …"
    return text


def make_key(*parts: str | None) -> str:
    """Stabiele sleutel als een bron zelf geen id levert."""
    joined = "|".join(p or "" for p in parts)
    return "sha1:" + hashlib.sha1(joined.encode("utf-8")).hexdigest()


def get_fetcher(source_type: str):
    # Import hier, zodat een kapotte ophaler de andere niet blokkeert.
    if source_type == "rss":
        from .rss import fetch
    elif source_type == "github":
        from .github import fetch
    elif source_type == "page":
        from .page import fetch
    else:
        raise ValueError(f"Onbekend brontype: {source_type}")
    return fetch
