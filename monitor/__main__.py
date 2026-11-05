"""Opdrachtregel.

  python -m monitor fetch                  alle actieve bronnen ophalen en opslaan
  python -m monitor fetch --bron "Etch"    één bron (op naam)
  python -m monitor digest                 wekelijkse digest versturen (niets nieuws = geen mail)
  python -m monitor digest --voorbeeld     digest als HTML-bestand bekijken, zonder versturen
  python -m monitor testmail               testmail om Emailit te controleren
  python -m monitor test rss <url>         een bron proberen zónder database (handig vóór toevoegen)
  python -m monitor test page <url> --selector ".content" --patroon "^\\d+\\.\\d+(\\.\\d+)?$"
"""
import argparse
import sys

from . import filters


def cmd_test(source_type: str, url: str, selector: str | None = None, pattern: str | None = None) -> int:
    from .fetchers import get_fetcher

    source = {"url": url, "type": source_type, "selector": selector, "item_pattern": pattern}
    try:
        items = get_fetcher(source_type)(source)
    except Exception as exc:
        print(f"✘ {type(exc).__name__}: {exc}")
        return 1
    if source_type == "page":
        print("HTML-check: ✔ de inhoud staat in de HTML (niet alleen via JavaScript geladen)")
    print(f"{len(items)} items gevonden\n")
    for item in items[:15]:
        flag = "‼ URGENT " if filters.is_urgent(item) else ""
        date = item.published_at.date() if item.published_at else "geen datum"
        print(f"- {flag}{item.title}  [{date}]")
        print(f"    sleutel: {item.item_key}")
        if item.tags:
            print(f"    tags: {', '.join(item.tags)}")
        if item.summary:
            print(f"    {item.summary[:160]}")
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="monitor", description="Bronnenmonitor")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="bronnen ophalen en nieuwe items opslaan")
    p_fetch.add_argument("--bron", help="alleen deze bron (naam)")

    p_test = sub.add_parser("test", help="bron proberen zonder database")
    p_test.add_argument("type", choices=["rss", "github", "page"])
    p_test.add_argument("url")
    p_test.add_argument("--selector", help="page: CSS-selector van het relevante deel")
    p_test.add_argument("--patroon", help="page: regex voor één item (bijv. een versienummer)")

    p_digest = sub.add_parser("digest", help="wekelijkse digest versturen")
    p_digest.add_argument("--voorbeeld", action="store_true", help="niet versturen, alleen HTML-bestand maken")
    p_digest.add_argument("--alles", action="store_true", help="ook nulmeting-items meenemen (alleen met --voorbeeld)")

    sub.add_parser("testmail", help="testmail versturen om Emailit te controleren")

    args = parser.parse_args()
    if args.command == "digest":
        from . import notify
        if args.alles and not args.voorbeeld:
            parser.error("--alles kan alleen samen met --voorbeeld")
        notify.send_digest(preview=args.voorbeeld, include_baseline=args.alles)
        return 0
    if args.command == "testmail":
        from . import notify
        notify.send_test()
        return 0
    if args.command == "fetch":
        from . import fetch
        fetch.run(args.bron)
        return 0
    if args.command == "test":
        return cmd_test(args.type, args.url, args.selector, args.patroon)
    return 1


if __name__ == "__main__":
    sys.exit(main())
