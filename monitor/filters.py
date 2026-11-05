"""Trefwoordfilters (include/exclude per bron) en de urgent-check. Bewust simpel, zonder AI."""
import re

from . import config
from .fetchers import Item


def _pattern(word: str) -> re.Pattern:
    word = word.strip()
    if word.endswith("*"):
        return re.compile(r"\b" + re.escape(word[:-1]), re.IGNORECASE)
    return re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE)


def _text(item: Item) -> str:
    return " ".join([item.title or "", item.summary or "", " ".join(item.tags)])


def matches_any(item: Item, words: list[str]) -> bool:
    text = _text(item)
    return any(_pattern(w).search(text) for w in words if w and w.strip())


def passes_filters(item: Item, source: dict) -> bool:
    """Lege include-lijst = alles doorlaten. Exclude wint altijd."""
    include = source.get("include_keywords") or []
    exclude = source.get("exclude_keywords") or []
    if exclude and matches_any(item, exclude):
        return False
    if include and not matches_any(item, include):
        return False
    return True


def is_urgent(item: Item) -> bool:
    text = _text(item)
    for phrase in config.URGENT_IGNORE:
        text = re.sub(re.escape(phrase), " ", text, flags=re.IGNORECASE)
    return any(_pattern(w).search(text) for w in config.URGENT_KEYWORDS)
