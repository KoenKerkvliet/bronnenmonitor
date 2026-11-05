"""Opdrachtregel.

  python -m monitor fetch                  alle actieve bronnen ophalen en opslaan
  python -m monitor fetch --bron "Etch"    één bron (op naam)
  python -m monitor test rss <url>         een bron proberen zónder database (handig vóór toevoegen)
"""
import argparse
import sys

from . import filters


def cmd_test(source_type: str, url: str) -> int:
    from .fetchers import get_fetcher

    items = get_fetcher(source_type)({"url": url, "type": source_type})
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

    args = parser.parse_args()
    if args.command == "fetch":
        from . import fetch
        fetch.run(args.bron)
        return 0
    if args.command == "test":
        return cmd_test(args.type, args.url)
    return 1


if __name__ == "__main__":
    sys.exit(main())
