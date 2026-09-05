-- ปิดงานข้อมูลศูนย์พักพิง: ชื่อที่ศูนย์แก้ต้องตรงกับบัญชีการนำส่ง มี audit
-- และย้ายข้อมูลกู้ภัยรุ่นเก่าที่เป็นยอดรวมให้เป็นรายบุคคลเมื่อยืนยันรายการได้ครบ

begin;

create table if not exists public.shelter_occupant_name_audit (
  id uuid primary key default gen_random_uuid(),
  shelter_id uuid not null references public.shelters(id) on delete cascade,
  occupant_id uuid not null references public.shelter_occupants(id) on delete cascade,
  delivery_person_id uuid references public.rescue_delivery_people(id) on delete set null,
  previous_full_name text not null,
  next_full_name text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists shelter_occupant_name_audit_occupant_idx
  on public.shelter_occupant_name_audit (occupant_id, changed_at desc);

create table if not exists public.shelter_request_exit_audit (
  id uuid primary key default gen_random_uuid(),
  shelter_id uuid not null references public.shelters(id) on delete cascade,
  sos_report_id uuid not null references public.sos_reports(id) on delete cascade,
  exit_destination text not null check (exit_destination in ('home', 'relative_home', 'other_shelter', 'other')),
  exit_at timestamptz not null,
  exit_note text,
  exited_count integer not null check (exited_count > 0),
  recorded_by uuid references public.profiles(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index if not exists shelter_request_exit_audit_request_idx
  on public.shelter_request_exit_audit (shelter_id, sos_report_id, recorded_at desc);

alter table public.shelter_occupant_name_audit enable row level security;
alter table public.shelter_request_exit_audit enable row level security;

drop policy if exists "shelter staff can read occupant name audit" on public.shelter_occupant_name_audit;
create policy "shelter staff can read occupant name audit"
  on public.shelter_occupant_name_audit
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (p.role = 'admin' or (p.role = 'shelter_staff' and p.shelter_id = shelter_occupant_name_audit.shelter_id))
    )
  );

drop policy if exists "shelter staff can read request exit audit" on public.shelter_request_exit_audit;
create policy "shelter staff can read request exit audit"
  on public.shelter_request_exit_audit
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (p.role = 'admin' or (p.role = 'shelter_staff' and p.shelter_id = shelter_request_exit_audit.shelter_id))
    )
  );

grant select on public.shelter_occupant_name_audit to authenticated;
grant select on public.shelter_request_exit_audit to authenticated;

-- เมื่อเจ้าหน้าที่ใส่ชื่อจริงแล้ว trigger ต้องไม่ตีความเป็นชื่อชั่วคราวจากหมายเหตุเดิม
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
    or new.full_name like '%ไม่ทราบชื่อ #%'
  then
    new.identity_status := 'temporary';
  elsif tg_op = 'INSERT'
    and new.notes like '%รหัสชั่วคราว P%'
  then
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

