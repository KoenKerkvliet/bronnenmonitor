"""RSS- en Atom-feeds."""
from datetime import datetime, timezone

import feedparser

from .. import http
from . import Item, clean_text, make_key


def _date(entry) -> datetime | None:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    return datetime(*parsed[:6], tzinfo=timezone.utc)


def parse_feed(content: bytes) -> list[Item]:
    feed = feedparser.parse(content)
    if feed.bozo and not feed.entries:
        raise ValueError(f"Geen geldige feed: {feed.bozo_exception}")

    items = []
    for entry in feed.entries:
        title = clean_text(entry.get("title")) or "(zonder titel)"
        link = entry.get("link")
        key = entry.get("id") or link or make_key(title, entry.get("published"))
        summary = entry.get("summary")
        if not summary and entry.get("content"):
            summary = entry.content[0].get("value")
        tags = [t.get("term") for t in entry.get("tags", []) if t.get("term")]
        items.append(
            Item(
                item_key=key,
                title=title,
                url=link,
                summary=clean_text(summary),
                published_at=_date(entry),
                tags=tags,
            )
        )
    return items


def fetch(source: dict) -> list[Item]:
    response = http.get(source["url"])
    return parse_feed(response.content)
