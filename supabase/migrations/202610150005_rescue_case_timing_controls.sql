-- Case timing is a control-room review SLA, not an automatic closure rule.
-- A GPS outage or a difficult rescue must never silently close an SOS case.
begin;

create or replace function public.get_admin_rescue_case_control_v2(p_sos_report_id uuid)
returns table (
  assignment_id uuid,
  rescuer_id uuid,
  rescuer_name text,
  agency text,
  assignment_status text,
  accepted_at timestamptz,
  estimated_arrival_minutes integer,
  arrival_target_at timestamptz,
  escalation_at timestamptz,
  resolution_review_at timestamptz,
  latitude double precision,
  longitude double precision,
  location_updated_at timestamptz,
  location_is_stale boolean,
  arrival_is_overdue boolean,
  resolution_is_overdue boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may view rescue case control data';
  end if;

  return query
  select
    a.id,
    a.rescuer_id,
    p.full_name::text,
    p.agency::text,
    a.status::text,
    a.accepted_at,
    d.estimated_arrival_minutes,
    case when a.accepted_at is null then null
      else a.accepted_at + coalesce(d.estimated_arrival_minutes, 30) * interval '1 minute'
    end as arrival_target_at,
    case when a.accepted_at is null then null
      else a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute'
    end as escalation_at,
    case when a.accepted_at is null then null
      else a.accepted_at + case s.urgency_level
        when 'critical' then interval '60 minutes'
        when 'high' then interval '120 minutes'
        when 'medium' then interval '240 minutes'
        else interval '480 minutes'
      end
    end as resolution_review_at,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at,
    coalesce(rp.location_updated_at < now() - interval '5 minutes', true),
    coalesce(
      a.status in ('accepted', 'en_route') and a.accepted_at is not null
      and now() > a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute',
      false
    ),
    coalesce(
      a.status in ('accepted', 'en_route', 'on_scene') and a.accepted_at is not null
      and now() > a.accepted_at + case s.urgency_level
        when 'critical' then interval '60 minutes'
        when 'high' then interval '120 minutes'
        when 'medium' then interval '240 minutes'
        else interval '480 minutes'
      end,
      false
    )
  from public.assignments a
  join public.sos_reports s on s.id = a.sos_report_id
  join public.profiles p on p.id = a.rescuer_id
  left join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
  left join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.sos_report_id = p_sos_report_id
    and a.status in ('offered', 'accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last, d.offered_at desc
  limit 1;
end;
$$;

revoke all on function public.get_admin_rescue_case_control_v2(uuid) from public, anon;
grant execute on function public.get_admin_rescue_case_control_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
