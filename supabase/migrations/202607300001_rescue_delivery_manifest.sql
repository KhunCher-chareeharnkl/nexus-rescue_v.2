-- บัญชีรายชื่อการนำส่งรายบุคคล
-- ช่วยให้ตรวจสอบได้ว่าจำนวนคนในคำร้อง SOS ไปถึงปลายทางครบหรือไม่
-- และรองรับการแยกบางคนไปโรงพยาบาล (เคสแดง) ระหว่างนำส่งศูนย์พักพิง

begin;

create extension if not exists pgcrypto;

-- v2 ต่อจาก transaction เดิมของระบบ ตรวจ dependency ก่อนสร้างสิ่งใดเพิ่มเติม
do $preflight$
begin
  if to_regprocedure(
    'public.confirm_rescue_outcome(uuid,text,text,uuid,text,integer,integer,integer,text,text)'
  ) is null then
    raise exception
      'ไม่พบ public.confirm_rescue_outcome signature เดิม กรุณาตรวจสอบ RPC เดิมก่อนรัน migration นี้';
  end if;
end;
$preflight$;

-- ข้อมูลเดิมบางศูนย์ยังเป็น 0 จึงใช้ NOT VALID:
-- แถวเดิมยังอยู่เพื่อให้แอดมินเข้าไปแก้ได้ แต่การเพิ่ม/แก้ไขหลัง migration ต้องระบุค่ามากกว่า 0
alter table public.shelters
  drop constraint if exists shelters_capacity_must_be_positive;
alter table public.shelters
  add constraint shelters_capacity_must_be_positive
  check (coalesce(capacity, 0) > 0) not valid;

create table if not exists public.rescue_delivery_manifests (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid not null references public.sos_reports(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  rescuer_id uuid not null references public.profiles(id) on delete restrict,
  primary_destination_type text not null
    check (primary_destination_type in ('shelter', 'relative_home', 'hotel', 'other_safe')),
  shelter_id uuid references public.shelters(id) on delete restrict,
  requested_adult_count integer not null default 0 check (requested_adult_count >= 0),
  requested_child_count integer not null default 0 check (requested_child_count >= 0),
  requested_elder_count integer not null default 0 check (requested_elder_count >= 0),
  accounted_total integer not null check (accounted_total >= 0),
  primary_destination_total integer not null check (primary_destination_total >= 0),
  hospital_total integer not null default 0 check (hospital_total >= 0),
  count_discrepancy_note text,
  created_at timestamptz not null default now(),
  unique (sos_report_id)
);

create table if not exists public.rescue_delivery_people (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.rescue_delivery_manifests(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  full_name text not null check (char_length(btrim(full_name)) > 0),
  age_group text not null check (age_group in ('adult', 'child', 'elder')),
  is_primary_destination boolean not null default false,
  destination_type text not null
    check (destination_type in ('shelter', 'hospital', 'relative_home', 'hotel', 'other_safe')),
  destination_name text,
  notes text,
  created_at timestamptz not null default now(),
  unique (manifest_id, sequence_no)
);

-- รองรับกรณีเคยรัน migration ฉบับก่อนหน้าค้างไว้ก่อนเพิ่มคอลัมน์นี้
alter table public.rescue_delivery_people
  add column if not exists is_primary_destination boolean not null default false;

create index if not exists rescue_delivery_manifests_shelter_idx
  on public.rescue_delivery_manifests (shelter_id, created_at desc);
create index if not exists rescue_delivery_people_manifest_idx
  on public.rescue_delivery_people (manifest_id, sequence_no);

alter table public.rescue_delivery_manifests enable row level security;
alter table public.rescue_delivery_people enable row level security;

drop policy if exists "authorized officers can read delivery manifests"
  on public.rescue_delivery_manifests;
create policy "authorized officers can read delivery manifests"
  on public.rescue_delivery_manifests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or (p.role = 'rescuer' and rescue_delivery_manifests.rescuer_id = auth.uid())
          or (p.role = 'shelter_staff' and p.shelter_id = rescue_delivery_manifests.shelter_id)
        )
    )
  );

drop policy if exists "authorized officers can read delivery people"
  on public.rescue_delivery_people;
create policy "authorized officers can read delivery people"
  on public.rescue_delivery_people
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.rescue_delivery_manifests m
      join public.profiles p on p.id = auth.uid()
      where m.id = rescue_delivery_people.manifest_id
        and (
          p.role = 'admin'
          or (p.role = 'rescuer' and m.rescuer_id = auth.uid())
          or (p.role = 'shelter_staff' and p.shelter_id = m.shelter_id)
        )
    )
  );

grant select on public.rescue_delivery_manifests to authenticated;
grant select on public.rescue_delivery_people to authenticated;

