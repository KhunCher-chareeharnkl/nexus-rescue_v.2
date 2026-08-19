begin;

-- เก็บว่าใครเป็นผู้ยืนยันการออก เพื่อให้ตรวจสอบย้อนหลังได้
alter table public.shelter_occupants
  add column if not exists exit_recorded_by uuid
    references public.profiles(id) on delete set null;

comment on column public.shelter_occupants.exit_recorded_by is
  'เจ้าหน้าที่ที่ยืนยันการออกจากศูนย์ผ่าน confirm_shelter_exit';

create or replace function public.confirm_shelter_exit(
  p_occupant_id uuid,
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
  v_occupant public.shelter_occupants%rowtype;
  v_shelter_name text;
  v_profile_role text;
  v_profile_shelter_id uuid;
  v_shelter_occupancy integer := 0;
  v_case_remaining integer := 0;
  v_destination_label text;
  v_next_status text;
  v_next_shelter_name text;
  v_status_note text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันการออกจากศูนย์';
  end if;

  if p_occupant_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบรหัสผู้พักพิง';
  end if;

  if p_exit_destination is null
     or p_exit_destination not in ('home', 'relative_home', 'other_shelter', 'other') then
    raise exception using errcode = '22023', message = 'ปลายทางหลังออกจากศูนย์ไม่ถูกต้อง';
  end if;

  if p_exit_at is null then
    raise exception using errcode = '22023', message = 'กรุณาระบุวันและเวลาออกจากศูนย์';
  end if;

  if p_exit_at > now() + interval '1 minute' then
    raise exception using errcode = '22023', message = 'เวลาออกต้องไม่เกินเวลาปัจจุบัน';
  end if;

  select *
  into v_occupant
  from public.shelter_occupants
  where id = p_occupant_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบข้อมูลผู้พักพิง';
  end if;

  if v_occupant.status <> 'in_shelter' then
    raise exception using errcode = '23514', message = 'รายการนี้ถูกยืนยันออกจากศูนย์ไปแล้ว';
  end if;

  if p_exit_at < v_occupant.entry_date then
    raise exception using errcode = '22023', message = 'เวลาออกต้องไม่ก่อนเวลาเข้าศูนย์';
  end if;

  select p.role, p.shelter_id
  into v_profile_role, v_profile_shelter_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;

  if v_profile_role is null
     or not (
       v_profile_role = 'admin'
       or (v_profile_role = 'shelter_staff' and v_profile_shelter_id = v_occupant.shelter_id)
     ) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์ยืนยันการออกของผู้พักพิงรายนี้';
  end if;

  -- ล็อกแถวศูนย์เพื่อให้การคำนวณยอดพร้อมกันหลายรายการไม่ทับกัน
  select s.name
  into v_shelter_name
  from public.shelters s
  where s.id = v_occupant.shelter_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบข้อมูลศูนย์พักพิง';
  end if;

  update public.shelter_occupants
  set status = 'exited',
      exit_date = p_exit_at,
      exit_destination = p_exit_destination,
      exit_note = nullif(btrim(p_exit_note), ''),
      exit_recorded_by = auth.uid()
  where id = v_occupant.id;

  select coalesce(sum(
    coalesce(o.adult_count, 0)
    + coalesce(o.child_count, 0)
    + coalesce(o.elder_count, 0)
  ), 0)::integer
  into v_shelter_occupancy
  from public.shelter_occupants o
  where o.shelter_id = v_occupant.shelter_id
    and o.status = 'in_shelter';

  update public.shelters
  set current_occupancy = v_shelter_occupancy
  where id = v_occupant.shelter_id;

  case p_exit_destination
    when 'home' then v_destination_label := 'กลับบ้าน';
    when 'relative_home' then v_destination_label := 'ไปบ้านญาติ';
    when 'other_shelter' then v_destination_label := 'ย้ายไปศูนย์พักพิงแห่งอื่น';
    else v_destination_label := 'ไปปลายทางอื่น';
  end case;

  if v_occupant.sos_report_id is not null then
    select coalesce(sum(
      coalesce(o.adult_count, 0)
      + coalesce(o.child_count, 0)
      + coalesce(o.elder_count, 0)
    ), 0)::integer
    into v_case_remaining
    from public.shelter_occupants o
    where o.sos_report_id = v_occupant.sos_report_id
      and o.status = 'in_shelter';

    if v_case_remaining > 0 then
      v_next_status := 'at_shelter';
      v_next_shelter_name := v_shelter_name;
      v_status_note := concat_ws(
        ' · ',
        format('%s ออกจากศูนย์และ%s', v_occupant.full_name, v_destination_label),
        format('ยังมีสมาชิกอยู่ในศูนย์ %s คน', v_case_remaining),
        nullif(btrim(p_exit_note), '')
      );
    elsif p_exit_destination = 'home' then
      v_next_status := 'returned_home';
      v_next_shelter_name := null;
      v_status_note := concat_ws(
        ' · ',
        format('ออกจาก %s และกลับบ้านแล้ว', v_shelter_name),
        nullif(btrim(p_exit_note), '')
      );
    elsif p_exit_destination = 'other_shelter' then
      v_next_status := 'at_shelter';
      v_next_shelter_name := 'ศูนย์พักพิงแห่งอื่น';
      v_status_note := concat_ws(
        ' · ',
        format('ย้ายออกจาก %s ไปศูนย์พักพิงแห่งอื่น', v_shelter_name),
        nullif(btrim(p_exit_note), '')
      );
    else
      v_next_status := 'rescued';
      v_next_shelter_name := null;
      v_status_note := concat_ws(
        ' · ',
        format('ออกจาก %s และ%s', v_shelter_name, v_destination_label),
        nullif(btrim(p_exit_note), '')
      );
    end if;

    update public.victim_status
    set status = v_next_status,
        shelter_name = v_next_shelter_name,
        notes = v_status_note,
        updated_at = now()
    where sos_report_id = v_occupant.sos_report_id;

    if not found then
      insert into public.victim_status (
        sos_report_id,
        status,
        shelter_name,
        notes,
        updated_at
      ) values (
        v_occupant.sos_report_id,
        v_next_status,
        v_next_shelter_name,
        v_status_note,
        now()
      );
    end if;
  end if;

  return jsonb_build_object(
    'occupant_id', v_occupant.id,
    'shelter_id', v_occupant.shelter_id,
    'sos_report_id', v_occupant.sos_report_id,
    'exit_destination', p_exit_destination,
    'shelter_occupancy', v_shelter_occupancy,
    'case_remaining', v_case_remaining,
    'victim_status', v_next_status
  );
end;
$$;

revoke all on function public.confirm_shelter_exit(uuid, text, timestamp with time zone, text)
  from public, anon;
grant execute on function public.confirm_shelter_exit(uuid, text, timestamp with time zone, text)
  to authenticated;

comment on function public.confirm_shelter_exit(uuid, text, timestamp with time zone, text) is
  'ยืนยันการออกจากศูนย์ ปรับยอดคน และอัปเดต victim_status ใน transaction เดียว';

notify pgrst, 'reload schema';

commit;
