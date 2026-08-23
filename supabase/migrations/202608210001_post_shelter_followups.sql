begin;

create table if not exists public.post_shelter_followups (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid references public.sos_reports(id) on delete cascade,
  shelter_occupant_id uuid references public.shelter_occupants(id) on delete set null,
  shelter_id uuid references public.shelters(id) on delete set null,
  round_no integer not null default 1 check (round_no >= 1),
  household_name text not null,
  contact_phone text,
  status text not null default 'pending'
    check (status in ('pending', 'contacted', 'completed', 'needs_assistance', 'closed')),
  due_at timestamp with time zone not null default (now() + interval '1 day'),
  contacted_at timestamp with time zone,
  completed_at timestamp with time zone,
  arrived_home boolean,
  home_habitable boolean,
  water_available boolean,
  electricity_available boolean,
  toilet_usable boolean,
  access_route_safe boolean,
  has_injured_person boolean,
  has_vulnerable_person boolean,
  needs_food boolean,
  needs_medicine boolean,
  needs_temporary_shelter boolean,
  needs_rescue_followup boolean,
  damage_description text,
  image_urls text[] not null default '{}'::text[],
  notes text,
  submitted_by_type text not null default 'system'
    check (submitted_by_type in ('system', 'victim', 'shelter_staff', 'rescuer', 'admin')),
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint post_shelter_followups_has_source_check
    check (sos_report_id is not null or shelter_occupant_id is not null),
  constraint post_shelter_followups_damage_description_length_check
    check (damage_description is null or char_length(damage_description) <= 2000),
  constraint post_shelter_followups_notes_length_check
    check (notes is null or char_length(notes) <= 2000),
  constraint post_shelter_followups_image_limit_check
    check (cardinality(image_urls) <= 6),
  constraint post_shelter_followups_round_unique
    unique (shelter_occupant_id, round_no)
);

create index if not exists post_shelter_followups_status_due_idx
  on public.post_shelter_followups (status, due_at);
create index if not exists post_shelter_followups_sos_idx
  on public.post_shelter_followups (sos_report_id, created_at desc);
create index if not exists post_shelter_followups_shelter_idx
  on public.post_shelter_followups (shelter_id, created_at desc);
create index if not exists post_shelter_followups_phone_idx
  on public.post_shelter_followups (contact_phone)
  where contact_phone is not null;

comment on table public.post_shelter_followups is
  'ประวัติการติดตามความปลอดภัยและสภาพความเป็นอยู่หลังออกจากศูนย์พักพิง';
comment on column public.post_shelter_followups.round_no is
  'ลำดับการติดตามของรายการผู้พักพิงเดียวกัน รองรับการติดตามซ้ำ';
comment on column public.post_shelter_followups.status is
  'pending=รอติดตาม, contacted=ติดต่อแล้วแต่ข้อมูลยังไม่ครบ, completed=ปลอดภัย, needs_assistance=ต้องช่วยต่อ, closed=ปิดรายการ';

create or replace function public.touch_post_shelter_followup_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_post_shelter_followup_updated_at_trigger
  on public.post_shelter_followups;
create trigger touch_post_shelter_followup_updated_at_trigger
before update on public.post_shelter_followups
for each row execute function public.touch_post_shelter_followup_updated_at();

-- สร้างงานติดตามรอบแรกทันทีเมื่อยืนยันว่าผู้พักพิงกลับบ้าน
create or replace function public.schedule_post_shelter_followup_on_home_exit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'exited'
     and new.exit_destination = 'home'
     and (
       old.status is distinct from new.status
       or old.exit_destination is distinct from new.exit_destination
     ) then
    insert into public.post_shelter_followups (
      sos_report_id,
      shelter_occupant_id,
      shelter_id,
      round_no,
      household_name,
      contact_phone,
      status,
      due_at,
      submitted_by_type
    ) values (
      new.sos_report_id,
      new.id,
      new.shelter_id,
      1,
      new.full_name,
      new.phone,
      'pending',
      coalesce(new.exit_date, now()) + interval '1 day',
      'system'
    )
    on conflict (shelter_occupant_id, round_no) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists schedule_post_shelter_followup_on_home_exit_trigger
  on public.shelter_occupants;
