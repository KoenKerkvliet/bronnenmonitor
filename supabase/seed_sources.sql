-- Startbronnen (geverifieerd op 2026-11-05). Uitvoeren na 001_schema.sql.
insert into public.sources (name, type, url, category, notes, active, selector, item_pattern) values
  ('WordPress News',      'rss',  'https://wordpress.org/news/feed/',                     'webdesign', 'Officiële feed.', true, null, null),
  ('Kennisnet artikelen', 'rss',  'https://www.kennisnet.nl/feed/',                       'onderwijs', 'Artikelen over alle thema''s, met categorie per item.', true, null, null),
  ('Kennisnet nieuws',    'rss',  'https://www.kennisnet.nl/nieuws/feed/',                'onderwijs', 'Nieuwsberichten.', true, null, null),
  ('Bricks Builder',      'rss',  'https://bricksbuilder.io/feed/?post_type=release',     'webdesign', 'Verborgen feed van post type "release"; niet officieel gedocumenteerd. Reserve: page-type op /changelog/.', true, null, null),
  ('Etch',                'rss',  'https://etchwp.com/feed/?post_type=changelog',         'webdesign', 'Verborgen feed van post type "changelog"; niet officieel gedocumenteerd.', true, null, null),
  ('Bricksforge',         'page', 'https://bricksforge.io/version-changelog/',            'webdesign', 'Content staat in de HTML ✔ (getest 2026-11-05). Geen feed (410). Versies zijn <h3>-koppen; alleen de laatste 3 staan op de pagina.', true, '.brxe-post-content', '^\d+\.\d+(\.\d+)?$'),
  ('AOb',                 'page', 'https://www.aob.nl/actueel/artikelen/',                'onderwijs', 'Geen feed. Kaartmodus, content staat in de HTML ✔ (getest 2026-11-05). Bevat ook Onderwijsblad; sector (PO/VO/MBO…) komt als tag mee.', true, 'a.card', null),
  ('PO-Raad',             'page', 'https://www.poraad.nl/nieuws',                         'onderwijs', 'Geen feed (Drupal). Kaartmodus, content staat in de HTML ✔ (getest 2026-11-05).', true, 'article.node-article-card', null);

-- Uitbreiding 2026-11-06: onderwijs, privacy & security, YouTube, WordPress-nieuws en AI.
insert into public.sources (name, type, url, category, include_keywords, selector, item_pattern, notes) values
  ('Mediawijzer.net', 'rss', 'https://www.mediawijzer.net/feed/', 'onderwijs', '{}', null, null, 'Mediawijsheid en digitale geletterdheid.'),
  ('SIVON', 'rss', 'https://sivon.nl/feed/', 'onderwijs', '{}', null, null, 'Privacy en ICT-inkoop voor scholen.'),
  ('SLO', 'page', 'https://www.slo.nl/over-slo/nieuws/', 'onderwijs', '{}', 'a[href*=''/over-slo/nieuws/@'']', null, 'Geen feed. Linkmodus, content staat in de HTML ✔ (getest 2026-11-06). Geen datums op de pagina.'),
  ('Autoriteit Persoonsgegevens', 'rss', 'https://www.autoriteitpersoonsgegevens.nl/feed/article/rss.xml', 'security', '{}', null, null, 'Privacytoezichthouder.'),
  ('NCSC', 'rss', 'https://feeds.ncsc.nl/nieuws.rss', 'security', '{"WordPress","PHP","onderwijs","scholen","school"}', null, null, 'Zeer veel waarschuwingen; alleen over WordPress, PHP of onderwijs.'),
  ('Patchstack', 'rss', 'https://patchstack.com/feed/', 'security', '{"Bricks","Bricksforge","Etch","WordPress Core"}', null, null, 'WordPress-lekken; alleen over je eigen tools en WordPress core.'),
  ('Wordfence', 'rss', 'https://www.wordfence.com/blog/feed/', 'security', '{"Bricks","Bricksforge","Etch","WordPress Core"}', null, null, 'WordPress-lekken; alleen over je eigen tools en WordPress core.'),
  ('WPTuts', 'rss', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCiTDv6q1XYwZnAm2EYN8wKw', 'webdesign', '{}', null, null, 'YouTube (Paul Charlton). Feed bevat de laatste 15 video''s.'),
  ('Rino de Boer', 'rss', 'https://www.youtube.com/feeds/videos.xml?channel_id=UC4rBpJF855RQuO8PrUVb68g', 'webdesign', '{}', null, null, 'YouTube, voorheen Living with Pixels. Feed bevat de laatste 15 video''s.'),
  ('Ralphs BBQ Tube', 'rss', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHWf4d_mxC8Cb3mipHpPs4Q', 'bbq', '{}', null, null, 'YouTube. Feed bevat de laatste 15 video''s.'),
  ('The WP Minute', 'rss', 'https://thewpminute.com/feed/', 'webdesign', '{}', null, null, null),
  ('WP Tavern', 'rss', 'https://wptavern.com/feed', 'webdesign', '{}', null, null, null),
  ('Make WordPress Core', 'rss', 'https://make.wordpress.org/core/feed/', 'webdesign', '{}', null, null, 'Ontwikkelnotities van WordPress (technisch, ~20/maand).'),
  ('Anthropic', 'page', 'https://www.anthropic.com/news', 'ai', '{}', 'a[class*=''title-link'']', '/news/[a-z0-9-]+$', 'Geen feed. Kaartmodus, content staat in de HTML ✔ (getest 2026-11-06). Geen datums op de pagina.'),
  ('Claude release notes', 'rss', 'https://platform.claude.com/docs/en/release-notes/feed.xml', 'ai', '{}', null, null, 'Release notes van het Claude Platform (API).'),
  ('OpenAI', 'rss', 'https://openai.com/news/rss.xml', 'ai', '{"tag:Product","tag:Safety"}', null, null, 'Alleen berichten met tag Product of Safety (zonder klantverhalen).');
