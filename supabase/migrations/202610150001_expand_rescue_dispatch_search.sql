-- Search in controlled rings.  A team must still be active, available, have a
-- fresh location, and cover the SOS province/district before it is considered.
create table if not exists public.rescue_dispatch_searches (
  sos_report_id uuid primary key references public.sos_reports(id) on delete cascade,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rescue_dispatch_searches enable row level security;

alter table public.rescue_dispatch_attempts
  add column if not exists search_radius_km integer;

create or replace function public.dispatch_rescue_case(p_sos_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.sos_reports%rowtype;
  v_rescuer_id uuid;
  v_distance_km double precision;
  v_eta_minutes integer;
  v_assignment_id uuid;
  v_attempt_no integer;
  v_started_at timestamptz;
  v_search_round integer;
  v_radius_km integer;
  v_respond_by timestamptz := now() + interval '90 seconds';
begin
  select * into v_case from public.sos_reports where id = p_sos_report_id for update;
  if not found or v_case.status not in ('pending', 'cannot_reach') then
    return jsonb_build_object('assigned', false, 'reason', 'case_not_dispatchable');
  end if;

  if exists (
    select 1 from public.assignments
    where sos_report_id = p_sos_report_id
      and status in ('offered', 'accepted', 'en_route', 'on_scene')
  ) then
    return jsonb_build_object('assigned', false, 'reason', 'case_already_open');
  end if;

  insert into public.rescue_dispatch_searches (sos_report_id)
  values (p_sos_report_id)
  on conflict (sos_report_id) do update set updated_at = now()
  returning started_at into v_started_at;

  -- 0-59 sec: 5 km, 1-2:59 min: 15 km, then 50 km within its service area.
  v_search_round := least(3, greatest(1, floor(extract(epoch from now() - v_started_at) / 60)::integer + 1));
  v_radius_km := case v_search_round when 1 then 5 when 2 then 15 else 50 end;

  if v_case.lat is null or v_case.lng is null then
    return jsonb_build_object('assigned', false, 'reason', 'case_location_missing', 'search_radius_km', v_radius_km);
  end if;

  select p.id,
    6371 * 2 * asin(sqrt(
      power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
      + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
      * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
    )) as distance_km
  into v_rescuer_id, v_distance_km
  from public.rescuer_presence rp
  join public.profiles p on p.id = rp.rescuer_id
  where p.role = 'rescuer'
    and p.is_active = true
    and rp.availability = 'available'
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '2 minutes'
    and exists (
      select 1 from public.rescuer_service_areas area
      where area.rescuer_id = p.id
        and lower(btrim(area.province)) = lower(btrim(v_case.province))
        and (area.district is null or lower(btrim(area.district)) = lower(btrim(v_case.district)))
    )
    and not exists (
      select 1 from public.assignments active
      where active.rescuer_id = p.id
        and active.status in ('offered', 'accepted', 'en_route', 'on_scene')
    )
    and not exists (
      select 1 from public.rescue_dispatch_attempts prior
      where prior.sos_report_id = p_sos_report_id and prior.rescuer_id = p.id
    )
    and 6371 * 2 * asin(sqrt(
      power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
      + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
      * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
    )) <= v_radius_km
  order by distance_km, rp.location_updated_at desc
  limit 1;

  if v_rescuer_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_available_rescuer_in_radius', 'search_round', v_search_round, 'search_radius_km', v_radius_km);
  end if;

  v_eta_minutes := greatest(1, ceil(v_distance_km / 30.0 * 60.0)::integer);
  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no
  from public.rescue_dispatch_attempts where sos_report_id = p_sos_report_id;

  insert into public.assignments (sos_report_id, rescuer_id, status)
  values (p_sos_report_id, v_rescuer_id, 'offered')
  returning id into v_assignment_id;

  insert into public.rescue_dispatch_attempts (
    sos_report_id, assignment_id, rescuer_id, attempt_no, status, respond_by,
    estimated_arrival_minutes, search_radius_km
  ) values (
    p_sos_report_id, v_assignment_id, v_rescuer_id, v_attempt_no, 'offered', v_respond_by,
    v_eta_minutes, v_radius_km
  );

  return jsonb_build_object(
    'assigned', true, 'assignment_id', v_assignment_id, 'rescuer_id', v_rescuer_id,
    'respond_by', v_respond_by, 'eta_minutes', v_eta_minutes,
    'search_round', v_search_round, 'search_radius_km', v_radius_km
  );
end;
$$;

create or replace function public.get_my_rescuer_dispatch_readiness()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_presence public.rescuer_presence%rowtype;
  v_area_count integer;
  v_active_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'rescuer' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active rescuer may view dispatch readiness';
  end if;
  select * into v_presence from public.rescuer_presence where rescuer_id = auth.uid();
  select count(*) into v_area_count from public.rescuer_service_areas where rescuer_id = auth.uid();
  select count(*) into v_active_count from public.assignments
    where rescuer_id = auth.uid() and status in ('offered', 'accepted', 'en_route', 'on_scene');

  return jsonb_build_object(
    'availability', coalesce(v_presence.availability, 'offline'),
    'has_current_location', coalesce(v_presence.location_updated_at >= now() - interval '2 minutes', false),
    'location_updated_at', v_presence.location_updated_at,
    'service_area_count', v_area_count,
    'open_assignment_count', v_active_count,
    'ready', coalesce(v_presence.availability = 'available' and v_presence.location_updated_at >= now() - interval '2 minutes' and v_area_count > 0 and v_active_count = 0, false)
  );
end;
$$;

revoke all on function public.get_my_rescuer_dispatch_readiness() from public, anon;
grant execute on function public.get_my_rescuer_dispatch_readiness() to authenticated;

notify pgrst, 'reload schema';
