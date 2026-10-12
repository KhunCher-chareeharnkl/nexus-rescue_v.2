-- Live presence is deliberately separate from profiles: a rescuer may opt out
-- at any time, and location data must not become broadly readable profile data.
create table if not exists public.rescuer_presence (
  rescuer_id uuid primary key references public.profiles(id) on delete cascade,
  availability text not null default 'offline'
    check (availability in ('available', 'busy', 'offline')),
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.rescue_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid not null references public.sos_reports(id) on delete cascade,
  assignment_id uuid not null unique references public.assignments(id) on delete restrict,
  rescuer_id uuid not null references public.profiles(id) on delete restrict,
  attempt_no integer not null,
  status text not null check (status in ('offered', 'accepted', 'declined', 'expired', 'handed_off')),
  offered_at timestamptz not null default now(),
  respond_by timestamptz not null,
  responded_at timestamptz,
  estimated_arrival_minutes integer,
  reason text,
  created_at timestamptz not null default now(),
  unique (sos_report_id, attempt_no)
);

-- Distance is considered only after jurisdiction. A nearby team from another
-- province must never receive a case unless an administrator explicitly adds
-- that province as one of the team's mutual-aid service areas.
create table if not exists public.rescuer_service_areas (
  id uuid primary key default gen_random_uuid(),
  rescuer_id uuid not null references public.profiles(id) on delete cascade,
  province text not null check (char_length(btrim(province)) > 0),
  district text,
  is_mutual_aid boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists rescue_dispatch_attempts_case_idx
  on public.rescue_dispatch_attempts (sos_report_id, offered_at desc);
create index if not exists rescue_dispatch_attempts_rescuer_idx
  on public.rescue_dispatch_attempts (rescuer_id, status, offered_at desc);
create index if not exists rescuer_presence_available_idx
  on public.rescuer_presence (location_updated_at desc)
  where availability = 'available';
create index if not exists rescuer_service_areas_coverage_idx
  on public.rescuer_service_areas (province, district, rescuer_id);

-- The original check predates automatic offers. Replace only the status-domain
-- check, preserving constraints such as the one that requires a reason for a
-- cannot_reach outcome.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.assignments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%cannot_reach_reason%'
  loop
    execute format('alter table public.assignments drop constraint %I', constraint_name);
  end loop;
end;
$$;

alter table public.assignments
  add constraint assignments_status_check
  check (status in ('offered', 'accepted', 'en_route', 'on_scene', 'completed', 'cannot_reach', 'declined', 'expired'));

create unique index if not exists assignments_one_open_case_idx
  on public.assignments (sos_report_id)
  where status in ('offered', 'accepted', 'en_route', 'on_scene');

alter table public.rescuer_presence enable row level security;
alter table public.rescue_dispatch_attempts enable row level security;
alter table public.rescuer_service_areas enable row level security;

drop policy if exists "rescuers read own presence" on public.rescuer_presence;
create policy "rescuers read own presence" on public.rescuer_presence
  for select to authenticated using (rescuer_id = auth.uid());
drop policy if exists "admins read dispatch attempts" on public.rescue_dispatch_attempts;
create policy "admins read dispatch attempts" on public.rescue_dispatch_attempts
  for select to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
  );
drop policy if exists "rescuers read own service areas" on public.rescuer_service_areas;
create policy "rescuers read own service areas" on public.rescuer_service_areas
  for select to authenticated using (rescuer_id = auth.uid());
drop policy if exists "admins manage service areas" on public.rescuer_service_areas;
create policy "admins manage service areas" on public.rescuer_service_areas
  for all to authenticated using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
  ) with check (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
  );

