"""HTML- en tekstversies van de mails.

Opgebouwd met tabellen en inline CSS (werkt ook in Outlook). Kleuren staan bovenaan.
Elk item is een dict uit de database met daarin `sources` (name, category).
"""
from datetime import datetime
from html import escape

from . import config

ACCENT = "#5b3fd1"
URGENT = "#c62828"
MUTED = "#6b6b6b"
BG = "#f4f4f6"

CATEGORY_LABELS = {
    "onderwijs": "Onderwijs",
    "webdesign": "Webdesign & tools",
    "security": "Privacy & security",
    "ai": "AI",
    "bbq": "BBQ",
}


# --- hulpjes -------------------------------------------------------------------

def category_label(category: str) -> str:
    return CATEGORY_LABELS.get(category, category.capitalize())


def display_title(item: dict) -> str:
    """Een kale versie als '4.0.2' wordt 'Bricksforge 4.0.2'; gewone titels blijven gelijk."""
    title = item["title"]
    if any(ch.isalpha() for ch in title):
        return title
    return f"{item['sources']['name']} {title}"


def short(text: str | None, length: int = 220) -> str:
    if not text:
        return ""
    return text if len(text) <= length else text[:length].rsplit(" ", 1)[0] + " …"


def nice_date(value: str | None) -> str:
    if not value:
        return ""
    return datetime.fromisoformat(value).strftime("%d-%m-%Y")


def group_by_category(items: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    # Nieuwste eerst, daarna (stabiel) gesorteerd op categorie en bron.
    newest_first = sorted(items, key=lambda i: i.get("published_at") or i["found_at"], reverse=True)
    for item in sorted(newest_first, key=lambda i: (i["sources"]["category"], i["sources"]["name"])):
        groups.setdefault(item["sources"]["category"], []).append(item)
    return groups


# --- HTML-bouwstenen -----------------------------------------------------------

def _layout(title: str, preheader: str, content: str) -> str:
    dashboard = ""
    if config.DASHBOARD_URL:
        dashboard = (f'<a href="{escape(config.DASHBOARD_URL)}" style="color:{ACCENT};text-decoration:none;">'
                     "Open het dashboard</a> &middot; ")
    return f"""<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:{BG};" bgcolor="{BG}">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:{BG};opacity:0;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="{BG}" style="background:{BG};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;">
<tr><td bgcolor="{ACCENT}" style="background:{ACCENT};padding:20px 28px;border-radius:8px 8px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#ffffff;font-size:20px;font-weight:bold;">{escape(title)}</td></tr>
<tr><td style="padding:8px 28px 24px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#222222;font-size:15px;line-height:1.5;">
{content}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #eeeeee;font-family:Arial,sans-serif;color:{MUTED};font-size:12px;">
{dashboard}Bronnenmonitor van Design Pixels
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _heading(text: str) -> str:
    return (f'<h2 style="margin:24px 0 8px 0;font-size:17px;color:{ACCENT};'
            f'border-bottom:2px solid {ACCENT};padding-bottom:4px;">{escape(text)}</h2>')


def _item_html(item: dict, show_urgent_label: bool = True) -> str:
    label = ""
    if show_urgent_label and item.get("is_urgent"):
        label = (f'<span style="background:{URGENT};color:#ffffff;font-size:11px;font-weight:bold;'
                 'padding:2px 6px;border-radius:3px;">URGENT</span> ')
    title = escape(display_title(item))
    if item.get("url"):
        title = f'<a href="{escape(item["url"])}" style="color:#222222;text-decoration:underline;">{title}</a>'
    meta = " &middot; ".join(x for x in [escape(item["sources"]["name"]), nice_date(item.get("published_at"))] if x)
    summary = escape(short(item.get("summary")))
    return (f'<p style="margin:12px 0 0 0;">{label}<strong>{title}</strong><br>'
            f'<span style="color:{MUTED};font-size:12px;">{meta}</span>'
            + (f'<br><span style="font-size:14px;">{summary}</span>' if summary else "")
            + "</p>")


def _item_text(item: dict) -> str:
    lines = [f"- {'[URGENT] ' if item.get('is_urgent') else ''}{display_title(item)}"]
    date = nice_date(item.get("published_at"))
    lines.append(f"  {item['sources']['name']}{' -- ' + date if date else ''}")
    if item.get("summary"):
        lines.append(f"  {short(item['summary'], 180)}")
    if item.get("url"):
        lines.append(f"  {item['url']}")
    return "\n".join(lines)


def _text_footer() -> str:
    footer = "\n\n--\nBronnenmonitor van Design Pixels"
    if config.DASHBOARD_URL:
        footer += f"\nDashboard: {config.DASHBOARD_URL}"
    return footer


# --- de mails --------------------------------------------------------------------

def urgent_mail(items: list[dict]) -> tuple[str, str, str]:
    """Geeft (onderwerp, html, tekst) voor een urgent-melding."""
    first = display_title(items[0])
    subject = f"Urgent: {first}" if len(items) == 1 else f"Urgent: {len(items)} meldingen, o.a. {first}"
    intro = ("Er is een nieuw bericht gevonden met een urgent trefwoord (bijv. security of kritiek)."
             if len(items) == 1 else
             f"Er zijn {len(items)} nieuwe berichten gevonden met een urgent trefwoord (bijv. security of kritiek).")

    html = f'<p style="margin:16px 0 0 0;">{intro}</p>' + "".join(_item_html(i, show_urgent_label=False) for i in items)
    text = "Hoi,\n\n" + intro + "\n\n" + "\n\n".join(_item_text(i) for i in items) + _text_footer()
    return subject, _layout("Urgente melding", intro, html), text


def digest_mail(items: list[dict], week: int) -> tuple[str, str, str]:
    """Geeft (onderwerp, html, tekst) voor de wekelijkse digest, gegroepeerd per categorie."""
    subject = f"Weekdigest week {week}: {len(items)} {'nieuw item' if len(items) == 1 else 'nieuwe items'}"
    groups = group_by_category(items)
    overview = ", ".join(f"{len(v)} {category_label(k).lower()}" for k, v in groups.items())
    intro = f"Dit is er deze week nieuw ({overview})."

    html_parts = [f'<p style="margin:16px 0 0 0;">{escape(intro)}</p>']
    text_parts = ["Hoi,", intro]
    for category, group in groups.items():
        html_parts.append(_heading(f"{category_label(category)} ({len(group)})"))
        html_parts.extend(_item_html(i) for i in group)
        text_parts.append(f"== {category_label(category)} ({len(group)}) ==\n\n" + "\n\n".join(_item_text(i) for i in group))

    return subject, _layout(f"Weekdigest week {week}", intro, "".join(html_parts)), "\n\n".join(text_parts) + _text_footer()


def test_mail() -> tuple[str, str, str]:
    body = "Dit is een testmail van de bronnenmonitor. Komt deze aan, dan werkt het versturen via Emailit."
    return ("Testmail — Bronnenmonitor", _layout("Testmail", body, f'<p style="margin:16px 0 0 0;">{body}</p>'),
            f"Hoi,\n\n{body}" + _text_footer())
