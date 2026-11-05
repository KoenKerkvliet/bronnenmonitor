"""GitHub-releases via de openbare Atom-feed.

Als url mag je zowel 'owner/repo' als 'https://github.com/owner/repo' invullen.
"""
import re

from .. import http
from . import Item
from .rss import parse_feed


def feed_url(url: str) -> str:
    match = re.search(r"(?:github\.com/)?([\w.-]+)/([\w.-]+?)(?:\.git|/releases.*|/)?$", url.strip())
    if not match:
        raise ValueError(f"Kan geen owner/repo halen uit: {url}")
    owner, repo = match.groups()
    return f"https://github.com/{owner}/{repo}/releases.atom"


def fetch(source: dict) -> list[Item]:
    response = http.get(feed_url(source["url"]))
    return parse_feed(response.content)
