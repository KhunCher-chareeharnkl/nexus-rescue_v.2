-- Security-definer operations keep mission state changes atomic and validate
-- the caller again inside Postgres.  The UI must call these functions instead
-- of writing assignments, SOS state, or victim state directly.

create or replace function public.advance_rescue_assignment(
  p_sos_report_id uuid,
  p_next_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_sos_status text;
  v_victim_status text;
  v_victim_note text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'rescuer' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active rescuer may update a mission';
  end if;
  if p_next_status not in ('en_route', 'on_scene', 'completed') then
    raise exception using errcode = '22023', message = 'Invalid mission transition';
  end if;

  select * into v_assignment
  from public.assignments
  where sos_report_id = p_sos_report_id
    and rescuer_id = auth.uid()
    and status in ('accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'You do not own an active mission for this case';
  end if;

  if (v_assignment.status = 'accepted' and p_next_status not in ('en_route', 'completed'))
     or (v_assignment.status = 'en_route' and p_next_status not in ('on_scene', 'completed'))
     or (v_assignment.status = 'on_scene' and p_next_status <> 'completed') then
    raise exception using errcode = '23514', message = 'Mission state transition is not permitted';
  end if;

  v_sos_status := case when p_next_status = 'completed' then 'rescued' else 'assigned' end;
  v_victim_status := case when p_next_status = 'completed' then 'rescued' else 'rescue_assigned' end;
  v_victim_note := case p_next_status
    when 'en_route' then 'ทีมกู้ภัยเริ่มเดินทางไปยังจุดเกิดเหตุแล้ว'
    when 'on_scene' then 'ทีมกู้ภัยถึงจุดเกิดเหตุและกำลังดำเนินการช่วยเหลือ'
    else null
  end;

  update public.assignments
  set status = p_next_status,
      notes = coalesce(nullif(btrim(p_notes), ''), notes),
      completed_at = case when p_next_status = 'completed' then now() else completed_at end
  where id = v_assignment.id;
  update public.sos_reports set status = v_sos_status, updated_at = now() where id = p_sos_report_id;
  insert into public.victim_status (sos_report_id, status, notes, updated_at)
  values (p_sos_report_id, v_victim_status, coalesce(nullif(btrim(p_notes), ''), v_victim_note), now())
  on conflict (sos_report_id) do update set
    status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

  return jsonb_build_object('assignment_id', v_assignment.id, 'status', p_next_status);
end;
$$;

create or replace function public.admin_handoff_rescue_case(
  p_sos_report_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment public.assignments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dispatch jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may transfer a rescue case';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'A handoff reason is required';
  end if;

  select * into v_assignment
  from public.assignments
  where sos_report_id = p_sos_report_id and status in ('offered', 'accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No open rescue assignment was found for this case';
  end if;

  -- Keep a truthful audit trail: the assignment was cancelled by the control
  -- centre, and the dispatch attempt records the handoff reason explicitly.
  update public.assignments
  set status = 'declined', completed_at = now(), notes = 'ADMIN HANDOFF: ' || v_reason
  where id = v_assignment.id;
  update public.rescue_dispatch_attempts
  set status = 'handed_off', responded_at = now(), reason = v_reason
  where assignment_id = v_assignment.id and status in ('offered', 'accepted');
  update public.rescuer_presence
  set availability = 'offline', updated_at = now()
  where rescuer_id = v_assignment.rescuer_id;

  delete from public.rescue_dispatch_searches where sos_report_id = p_sos_report_id;
  update public.sos_reports set status = 'pending', updated_at = now() where id = p_sos_report_id;
  insert into public.victim_status (sos_report_id, status, notes, updated_at)
  values (p_sos_report_id, 'unknown', 'ส่วนกลางส่งต่อเคส: ' || v_reason, now())
  on conflict (sos_report_id) do update set status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

  v_dispatch := public.dispatch_rescue_case(p_sos_report_id);
  return jsonb_build_object('handed_off', true, 'previous_rescuer_id', v_assignment.rescuer_id, 'dispatch', v_dispatch);
end;
$$;

create or replace function public.admin_redrive_rescue_case(p_sos_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may retry dispatch';
  end if;
  return public.dispatch_rescue_case(p_sos_report_id);
end;
$$;

revoke all on function public.advance_rescue_assignment(uuid, text, text) from public, anon;
grant execute on function public.advance_rescue_assignment(uuid, text, text) to authenticated;
revoke all on function public.admin_handoff_rescue_case(uuid, text) from public, anon;
grant execute on function public.admin_handoff_rescue_case(uuid, text) to authenticated;
revoke all on function public.admin_redrive_rescue_case(uuid) from public, anon;
grant execute on function public.admin_redrive_rescue_case(uuid) to authenticated;

notify pgrst, 'reload schema';
