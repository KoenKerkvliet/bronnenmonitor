"""Gewone webpagina's zonder feed.

Per bron stel je twee dingen in:

  selector      CSS-selector: welk deel van de pagina (of welke elementen) de items bevat
  item_pattern  regex die bepaalt wat één item is (bij kaarten en links optioneel)

Er zijn drie modi. De ophaler kiest zelf, op basis van wat de selector oplevert:

  1. Kaartmodus: de selector vindt meerdere blokken (bijv. nieuwskaarten). Elk blok is één item:
     titel = eerste kop of element met "title" in de class, link = het blok zelf of de eerste
     link erin, datum en intro uit de tekst, labels (tag/categorie) als tags. De sleutel is de link.
     item_pattern (optioneel) moet passen op de link.
     Voorbeeld PO-Raad:  selector "article.node-article-card"

  2. Linkmodus: de selector vindt alleen eenvoudige links (<a> zonder blokken erin). Elke link
     waarvan de href of tekst op item_pattern past, is een item. De sleutel is de link.
     Voorbeeld Etch-index:  selector "a[href*='/changelog/']"  patroon "/changelog/\\d+-\\d+-\\d+/?$"

  3. Koppenmodus: de selector vindt één gebied. Elke kop (h1–h6) daarin waarvan de tekst volledig
     op item_pattern past, is een item; de tekst eronder (tot de volgende passende kop) is de
     samenvatting. De sleutel is de koptekst (bijv. "4.0.2"). Hier is item_pattern verplicht.
     Voorbeeld Bricksforge:  selector ".brxe-post-content"  patroon "^\\d+\\.\\d+(\\.\\d+)?$"

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
BLOCKS = ["div", "p", "article", "section", "ul", *HEADINGS]

MONTHS = {
    # Engels
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    # Nederlands (alleen waar anders dan Engels)
    "januari": 1, "februari": 2, "maart": 3, "mei": 5, "juni": 6, "juli": 7, "augustus": 8, "oktober": 10,
    # Afkortingen (Engels en Nederlands)
    "jan": 1, "feb": 2, "mar": 3, "mrt": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "okt": 10, "nov": 11, "dec": 12,
}
# Langste namen eerst, zodat "november" niet als "nov" + rest wordt gelezen.
_MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))
_DATE_DMY = re.compile(rf"\b(\d{{1,2}})\.?\s+({_MONTH_RE})\.?\s+(\d{{4}})\b", re.IGNORECASE)  # 13. October 2026 / 04 nov 2026
_DATE_MDY = re.compile(rf"\b({_MONTH_RE})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})\b", re.IGNORECASE)   # October 13, 2026
_DATE_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_DATE_NUM = re.compile(r"\b(\d{1,2})-(\d{1,2})-(\d{4})\b")                                     # 04-11-2026

# Knopteksten die we niet in een samenvatting willen
_BUTTON_TEXT = re.compile(r"\b(Lees verder|Lees meer|Read more|Meer lezen)\b", re.IGNORECASE)


class NothingFound(ValueError):
    pass


def find_date(text: str) -> datetime | None:
    """Zoekt de eerste herkenbare datum in een stuk tekst."""
    head = text[:300]
    try:
        if m := _DATE_DMY.search(head):
            return datetime(int(m[3]), MONTHS[m[2].lower()], int(m[1]), tzinfo=timezone.utc)
        if m := _DATE_MDY.search(head):
            return datetime(int(m[3]), MONTHS[m[1].lower()], int(m[2]), tzinfo=timezone.utc)
        if m := _DATE_ISO.search(head):
            return datetime(int(m[1]), int(m[2]), int(m[3]), tzinfo=timezone.utc)
        if m := _DATE_NUM.search(head):
            return datetime(int(m[3]), int(m[2]), int(m[1]), tzinfo=timezone.utc)
    except ValueError:
        pass
    return None


# --- koppenmodus -------------------------------------------------------------------

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
            items.append(Item(item_key=label, title=label, url=page_url,
                              summary=clean_text(body), published_at=find_date(body)))
    return items


# --- linkmodus ---------------------------------------------------------------------

def _link_items(links: list[Tag], pattern: re.Pattern | None, page_url: str) -> list[Item]:
    items, seen = [], set()
    for link in links:
        href = urljoin(page_url, link.get("href", ""))
        text = link.get_text(" ", strip=True)
        if pattern and not (pattern.search(href) or pattern.search(text)):
            continue
        if href in seen:
            continue
        seen.add(href)
        items.append(Item(item_key=href, title=text or href, url=href))
    return items


# --- kaartmodus --------------------------------------------------------------------

def _has_class(element: Tag, *words: str) -> bool:
    classes = " ".join(element.get("class", [])).lower()
    return any(w in classes for w in words)


def _leaves(card: Tag) -> list[Tag]:
    """Elementen zonder kind-elementen, maar wél met tekst."""
    return [e for e in card.find_all(True) if e.find(True) is None and e.get_text(strip=True)]


def _card_item(card: Tag, pattern: re.Pattern | None, page_url: str) -> Item | None:
    # Link: het blok zelf, of de eerste link erin die op het patroon past
    links = [card] if card.name == "a" and card.get("href") else card.find_all("a", href=True)
    hrefs = [urljoin(page_url, a["href"]) for a in links]
    if pattern:
        hrefs = [h for h in hrefs if pattern.search(h)]
    if not hrefs:
        return None
    url = hrefs[0]

    # Titel: eerste kop, anders het langste element met "title" in de class (zo wint de echte
    # titel van bijv. een datum in "card__top-title"), anders de linktekst
    title_candidates = [e for e in card.find_all(True) if _has_class(e, "title") and e.get_text(strip=True)]
    title_el = card.find(HEADINGS) or max(title_candidates, key=lambda e: len(e.get_text(strip=True)), default=None)
    title = title_el.get_text(" ", strip=True) if title_el else links[0].get_text(" ", strip=True)
    if not title:
        return None

    # Labels zoals "Nieuws" of "MBO" worden tags (handig om op te filteren)
    tags = []
    for leaf in _leaves(card):
        if _has_class(leaf, "tag", "category", "label", "type") and not _has_class(leaf, "title"):
            text = leaf.get_text(" ", strip=True)
            if text.lower() not in ("alle", "all") and text not in tags:
                tags.append(text)

    # Intro: element met text/body/intro/summary/excerpt in de class, of een <p>
    summary_el = next((e for e in card.find_all(True)
                       if (_has_class(e, "text", "body", "intro", "summary", "excerpt", "teaser") or e.name == "p")
                       and not _has_class(e, "title") and e.get_text(strip=True)
                       and e.get_text(strip=True) != title), None)
    summary = summary_el.get_text(" ", strip=True) if summary_el else ""
    summary = _BUTTON_TEXT.sub("", summary).strip()

    return Item(item_key=url, title=title, url=url, summary=clean_text(summary),
                published_at=find_date(card.get_text(" ", strip=True)), tags=tags)


def _card_items(cards: list[Tag], pattern: re.Pattern | None, page_url: str) -> list[Item]:
    items, seen = [], set()
    for card in cards:
        item = _card_item(card, pattern, page_url)
        if item and item.item_key not in seen:
            seen.add(item.item_key)
            items.append(item)
    return items


# --- algemeen ----------------------------------------------------------------------

def detect_mode(regions: list[Tag]) -> str:
    if all(r.name == "a" and not r.find(BLOCKS) for r in regions):
        return "link"
    if len(regions) > 1:
        return "kaart"
    return "koppen"


def parse_page(html: str | bytes, source: dict) -> list[Item]:
    soup = BeautifulSoup(html, "html.parser")
    for junk in soup(["script", "style", "noscript", "svg", "template"]):
        junk.decompose()

    selector = (source.get("selector") or "").strip()
    pattern_text = (source.get("item_pattern") or "").strip()
    pattern = re.compile(pattern_text) if pattern_text else None

    regions = soup.select(selector) if selector else [soup]
    if not regions:
        raise NothingFound(
            f"Selector '{selector}' vindt niets op de pagina. Is de site aangepast, "
            "of wordt dit deel pas door JavaScript geladen?"
        )

    mode = detect_mode(regions)
    if mode == "link":
        items = _link_items(regions, pattern, source["url"])
    elif mode == "kaart":
        items = _card_items(regions, pattern, source["url"])
    else:
        if not pattern:
            raise ValueError("Koppenmodus (selector vindt één gebied) heeft een item_pattern (regex) nodig.")
        items = _heading_items(regions, pattern, source["url"])

    if not items:
        text_length = sum(len(r.get_text(strip=True)) for r in regions)
        raise NothingFound(
            f"{mode.capitalize()}modus: selector gevonden ({len(regions)}×, {text_length} tekens tekst), "
            f"maar geen enkel item herkend (patroon: '{pattern_text or '-'}'). Mogelijk wordt de inhoud "
            "via JavaScript geladen of is de opbouw van de pagina veranderd."
        )
    return items


def fetch(source: dict) -> list[Item]:
    response = http.get(source["url"])
    # Bytes doorgeven: BeautifulSoup leest zelf de juiste tekenset uit de HTML.
    return parse_page(response.content, source)
