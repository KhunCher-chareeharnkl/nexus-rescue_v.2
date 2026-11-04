-- Ensure every new Auth user receives the profile prepared by redeem_access_code.

begin;

create or replace function public.redeem_access_code(
  p_email text,
  p_code text,
  p_role text,
  p_shelter_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_user auth.users%rowtype;
begin
  if p_role not in ('rescuer', 'shelter_staff') then
    raise exception 'role ไม่ถูกต้อง';
  end if;

  if p_role = 'shelter_staff' and p_shelter_id is null then
    raise exception 'กรุณาเลือกศูนย์พักพิง';
  end if;

  if not exists (
    select 1
    from public.access_codes
    where role = p_role and code = p_code and active = true
  ) then
    raise exception 'รหัสอ้างอิงไม่ถูกต้อง หรือถูกยกเลิกแล้ว';
  end if;

  select *
  into existing_user
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if existing_user.id is not null then
    insert into public.profiles (id, full_name, role, shelter_id)
    values (
      existing_user.id,
      coalesce(existing_user.raw_user_meta_data->>'full_name', 'เจ้าหน้าที่'),
      p_role,
      p_shelter_id
    )
    on conflict (id) do update
      set role = excluded.role,
          shelter_id = excluded.shelter_id,
          is_active = true;
  else
    insert into public.staff_invites (email, role, shelter_id, used)
    values (lower(p_email), p_role, p_shelter_id, false)
    on conflict (email) do update
      set role = excluded.role,
          shelter_id = excluded.shelter_id,
          used = false;
  end if;

  return true;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

commit;
