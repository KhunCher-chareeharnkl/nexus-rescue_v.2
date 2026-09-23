begin;

-- A deceased outcome is terminal, unlike an access problem where a rescuer
-- must be able to return to the scene. Preserve that distinction for victims.
alter table public.victim_status
  drop constraint if exists victim_status_status_check;

alter table public.victim_status
  add constraint victim_status_status_check
  check (status in (
    'waiting', 'rescue_assigned', 'rescued', 'at_shelter',
    'returned_home', 'unknown', 'deceased'
  ));

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
  v_outcome_note text;
  v_sos_status text;
  v_victim_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

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
      raise exception using errcode = '22023', message = 'กรุณาเลือกเข้าไม่ถึงหรือเสียชีวิต';
    end if;

    if p_cannot_reach_reason = 'no_access'
      and p_victim_status is distinct from 'unknown' then
      raise exception using errcode = '22023', message = 'กรณีเข้าไม่ถึงต้องบันทึกสถานะผู้ประสบภัยเป็นรอตรวจสอบ';
    end if;

    if p_cannot_reach_reason = 'deceased'
      and p_victim_status not in ('unknown', 'deceased') then
      raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยกรณีเสียชีวิตไม่ถูกต้อง';
    end if;

    v_outcome_note := coalesce(
      nullif(btrim(coalesce(p_notes, '')), ''),
      case p_cannot_reach_reason
        when 'no_access' then 'เจ้าหน้าที่เข้าถึงพื้นที่ไม่ได้: รอประเมินและเข้าช่วยเหลือใหม่'
        when 'deceased' then 'ยืนยันเหตุเสียชีวิต: ปิดเคสและรอการประสานหน่วยงานที่เกี่ยวข้อง'
      end
    );

    -- Keep the assignment outcome for audit, but close the SOS only when the
    -- confirmed outcome is deceased. A no-access case remains available to retry.
    update public.assignments
    set status = 'cannot_reach',
        cannot_reach_reason = p_cannot_reach_reason,
        notes = v_outcome_note,
        completed_at = coalesce(completed_at, now())
    where id = v_active_assignment_id;

    v_sos_status := case when p_cannot_reach_reason = 'deceased' then 'closed' else 'cannot_reach' end;
    v_victim_status := case when p_cannot_reach_reason = 'deceased' then 'deceased' else 'unknown' end;

    update public.sos_reports
    set status = v_sos_status,
        updated_at = now()
    where id = p_sos_report_id;

    insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
    values (
      p_sos_report_id,
      v_victim_status,
      null,
      coalesce(nullif(btrim(coalesce(p_victim_notes, '')), ''), v_outcome_note),
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
      'outcome', p_cannot_reach_reason,
      'sos_status', v_sos_status
    );
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