create trigger schedule_post_shelter_followup_on_home_exit_trigger
after update of status, exit_destination on public.shelter_occupants
for each row execute function public.schedule_post_shelter_followup_on_home_exit();

-- สร้างงานให้ข้อมูลที่กลับบ้านไปแล้วก่อนติดตั้ง migration นี้
insert into public.post_shelter_followups (
  sos_report_id,
  shelter_occupant_id,
  shelter_id,
  round_no,
  household_name,
  contact_phone,
  status,
  due_at,
  submitted_by_type
)
select
  o.sos_report_id,
  o.id,
  o.shelter_id,
  1,
  o.full_name,
  o.phone,
  'pending',
  coalesce(o.exit_date, now()) + interval '1 day',
  'system'
from public.shelter_occupants o
where o.status = 'exited'
  and o.exit_destination = 'home'
on conflict (shelter_occupant_id, round_no) do nothing;

alter table public.post_shelter_followups enable row level security;

drop policy if exists post_shelter_followups_staff_select
  on public.post_shelter_followups;
create policy post_shelter_followups_staff_select
  on public.post_shelter_followups
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (
          p.role in ('admin', 'gov')
          or (p.role = 'shelter_staff' and p.shelter_id = post_shelter_followups.shelter_id)
          or (
            p.role = 'rescuer'
            and post_shelter_followups.sos_report_id is not null
            and exists (
              select 1
              from public.assignments a
              where a.sos_report_id = post_shelter_followups.sos_report_id
                and a.rescuer_id = auth.uid()
            )
          )
        )
    )
  );

revoke all on table public.post_shelter_followups from public, anon;
revoke insert, update, delete on table public.post_shelter_followups from authenticated;
grant select on table public.post_shelter_followups to authenticated;

