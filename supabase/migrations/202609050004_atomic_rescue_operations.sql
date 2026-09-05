-- ปิดช่องว่างงานกู้ภัย: รับงานและยืนยันผลต้องทำแบบ atomic

begin;

create or replace function public.accept_rescue_assignment(
  p_sos_report_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_report_status text;
  v_assignment_id uuid;
  v_assigned_rescuer_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนรับงาน';
  end if;
  if p_sos_report_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบรหัสคำร้อง SOS';
  end if;

  -- ล็อกโปรไฟล์เพื่อกันเจ้าหน้าที่คนเดียวรับสองงานพร้อมกันจากหลายอุปกรณ์
  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active = true
  for update;
  if v_role is distinct from 'rescuer' then
    raise exception using errcode = '42501', message = 'เฉพาะเจ้าหน้าที่กู้ภัยที่เปิดใช้งานเท่านั้นที่รับงานได้';
  end if;

  -- ล็อกคำร้อง: เจ้าหน้าที่คนอื่นต้องรอผลก่อน จึงไม่มีผู้รับซ้อนกัน
  select status into v_report_status
  from public.sos_reports
  where id = p_sos_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบคำร้อง SOS นี้';
  end if;

  if v_report_status = 'assigned' then
    select id, rescuer_id into v_assignment_id, v_assigned_rescuer_id
    from public.assignments
    where sos_report_id = p_sos_report_id
      and status in ('accepted', 'en_route', 'on_scene')
    order by accepted_at desc nulls last
    limit 1
    for update;
    if v_assigned_rescuer_id = auth.uid() then
      return jsonb_build_object('assignment_id', v_assignment_id, 'already_accepted', true);
    end if;
    raise exception using errcode = '23505', message = 'คำร้องนี้มีเจ้าหน้าที่รับงานแล้ว';
  end if;

  if v_report_status not in ('pending', 'cannot_reach') then
    raise exception using errcode = '23514', message = 'คำร้องนี้ไม่สามารถรับงานได้ในสถานะปัจจุบัน';
  end if;

  select id into v_assignment_id
  from public.assignments
  where rescuer_id = auth.uid()
    and status in ('accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if v_assignment_id is not null then
    raise exception using errcode = '23505', message = 'คุณมีภารกิจที่กำลังดำเนินการอยู่ กรุณาปิดงานเดิมก่อน';
  end if;

  insert into public.assignments (sos_report_id, rescuer_id, status, accepted_at)
  values (p_sos_report_id, auth.uid(), 'accepted', now())
  returning id into v_assignment_id;

  update public.sos_reports
  set status = 'assigned', updated_at = now()
  where id = p_sos_report_id;

  insert into public.victim_status (sos_report_id, status, updated_at)
  values (p_sos_report_id, 'rescue_assigned', now())
  on conflict (sos_report_id) do update
  set status = excluded.status,
      updated_at = excluded.updated_at;

  return jsonb_build_object('assignment_id', v_assignment_id, 'already_accepted', false);
end;
$$;

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
begin
  -- v3 ตรวจสิทธิ์ ล็อกคำร้อง สร้าง manifest และปรับสถานะภารกิจให้แล้ว
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
    raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยกรณีเข้าถึงไม่ได้ไม่ถูกต้อง';
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

revoke all on function public.accept_rescue_assignment(uuid) from public, anon;
grant execute on function public.accept_rescue_assignment(uuid) to authenticated;
revoke all on function public.confirm_rescue_outcome_v4(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text, text, text, text) from public, anon;
grant execute on function public.confirm_rescue_outcome_v4(uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text, text, text, text) to authenticated;

-- เปิด Realtime สำหรับจำนวนที่ว่างของศูนย์ หากตารางยังไม่ได้อยู่ใน publication
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'shelters'
    ) then
    alter publication supabase_realtime add table public.shelters;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
