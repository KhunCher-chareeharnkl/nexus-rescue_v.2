-- Replaces the first map RPC for databases where the legacy assignment enum
-- or varchar profile fields caused RETURN QUERY type mismatches.
create or replace function public.get_admin_rescuer_locations()
returns table (
  rescuer_id uuid,
  display_name text,
  agency text,
  availability text,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  assignment_status text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    p.id::uuid as rescuer_id,
    p.full_name::text as display_name,
    p.agency::text as agency,
    rp.availability::text as availability,
    rp.latitude::double precision as latitude,
    rp.longitude::double precision as longitude,
    rp.location_updated_at::timestamptz as location_updated_at,
    active.status::text as assignment_status
  from public.rescuer_presence rp
  join public.profiles p on p.id = rp.rescuer_id
  left join lateral (
    select a.status
    from public.assignments a
    where a.rescuer_id = p.id
      and a.status in ('accepted', 'en_route', 'on_scene')
    order by a.accepted_at desc nulls last
    limit 1
  ) active on true
  where exists (
      select 1 from public.profiles admin
      where admin.id = auth.uid() and admin.role = 'admin' and admin.is_active = true
    )
    and p.role = 'rescuer'
    and p.is_active = true
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '15 minutes'
  order by
    case rp.availability when 'busy' then 0 when 'available' then 1 else 2 end,
    rp.location_updated_at desc;
$$;

notify pgrst, 'reload schema';
