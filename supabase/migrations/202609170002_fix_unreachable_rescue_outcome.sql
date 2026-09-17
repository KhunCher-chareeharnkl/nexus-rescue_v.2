begin;

-- The legacy confirm_rescue_outcome function changes assignment.status before it
-- persists cannot_reach_reason. Databases with chk_unable_reason_required reject
-- that intermediate row. Handle unsuccessful outcomes atomically in v4 instead.
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

  -- Lock only the currently active assignment owned by the rescuer.
  select a.id into v_active_assignment_id
  from public.assignments a
  where a.sos_report_id = p_sos_report_id
    and a.rescuer_id = auth.uid()
    and a.status in ('accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last
  limit 1
  for update;

  if v_active_assignment_id is null then
    raise exception using errcode = '42501', message = 'คุณไม่ใช่ผู้รับผิดชอบภารกิจนี้ หรือภารกิจสิ้นสุดแล้ว';
  end if;

  if p_mode = 'cannot_reach' then
    if p_cannot_reach_reason not in ('no_access', 'deceased') then
      raise exception using errcode = '22023', message = 'กรุณาระบุเหตุผลว่าเข้าไม่ถึงหรือเสียชีวิต';
    end if;

    if p_victim_status is distinct from 'unknown' then
      raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยกรณีช่วยเหลือไม่ได้ไม่ถูกต้อง';
    end if;

    -- Set the reason in the same UPDATE as status so chk_unable_reason_required
    -- never observes an invalid intermediate row.
    update public.assignments
    set status = 'cannot_reach',
        cannot_reach_reason = p_cannot_reach_reason,
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        completed_at = coalesce(completed_at, now())
    where id = v_active_assignment_id;

    update public.sos_reports
    set status = 'cannot_reach',
        updated_at = now()
    where id = p_sos_report_id;

    insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
    values (
      p_sos_report_id,
      'unknown',
      null,
      coalesce(nullif(btrim(coalesce(p_victim_notes, '')), ''), nullif(btrim(coalesce(p_notes, '')), '')),
      now()
    )
    on conflict (sos_report_id) do update
    set status = excluded.status,
        shelter_name = excluded.shelter_name,
        notes = excluded.notes,
        updated_at = excluded.updated_at;

    return jsonb_build_object(
      'sos_report_id', p_sos_report_id,
      'atomic', true,
      'outcome', p_cannot_reach_reason
    );
  end if;

  -- Successful outcomes retain the existing delivery-manifest workflow.
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

notify pgrst, 'reload schema';

commit;
