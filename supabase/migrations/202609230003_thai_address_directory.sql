begin;

-- This directory is the application's source of truth at runtime. External API
-- calls only refresh it; a failed refresh never removes previously known areas.
create table if not exists public.thai_address_provinces (
  id integer primary key,
  name_th text not null unique,
  name_en text
);
create table if not exists public.thai_address_districts (
  id integer primary key,
  province_id integer not null references public.thai_address_provinces(id) on delete restrict,
  name_th text not null,
  name_en text,
  unique (province_id, name_th)
);
create table if not exists public.thai_address_subdistricts (
  id integer primary key,
  district_id integer not null references public.thai_address_districts(id) on delete restrict,
  name_th text not null,
  name_en text,
  zip_code text,
  latitude double precision,
  longitude double precision,
  unique (district_id, name_th)
);
create index if not exists thai_address_districts_province_idx on public.thai_address_districts (province_id);
create index if not exists thai_address_subdistricts_district_idx on public.thai_address_subdistricts (district_id);

create table if not exists public.thai_address_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  province_count integer not null default 0,
  district_count integer not null default 0,
  subdistrict_count integer not null default 0,
  error_message text
);

create or replace view public.thai_address_directory
with (security_invoker = true) as
select
  province.name_th as province,
  district.name_th as district,
  subdistrict.name_th as sub_district,
  subdistrict.zip_code,
  subdistrict.latitude,
  subdistrict.longitude
from public.thai_address_subdistricts subdistrict
join public.thai_address_districts district on district.id = subdistrict.district_id
join public.thai_address_provinces province on province.id = district.province_id;

alter table public.thai_address_provinces enable row level security;
alter table public.thai_address_districts enable row level security;
alter table public.thai_address_subdistricts enable row level security;
alter table public.thai_address_sync_runs enable row level security;

drop policy if exists "public read thai provinces" on public.thai_address_provinces;
create policy "public read thai provinces" on public.thai_address_provinces for select to anon, authenticated using (true);
drop policy if exists "public read thai districts" on public.thai_address_districts;
create policy "public read thai districts" on public.thai_address_districts for select to anon, authenticated using (true);
drop policy if exists "public read thai subdistricts" on public.thai_address_subdistricts;
create policy "public read thai subdistricts" on public.thai_address_subdistricts for select to anon, authenticated using (true);
drop policy if exists "admins read address sync history" on public.thai_address_sync_runs;
create policy "admins read address sync history" on public.thai_address_sync_runs for select to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
);

grant select on public.thai_address_directory to anon, authenticated;
notify pgrst, 'reload schema';
commit;
