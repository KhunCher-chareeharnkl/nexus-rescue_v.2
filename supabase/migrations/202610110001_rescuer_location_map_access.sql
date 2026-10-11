begin;

-- Live locations remain private by default. These two narrowly-scoped RPCs are
-- the only read paths: control-room admins see the operational map, while a
-- victim can see only the currently assigned team for their own SOS request.
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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only active administrators can view rescue locations';
  end if;

  return query
  select
    p.id,
    p.full_name::text,
    p.agency::text,
    rp.availability::text,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at,
    active.status::text
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
  where p.role = 'rescuer'
    and p.is_active = true
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '15 minutes'
  order by
    case rp.availability when 'busy' then 0 when 'available' then 1 else 2 end,
    rp.location_updated_at desc;
end;
$$;

create or replace function public.get_victim_assigned_rescuer_location(
  p_sos_report_id uuid,
  p_phone text
)
returns table (
  agency text,
  assignment_status text,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Victims currently authenticate their tracker with the telephone number
  -- used when creating the SOS. Do not return any location for another case.
  if not exists (
    select 1 from public.sos_reports
    where id = p_sos_report_id and phone = btrim(p_phone)
  ) then
    raise exception using errcode = '42501', message = 'This SOS request does not match the supplied phone number';
  end if;

  return query
  select
    coalesce(nullif(btrim(p.agency), ''), 'ทีมกู้ภัยที่ได้รับมอบหมาย')::text,
    a.status::text,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at
  from public.assignments a
  join public.profiles p on p.id = a.rescuer_id
  join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
  where a.sos_report_id = p_sos_report_id
    and a.status in ('accepted', 'en_route', 'on_scene')
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '5 minutes'
  order by a.accepted_at desc nulls last
  limit 1;
end;
$$;

revoke all on function public.get_admin_rescuer_locations() from public, anon;
grant execute on function public.get_admin_rescuer_locations() to authenticated;
revoke all on function public.get_victim_assigned_rescuer_location(uuid, text) from public, anon;
grant execute on function public.get_victim_assigned_rescuer_location(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
