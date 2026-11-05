"""Eén gedeelde HTTP-sessie met User-Agent, timeouts en automatische retries."""
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import config

_session = None


def session() -> requests.Session:
    global _session
    if _session is None:
        retry = Retry(
            total=config.RETRIES,
            backoff_factor=1.5,  # wacht 0s, 3s, 6s ... tussen pogingen
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "HEAD"],
        )
        s = requests.Session()
        s.headers["User-Agent"] = config.USER_AGENT
        s.mount("https://", HTTPAdapter(max_retries=retry))
        s.mount("http://", HTTPAdapter(max_retries=retry))
        _session = s
    return _session


def get(url: str) -> requests.Response:
    """Haal een URL op; geeft een fout bij een HTTP-status vanaf 400."""
    response = session().get(url, timeout=config.TIMEOUT_SECONDS)
    response.raise_for_status()
    return response
