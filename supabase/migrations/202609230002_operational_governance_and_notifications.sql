begin;

-- A death reported from the field closes the rescue case, but it still needs a
-- supervisor confirmation trail.  This record deliberately stores metadata and
-- evidence references only; evidence files remain in controlled Storage.
create table if not exists public.death_case_confirmations (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid not null unique references public.sos_reports(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  reported_by uuid references public.profiles(id) on delete set null,
  reported_at timestamptz not null default now(),
  reported_note text,
  evidence_urls text[] not null default '{}',
  status text not null default 'pending_review'
    check (status in ('pending_review', 'confirmed', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists death_case_confirmations_status_created_idx
  on public.death_case_confirmations (status, created_at desc);

-- A privacy-conscious timeline: it records operational transitions, never a
-- full SOS payload, phone number, national ID, or uploaded evidence.
create table if not exists public.operation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb
);

create index if not exists operation_audit_logs_entity_created_idx
  on public.operation_audit_logs (entity_type, entity_id, created_at desc);
create index if not exists operation_audit_logs_actor_created_idx
  on public.operation_audit_logs (actor_id, created_at desc);

create or replace function public.write_operation_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if tg_table_name = 'assignments' then
    v_before := case when tg_op = 'INSERT' then null else jsonb_build_object(
      'status', old.status, 'cannot_reach_reason', old.cannot_reach_reason,
      'completed_at', old.completed_at
    ) end;
    v_after := jsonb_build_object(
      'status', new.status, 'cannot_reach_reason', new.cannot_reach_reason,
      'completed_at', new.completed_at
    );
    if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
    v_action := case when tg_op = 'INSERT' then 'assignment_created' else 'assignment_updated' end;
  elsif tg_table_name = 'sos_reports' then
    v_before := case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status) end;
    v_after := jsonb_build_object('status', new.status);
    if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
    v_action := case when tg_op = 'INSERT' then 'sos_created' else 'sos_status_updated' end;
  elsif tg_table_name = 'victim_status' then
    v_before := case when tg_op = 'INSERT' then null else jsonb_build_object('status', old.status, 'shelter_name', old.shelter_name) end;
    v_after := jsonb_build_object('status', new.status, 'shelter_name', new.shelter_name);
    if tg_op = 'UPDATE' and v_before = v_after then return new; end if;
    v_action := case when tg_op = 'INSERT' then 'victim_status_created' else 'victim_status_updated' end;
  else
    return coalesce(new, old);
  end if;

  insert into public.operation_audit_logs (actor_id, entity_type, entity_id, action, before_data, after_data)
  values (auth.uid(), tg_table_name, new.id, v_action, v_before, v_after);
  return new;
end;
$$;

drop trigger if exists operation_audit_assignments on public.assignments;
create trigger operation_audit_assignments
after insert or update of status, cannot_reach_reason, completed_at on public.assignments
for each row execute function public.write_operation_audit();

drop trigger if exists operation_audit_sos_reports on public.sos_reports;
create trigger operation_audit_sos_reports
after insert or update of status on public.sos_reports
for each row execute function public.write_operation_audit();

drop trigger if exists operation_audit_victim_status on public.victim_status;
create trigger operation_audit_victim_status
after insert or update of status, shelter_name on public.victim_status
for each row execute function public.write_operation_audit();

create or replace function public.create_death_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cannot_reach' and new.cannot_reach_reason = 'deceased'
     and (tg_op = 'INSERT' or old.cannot_reach_reason is distinct from 'deceased') then
    insert into public.death_case_confirmations (
      sos_report_id, assignment_id, reported_by, reported_note
    ) values (
      new.sos_report_id, new.id, auth.uid(), new.notes
    ) on conflict (sos_report_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists create_death_confirmation_after_outcome on public.assignments;
create trigger create_death_confirmation_after_outcome
after insert or update of status, cannot_reach_reason on public.assignments
for each row execute function public.create_death_confirmation();

-- Browser Push subscriptions are device-specific; the same account can opt in
-- on more than one device without exposing subscription keys to other users.
create table if not exists public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_subscriptions_profile_idx
  on public.notification_subscriptions (profile_id);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  target_url text not null default '/officer/dashboard',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where sent_at is null;

create or replace function public.enqueue_admin_notification(
  p_event_type text,
  p_title text,
  p_body text,
  p_target_url text default '/officer/admin'
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notification_outbox (recipient_id, event_type, title, body, target_url)
  select id, p_event_type, p_title, p_body, p_target_url
  from public.profiles
  where is_active = true and role in ('admin', 'gov');
$$;

create or replace function public.enqueue_sos_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_admin_notification(
    'sos_created', 'มีคำขอความช่วยเหลือใหม่',
    'มีคำขอ SOS ใหม่ใน ' || new.province || ' กรุณาตรวจสอบและมอบหมายภารกิจ',
    '/officer/admin'
  );
  return new;
end;
$$;

create or replace function public.enqueue_death_review_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_admin_notification(
    'death_review_required', 'รอยืนยันกรณีเสียชีวิต',
    'มีรายงานเสียชีวิตจากหน้างาน รอผู้ดูแลตรวจสอบและยืนยัน',
    '/officer/admin'
  );
  return new;
end;
$$;

create or replace function public.enqueue_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notification_outbox (recipient_id, event_type, title, body, target_url)
  values (
    new.rescuer_id,
    'assignment_created',
    'ได้รับมอบหมายภารกิจช่วยเหลือ',
    'มีภารกิจใหม่ที่ต้องตรวจสอบและรับงาน',
    '/officer/dashboard'
  );
  return new;
end;
$$;

drop trigger if exists enqueue_sos_created_notification_after_insert on public.sos_reports;
create trigger enqueue_sos_created_notification_after_insert
after insert on public.sos_reports
for each row execute function public.enqueue_sos_created_notification();

drop trigger if exists enqueue_death_review_notification_after_insert on public.death_case_confirmations;
create trigger enqueue_death_review_notification_after_insert
after insert on public.death_case_confirmations
for each row execute function public.enqueue_death_review_notification();

drop trigger if exists enqueue_assignment_notification_after_insert on public.assignments;
create trigger enqueue_assignment_notification_after_insert
after insert on public.assignments
for each row execute function public.enqueue_assignment_notification();

create or replace function public.review_death_case_confirmation(
  p_confirmation_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.death_case_confirmations%rowtype;
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'เฉพาะผู้ดูแลระบบที่เปิดใช้งานเท่านั้นที่ยืนยันกรณีเสียชีวิตได้';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception using errcode = '22023', message = 'ผลการยืนยันไม่ถูกต้อง';
  end if;
  if p_decision = 'rejected' and v_note is null then
    raise exception using errcode = '22023', message = 'กรุณาระบุเหตุผลเมื่อไม่ยืนยันรายงาน';
  end if;

  select * into v_case from public.death_case_confirmations
  where id = p_confirmation_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการยืนยันกรณีเสียชีวิต';
  end if;
  if v_case.status <> 'pending_review' then
    raise exception using errcode = '23514', message = 'รายการนี้ได้รับการพิจารณาแล้ว';
  end if;

  update public.death_case_confirmations
  set status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = v_note, updated_at = now()
  where id = p_confirmation_id;

  -- Rejecting a report reopens the SOS as a retriable access case. The original
  -- assignment stays immutable as an audit record; a coordinator can assign a
  -- new team from the normal queue.
  if p_decision = 'rejected' then
    update public.sos_reports set status = 'cannot_reach', updated_at = now()
    where id = v_case.sos_report_id;
    insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
    values (v_case.sos_report_id, 'unknown', null, v_note, now())
    on conflict (sos_report_id) do update
      set status = excluded.status, shelter_name = null, notes = excluded.notes, updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object('confirmation_id', p_confirmation_id, 'status', p_decision);
end;
$$;

alter table public.death_case_confirmations enable row level security;
alter table public.operation_audit_logs enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_outbox enable row level security;

drop policy if exists "admins read death confirmations" on public.death_case_confirmations;
create policy "admins read death confirmations" on public.death_case_confirmations for select to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
);
drop policy if exists "admins read operational audit" on public.operation_audit_logs;
create policy "admins read operational audit" on public.operation_audit_logs for select to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
);
drop policy if exists "users manage own push subscriptions" on public.notification_subscriptions;
create policy "users manage own push subscriptions" on public.notification_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
drop policy if exists "admins read notification outbox" on public.notification_outbox;
create policy "admins read notification outbox" on public.notification_outbox for select to authenticated using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active)
);

revoke all on function public.review_death_case_confirmation(uuid, text, text) from public, anon;
grant execute on function public.review_death_case_confirmation(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