create or replace function public.confirm_rescue_outcome_v2(
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
  v_contact_phone text;
  v_requested_total integer;
  v_accounted_total integer := 0;
  v_primary_total integer := 0;
  v_hospital_total integer := 0;
  v_primary_adult integer := 0;
  v_primary_child integer := 0;
  v_primary_elder integer := 0;
  v_capacity integer;
  v_current_occupancy integer;
  v_manifest_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

  if p_mode not in ('rescued', 'cannot_reach') then
    raise exception using errcode = '22023', message = 'สถานะผลการช่วยเหลือไม่ถูกต้อง';
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

  if p_mode = 'rescued' then
    if p_destination_type not in ('shelter', 'relative_home', 'hotel', 'other_safe') then
      raise exception using errcode = '22023', message = 'กรุณาเลือกปลายทางหลัก';
    end if;
    if p_destination_type = 'shelter' and p_destination_shelter_id is null then
      raise exception using errcode = '22023', message = 'กรุณาเลือกศูนย์พักพิง';
    end if;
    if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
      raise exception using errcode = '22023', message = 'กรุณาระบุบัญชีรายชื่อผู้ประสบภัย';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_people) person
      where nullif(btrim(person->>'full_name'), '') is null
        or coalesce(person->>'age_group', '') not in ('adult', 'child', 'elder')
        or coalesce(person->>'destination_type', '') not in ('shelter', 'hospital', 'relative_home', 'hotel', 'other_safe')
    ) then
      raise exception using errcode = '22023', message = 'ชื่อ กลุ่มอายุ หรือปลายทางของบุคคลไม่ครบ';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_people) person
      where coalesce((person->>'is_primary_destination')::boolean, false)
        and person->>'destination_type' <> p_destination_type
    ) then
      raise exception using errcode = '22023', message = 'ปลายทางหลักในบัญชีรายชื่อไม่ตรงกับปลายทางที่เลือก';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_people) person
      where person->>'destination_type' <> 'shelter'
        and nullif(btrim(person->>'destination_name'), '') is null
    ) then
      raise exception using errcode = '22023', message = 'กรุณาระบุชื่อปลายทางของผู้ที่ไม่ได้เข้าศูนย์ทุกคน';
    end if;

    select
      count(*)::integer,
      count(*) filter (where coalesce((person->>'is_primary_destination')::boolean, false))::integer,
      count(*) filter (where person->>'destination_type' = 'hospital')::integer,
      count(*) filter (where coalesce((person->>'is_primary_destination')::boolean, false) and person->>'age_group' = 'adult')::integer,
      count(*) filter (where coalesce((person->>'is_primary_destination')::boolean, false) and person->>'age_group' = 'child')::integer,
      count(*) filter (where coalesce((person->>'is_primary_destination')::boolean, false) and person->>'age_group' = 'elder')::integer
    into
      v_accounted_total,
      v_primary_total,
      v_hospital_total,
      v_primary_adult,
      v_primary_child,
      v_primary_elder
    from jsonb_array_elements(p_people) person;

    if v_accounted_total <> v_requested_total
      and nullif(btrim(p_count_discrepancy_note), '') is null then
      raise exception using errcode = '22023',
        message = format(
          'จำนวนในบัญชีรายชื่อ %s คน ไม่ตรงกับคำร้อง %s คน กรุณาระบุเหตุผล',
          v_accounted_total,
          v_requested_total
        );
    end if;

    if v_primary_total = 0 then
      raise exception using errcode = '22023', message = 'ต้องมีผู้ประสบภัยอย่างน้อย 1 คนไปถึงปลายทางหลัก';
    end if;

    if coalesce(p_confirmed_adult, -1) <> v_primary_adult
      or coalesce(p_confirmed_child, -1) <> v_primary_child
      or coalesce(p_confirmed_elder, -1) <> v_primary_elder then
      raise exception using errcode = '22023', message = 'จำนวนผู้ที่ถึงปลายทางหลักไม่ตรงกับบัญชีรายชื่อ';
    end if;

    if p_destination_type = 'shelter' then
      if exists (
        select 1
        from jsonb_array_elements(p_people) person
        where person->>'destination_type' = 'shelter'
          and p_destination_shelter_id is null
      ) then
        raise exception using errcode = '22023', message = 'ไม่พบศูนย์ปลายทางของผู้พักพิง';
      end if;

      select coalesce(s.capacity, 0), coalesce(s.current_occupancy, 0)
      into v_capacity, v_current_occupancy
      from public.shelters s
      where s.id = p_destination_shelter_id
        and s.is_active = true
      for update;

      if not found then
        raise exception using errcode = 'P0002', message = 'ไม่พบศูนย์พักพิงที่เปิดให้บริการ';
      end if;

      if v_capacity < 1 then
        raise exception using errcode = '22023',
          message = 'ศูนย์พักพิงยังไม่กำหนดจำนวนที่รับได้สูงสุด กรุณาให้ผู้ดูแลระบบกำหนดความจุก่อน';
      end if;

      if v_current_occupancy + v_primary_total > v_capacity then
        raise exception using errcode = '22023',
          message = format(
            'ศูนย์เหลือที่ว่าง %s คน แต่กำลังนำส่ง %s คน',
            greatest(v_capacity - v_current_occupancy, 0),
            v_primary_total
          );
      end if;
    end if;
  end if;

  -- เรียก transaction เดิมเพื่ออัปเดต assignments, sos_reports, victim_status
  -- และสร้าง shelter_occupants ตามพฤติกรรมเดิมของระบบ
  perform public.confirm_rescue_outcome(
    p_sos_report_id => p_sos_report_id,
    p_mode => p_mode,
    p_destination_type => p_destination_type,
    p_destination_shelter_id => p_destination_shelter_id,
    p_destination_note => p_destination_note,
    p_confirmed_adult => p_confirmed_adult,
    p_confirmed_child => p_confirmed_child,
    p_confirmed_elder => p_confirmed_elder,
    p_cannot_reach_reason => p_cannot_reach_reason,
    p_notes => p_notes
  );

  if p_mode = 'rescued' then
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
      count_discrepancy_note
    )
    values (
      p_sos_report_id,
      v_assignment_id,
      auth.uid(),
      p_destination_type,
      case when p_destination_type = 'shelter' then p_destination_shelter_id else null end,
      v_requested_adult,
      v_requested_child,
      v_requested_elder,
      v_accounted_total,
      v_primary_total,
      v_hospital_total,
      nullif(btrim(p_count_discrepancy_note), '')
    )
    returning id into v_manifest_id;

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
      coalesce((person.value->>'is_primary_destination')::boolean, false),
      person.value->>'destination_type',
      nullif(btrim(person.value->>'destination_name'), ''),
      nullif(btrim(person.value->>'notes'), '')
    from jsonb_array_elements(p_people) with ordinality person(value, ordinality);

    if p_destination_type = 'shelter' then
      -- RPC รุ่นเดิมสร้างทะเบียนแบบยอดรวมของครัวเรือน จึงแทนที่ด้วยรายชื่อจริงรายคน
      -- เพื่อให้ศูนย์เช็กชื่อและยืนยันออกจากศูนย์ได้เป็นรายบุคคล
      delete from public.shelter_occupants
      where shelter_id = p_destination_shelter_id
        and sos_report_id = p_sos_report_id
        and entry_source = 'rescuer';

      insert into public.shelter_occupants (
        shelter_id,
        sos_report_id,
        assignment_id,
        full_name,
        phone,
        adult_count,
        child_count,
        elder_count,
        entry_source,
        registered_by,
        status,
        entry_date
      )
      select
        p_destination_shelter_id,
        p_sos_report_id,
        v_assignment_id,
        btrim(person.value->>'full_name'),
        v_contact_phone,
        case when person.value->>'age_group' = 'adult' then 1 else 0 end,
        case when person.value->>'age_group' = 'child' then 1 else 0 end,
        case when person.value->>'age_group' = 'elder' then 1 else 0 end,
        'rescuer',
        auth.uid(),
        'in_shelter',
        now()
      from jsonb_array_elements(p_people) with ordinality person(value, ordinality)
      where coalesce((person.value->>'is_primary_destination')::boolean, false)
        and person.value->>'destination_type' = 'shelter';

      update public.shelters
      set current_occupancy = coalesce((
        select sum(
          coalesce(o.adult_count, 0)
          + coalesce(o.child_count, 0)
          + coalesce(o.elder_count, 0)
        )
        from public.shelter_occupants o
        where o.shelter_id = p_destination_shelter_id
          and o.status = 'in_shelter'
      ), 0)
      where id = p_destination_shelter_id;
    end if;
  end if;
end;
$$;

revoke all on function public.confirm_rescue_outcome_v2(
  uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text
) from public;
grant execute on function public.confirm_rescue_outcome_v2(
  uuid, text, text, uuid, text, integer, integer, integer, text, text, jsonb, text
) to authenticated;

comment on table public.rescue_delivery_manifests is
  'หัวรายการนำส่ง ใช้กระทบยอดจำนวนคนใน SOS กับคนที่ไปถึงปลายทางและโรงพยาบาล';
comment on table public.rescue_delivery_people is
  'บัญชีรายชื่อรายบุคคลของการนำส่ง พร้อมกลุ่มอายุและปลายทางจริง';

commit;
