"""Instellingen voor de bronnenmonitor. Geheimen komen uit omgevingsvariabelen (.env of GitHub secrets)."""
import os

from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
# Service role key (eyJ...) óf de nieuwe secret key (sb_secret_...). Nooit in de frontend gebruiken!
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Mail via Emailit (fase 3)
EMAILIT_API_KEY = os.getenv("EMAILIT_API_KEY", "")
EMAILIT_FROM = os.getenv("EMAILIT_FROM", "Bronnenmonitor <monitor@digest.designpixels.nl>")
EMAILIT_TO = os.getenv("EMAILIT_TO", "")            # ontvanger van digest en urgent-mails
EMAILIT_REPLY_TO = os.getenv("EMAILIT_REPLY_TO", "")
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://koenkerkvliet.github.io/bronnenmonitor/")

# Netjes ophalen
USER_AGENT = "Bronnenmonitor/1.0 (+https://github.com/KoenKerkvliet/bronnenmonitor)"
TIMEOUT_SECONDS = 20
RETRIES = 3

# Hoeveel tekens van een samenvatting bewaren we maximaal
MAX_SUMMARY_LENGTH = 1500

# Een item is urgent als titel, samenvatting of tags één van deze woorden bevatten.
# Hele woorden, hoofdletterongevoelig. Woorden die eindigen op * matchen ook langere woorden
# (bijv. "kwetsba*" vindt kwetsbaar, kwetsbaarheid, kwetsbaarheden).
URGENT_KEYWORDS = [
    "security",
    "vulnerabilit*",
    "critical",
    "exploit*",
    "CVE",
    "XSS",
    "kritiek*",
    "kwetsba*",
    "beveiligingslek*",
    "datalek*",
]

# Zinnen die eerst uit de tekst worden gehaald, zodat ze geen vals alarm geven.
# Bijv. elke WordPress-beta waarschuwt: "do not install on mission-critical websites".
URGENT_IGNORE = [
    "mission-critical",
    "mission critical",
]
