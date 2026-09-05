-- ให้ศูนย์พักพิงจัดการผู้ที่กู้ภัยนำส่งเป็น "คำร้อง" ได้ โดยยังคง
-- ผู้พักพิงหนึ่งแถวต่อหนึ่งคน เพื่อให้การออกจากศูนย์รายคนและยอดความจุถูกต้อง

begin;

alter table public.shelter_occupants
  add column if not exists delivery_person_id uuid
  references public.rescue_delivery_people(id) on delete set null;

create unique index if not exists shelter_occupants_delivery_person_unique
  on public.shelter_occupants (delivery_person_id)
  where delivery_person_id is not null;

create index if not exists shelter_occupants_sos_report_idx
  on public.shelter_occupants (shelter_id, sos_report_id, status);

-- เชื่อมข้อมูลเดิมที่ชื่อและกลุ่มอายุตรงกันก่อน ส่วนรายการใหม่จะถูกเชื่อมผ่าน trigger ด้านล่าง
with candidate_people as (
  select
    p.id as delivery_person_id,
    m.sos_report_id,
    m.shelter_id,
    p.full_name,
    p.age_group,
    row_number() over (
      partition by m.sos_report_id, m.shelter_id, p.full_name, p.age_group
      order by p.sequence_no
    ) as occurrence
  from public.rescue_delivery_people p
  join public.rescue_delivery_manifests m on m.id = p.manifest_id
  where p.is_primary_destination = true
    and p.destination_type = 'shelter'
), candidate_occupants as (
  select
    o.id,
    o.sos_report_id,
    o.shelter_id,
    o.full_name,
    case
      when coalesce(o.child_count, 0) = 1 then 'child'
      when coalesce(o.elder_count, 0) = 1 then 'elder'
      else 'adult'
    end as age_group,
    row_number() over (
      partition by
        o.sos_report_id,
        o.shelter_id,
        o.full_name,
        case
          when coalesce(o.child_count, 0) = 1 then 'child'
          when coalesce(o.elder_count, 0) = 1 then 'elder'
          else 'adult'
        end
      order by o.entry_date, o.id
    ) as occurrence
  from public.shelter_occupants o
  where o.entry_source = 'rescuer'
    and o.sos_report_id is not null
    and o.delivery_person_id is null
    and coalesce(o.adult_count, 0) + coalesce(o.child_count, 0) + coalesce(o.elder_count, 0) = 1
)
update public.shelter_occupants o
set delivery_person_id = p.delivery_person_id
from candidate_occupants co
join candidate_people p
  on p.sos_report_id = co.sos_report_id
 and p.shelter_id = co.shelter_id
 and p.full_name = co.full_name
 and p.age_group = co.age_group
 and p.occurrence = co.occurrence
where o.id = co.id;

create or replace function public.link_shelter_occupant_to_delivery_person()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.delivery_person_id is not null
     or new.entry_source <> 'rescuer'
     or new.sos_report_id is null
     or coalesce(new.adult_count, 0) + coalesce(new.child_count, 0) + coalesce(new.elder_count, 0) <> 1 then
    return new;
  end if;

  select p.id
  into new.delivery_person_id
  from public.rescue_delivery_people p
  join public.rescue_delivery_manifests m on m.id = p.manifest_id
  where m.sos_report_id = new.sos_report_id
    and m.shelter_id = new.shelter_id
    and p.is_primary_destination = true
    and p.destination_type = 'shelter'
    and p.full_name = new.full_name
    and p.age_group = case
      when coalesce(new.child_count, 0) = 1 then 'child'
      when coalesce(new.elder_count, 0) = 1 then 'elder'
      else 'adult'
    end
    and not exists (
      select 1
      from public.shelter_occupants o
      where o.delivery_person_id = p.id
    )
  order by p.sequence_no
  limit 1;

  return new;
end;
$$;

drop trigger if exists link_shelter_occupant_to_delivery_person_trigger
  on public.shelter_occupants;
create trigger link_shelter_occupant_to_delivery_person_trigger
before insert on public.shelter_occupants
for each row execute function public.link_shelter_occupant_to_delivery_person();

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
  v_shelter_id uuid;
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

  update public.rescue_delivery_people
  set full_name = v_full_name,
      identity_status = 'reported_name'
  where id = p_delivery_person_id;

  update public.shelter_occupants
  set full_name = v_full_name
  where id = p_occupant_id;

  return jsonb_build_object('occupant_id', p_occupant_id, 'delivery_person_id', p_delivery_person_id, 'full_name', v_full_name);
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

  return jsonb_build_object('sos_report_id', p_sos_report_id, 'shelter_id', p_shelter_id, 'exited_count', v_exited_count);
end;
$$;

revoke all on function public.rename_shelter_delivery_person(uuid, uuid, text) from public, anon;
grant execute on function public.rename_shelter_delivery_person(uuid, uuid, text) to authenticated;
revoke all on function public.confirm_shelter_request_exit(uuid, uuid, text, timestamp with time zone, text) from public, anon;
grant execute on function public.confirm_shelter_request_exit(uuid, uuid, text, timestamp with time zone, text) to authenticated;

comment on column public.shelter_occupants.delivery_person_id is
  'เชื่อมผู้พักพิงรายบุคคลกับรายชื่อที่กู้ภัยนำส่ง เพื่อให้ศูนย์แก้ชื่อและจัดการเป็นคำร้องได้';

notify pgrst, 'reload schema';

commit;
