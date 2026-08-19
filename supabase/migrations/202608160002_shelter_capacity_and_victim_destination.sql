-- ให้เจ้าหน้าที่ศูนย์แก้ความจุของศูนย์ตนเอง และบันทึกปลายทางผู้ประสบภัย
-- ไม่ลบหรือแก้ประวัติเดิม

begin;

create or replace function public.update_shelter_capacity(
  p_shelter_id uuid,
  p_capacity integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_people integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  if p_capacity is null or p_capacity < 1 then
    raise exception using errcode = '22023', message = 'ความจุต้องมีอย่างน้อย 1 คน';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role = 'admin'
        or (p.role = 'shelter_staff' and p.shelter_id = p_shelter_id)
      )
  ) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์แก้ไขความจุของศูนย์นี้';
  end if;

  perform 1 from public.shelters where id = p_shelter_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบศูนย์พักพิง';
  end if;

  select coalesce(sum(
    coalesce(o.adult_count, 0)
    + coalesce(o.child_count, 0)
    + coalesce(o.elder_count, 0)
  ), 0)::integer
  into v_current_people
  from public.shelter_occupants o
  where o.shelter_id = p_shelter_id
    and o.status = 'in_shelter';

  if p_capacity < v_current_people then
    raise exception using errcode = '22023',
      message = format('ความจุต้องไม่น้อยกว่าผู้ที่อยู่ในศูนย์ปัจจุบัน %s คน', v_current_people);
  end if;

  update public.shelters
  set capacity = p_capacity,
      current_occupancy = v_current_people
  where id = p_shelter_id;
end;
$$;

revoke all on function public.update_shelter_capacity(uuid, integer) from public, anon;
grant execute on function public.update_shelter_capacity(uuid, integer) to authenticated;

create or replace function public.sync_victim_destination(
  p_sos_report_id uuid,
  p_status text,
  p_shelter_name text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบ';
  end if;

  if p_status not in ('rescued', 'at_shelter') then
    raise exception using errcode = '22023', message = 'สถานะปลายทางไม่ถูกต้อง';
  end if;

  if not exists (
    select 1
    from public.assignments a
    where a.sos_report_id = p_sos_report_id
      and a.rescuer_id = auth.uid()
  ) and not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์อัปเดตปลายทางของเคสนี้';
  end if;

  update public.victim_status
  set status = p_status,
      shelter_name = nullif(btrim(p_shelter_name), ''),
      notes = nullif(btrim(p_notes), ''),
      updated_at = now()
  where sos_report_id = p_sos_report_id;

  if not found then
    insert into public.victim_status (
      sos_report_id,
      status,
      shelter_name,
      notes,
      updated_at
    ) values (
      p_sos_report_id,
      p_status,
      nullif(btrim(p_shelter_name), ''),
      nullif(btrim(p_notes), ''),
      now()
    );
  end if;
end;
$$;

revoke all on function public.sync_victim_destination(uuid, text, text, text) from public, anon;
grant execute on function public.sync_victim_destination(uuid, text, text, text) to authenticated;

-- ให้ PostgREST เห็น RPC ใหม่ทันทีหลัง migration จบ
notify pgrst, 'reload schema';

commit;