create or replace function public.set_rescuer_presence(
  p_availability text,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'rescuer' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only active rescuers can publish availability';
  end if;
  if p_availability not in ('available', 'busy', 'offline') then
    raise exception using errcode = '22023', message = 'Invalid availability';
  end if;
  if p_availability = 'available'
     and (p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception using errcode = '22023', message = 'A current location is required before going available';
  end if;
  if p_availability = 'available' and exists (
    select 1 from public.assignments
    where rescuer_id = auth.uid() and status in ('accepted', 'en_route', 'on_scene')
  ) then
    raise exception using errcode = '23514', message = 'Finish or hand off the active mission before going available';
  end if;

  insert into public.rescuer_presence (
    rescuer_id, availability, latitude, longitude, location_updated_at, updated_at
  ) values (
    auth.uid(), p_availability, p_latitude, p_longitude,
    case when p_latitude is null then null else now() end, now()
  )
  on conflict (rescuer_id) do update set
    availability = excluded.availability,
    latitude = coalesce(excluded.latitude, public.rescuer_presence.latitude),
    longitude = coalesce(excluded.longitude, public.rescuer_presence.longitude),
    location_updated_at = case when excluded.latitude is null
      then public.rescuer_presence.location_updated_at else now() end,
    updated_at = now();
end;
$$;

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
  -- Two minutes leaves enough time for the one-minute push worker to deliver
  -- the offer before it is eligible for timeout.
  v_respond_by timestamptz := now() + interval '2 minutes';
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

  select
    p.id,
    case when v_case.lat is null or v_case.lng is null then null else
      6371 * 2 * asin(sqrt(
        power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
        + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
        * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
      )) end
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
  order by
    case when v_case.lat is null or v_case.lng is null then 0 else
      6371 * 2 * asin(sqrt(
        power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
        + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
        * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
      )) end,
    rp.location_updated_at desc
  limit 1;

  if v_rescuer_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_available_rescuer');
  end if;

  -- A transparent rough ETA is safer than implying a route-provider guarantee.
  v_eta_minutes := case when v_distance_km is null then null
    else greatest(1, ceil(v_distance_km / 30.0 * 60.0)::integer) end;
  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no
  from public.rescue_dispatch_attempts where sos_report_id = p_sos_report_id;

  insert into public.assignments (sos_report_id, rescuer_id, status)
  values (p_sos_report_id, v_rescuer_id, 'offered')
  returning id into v_assignment_id;

  insert into public.rescue_dispatch_attempts (
    sos_report_id, assignment_id, rescuer_id, attempt_no, status, respond_by, estimated_arrival_minutes
  ) values (
    p_sos_report_id, v_assignment_id, v_rescuer_id, v_attempt_no, 'offered', v_respond_by, v_eta_minutes
  );

  return jsonb_build_object(
    'assigned', true, 'assignment_id', v_assignment_id, 'rescuer_id', v_rescuer_id,
    'respond_by', v_respond_by, 'eta_minutes', v_eta_minutes
  );
end;
$$;

create or replace function public.respond_to_rescue_dispatch(
  p_sos_report_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment_id uuid;
  v_respond_by timestamptz;
  v_expired boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in before responding to a dispatch';
  end if;

  select a.id, d.respond_by into v_assignment_id, v_respond_by
  from public.assignments a
  join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.sos_report_id = p_sos_report_id
    and a.rescuer_id = auth.uid()
    and a.status = 'offered' and d.status = 'offered'
  for update of a, d;
  if v_assignment_id is null then
    raise exception using errcode = 'P0002', message = 'No pending dispatch was found for this case';
  end if;

  if v_respond_by <= now() then
    update public.assignments set status = 'expired', completed_at = now() where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'expired', responded_at = now(), reason = 'response_timeout'
      where assignment_id = v_assignment_id;
    v_expired := true;
  elsif p_accept then
    update public.assignments set status = 'accepted', accepted_at = now() where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'accepted', responded_at = now()
      where assignment_id = v_assignment_id;
    update public.sos_reports set status = 'assigned', updated_at = now() where id = p_sos_report_id;
    insert into public.victim_status (sos_report_id, status, updated_at)
    values (p_sos_report_id, 'rescue_assigned', now())
    on conflict (sos_report_id) do update set status = excluded.status, updated_at = excluded.updated_at;
    update public.rescuer_presence set availability = 'busy', updated_at = now() where rescuer_id = auth.uid();
    return jsonb_build_object('accepted', true, 'assignment_id', v_assignment_id);
  else
    update public.assignments set status = 'declined', completed_at = now(), notes = nullif(btrim(coalesce(p_reason, '')), '')
      where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'declined', responded_at = now(), reason = nullif(btrim(coalesce(p_reason, '')), '')
      where assignment_id = v_assignment_id;
  end if;

  perform public.dispatch_rescue_case(p_sos_report_id);
  return jsonb_build_object('accepted', false, 'expired', v_expired, 'redispatched', true);
end;
$$;

create or replace function public.expire_stale_rescue_dispatches()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment record;
  v_case record;
  v_expired integer := 0;
  v_dispatched integer := 0;
begin
  for v_assignment in
    select a.id, a.sos_report_id
    from public.assignments a
    join public.rescue_dispatch_attempts d on d.assignment_id = a.id
    where a.status = 'offered' and d.status = 'offered' and d.respond_by <= now()
    for update of a, d skip locked
  loop
    update public.assignments set status = 'expired', completed_at = now() where id = v_assignment.id;
    update public.rescue_dispatch_attempts set status = 'expired', responded_at = now(), reason = 'response_timeout'
      where assignment_id = v_assignment.id;
    perform public.dispatch_rescue_case(v_assignment.sos_report_id);
    v_expired := v_expired + 1;
  end loop;

  -- Also retries cases created while every rescuer was offline.
  for v_case in
    select id from public.sos_reports s
    where s.status in ('pending', 'cannot_reach')
      and not exists (
        select 1 from public.assignments a where a.sos_report_id = s.id
          and a.status in ('offered', 'accepted', 'en_route', 'on_scene')
      )
    order by s.created_at
    limit 100
  loop
    if (public.dispatch_rescue_case(v_case.id)->>'assigned')::boolean then
      v_dispatched := v_dispatched + 1;
    end if;
  end loop;
  return jsonb_build_object('expired', v_expired, 'new_offers', v_dispatched);
end;
$$;

create or replace function public.get_my_pending_rescue_dispatches()
returns table (sos_report_id uuid, respond_by timestamptz, estimated_arrival_minutes integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select a.sos_report_id, d.respond_by, d.estimated_arrival_minutes
  from public.assignments a
  join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.rescuer_id = auth.uid() and a.status = 'offered' and d.status = 'offered'
  order by d.offered_at desc;
$$;

create or replace function public.auto_dispatch_on_case_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('pending', 'cannot_reach')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.dispatch_rescue_case(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists auto_dispatch_on_sos_change on public.sos_reports;
create trigger auto_dispatch_on_sos_change
after insert or update of status on public.sos_reports
for each row execute function public.auto_dispatch_on_case_change();

create or replace function public.mark_rescuer_offline_after_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('completed', 'cannot_reach')
     and old.status in ('accepted', 'en_route', 'on_scene')
     and not exists (
       select 1 from public.assignments
       where rescuer_id = new.rescuer_id and id <> new.id
         and status in ('accepted', 'en_route', 'on_scene')
     ) then
    update public.rescuer_presence
    set availability = 'offline', updated_at = now()
    where rescuer_id = new.rescuer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists mark_rescuer_offline_after_assignment on public.assignments;
create trigger mark_rescuer_offline_after_assignment
after update of status on public.assignments
for each row execute function public.mark_rescuer_offline_after_assignment();

create or replace function public.enqueue_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_outbox (recipient_id, event_type, title, body, target_url)
  values (
    new.rescuer_id,
    case when new.status = 'offered' then 'dispatch_offer' else 'assignment_created' end,
    case when new.status = 'offered' then 'มีภารกิจใหม่ กรุณายืนยันภายใน 2 นาที' else 'ได้รับมอบหมายภารกิจช่วยเหลือ' end,
    case when new.status = 'offered' then 'ระบบเลือกคุณเป็นทีมที่เหมาะสมที่สุด กรุณาตอบรับหรือปฏิเสธทันที' else 'มีภารกิจใหม่ที่ต้องตรวจสอบและรับงาน' end,
    '/officer/dashboard'
  );
  return new;
end;
$$;

revoke all on function public.set_rescuer_presence(text, double precision, double precision) from public, anon;
grant execute on function public.set_rescuer_presence(text, double precision, double precision) to authenticated;
revoke all on function public.respond_to_rescue_dispatch(uuid, boolean, text) from public, anon;
grant execute on function public.respond_to_rescue_dispatch(uuid, boolean, text) to authenticated;
revoke all on function public.get_my_pending_rescue_dispatches() from public, anon;
grant execute on function public.get_my_pending_rescue_dispatches() to authenticated;
revoke all on function public.dispatch_rescue_case(uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_rescue_dispatches() from public, anon, authenticated;

notify pgrst, 'reload schema';
