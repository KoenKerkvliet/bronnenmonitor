-- Bronnenmonitor: schema + Row Level Security
-- Uitvoeren in Supabase: SQL Editor → plak dit bestand → Run.
-- Het script is idempotent genoeg om bij een lege database één keer te draaien.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Bronnen die gevolgd worden
-- ---------------------------------------------------------------------------
create table if not exists public.sources (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  type             text not null check (type in ('rss', 'github', 'page')),
  url              text not null,
  category         text not null default 'algemeen',     -- bijv. onderwijs, webdesign
  include_keywords text[] not null default '{}',          -- leeg = alles doorlaten
  exclude_keywords text[] not null default '{}',
  selector         text,        -- page: CSS-selector van het relevante deel
  item_pattern     text,        -- page: regex waarmee een item (bijv. versie) herkend wordt
  active           boolean not null default true,
  notes            text,        -- bijv. "content staat in HTML ✔"
  last_checked_at  timestamptz,
  last_success_at  timestamptz, -- leeg = nog nooit gelukt → volgende run is de nulmeting
  last_error       text,
  last_error_at    timestamptz,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Verstuurde mails (wekelijkse digest of urgent-melding)
-- ---------------------------------------------------------------------------
create table if not exists public.digests (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('weekly', 'urgent')),
  sent_at     timestamptz not null default now(),
  item_count  integer not null default 0
);

-- ---------------------------------------------------------------------------
-- Gevonden items
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id              uuid primary key default gen_random_uuid(),
  source_id       uuid not null references public.sources (id) on delete cascade,
  item_key        text not null,          -- stabiele unieke sleutel binnen de bron
  title           text not null,
  url             text,
  summary         text,
  tags            text[] not null default '{}',   -- categorieën uit de feed
  published_at    timestamptz,
  found_at        timestamptz not null default now(),
  is_read         boolean not null default false,
  is_saved        boolean not null default false, -- "verzamelen" in het dashboard
  is_urgent       boolean not null default false,
  is_baseline     boolean not null default false, -- gevonden bij de nulmeting: nooit mailen
  urgent_sent_at  timestamptz,
  digest_id       uuid references public.digests (id) on delete set null,
  ai_summary      text,                           -- gereserveerd voor een latere AI-stap
  unique (source_id, item_key)
);

create index if not exists items_found_at_idx   on public.items (found_at desc);
create index if not exists items_unsent_idx     on public.items (found_at) where digest_id is null and not is_baseline;
create index if not exists items_source_idx     on public.items (source_id);

-- ---------------------------------------------------------------------------
-- Wie mag inloggen in de interface (allowlist op e-mailadres)
-- Je eigen adres zet je er zelf in, zodat het niet in de publieke repo staat:
--   insert into public.allowed_users (email) values ('jij@voorbeeld.nl');
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_users (
  email text primary key
);

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------------
-- Rechten: anon mag niets, ingelogde gebruiker alleen als die op de allowlist staat.
-- Het Python-script gebruikt de service role / secret key en omzeilt RLS.
-- ---------------------------------------------------------------------------
revoke all on public.sources, public.items, public.digests, public.allowed_users from anon;
grant select, insert, update, delete on public.sources, public.items to authenticated;
grant select on public.digests, public.allowed_users to authenticated;
grant all on public.sources, public.items, public.digests, public.allowed_users to service_role;
revoke execute on function public.is_allowed() from anon, public;
grant execute on function public.is_allowed() to authenticated, service_role;

alter table public.sources       enable row level security;
alter table public.items         enable row level security;
alter table public.digests       enable row level security;
alter table public.allowed_users enable row level security;

create policy "eigenaar: bronnen" on public.sources
  for all to authenticated using (public.is_allowed()) with check (public.is_allowed());

create policy "eigenaar: items" on public.items
  for all to authenticated using (public.is_allowed()) with check (public.is_allowed());

create policy "eigenaar: digests lezen" on public.digests
  for select to authenticated using (public.is_allowed());

create policy "eigenaar: allowlist lezen" on public.allowed_users
  for select to authenticated using (public.is_allowed());
