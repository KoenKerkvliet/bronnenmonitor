-- Urgent-meldingen per bron aan/uit (bijv. uit voor YouTube-kanalen en algemene nieuwssites,
-- waar woorden als "security" vaak voorkomen zonder dat er iets urgents is).
-- Uitvoeren in Supabase: SQL Editor → plak dit bestand → Run.
alter table public.sources
  add column if not exists urgent_enabled boolean not null default true;