-- เจ้าหน้าที่บันทึกผลผ่าน RPC เท่านั้น เพื่อให้ตรวจสิทธิ์และจัดระดับเคสในจุดเดียว
create or replace function public.record_post_shelter_followup(
  p_followup_id uuid,
  p_assessment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_followup public.post_shelter_followups%rowtype;
  v_role text;
  v_profile_shelter_id uuid;
  v_arrived_home boolean;
  v_home_habitable boolean;
  v_water_available boolean;
  v_electricity_available boolean;
  v_toilet_usable boolean;
  v_access_route_safe boolean;
  v_has_injured_person boolean;
  v_has_vulnerable_person boolean;
  v_needs_food boolean;
  v_needs_medicine boolean;
  v_needs_temporary_shelter boolean;
  v_needs_rescue_followup boolean;
  v_damage_description text;
  v_image_urls text[];
  v_notes text;
  v_next_status text;
  v_submitter_type text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนบันทึกผลติดตาม';
  end if;

  if p_followup_id is null or p_assessment is null or jsonb_typeof(p_assessment) <> 'object' then
    raise exception using errcode = '22023', message = 'ข้อมูลแบบประเมินไม่ถูกต้อง';
  end if;

  select *
  into v_followup
  from public.post_shelter_followups f
  where f.id = p_followup_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการติดตามหลังกลับบ้าน';
  end if;

  if v_followup.status = 'closed' then
    raise exception using errcode = '23514', message = 'รายการติดตามนี้ถูกปิดแล้ว';
  end if;

  select p.role, p.shelter_id
  into v_role, v_profile_shelter_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;

  if v_role is null
     or not (
       v_role = 'admin'
       or (v_role = 'shelter_staff' and v_profile_shelter_id = v_followup.shelter_id)
       or (
         v_role = 'rescuer'
         and v_followup.sos_report_id is not null
         and exists (
           select 1 from public.assignments a
           where a.sos_report_id = v_followup.sos_report_id
             and a.rescuer_id = auth.uid()
         )
       )
     ) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์บันทึกรายการติดตามนี้';
  end if;

  if not (p_assessment ? 'arrived_home')
     or jsonb_typeof(p_assessment -> 'arrived_home') <> 'boolean' then
    raise exception using errcode = '22023', message = 'กรุณาระบุว่าผู้ประสบภัยกลับถึงบ้านหรือไม่';
  end if;

  select *
  into
    v_arrived_home,
    v_home_habitable,
    v_water_available,
    v_electricity_available,
    v_toilet_usable,
    v_access_route_safe,
    v_has_injured_person,
    v_has_vulnerable_person,
    v_needs_food,
    v_needs_medicine,
    v_needs_temporary_shelter,
    v_needs_rescue_followup,
    v_damage_description,
    v_image_urls,
    v_notes
  from jsonb_to_record(p_assessment) as x(
    arrived_home boolean,
    home_habitable boolean,
    water_available boolean,
    electricity_available boolean,
    toilet_usable boolean,
    access_route_safe boolean,
    has_injured_person boolean,
    has_vulnerable_person boolean,
    needs_food boolean,
    needs_medicine boolean,
    needs_temporary_shelter boolean,
    needs_rescue_followup boolean,
    damage_description text,
    image_urls text[],
    notes text
  );

  if v_arrived_home and (
    v_home_habitable is null
    or v_water_available is null
    or v_electricity_available is null
    or v_toilet_usable is null
    or v_access_route_safe is null
    or v_has_injured_person is null
    or v_has_vulnerable_person is null
    or v_needs_food is null
    or v_needs_medicine is null
    or v_needs_temporary_shelter is null
    or v_needs_rescue_followup is null
  ) then
    raise exception using errcode = '22023', message = 'กรุณาตอบแบบประเมินหลังกลับบ้านให้ครบทุกข้อ';
  end if;

  v_image_urls := coalesce(v_image_urls, '{}'::text[]);
  v_damage_description := nullif(btrim(v_damage_description), '');
  v_notes := nullif(btrim(v_notes), '');

  if cardinality(v_image_urls) > 6 then
    raise exception using errcode = '22023', message = 'แนบรูปภาพได้ไม่เกิน 6 รูป';
  end if;
  if v_damage_description is not null and char_length(v_damage_description) > 2000 then
    raise exception using errcode = '22023', message = 'รายละเอียดความเสียหายต้องไม่เกิน 2,000 ตัวอักษร';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using errcode = '22023', message = 'หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร';
  end if;

  if not v_arrived_home
     or not coalesce(v_home_habitable, true)
     or not coalesce(v_water_available, true)
     or not coalesce(v_electricity_available, true)
     or not coalesce(v_toilet_usable, true)
     or not coalesce(v_access_route_safe, true)
     or coalesce(v_has_injured_person, false)
     or coalesce(v_needs_food, false)
     or coalesce(v_needs_medicine, false)
     or coalesce(v_needs_temporary_shelter, false)
     or coalesce(v_needs_rescue_followup, false) then
    v_next_status := 'needs_assistance';
  else
    v_next_status := 'completed';
  end if;

  v_submitter_type := case v_role
    when 'shelter_staff' then 'shelter_staff'
    when 'rescuer' then 'rescuer'
    else 'admin'
  end;

  update public.post_shelter_followups
  set status = v_next_status,
      contacted_at = coalesce(contacted_at, now()),
      completed_at = now(),
      arrived_home = v_arrived_home,
      home_habitable = v_home_habitable,
      water_available = v_water_available,
      electricity_available = v_electricity_available,
      toilet_usable = v_toilet_usable,
      access_route_safe = v_access_route_safe,
      has_injured_person = v_has_injured_person,
      has_vulnerable_person = v_has_vulnerable_person,
      needs_food = v_needs_food,
      needs_medicine = v_needs_medicine,
      needs_temporary_shelter = v_needs_temporary_shelter,
      needs_rescue_followup = v_needs_rescue_followup,
      damage_description = v_damage_description,
      image_urls = v_image_urls,
      notes = v_notes,
      submitted_by_type = v_submitter_type,
      submitted_by = auth.uid()
  where id = v_followup.id;

  return jsonb_build_object(
    'id', v_followup.id,
    'status', v_next_status,
    'needs_assistance', v_next_status = 'needs_assistance',
    'completed_at', now()
  );
end;
$$;

revoke all on function public.record_post_shelter_followup(uuid, jsonb)
  from public, anon;
grant execute on function public.record_post_shelter_followup(uuid, jsonb)
  to authenticated;

comment on function public.record_post_shelter_followup(uuid, jsonb) is
  'บันทึกผลติดตามหลังกลับบ้าน ตรวจสิทธิ์ และจัดสถานะ completed หรือ needs_assistance อัตโนมัติ';

notify pgrst, 'reload schema';

commit;
