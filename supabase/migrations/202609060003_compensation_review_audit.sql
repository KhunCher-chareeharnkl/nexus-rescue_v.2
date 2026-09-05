begin;

create table if not exists public.damage_report_status_audit (
  id uuid primary key default gen_random_uuid(),
  damage_report_id uuid not null references public.damage_reports(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  old_status text not null,
  new_status text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists damage_report_status_audit_report_created_idx
  on public.damage_report_status_audit (damage_report_id, created_at desc);

alter table public.damage_report_status_audit enable row level security;

drop policy if exists "admins can read compensation review audit" on public.damage_report_status_audit;
create policy "admins can read compensation review audit"
  on public.damage_report_status_audit
  for select to authenticated
  using (
    exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.role = 'admin'
        and profile.is_active = true
    )
  );

create or replace function public.admin_update_damage_report_status(
  p_report_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_current_status text;
  v_victim_confirmed boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนดำเนินการ';
  end if;

  select role into v_actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;
  if v_actor_role is distinct from 'admin' then
    raise exception using errcode = '42501', message = 'เฉพาะผู้ดูแลระบบที่เปิดใช้งานเท่านั้นที่เปลี่ยนสถานะคำร้องได้';
  end if;

  if p_status not in ('verified', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'สถานะที่ต้องการไม่ถูกต้อง';
  end if;

  select status, victim_confirmed into v_current_status, v_victim_confirmed
  from public.damage_reports
  where id = p_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบคำร้องเยียวยา';
  end if;

  if not v_victim_confirmed and p_status in ('verified', 'approved') then
    raise exception using errcode = '23514', message = 'ผู้ประสบภัยยังไม่ได้ยืนยันข้อมูล จึงยังดำเนินการขั้นนี้ไม่ได้';
  end if;

  if p_status = 'rejected' and v_reason is null then
    raise exception using errcode = '22023', message = 'กรุณาระบุเหตุผลที่ไม่อนุมัติ';
  end if;

  if not (
    (v_current_status = 'pending' and p_status in ('verified', 'rejected'))
    or (v_current_status = 'verified' and p_status in ('approved', 'rejected'))
  ) then
    raise exception using errcode = '23514', message = 'ไม่สามารถเปลี่ยนสถานะจากสถานะปัจจุบันได้';
  end if;

  update public.damage_reports
  set status = p_status
  where id = p_report_id;

  insert into public.damage_report_status_audit (
    damage_report_id, actor_id, old_status, new_status, reason
  ) values (
    p_report_id, auth.uid(), v_current_status, p_status, v_reason
  );

  return jsonb_build_object(
    'report_id', p_report_id,
    'old_status', v_current_status,
    'new_status', p_status,
    'changed_at', now()
  );
end;
$$;

revoke all on function public.admin_update_damage_report_status(uuid, text, text) from public, anon;
grant execute on function public.admin_update_damage_report_status(uuid, text, text) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['sos_reports', 'damage_reports'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
