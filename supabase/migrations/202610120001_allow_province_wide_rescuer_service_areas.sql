-- A nullable district means the rescuer covers every district in a province.
-- The original composite primary key accidentally made district mandatory.
alter table public.rescuer_service_areas
  add column if not exists id uuid default gen_random_uuid();

alter table public.rescuer_service_areas
  drop constraint if exists rescuer_service_areas_pkey;

alter table public.rescuer_service_areas
  alter column district drop not null,
  alter column id set not null,
  alter column id set default gen_random_uuid();

alter table public.rescuer_service_areas
  add constraint rescuer_service_areas_pkey primary key (id);

create index if not exists rescuer_service_areas_unique_coverage_idx
  on public.rescuer_service_areas (rescuer_id, province, coalesce(district, ''));
