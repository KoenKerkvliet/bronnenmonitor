-- Startbronnen (geverifieerd op 2026-11-05). Uitvoeren na 001_schema.sql.
insert into public.sources (name, type, url, category, notes, active, selector, item_pattern) values
  ('WordPress News',      'rss',  'https://wordpress.org/news/feed/',                     'webdesign', 'Officiële feed.', true, null, null),
  ('Kennisnet artikelen', 'rss',  'https://www.kennisnet.nl/feed/',                       'onderwijs', 'Artikelen over alle thema''s, met categorie per item.', true, null, null),
  ('Kennisnet nieuws',    'rss',  'https://www.kennisnet.nl/nieuws/feed/',                'onderwijs', 'Nieuwsberichten.', true, null, null),
  ('Bricks Builder',      'rss',  'https://bricksbuilder.io/feed/?post_type=release',     'webdesign', 'Verborgen feed van post type "release"; niet officieel gedocumenteerd. Reserve: page-type op /changelog/.', true, null, null),
  ('Etch',                'rss',  'https://etchwp.com/feed/?post_type=changelog',         'webdesign', 'Verborgen feed van post type "changelog"; niet officieel gedocumenteerd.', true, null, null),
  ('Bricksforge',         'page', 'https://bricksforge.io/version-changelog/',            'webdesign', 'Content staat in de HTML ✔ (getest 2026-11-05). Geen feed (410). Versies zijn <h3>-koppen; alleen de laatste 3 staan op de pagina.', true, '.brxe-post-content', '^\d+\.\d+(\.\d+)?$');
