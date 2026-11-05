"""Gewone webpagina's zonder feed.

Per bron stel je twee dingen in:

  selector      CSS-selector van het deel van de pagina waar de items staan (leeg = hele pagina)
  item_pattern  regex die bepaalt wat één item is

Er zijn twee modi, afhankelijk van wat de selector oplevert:

  1. Koppenmodus (standaard): binnen het geselecteerde deel wordt elke kop (h1–h6) waarvan de
     tekst volledig op item_pattern past een item. De sleutel is die koptekst (bijv. "4.0.2"),
     de samenvatting is de tekst die erna komt tot de volgende passende kop.
     Voorbeeld Bricksforge:  selector ".brxe-post-content"  patroon "^\\d+\\.\\d+(\\.\\d+)?$"

  2. Linkmodus: als de selector alleen <a>-elementen oplevert, wordt elke link waarvan de
     href óf de tekst op item_pattern past een item. De sleutel is de (absolute) link.
     Voorbeeld Etch-index:  selector "a[href*='/changelog/']"  patroon "/changelog/\\d+-\\d+-\\d+/?$"

Vindt de ophaler niets, dan geeft hij een fout. Meestal betekent dat: de selector klopt niet meer
(site aangepast) of de inhoud wordt pas door JavaScript geladen en staat niet in de HTML.
"""
import re
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .. import http
from . import Item, clean_text

HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"]

MONTHS = {
    # Engels
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    # Nederlands (alleen waar anders dan Engels)
    "januari": 1, "februari": 2, "maart": 3, "mei": 5, "juni": 6, "juli": 7, "augustus": 8, "oktober": 10,
}
_MONTH_RE = "|".join(MONTHS)
_DATE_DMY = re.compile(rf"\b(\d{{1,2}})\.?\s+({_MONTH_RE})\s+(\d{{4}})\b", re.IGNORECASE)   # 13. October 2026
_DATE_MDY = re.compile(rf"\b({_MONTH_RE})\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.IGNORECASE)    # October 13, 2026
_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


class NothingFound(ValueError):
    pass


def find_date(text: str) -> datetime | None:
    """Zoekt de eerste herkenbare datum in een stuk tekst."""
    head = text[:200]
    try:
        if m := _DATE_DMY.search(head):
            return datetime(int(m[3]), MONTHS[m[2].lower()], int(m[1]), tzinfo=timezone.utc)
        if m := _DATE_MDY.search(head):
            return datetime(int(m[3]), MONTHS[m[1].lower()], int(m[2]), tzinfo=timezone.utc)
        if m := _DATE_ISO.search(head):
            return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc)
    except ValueError:
        pass
    return None


def _text_after(heading: Tag, pattern: re.Pattern) -> str:
    """Tekst van de elementen ná een kop, tot de volgende kop die ook een item is."""
    parts = []
    for sibling in heading.find_next_siblings():
        if sibling.name in HEADINGS and pattern.fullmatch(sibling.get_text(strip=True)):
            break
        if any(pattern.fullmatch(h.get_text(strip=True)) for h in sibling.find_all(HEADINGS)):
            break
        parts.append(sibling.get_text(" ", strip=True))
    return " ".join(p for p in parts if p)


def _heading_items(regions: list[Tag], pattern: re.Pattern, page_url: str) -> list[Item]:
    items = []
    for region in regions:
        for heading in region.find_all(HEADINGS):
            label = heading.get_text(" ", strip=True)
            if not pattern.fullmatch(label):
                continue
            body = _text_after(heading, pattern)
            items.append(
                Item(
                    item_key=label,
                    title=label,
                    url=page_url,
                    summary=clean_text(body),
                    published_at=find_date(body),
                )
            )
    return items


def _link_items(links: list[Tag], pattern: re.Pattern, page_url: str) -> list[Item]:
    items, seen = [], set()
    for link in links:
        href = urljoin(page_url, link.get("href", ""))
        text = link.get_text(" ", strip=True)
        if not (pattern.search(href) or pattern.search(text)) or href in seen:
            continue
        seen.add(href)
        items.append(Item(item_key=href, title=text or href, url=href))
    return items


def parse_page(html: str | bytes, source: dict) -> list[Item]:
    soup = BeautifulSoup(html, "html.parser")
    for junk in soup(["script", "style", "noscript", "svg", "template"]):
        junk.decompose()

    selector = (source.get("selector") or "").strip()
    pattern_text = (source.get("item_pattern") or "").strip()
    if not pattern_text:
        raise ValueError("Page-bron heeft geen item_pattern (regex) ingesteld.")
    pattern = re.compile(pattern_text)

    regions = soup.select(selector) if selector else [soup]
    if not regions:
        raise NothingFound(
            f"Selector '{selector}' vindt niets op de pagina. Is de site aangepast, "
            "of wordt dit deel pas door JavaScript geladen?"
        )

    if all(r.name == "a" for r in regions):
        items = _link_items(regions, pattern, source["url"])
    else:
        items = _heading_items(regions, pattern, source["url"])

    if not items:
        text_length = sum(len(r.get_text(strip=True)) for r in regions)
        raise NothingFound(
            f"Selector gevonden ({len(regions)}×, {text_length} tekens tekst), maar geen enkel item "
            f"past op patroon '{pattern_text}'. Mogelijk wordt de inhoud via JavaScript geladen "
            "of is de opbouw van de pagina veranderd."
        )
    return items


def fetch(source: dict) -> list[Item]:
    response = http.get(source["url"])
    # Bytes doorgeven: BeautifulSoup leest zelf de juiste tekenset uit de HTML.
    return parse_page(response.content, source)
