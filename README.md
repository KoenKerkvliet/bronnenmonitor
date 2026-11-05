# Bronnenmonitor

Persoonlijke monitor die nieuws en changelogs volgt (Kennisnet, WordPress, Bricks, Bricksforge, Etch),
filtert, opslaat in Supabase en een digest per mail stuurt.

> Status: **fase 1** – database + ophalen van rss/github-bronnen. Mail, dashboard en GitHub Actions volgen.

## Hoe het werkt

```
GitHub Actions (cron) → Python (monitor/) → Supabase (sources, items, digests)
                                          → Emailit (urgent-mail + weekdigest)   [fase 3]
GitHub Pages (web/) → dashboard met login (magic link)                           [fase 4]
```

Brontypes:

| type     | wat                                   | url-veld                              |
|----------|---------------------------------------|---------------------------------------|
| `rss`    | RSS- of Atom-feed                     | de feed-URL                           |
| `github` | releases van een GitHub-repo          | `owner/repo` of de repo-URL           |
| `page`   | gewone pagina zonder feed (fase 2)    | pagina-URL + CSS-selector + patroon   |

**Nulmeting:** de eerste keer dat een bron lukt, worden alle bestaande items opgeslagen als
`is_baseline` en nooit gemaild. Pas daarna telt iets als "nieuw".

**Urgent:** een item is urgent als titel, samenvatting of tags een woord uit `URGENT_KEYWORDS`
in [monitor/config.py](monitor/config.py) bevat.

## Setup (fase 1)

### 1. Database

1. Open je Supabase-project → **SQL Editor**.
2. Plak en run [supabase/migrations/001_schema.sql](supabase/migrations/001_schema.sql).
3. Plak en run [supabase/seed_sources.sql](supabase/seed_sources.sql) (de startbronnen).
4. Zet jezelf op de allowlist voor het dashboard (later nodig):
   ```sql
   insert into public.allowed_users (email) values ('jouw@adres.nl');
   ```

### 2. Lokaal draaien

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # en vul SUPABASE_SERVICE_KEY in
```

Sleutel: Supabase → **Project Settings → API Keys** → de *secret* key (`sb_secret_...`)
of de legacy *service_role* key. Deze sleutel omzeilt alle beveiliging: alleen in `.env`
en later in GitHub secrets, **nooit** in de code of de frontend.

### 3. Gebruiken

```bash
python -m monitor test rss https://wordpress.org/news/feed/   # bron proberen, zonder database
python -m monitor fetch                                        # alle actieve bronnen ophalen
python -m monitor fetch --bron "Etch"                          # één bron
```

Fouten per bron komen in `sources.last_error`; één kapotte bron stopt de run niet.

## Bronnen (geverifieerd 2026-11-05)

| Bron                | Type | URL |
|---------------------|------|-----|
| WordPress News      | rss  | https://wordpress.org/news/feed/ |
| Kennisnet artikelen | rss  | https://www.kennisnet.nl/feed/ |
| Kennisnet nieuws    | rss  | https://www.kennisnet.nl/nieuws/feed/ |
| Bricks Builder      | rss  | https://bricksbuilder.io/feed/?post_type=release (verborgen, ongedocumenteerd) |
| Etch                | rss  | https://etchwp.com/feed/?post_type=changelog (verborgen, ongedocumenteerd) |
| Bricksforge         | page | https://bricksforge.io/version-changelog/ (fase 2) |
