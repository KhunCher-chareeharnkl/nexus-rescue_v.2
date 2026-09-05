-- Ownership hardening for rescue jobs.
-- A rescuer may confirm an outcome only for their own currently active assignment.

begin;

create or replace function public.confirm_rescue_outcome_v4(
  p_sos_report_id uuid,
  p_mode text,
  p_destination_type text,
  p_destination_shelter_id uuid,
  p_destination_note text,
  p_confirmed_adult integer,
  p_confirmed_child integer,
  p_confirmed_elder integer,
  p_cannot_reach_reason text,
  p_notes text,
  p_people jsonb,
  p_count_discrepancy_note text,
  p_victim_status text,
  p_victim_shelter_name text,
  p_victim_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_assignment_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

  -- Lock the active assignment owned by the caller.  Historical assignments
  -- must never authorize a new outcome for the same SOS request.
  select id into v_active_assignment_id
  from public.assignments
  where sos_report_id = p_sos_report_id
    and rescuer_id = auth.uid()
    and status in ('accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;

  if v_active_assignment_id is null then
    raise exception using errcode = '42501', message = 'คุณไม่ใช่ผู้รับผิดชอบภารกิจนี้ หรือภารกิจสิ้นสุดแล้ว';
  end if;

  perform public.confirm_rescue_outcome_v3(
    p_sos_report_id,
    p_mode,
    p_destination_type,
    p_destination_shelter_id,
    p_destination_note,
    p_confirmed_adult,
    p_confirmed_child,
    p_confirmed_elder,
    p_cannot_reach_reason,
    p_notes,
    p_people,
    p_count_discrepancy_note
  );

  if p_mode = 'rescued' and p_victim_status not in ('rescued', 'at_shelter') then
    raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยหลังช่วยเหลือไม่ถูกต้อง';
  end if;
  if p_mode = 'cannot_reach' and p_victim_status <> 'unknown' then
    raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยกรณีเข้าไม่ถึงไม่ถูกต้อง';
  end if;

  insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
  values (
    p_sos_report_id,
    p_victim_status,
    nullif(btrim(p_victim_shelter_name), ''),
    nullif(btrim(p_victim_notes), ''),
    now()
  )
  on conflict (sos_report_id) do update
  set status = excluded.status,
      shelter_name = excluded.shelter_name,
      notes = excluded.notes,
      updated_at = excluded.updated_at;

  return jsonb_build_object('sos_report_id', p_sos_report_id, 'atomic', true);
end;
$$;

revoke all on function public.confirm_rescue_outcome_v4(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.confirm_rescue_outcome_v4(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text, text, text, text) to authenticated;

commit;