create or replace function public.rename_shelter_delivery_person(
  p_delivery_person_id uuid,
  p_occupant_id uuid,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occupant public.shelter_occupants%rowtype;
  v_role text;
  v_profile_shelter_id uuid;
  v_full_name text := nullif(btrim(p_full_name), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนแก้ไขชื่อ';
  end if;
  if p_delivery_person_id is null or p_occupant_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบข้อมูลบุคคลที่ต้องการแก้ไข';
  end if;
  if v_full_name is null or char_length(v_full_name) > 160 then
    raise exception using errcode = '22023', message = 'กรุณาระบุชื่อความยาวไม่เกิน 160 ตัวอักษร';
  end if;

  select * into v_occupant
  from public.shelter_occupants
  where id = p_occupant_id
    and delivery_person_id = p_delivery_person_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบผู้พักพิงที่เชื่อมกับรายชื่อกู้ภัยนี้';
  end if;

  select role, shelter_id into v_role, v_profile_shelter_id
  from public.profiles
  where id = auth.uid() and is_active = true;
  if v_role is null or not (v_role = 'admin' or (v_role = 'shelter_staff' and v_profile_shelter_id = v_occupant.shelter_id)) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์แก้ไขรายชื่อของศูนย์นี้';
  end if;

  perform 1 from public.rescue_delivery_people where id = p_delivery_person_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบบัญชีรายชื่อจากทีมกู้ภัย';
  end if;

  update public.rescue_delivery_people
  set full_name = v_full_name,
      identity_status = 'reported_name'
  where id = p_delivery_person_id;

  update public.shelter_occupants
  set full_name = v_full_name
  where id = p_occupant_id;

  if v_occupant.full_name is distinct from v_full_name then
    insert into public.shelter_occupant_name_audit (
      shelter_id, occupant_id, delivery_person_id, previous_full_name, next_full_name, changed_by
    ) values (
      v_occupant.shelter_id, p_occupant_id, p_delivery_person_id, v_occupant.full_name, v_full_name, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'occupant_id', p_occupant_id,
    'delivery_person_id', p_delivery_person_id,
    'full_name', v_full_name,
    'synced', true
  );
end;
$$;

create or replace function public.confirm_shelter_request_exit(
  p_sos_report_id uuid,
  p_shelter_id uuid,
  p_exit_destination text,
  p_exit_at timestamp with time zone,
  p_exit_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_occupant_id uuid;
  v_exited_count integer := 0;
begin
  if p_sos_report_id is null or p_shelter_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบคำร้องหรือศูนย์พักพิง';
  end if;

  -- confirm_shelter_exit ทำสิทธิ์ ตรวจเวลา ปรับความจุ และอัปเดตสถานะ SOS ให้ทุกคน
  -- หากคนใดคนหนึ่งผิดพลาด transaction นี้จะ rollback ทั้งคำร้อง
  for v_occupant_id in
    select id
    from public.shelter_occupants
    where shelter_id = p_shelter_id
      and sos_report_id = p_sos_report_id
      and status = 'in_shelter'
    order by entry_date, id
    for update
  loop
    perform public.confirm_shelter_exit(v_occupant_id, p_exit_destination, p_exit_at, p_exit_note);
    v_exited_count := v_exited_count + 1;
  end loop;

  if v_exited_count = 0 then
    raise exception using errcode = 'P0002', message = 'ไม่พบผู้พักพิงในคำร้องนี้ที่ยังอยู่ในศูนย์';
  end if;

  insert into public.shelter_request_exit_audit (
    shelter_id, sos_report_id, exit_destination, exit_at, exit_note, exited_count, recorded_by
  ) values (
    p_shelter_id, p_sos_report_id, p_exit_destination, p_exit_at, nullif(btrim(p_exit_note), ''), v_exited_count, auth.uid()
  );

  return jsonb_build_object(
    'sos_report_id', p_sos_report_id,
    'shelter_id', p_shelter_id,
    'exited_count', v_exited_count,
    'atomic', true
  );
end;
$$;

-- เปลี่ยนแถวกู้ภัยเก่าที่บันทึกเป็นยอดรวมให้เป็นรายบุคคล เฉพาะเมื่อ manifest
-- มีรายชื่อถึงศูนย์ครบพอดีกับยอดเดิม จึงไม่เดาหรือทำให้ข้อมูลที่ตรวจสอบไม่ได้สูญหาย
do $$
declare
  v_legacy public.shelter_occupants%rowtype;
  v_manifest_id uuid;
  v_people_count integer;
  v_total integer;
begin
  for v_legacy in
    select o.*
    from public.shelter_occupants o
    where o.entry_source = 'rescuer'
      and o.status = 'in_shelter'
      and o.delivery_person_id is null
      and coalesce(o.adult_count, 0) + coalesce(o.child_count, 0) + coalesce(o.elder_count, 0) > 1
  loop
    select m.id
    into v_manifest_id
    from public.rescue_delivery_manifests m
    where m.sos_report_id = v_legacy.sos_report_id
      and m.shelter_id = v_legacy.shelter_id;
    if v_manifest_id is null then
      continue;
    end if;

    select count(*)::integer
    into v_people_count
    from public.rescue_delivery_people p
    where p.manifest_id = v_manifest_id
      and p.is_primary_destination = true
      and p.destination_type = 'shelter';
    v_total := coalesce(v_legacy.adult_count, 0) + coalesce(v_legacy.child_count, 0) + coalesce(v_legacy.elder_count, 0);
    if v_people_count <> v_total
      or exists (
        select 1 from public.shelter_occupants o
        where o.shelter_id = v_legacy.shelter_id
          and o.sos_report_id = v_legacy.sos_report_id
          and o.delivery_person_id is not null
      ) then
      continue;
    end if;

    delete from public.shelter_occupants where id = v_legacy.id;

    insert into public.shelter_occupants (
      shelter_id, sos_report_id, assignment_id, delivery_person_id, full_name, phone,
      adult_count, child_count, elder_count, entry_source, registered_by, status, entry_date
    )
    select
      v_legacy.shelter_id,
      v_legacy.sos_report_id,
      v_legacy.assignment_id,
      p.id,
      p.full_name,
      v_legacy.phone,
      case when p.age_group = 'adult' then 1 else 0 end,
      case when p.age_group = 'child' then 1 else 0 end,
      case when p.age_group = 'elder' then 1 else 0 end,
      'rescuer',
      v_legacy.registered_by,
      'in_shelter',
      v_legacy.entry_date
    from public.rescue_delivery_people p
    where p.manifest_id = v_manifest_id
      and p.is_primary_destination = true
      and p.destination_type = 'shelter'
    order by p.sequence_no;
  end loop;
end;
$$;

revoke all on function public.rename_shelter_delivery_person(uuid, uuid, text) from public, anon;
grant execute on function public.rename_shelter_delivery_person(uuid, uuid, text) to authenticated;
revoke all on function public.confirm_shelter_request_exit(uuid, uuid, text, timestamp with time zone, text) from public, anon;
grant execute on function public.confirm_shelter_request_exit(uuid, uuid, text, timestamp with time zone, text) to authenticated;

notify pgrst, 'reload schema';

commit;
