-- การลงทะเบียนผู้เดินทางมาเองต้องล็อกศูนย์และบันทึกแบบ atomic
-- request_key ทำให้การกดซ้ำ/ตอบกลับเครือข่ายหายไม่สร้างผู้พักพิงซ้ำ

begin;

create table if not exists public.shelter_self_registration_requests (
  request_key uuid primary key,
  shelter_id uuid not null references public.shelters(id) on delete cascade,
  occupant_id uuid references public.shelter_occupants(id) on delete set null,
  registered_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists shelter_self_registration_requests_shelter_idx
  on public.shelter_self_registration_requests (shelter_id, created_at desc);

alter table public.shelter_self_registration_requests enable row level security;

create or replace function public.register_shelter_occupant(
  p_shelter_id uuid,
  p_full_name text,
  p_phone text,
  p_adult_count integer,
  p_child_count integer,
  p_elder_count integer,
  p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_full_name text := nullif(btrim(p_full_name), '');
  v_phone text := nullif(btrim(p_phone), '');
  v_role text;
  v_profile_shelter_id uuid;
  v_request_shelter_id uuid;
  v_request_registered_by uuid;
  v_occupant_id uuid;
  v_capacity integer;
  v_current_people integer;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนลงทะเบียนผู้พักพิง';
  end if;
  if p_shelter_id is null or p_request_key is null then
    raise exception using errcode = '22023', message = 'ไม่พบศูนย์พักพิงหรือรหัสคำขอลงทะเบียน';
  end if;
  if v_full_name is null or char_length(v_full_name) > 120 then
    raise exception using errcode = '22023', message = 'กรุณาระบุชื่อ–นามสกุลความยาวไม่เกิน 120 ตัวอักษร';
  end if;
  if v_phone is not null and v_phone !~ '^0[0-9]{8,9}$' then
    raise exception using errcode = '22023', message = 'กรุณาระบุเบอร์โทรศัพท์ 9–10 หลัก โดยขึ้นต้นด้วย 0';
  end if;
  if coalesce(p_adult_count, -1) < 0 or coalesce(p_adult_count, 0) > 99
    or coalesce(p_child_count, -1) < 0 or coalesce(p_child_count, 0) > 99
    or coalesce(p_elder_count, -1) < 0 or coalesce(p_elder_count, 0) > 99 then
    raise exception using errcode = '22023', message = 'จำนวนสมาชิกแต่ละกลุ่มต้องอยู่ระหว่าง 0 ถึง 99 คน';
  end if;
  v_total := coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) + coalesce(p_elder_count, 0);
  if v_total < 1 then
    raise exception using errcode = '22023', message = 'จำนวนผู้เข้าพักต้องมีอย่างน้อย 1 คน';
  end if;

  select role, shelter_id into v_role, v_profile_shelter_id
  from public.profiles
  where id = auth.uid() and is_active = true;
  if v_role is null or not (v_role = 'admin' or (v_role = 'shelter_staff' and v_profile_shelter_id = p_shelter_id)) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์ลงทะเบียนผู้พักพิงของศูนย์นี้';
  end if;

  -- INSERT นี้รอ transaction อื่นที่ใช้ request_key เดียวกันให้เสร็จก่อน
  insert into public.shelter_self_registration_requests (request_key, shelter_id, registered_by)
  values (p_request_key, p_shelter_id, auth.uid())
  on conflict (request_key) do nothing;

  select shelter_id, registered_by, occupant_id
  into v_request_shelter_id, v_request_registered_by, v_occupant_id
  from public.shelter_self_registration_requests
  where request_key = p_request_key
  for update;
  if v_request_shelter_id is distinct from p_shelter_id or v_request_registered_by is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'รหัสคำขอลงทะเบียนนี้ไม่ใช่ของผู้ใช้งานหรือศูนย์นี้';
  end if;
  if v_occupant_id is not null then
    return jsonb_build_object('occupant_id', v_occupant_id, 'people_count', v_total, 'idempotent', true);
  end if;

  select capacity
  into v_capacity
  from public.shelters
  where id = p_shelter_id and is_active = true
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบศูนย์พักพิงที่เปิดใช้งาน';
  end if;
  if coalesce(v_capacity, 0) < 1 then
    raise exception using errcode = '22023', message = 'ศูนย์พักพิงยังไม่กำหนดจำนวนที่รับได้สูงสุด';
  end if;

  select coalesce(sum(
    coalesce(o.adult_count, 0) + coalesce(o.child_count, 0) + coalesce(o.elder_count, 0)
  ), 0)::integer
  into v_current_people
  from public.shelter_occupants o
  where o.shelter_id = p_shelter_id and o.status = 'in_shelter';
  if v_current_people + v_total > v_capacity then
    raise exception using errcode = '22023', message = format(
      'ศูนย์เหลือที่ว่าง %s คน แต่กำลังลงทะเบียน %s คน',
      greatest(v_capacity - v_current_people, 0), v_total
    );
  end if;

  insert into public.shelter_occupants (
    shelter_id, full_name, phone, adult_count, child_count, elder_count,
    entry_source, status, entry_date, registered_by
  ) values (
    p_shelter_id, v_full_name, v_phone, p_adult_count, p_child_count, p_elder_count,
    'self_registered', 'in_shelter', now(), auth.uid()
  ) returning id into v_occupant_id;

  update public.shelter_self_registration_requests
  set occupant_id = v_occupant_id
  where request_key = p_request_key;

  update public.shelters
  set current_occupancy = v_current_people + v_total
  where id = p_shelter_id;

  return jsonb_build_object('occupant_id', v_occupant_id, 'people_count', v_total, 'idempotent', false);
end;
$$;

revoke all on function public.register_shelter_occupant(uuid, text, text, integer, integer, integer, uuid) from public, anon;
grant execute on function public.register_shelter_occupant(uuid, text, text, integer, integer, integer, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
