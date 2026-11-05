# Bronnenmonitor

Persoonlijke monitor die nieuws en changelogs volgt, filtert, opslaat in Supabase en mailt:
direct bij urgente berichten (security, kritiek…) en wekelijks een digest.

- **Dashboard:** https://koenkerkvliet.github.io/bronnenmonitor/
- **Bronnen nu:** Kennisnet (artikelen + nieuws), WordPress News, Bricks Builder, Etch, Bricksforge

## Hoe het werkt

```
GitHub Actions (schema)
 ├─ fetch.yml      3× per dag  → python -m monitor fetch   → Supabase (sources, items)
 │                                                          → Emailit: urgent-mail
 ├─ digest.yml     ma 07:00    → python -m monitor digest  → Emailit: weekdigest
 ├─ keepalive.yml  wekelijks   → houdt de geplande workflows aan
 └─ pages.yml      bij push    → publiceert web/ op GitHub Pages

Dashboard (web/) → Supabase met inloggen via magic link, beveiligd met Row Level Security
```

| Map / bestand | Wat |
|---|---|
| `monitor/` | Python: ophalen (`fetchers/`), filters, opslag (`db.py`), mail (`mailer.py`, `emails.py`, `notify.py`) |
| `monitor/config.py` | instellingen: urgente woorden, User-Agent, timeouts |
| `supabase/` | database-schema met RLS en de startbronnen |
| `web/` | het dashboard (plain JavaScript, geen build-stap) |
| `.github/workflows/` | de geplande taken |

### Begrippen

- **Brontypes:** `rss` (RSS/Atom-feed), `github` (releases van `owner/repo`), `page` (pagina
  zonder feed, zie hieronder).
- **Nulmeting:** de eerste keer dat een bron lukt, worden alle bestaande items opgeslagen als
  `is_baseline` en nooit gemaild. Pas daarna telt iets als "nieuw". Een nieuwe bron geeft dus
  geen stortvloed aan mails.
- **Filters per bron:** `include_keywords` (leeg = alles) en `exclude_keywords`. Items die
  niet door het filter komen, worden niet opgeslagen.
