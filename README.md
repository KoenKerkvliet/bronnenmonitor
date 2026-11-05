# Bronnenmonitor

Persoonlijke monitor die nieuws en changelogs volgt (Kennisnet, WordPress, Bricks, Bricksforge, Etch),
filtert, opslaat in Supabase en een digest per mail stuurt.

> Status: **fase 3** – ophalen (rss, github, page), opslag en mail (urgent + weekdigest). Dashboard en GitHub Actions volgen.

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
| `page`   | gewone pagina zonder feed             | pagina-URL + CSS-selector + patroon   |

### Page-bronnen instellen

Een page-bron heeft twee extra velden: `selector` (CSS, welk deel van de pagina) en
`item_pattern` (regex, wat één item is). Er zijn twee modi:

- **Koppenmodus**: elke kop (h1–h6) binnen de selector waarvan de tekst volledig op het patroon
  past, is een item. De koptekst is de sleutel; de tekst eronder wordt de samenvatting.
  Bricksforge: selector `.brxe-post-content`, patroon `^\d+\.\d+(\.\d+)?$`.
- **Linkmodus**: levert de selector alleen links (`<a>`) op, dan is elke link waarvan de href
  of tekst op het patroon past een item. Etch-index als reserve:
  selector `a[href*='/changelog/']`, patroon `/changelog/\d+-\d+-\d+/?$`.

Probeer een pagina altijd eerst met het testcommando. Het meldt of de inhoud echt in de HTML staat:

```bash
python -m monitor test page https://bricksforge.io/version-changelog/ --selector ".brxe-post-content" --patroon "^\d+\.\d+(\.\d+)?$"
```

Vindt een page-bron niets meer, dan komt dat als fout bij de bron (`last_error`). Meestal is de
site aangepast, of laadt de inhoud via JavaScript.

**Nulmeting:** de eerste keer dat een bron lukt, worden alle bestaande items opgeslagen als
`is_baseline` en nooit gemaild. Pas daarna telt iets als "nieuw".

**Urgent:** een item is urgent als titel, samenvatting of tags een woord uit `URGENT_KEYWORDS`
in [monitor/config.py](monitor/config.py) bevat. Zinnen in `URGENT_IGNORE` tellen niet mee
(bijv. "mission-critical" uit de standaardwaarschuwing bij WordPress-beta's).

**Mail:**
- *Urgent-mail*: direct na een ophaalrun, één mail met alle nog niet gemelde urgente items.
  Mislukt het versturen, dan gaat de mail bij de volgende run alsnog.
- *Weekdigest*: alle nieuwe items sinds de vorige digest, gegroepeerd per categorie (urgente
  items staan erin met een label). Niets nieuws = geen mail.

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

```bash
python -m monitor testmail                     # controleert of Emailit werkt
python -m monitor digest --voorbeeld           # digest als voorbeeld-mail.html, zonder versturen
python -m monitor digest --voorbeeld --alles   # idem, inclusief nulmeting-items (om de opmaak te zien)
python -m monitor digest                       # digest echt versturen
```

### 4. Mail (Emailit)

Verzenddomein: `digest.designpixels.nl` (geverifieerd in Emailit; DNS bij Hostinger:
MX + SPF op `emailit.digest`, DKIM op `emailit._domainkey.digest`, DMARC op `_dmarc.digest`).

Vul in `.env` in: `EMAILIT_API_KEY` (Emailit → API Keys, rechten "Sending" volstaan) en
`EMAILIT_TO` (je ontvangstadres). `EMAILIT_FROM` staat standaard op
`Bronnenmonitor <monitor@digest.designpixels.nl>`.

## Bronnen (geverifieerd 2026-11-05)

| Bron                | Type | URL |
|---------------------|------|-----|
| WordPress News      | rss  | https://wordpress.org/news/feed/ |
| Kennisnet artikelen | rss  | https://www.kennisnet.nl/feed/ |
| Kennisnet nieuws    | rss  | https://www.kennisnet.nl/nieuws/feed/ |
| Bricks Builder      | rss  | https://bricksbuilder.io/feed/?post_type=release (verborgen, ongedocumenteerd) |
| Etch                | rss  | https://etchwp.com/feed/?post_type=changelog (verborgen, ongedocumenteerd) |
| Bricksforge         | page | https://bricksforge.io/version-changelog/ (alleen de laatste 3 versies staan erop) |
