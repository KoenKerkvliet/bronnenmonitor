"""De ophaalrun: alle actieve bronnen langs, nieuwe items opslaan.

Een fout bij één bron wordt bij die bron gelogd en stopt de run nooit.
"""
import traceback

from . import db, filters
from .fetchers import Item, get_fetcher


def _to_row(item: Item, source: dict, baseline: bool) -> dict:
    return {
        "source_id": source["id"],
        "item_key": item.item_key,
        "title": item.title,
        "url": item.url,
        "summary": item.summary or None,
        "tags": item.tags,
        "published_at": item.published_at.isoformat() if item.published_at else None,
        # Urgent kan per bron uit staan (kolom urgent_enabled; ontbreekt die nog, dan geldt "aan").
        "is_urgent": source.get("urgent_enabled", True) and filters.is_urgent(item),
        "is_baseline": baseline,
    }


def fetch_source(source: dict) -> list[dict]:
    """Haalt één bron op en slaat nieuwe items op. Geeft de nieuwe rijen terug."""
    fetch = get_fetcher(source["type"])
    items = fetch(source)
    kept = [i for i in items if filters.passes_filters(i, source)]

    # Nulmeting: de eerste succesvolle run van een bron slaat alles op zonder te mailen.
    baseline = source.get("last_success_at") is None

    # Dubbele sleutels binnen één feed voorkomen (Postgres weigert dan de hele batch).
    unique = {i.item_key: i for i in kept}.values()
    new_rows = db.insert_new_items([_to_row(i, source, baseline) for i in unique])

    now = db.now_iso()
    db.update_source(source["id"], {"last_checked_at": now, "last_success_at": now, "last_error": None})
    print(f"  ✔ {source['name']}: {len(items)} gevonden, {len(kept)} na filter, {len(new_rows)} nieuw"
          + (" (nulmeting)" if baseline and new_rows else ""))
    return new_rows


def run(only: str | None = None) -> list[dict]:
    sources = db.active_sources(only)
    print(f"{len(sources)} actieve bron(nen)")
    all_new = []
    for source in sources:
        try:
            all_new.extend(fetch_source(source))
        except Exception as exc:  # bewust breed: één bron mag de run niet breken
            message = f"{type(exc).__name__}: {exc}"
            print(f"  ✘ {source['name']}: {message}")
            traceback.print_exc()
            try:
                now = db.now_iso()
                db.update_source(source["id"], {"last_checked_at": now, "last_error": message[:1000], "last_error_at": now})
            except Exception as db_exc:
                print(f"    (kon fout niet opslaan: {db_exc})")

    urgent = [r for r in all_new if r["is_urgent"] and not r["is_baseline"]]
    print(f"Klaar: {len(all_new)} nieuwe items, waarvan {len(urgent)} urgent.")

    # Urgent-mail. Kijkt naar álle nog niet gemelde urgente items, dus als een eerdere
    # mail mislukte, gaat die alsnog mee.
    from . import notify
    try:
        notify.send_urgent()
    except Exception as exc:
        print(f"‼ Urgent-mail mislukt: {exc}")
    return all_new
