-- รองรับการบันทึกผู้ประสบภัยแบบรวดเร็วโดยไม่ต้องพิมพ์ชื่อทีละคน
-- เป็น migration แบบเพิ่มข้อมูลเท่านั้น: ไม่ลบตาราง คอลัมน์ หรือประวัติเดิม

begin;

alter table public.rescue_delivery_people
  add column if not exists identity_status text not null default 'reported_name',
  add column if not exists reference_code text,
  add column if not exists handoff_status text not null default 'not_required',
  add column if not exists departed_at timestamp with time zone,
  add column if not exists received_at timestamp with time zone,
  add column if not exists received_by text;

alter table public.rescue_delivery_people
  drop constraint if exists rescue_delivery_people_identity_status_check;
alter table public.rescue_delivery_people
  add constraint rescue_delivery_people_identity_status_check
  check (identity_status in ('reported_name', 'temporary'));

alter table public.rescue_delivery_people
  drop constraint if exists rescue_delivery_people_handoff_status_check;
alter table public.rescue_delivery_people
  add constraint rescue_delivery_people_handoff_status_check
  check (handoff_status in ('not_required', 'pending_receipt', 'received'));

create index if not exists rescue_delivery_people_reference_code_idx
  on public.rescue_delivery_people (manifest_id, reference_code);

create index if not exists rescue_delivery_people_pending_handoff_idx
  on public.rescue_delivery_people (destination_type, handoff_status)
  where destination_type = 'hospital';

create or replace function public.prepare_rescue_delivery_person()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if nullif(btrim(new.reference_code), '') is null then
    new.reference_code := 'P' || lpad(new.sequence_no::text, 2, '0');
  end if;

  if new.full_name like '%ไม่ระบุชื่อ #%'
    or new.notes like '%รหัสชั่วคราว P%' then
    new.identity_status := 'temporary';
  else
    new.identity_status := 'reported_name';
  end if;

  if new.destination_type = 'hospital' then
    if tg_op = 'INSERT' then
      new.handoff_status := 'pending_receipt';
    elsif old.destination_type is distinct from 'hospital' then
      new.handoff_status := 'pending_receipt';
    end if;
    new.departed_at := coalesce(new.departed_at, now());
  else
    new.handoff_status := 'not_required';
    new.departed_at := null;
    new.received_at := null;
    new.received_by := null;
  end if;

  if new.handoff_status = 'received' and new.received_at is null then
    new.received_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_rescue_delivery_person_trigger
  on public.rescue_delivery_people;
create trigger prepare_rescue_delivery_person_trigger
before insert or update on public.rescue_delivery_people
for each row execute function public.prepare_rescue_delivery_person();

-- เติม metadata ให้ประวัติเดิมโดยไม่แก้ชื่อหรือผลการนำส่งเดิม
update public.rescue_delivery_people
set
  reference_code = coalesce(nullif(btrim(reference_code), ''), 'P' || lpad(sequence_no::text, 2, '0')),
  identity_status = case
    when full_name like '%ไม่ระบุชื่อ #%'
      or notes like '%รหัสชั่วคราว P%'
      then 'temporary'
    else 'reported_name'
  end,
  handoff_status = case
    when destination_type = 'hospital' then 'pending_receipt'
    else 'not_required'
  end,
  departed_at = case
    when destination_type = 'hospital' then coalesce(departed_at, created_at)
    else null
  end;