- **Urgent:** titel, samenvatting of tags bevatten een woord uit `URGENT_KEYWORDS`
  ([monitor/config.py](monitor/config.py)). Zinnen in `URGENT_IGNORE` tellen niet mee
  (bijv. "mission-critical" uit de standaardtekst bij WordPress-beta's).
- **Urgent-mail:** na elke ophaalrun één mail met alle nog niet gemelde urgente items. Mislukt
  het versturen, dan gaat de mail bij de volgende run alsnog.
- **Weekdigest:** alle nieuwe items sinds de vorige digest, per categorie, met urgente items
  gelabeld. Niets nieuws = geen mail.
- **Fouten:** een fout bij één bron wordt bij die bron opgeslagen (`last_error`, zichtbaar in
  het dashboard onder Bronnen) en stopt de rest van de run niet.

## Setup vanaf nul

Alles hieronder is al gedaan voor de huidige installatie; dit is voor als je het opnieuw opzet.

### 1. Supabase

1. Maak een project. Open **SQL Editor** en run achtereenvolgens
   [supabase/migrations/001_schema.sql](supabase/migrations/001_schema.sql) en
   [supabase/seed_sources.sql](supabase/seed_sources.sql).
2. Zet jezelf op de allowlist:
   ```sql
   insert into public.allowed_users (email) values ('jouw@adres.nl');
   ```
3. **Authentication → Users → Add user → Create new user**: je e-mailadres, "Auto Confirm User" aan.
4. **Authentication → Sign In / Providers**: "Allow new users to sign up" uit.
5. **Authentication → URL Configuration**: Site URL = de dashboard-URL; bij Redirect URLs ook
   `http://localhost:5500/` voor lokaal testen.
6. **Project Settings → API Keys**: de *publishable* key gaat in [web/config.js](web/config.js)
   (mag publiek). De *secret* key gaat alleen in `.env` en GitHub secrets.

### 2. Emailit

1. Voeg een (sub)domein toe, hier `digest.designpixels.nl`, zonder open/klik-tracking.
2. Zet de DNS-records bij je DNS-provider (hier Hostinger, *Naam* zonder `.designpixels.nl`):
   MX + SPF-TXT op `emailit.digest`, DKIM-TXT op `emailit._domainkey.digest`,
   DMARC-TXT op `_dmarc.digest`. Een "subdomein" als website aanmaken is niet nodig.
3. Verifieer het domein in Emailit en maak een API-sleutel met alleen "Sending"-rechten.

### 3. GitHub

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → New repository secret**, vier stuks:

   | Naam | Waarde |
   |---|---|
   | `SUPABASE_URL` | `https://<project>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | Supabase secret key (`sb_secret_...`) |
   | `EMAILIT_API_KEY` | Emailit API-sleutel |
   | `EMAILIT_TO` | ontvangstadres voor digest en urgent-mails |

3. **Actions → "Bronnen ophalen" → Run workflow** om te testen. Daarna draait alles vanzelf.

**Keepalive:** GitHub zet geplande workflows in een publieke repo uit na 60 dagen zonder
activiteit. `keepalive.yml` zet ze wekelijks opnieuw aan via de API. Krijg je toch een mail van
GitHub dat een workflow is uitgezet: **Actions → workflow → Enable workflow**, of push een commit.

### 4. Lokaal draaien

```bash
python -m venv .venv
.venv\Scripts\activate              # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env              # en vul de waarden in
```

`.env` staat in `.gitignore` en komt nooit op GitHub.

## Gebruik

```bash
python -m monitor fetch                        # alle actieve bronnen ophalen
python -m monitor fetch --bron "Etch"          # één bron
python -m monitor test rss <url>               # bron proberen zonder database
python -m monitor test github owner/repo
python -m monitor test page <url> --selector ".content" --patroon "^\d+\.\d+(\.\d+)?$"
python -m monitor testmail                     # controleert of Emailit werkt
python -m monitor digest --voorbeeld           # digest als voorbeeld-mail.html, zonder versturen
python -m monitor digest --voorbeeld --alles   # idem, inclusief nulmeting-items
python -m monitor digest                       # digest echt versturen
```

Dashboard lokaal: `python -m http.server 5500 --directory web` en open http://localhost:5500/.

### Een bron toevoegen

1. Zoek een feed. Tip voor WordPress-sites zonder zichtbare feed: probeer
   `https://site.nl/feed/?post_type=<type>`; de post types zie je op `https://site.nl/wp-json/wp/v2/types`.
   Zo zijn de Bricks- en Etch-feeds gevonden.
2. Test hem: `python -m monitor test rss <url>`.
3. Voeg hem toe in het dashboard onder **Bronnen → + Bron toevoegen**. De eerste run is een nulmeting.

### Page-bronnen (pagina zonder feed)

Twee extra velden: `selector` (CSS, welk deel van de pagina) en `item_pattern` (regex, wat één item is).

- **Koppenmodus:** elke kop (h1–h6) binnen de selector waarvan de tekst volledig op het patroon
  past, is een item; de tekst eronder wordt de samenvatting.
  Bricksforge: selector `.brxe-post-content`, patroon `^\d+\.\d+(\.\d+)?$`.
- **Linkmodus:** levert de selector alleen links (`<a>`) op, dan is elke link waarvan de href of
  tekst op het patroon past een item. Reserve voor Etch: selector `a[href*='/changelog/']`,
  patroon `/changelog/\d+-\d+-\d+/?$`.

Het testcommando meldt of de inhoud echt in de HTML staat. Vindt een page-bron later niets meer,
dan verschijnt dat als fout bij de bron: meestal is de site aangepast of laadt de inhoud via JavaScript.

### Aanpassen

- **Urgente woorden:** `URGENT_KEYWORDS` en `URGENT_IGNORE` in [monitor/config.py](monitor/config.py).
  Een `*` aan het eind matcht ook langere woorden (`kwetsba*` → kwetsbaarheden).
- **Tijden:** de `cron`-regels in `.github/workflows/` (in UTC).
- **Mailopmaak:** kleuren en teksten bovenin [monitor/emails.py](monitor/emails.py).
- **Later AI-samenvattingen:** de kolom `items.ai_summary` is al gereserveerd. Een extra stap na
  `fetch_source` in [monitor/fetch.py](monitor/fetch.py) kan die vullen, en de mail kan hem tonen.

## Bronnen (geverifieerd 2026-11-05)

| Bron | Type | URL | Opmerking |
|---|---|---|---|
| WordPress News | rss | https://wordpress.org/news/feed/ | |
| Kennisnet artikelen | rss | https://www.kennisnet.nl/feed/ | thema-feeds bestaan niet; categorie komt als tag mee |
| Kennisnet nieuws | rss | https://www.kennisnet.nl/nieuws/feed/ | |
| Bricks Builder | rss | https://bricksbuilder.io/feed/?post_type=release | verborgen feed; reserve: page op /changelog/ |
| Etch | rss | https://etchwp.com/feed/?post_type=changelog | verborgen feed; reserve: page op /changelog/ |
| Bricksforge | page | https://bricksforge.io/version-changelog/ | alleen de laatste 3 versies staan op de pagina |
