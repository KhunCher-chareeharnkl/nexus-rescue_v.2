-- Automatically hand off an accepted mission if its rescuer is still away from
-- the incident after the estimated travel time plus a ten-minute grace period.
-- Missing/stale GPS pauses the automatic handoff and notifies the control room.

alter table public.assignments
  add column if not exists arrival_gps_stale_notified_at timestamptz;

update public.assignments
set accepted_at = now()
where status in ('accepted', 'en_route') and accepted_at is null;

-- Preserve dispatch history for active missions created before automatic
-- dispatch was installed, so a handed-off rescuer is not selected again.
with missing_attempts as (
  select a.id, a.sos_report_id, a.rescuer_id, a.status, a.accepted_at,
    coalesce((
      select max(d.attempt_no)
      from public.rescue_dispatch_attempts d
      where d.sos_report_id = a.sos_report_id
    ), 0) as previous_attempt_no
  from public.assignments a
  where a.status in ('offered', 'accepted', 'en_route', 'on_scene')
    and not exists (
      select 1 from public.rescue_dispatch_attempts d where d.assignment_id = a.id
    )
), numbered_attempts as (
  select missing_attempts.*,
    row_number() over (partition by sos_report_id order by accepted_at nulls first, id) as attempt_offset
  from missing_attempts
)
insert into public.rescue_dispatch_attempts (
  sos_report_id, assignment_id, rescuer_id, attempt_no, status,
  offered_at, respond_by, responded_at, estimated_arrival_minutes, reason
)
select
  sos_report_id,
  id,
  rescuer_id,
  (previous_attempt_no + attempt_offset)::integer,
  case when status = 'offered' then 'offered' else 'accepted' end,
  coalesce(accepted_at, now()),
  case when status = 'offered' then now() + interval '2 minutes'
    else coalesce(accepted_at, now()) end,
  case when status = 'offered' then null else coalesce(accepted_at, now()) end,
  30,
  'legacy_active_assignment_backfill'
from numbered_attempts;

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
  v_arrival_handoffs integer := 0;
  v_arrival_gps_paused integer := 0;
  v_distance_m double precision;
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

  for v_assignment in
    select
      a.id,
      a.sos_report_id,
      a.rescuer_id,
      a.arrival_gps_stale_notified_at,
      s.lat as case_lat,
      s.lng as case_lng,
      rp.latitude as rescuer_lat,
      rp.longitude as rescuer_lng,
      rp.location_updated_at,
      d.estimated_arrival_minutes
    from public.assignments a
    join public.sos_reports s on s.id = a.sos_report_id
    left join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
    left join public.rescue_dispatch_attempts d on d.assignment_id = a.id
    where a.status in ('accepted', 'en_route')
      and a.accepted_at is not null
      and now() > a.accepted_at
        + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute'
    order by a.accepted_at
    for update of a skip locked
  loop
    if v_assignment.location_updated_at is null
       or v_assignment.location_updated_at < now() - interval '5 minutes'
       or v_assignment.rescuer_lat is null
       or v_assignment.rescuer_lng is null
       or v_assignment.case_lat is null
       or v_assignment.case_lng is null then
      if v_assignment.arrival_gps_stale_notified_at is null then
        update public.assignments
        set arrival_gps_stale_notified_at = now()
        where id = v_assignment.id
          and arrival_gps_stale_notified_at is null;

        if found then
          perform public.enqueue_admin_notification(
            'rescue_arrival_gps_stale',
            'ตรวจสอบภารกิจกู้ภัย: พิกัดไม่อัปเดต',
            'ภารกิจเลยเวลา ETA + 10 นาที แต่ตรวจสอบตำแหน่งล่าสุดไม่ได้ ระบบจึงพักการส่งต่องานอัตโนมัติ กรุณาตรวจสอบเคส ' || v_assignment.sos_report_id::text,
            '/officer/admin'
          );
          v_arrival_gps_paused := v_arrival_gps_paused + 1;
        end if;
      end if;
      continue;
    end if;

    v_distance_m := 6371000 * 2 * asin(sqrt(least(1.0, greatest(0.0,
      power(sin(radians(v_assignment.case_lat - v_assignment.rescuer_lat) / 2), 2)
      + cos(radians(v_assignment.rescuer_lat)) * cos(radians(v_assignment.case_lat))
      * power(sin(radians(v_assignment.case_lng - v_assignment.rescuer_lng) / 2), 2)
    ))));

    if v_distance_m <= 500 then
      update public.assignments
      set status = 'on_scene'
      where id = v_assignment.id and status in ('accepted', 'en_route');
      continue;
    end if;

    update public.assignments
    set status = 'expired',
        completed_at = now(),
        notes = concat_ws(E'\n', nullif(notes, ''), 'AUTO HANDOFF: arrival deadline exceeded')
    where id = v_assignment.id and status in ('accepted', 'en_route');
    if not found then
      continue;
    end if;

    update public.rescue_dispatch_attempts
    set status = 'handed_off',
        responded_at = now(),
        reason = 'arrival_deadline_exceeded'
    where assignment_id = v_assignment.id and status = 'accepted';

    update public.rescuer_presence rp
    set availability = 'available', updated_at = now()
    where rp.rescuer_id = v_assignment.rescuer_id
      and rp.location_updated_at >= now() - interval '5 minutes'
      and not exists (
        select 1
        from public.assignments active
        where active.rescuer_id = rp.rescuer_id
          and active.id <> v_assignment.id
          and active.status in ('offered', 'accepted', 'en_route', 'on_scene')
      );

    update public.sos_reports
    set status = 'pending', updated_at = now()
    where id = v_assignment.sos_report_id and status = 'assigned';
    if not found then
      continue;
    end if;

    insert into public.victim_status (sos_report_id, status, notes, updated_at)
    values (
      v_assignment.sos_report_id,
      'unknown',
      'ระบบส่งต่อภารกิจอัตโนมัติ เนื่องจากเลยกำหนดเวลาเดินทางและตำแหน่งยังห่างจากจุดเกิดเหตุ',
      now()
    )
    on conflict (sos_report_id) do update
    set status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

    v_arrival_handoffs := v_arrival_handoffs + 1;
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

  return jsonb_build_object(
    'expired', v_expired,
    'new_offers', v_dispatched,
    'arrival_handoffs', v_arrival_handoffs,
    'arrival_gps_paused', v_arrival_gps_paused
  );
end;
$$;

revoke all on function public.expire_stale_rescue_dispatches() from public, anon, authenticated;

notify pgrst, 'reload schema';

do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not enabled; automatic rescue dispatch deadlines will not run until the extension is enabled and the scheduled job is installed.';
    return;
  end if;

  for v_job_id in
    select jobid from cron.job where jobname = 'nexus-expire-rescue-dispatches'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'nexus-expire-rescue-dispatches',
    '* * * * *',
    $command$select public.expire_stale_rescue_dispatches();$command$
  );
end;
$$;
