"""Kleine laag rond de Supabase REST-API (PostgREST). Gebruikt de service key, dus omzeilt RLS."""
from datetime import datetime, timezone

import requests

from . import config


class DatabaseError(RuntimeError):
    pass


def _headers(extra: dict | None = None) -> dict:
    if not config.SUPABASE_URL or not config.SUPABASE_KEY:
        raise DatabaseError("SUPABASE_URL en/of SUPABASE_SERVICE_KEY ontbreken (zie .env.example).")
    headers = {"apikey": config.SUPABASE_KEY, "Content-Type": "application/json"}
    # Oude JWT-sleutels (eyJ...) moeten ook als Bearer mee; nieuwe sb_secret_-sleutels niet.
    if config.SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {config.SUPABASE_KEY}"
    if extra:
        headers.update(extra)
    return headers


def _request(method: str, table: str, params=None, json=None, prefer: str | None = None):
    url = f"{config.SUPABASE_URL}/rest/v1/{table}"
    extra = {"Prefer": prefer} if prefer else None
    response = requests.request(method, url, params=params, json=json, headers=_headers(extra), timeout=30)
    if response.status_code >= 400:
        raise DatabaseError(f"{method} {table}: {response.status_code} {response.text[:300]}")
    return response.json() if response.content else None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- bronnen ---------------------------------------------------------------

def active_sources(name: str | None = None) -> list[dict]:
    params = {"select": "*", "active": "eq.true", "order": "name"}
    if name:
        params["name"] = f"ilike.{name}"
    return _request("GET", "sources", params=params)


def update_source(source_id: str, fields: dict) -> None:
    _request("PATCH", "sources", params={"id": f"eq.{source_id}"}, json=fields)


# --- items -----------------------------------------------------------------

ITEM_FIELDS = "id,title,url,summary,published_at,found_at,is_urgent,tags,sources(name,category)"


def items_for_digest(include_baseline: bool = False) -> list[dict]:
    """Nog niet in een digest verstuurde items (nulmeting-items standaard niet)."""
    params = {"select": ITEM_FIELDS, "digest_id": "is.null", "order": "found_at"}
    if not include_baseline:
        params["is_baseline"] = "is.false"
    return _request("GET", "items", params=params)


def urgent_items_to_send() -> list[dict]:
    """Urgente items waarvoor nog geen urgent-mail is verstuurd."""
    params = {"select": ITEM_FIELDS, "is_urgent": "is.true", "is_baseline": "is.false",
              "urgent_sent_at": "is.null", "order": "found_at"}
    return _request("GET", "items", params=params)


def update_items(ids: list[str], fields: dict) -> None:
    if ids:
        _request("PATCH", "items", params={"id": f"in.({','.join(ids)})"}, json=fields)


def record_digest(kind: str, item_count: int) -> str:
    rows = _request("POST", "digests", json={"kind": kind, "item_count": item_count}, prefer="return=representation")
    return rows[0]["id"]

def insert_new_items(rows: list[dict]) -> list[dict]:
    """Voegt items toe en slaat bestaande (source_id, item_key) over.
    Geeft alleen de écht nieuwe rijen terug."""
    if not rows:
        return []
    return _request(
        "POST",
        "items",
        params={"on_conflict": "source_id,item_key"},
        json=rows,
        prefer="resolution=ignore-duplicates,return=representation",
    )