-- v3 ใช้ v2 สำหรับกรณีทั่วไป และรองรับกรณีทุกคนแยกไปโรงพยาบาล/
-- เสียชีวิต/ปลายทางอื่นจนไม่มีผู้ไปปลายทางหลัก
create or replace function public.confirm_rescue_outcome_v3(
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
  p_count_discrepancy_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_requested_adult integer;
  v_requested_child integer;
  v_requested_elder integer;
  v_requested_total integer;
  v_contact_phone text;
  v_accounted_total integer;
  v_primary_total integer;
  v_hospital_total integer;
  v_deceased_total integer;
  v_manifest_id uuid;
begin
  if p_mode is distinct from 'rescued' then
    perform public.confirm_rescue_outcome_v2(
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
    return;
  end if;

  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception using errcode = '22023', message = 'กรุณาระบุจำนวนผู้ประสบภัยที่พบ';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where coalesce((person->>'is_primary_destination')::boolean, false)
    )::integer,
    count(*) filter (where person->>'destination_type' = 'hospital')::integer,
    count(*) filter (where person->>'destination_type' = 'deceased')::integer
  into v_accounted_total, v_primary_total, v_hospital_total, v_deceased_total
  from jsonb_array_elements(p_people) person;

  if v_primary_total > 0 then
    perform public.confirm_rescue_outcome_v2(
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
    return;
  end if;

  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_people) person
    where nullif(btrim(person->>'full_name'), '') is null
      or coalesce(person->>'age_group', '') not in ('adult', 'child', 'elder')
      or coalesce(person->>'destination_type', '') not in ('hospital', 'deceased', 'other_safe')
      or nullif(btrim(person->>'destination_name'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'ข้อมูลกลุ่มอายุหรือปลายทางของผู้ประสบภัยไม่ครบ';
  end if;

  select a.id
  into v_assignment_id
  from public.assignments a
  where a.sos_report_id = p_sos_report_id
    and a.rescuer_id = auth.uid()
  order by a.accepted_at desc nulls last
  limit 1;

  if v_assignment_id is null then
    raise exception using errcode = '42501', message = 'ไม่พบงานที่เจ้าหน้าที่คนนี้รับไว้';
  end if;

  select
    coalesce(s.adult_count, 0),
    coalesce(s.child_count, 0),
    coalesce(s.elder_count, 0),
    s.phone
  into
    v_requested_adult,
    v_requested_child,
    v_requested_elder,
    v_contact_phone
  from public.sos_reports s
  where s.id = p_sos_report_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบคำร้อง SOS';
  end if;

  v_requested_total := v_requested_adult + v_requested_child + v_requested_elder;
  if v_accounted_total <> v_requested_total
    and nullif(btrim(p_count_discrepancy_note), '') is null then
    raise exception using errcode = '22023', message = 'จำนวนผู้ประสบภัยไม่ตรงกับคำร้อง กรุณาระบุเหตุผล';
  end if;

  -- ฟังก์ชันเดิมต้องมีปลายทางหลัก จึงใช้ other_safe เป็นค่าทางเทคนิคสำหรับ assignment
  -- ส่วนปลายทางจริงที่ตรวจสอบย้อนหลังได้เก็บครบใน rescue_delivery_people
  perform public.confirm_rescue_outcome(
    p_sos_report_id => p_sos_report_id,
    p_mode => 'rescued',
    p_destination_type => 'other_safe',
    p_destination_shelter_id => null,
    p_destination_note => 'ผู้ประสบภัยทุกคนแยกไปปลายทางรายบุคคล โปรดดูบัญชีการนำส่ง',
    p_confirmed_adult => 0,
    p_confirmed_child => 0,
    p_confirmed_elder => 0,
    p_cannot_reach_reason => null,
    p_notes => p_notes
  );

  insert into public.rescue_delivery_manifests (
    sos_report_id,
    assignment_id,
    rescuer_id,
    primary_destination_type,
    shelter_id,
    requested_adult_count,
    requested_child_count,
    requested_elder_count,
    accounted_total,
    primary_destination_total,
    hospital_total,
    deceased_total,
    count_discrepancy_note
  ) values (
    p_sos_report_id,
    v_assignment_id,
    auth.uid(),
    'other_safe',
    null,
    v_requested_adult,
    v_requested_child,
    v_requested_elder,
    v_accounted_total,
    0,
    v_hospital_total,
    v_deceased_total,
    nullif(btrim(p_count_discrepancy_note), '')
  ) returning id into v_manifest_id;

  insert into public.rescue_delivery_people (
    manifest_id,
    sequence_no,
    full_name,
    age_group,
    is_primary_destination,
    destination_type,
    destination_name,
    notes
  )
  select
    v_manifest_id,
    person.ordinality::integer,
    btrim(person.value->>'full_name'),
    person.value->>'age_group',
    false,
    person.value->>'destination_type',
    btrim(person.value->>'destination_name'),
    nullif(btrim(person.value->>'notes'), '')
  from jsonb_array_elements(p_people) with ordinality person(value, ordinality);
end;
$$;

revoke all on function public.confirm_rescue_outcome_v3(
  uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text
) from public, anon;
grant execute on function public.confirm_rescue_outcome_v3(
  uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text
) to authenticated;

comment on column public.rescue_delivery_people.identity_status is
  'reported_name = ทราบชื่อ/ข้อมูลอ้างอิง, temporary = ระบบสร้างชื่อและรหัสชั่วคราว';
comment on column public.rescue_delivery_people.reference_code is
  'รหัสติดตามบุคคลภายในภารกิจ เช่น P01 โดยไม่ต้องทราบชื่อจริง';
comment on column public.rescue_delivery_people.handoff_status is
  'สถานะการส่งมอบโรงพยาบาล: pending_receipt รอยืนยันรับ, received รับแล้ว';

notify pgrst, 'reload schema';

commit;
