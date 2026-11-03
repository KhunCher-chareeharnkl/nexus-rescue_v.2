-- Core table foundation required by the later feature migrations.
-- The legacy outcome RPC is created only when the target database lacks it.
begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regtype('public.assignment_status') is null then
    execute $type$
      create type public.assignment_status as enum (
        'accepted',
        'en_route',
        'on_scene',
        'completed',
        'cannot_reach'
      )
    $type$;
  end if;
end;
$$;

create table if not exists public.shelters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  province text,
  lat double precision,
  lng double precision,
  capacity integer default 0,
  current_occupancy integer default 0,
  contact_phone text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id),
  full_name text not null,
  phone text,
  role text default 'rescuer'
    check (role in ('rescuer', 'shelter_staff', 'admin', 'gov')),
  agency text,
  is_active boolean default true,
  current_lat double precision,
  current_lng double precision,
  created_at timestamptz default now(),
  shelter_id uuid references public.shelters(id)
);

create table if not exists public.sos_reports (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  province text not null,
  district text not null,
  sub_district text not null,
  address_details text,
  lat double precision,
  lng double precision,
  adult_count integer default 0,
  child_count integer default 0,
  elder_count integer default 0,
  urgency_level text default 'medium'
    check (urgency_level in ('low', 'medium', 'high', 'critical')),
  water_level integer default 1 check (water_level between 1 and 5),
  special_needs text,
  needed_items text[],
  status text default 'pending'
    check (status in ('pending', 'assigned', 'rescued', 'cannot_reach', 'closed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid not null references public.sos_reports(id),
  rescuer_id uuid not null references public.profiles(id),
  notes text,
  accepted_at timestamptz default now(),
  completed_at timestamptz,
  status public.assignment_status not null default 'accepted',
  cannot_reach_reason text check (cannot_reach_reason in ('no_access', 'deceased'))
);

create table if not exists public.victim_status (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid not null unique references public.sos_reports(id),
  status text default 'waiting'
    check (status in ('waiting', 'rescue_assigned', 'rescued', 'at_shelter', 'returned_home', 'unknown', 'deceased')),
  shelter_name text,
  notes text,
  updated_at timestamptz default now()
);

create table if not exists public.damage_reports (
  id uuid primary key default gen_random_uuid(),
  sos_report_id uuid references public.sos_reports(id),
  full_name text not null,
  phone text not null,
  province text not null,
  district text not null,
  sub_district text not null,
  address_details text,
  damage_type text
    check (damage_type in ('housing', 'vehicle', 'agriculture', 'property', 'other')),
  damage_value numeric,
  description text,
  image_urls text[] default '{}'::text[],
  home_status text
    check (home_status in ('returned', 'temporary_shelter', 'cannot_return')),
  status text default 'pending'
    check (status in ('pending', 'verified', 'approved', 'rejected')),
  created_at timestamptz default now(),
  incident_date date,
  id_card_number text,
  id_card_image_url text,
  victim_confirmed boolean default false,
  victim_confirmed_at timestamptz
);

create table if not exists public.shelter_occupants (
  id uuid primary key default gen_random_uuid(),
  shelter_id uuid not null references public.shelters(id),
  sos_report_id uuid references public.sos_reports(id),
  full_name text not null,
  phone text,
  adult_count integer default 1,
  child_count integer default 0,
  elder_count integer default 0,
  entry_source text not null check (entry_source in ('rescuer', 'self_registered')),
  registered_by uuid references public.profiles(id),
  status text default 'in_shelter' check (status in ('in_shelter', 'exited')),
  entry_date timestamptz default now(),
  exit_date timestamptz,
  exit_destination text check (exit_destination in ('home', 'relative_home', 'other_shelter', 'other')),
  exit_note text,
  created_at timestamptz default now()
);

create table if not exists public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('rescuer', 'shelter_staff', 'admin')),
  shelter_id uuid references public.shelters(id),
  invited_by uuid references public.profiles(id),
  used boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.staff_role_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id),
  requested_role text not null default 'shelter_staff'
    check (requested_role = 'shelter_staff'),
  requested_shelter_id uuid not null references public.shelters(id),
  agency text,
  note text,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.access_codes (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('rescuer', 'shelter_staff')),
  code text not null unique,
  active boolean default true,
  created_at timestamptz default now()
);

create index if not exists assignments_sos_report_id_idx
  on public.assignments (sos_report_id);
create index if not exists assignments_rescuer_id_idx
  on public.assignments (rescuer_id);
create index if not exists shelter_occupants_shelter_status_idx
  on public.shelter_occupants (shelter_id, status);
create index if not exists damage_reports_sos_report_id_idx
  on public.damage_reports (sos_report_id)
  where sos_report_id is not null;

do $$
begin
  if to_regprocedure(
    'public.confirm_rescue_outcome(uuid,text,text,uuid,text,integer,integer,integer,text,text)'
  ) is null then
    execute $function$
      create function public.confirm_rescue_outcome(
        p_sos_report_id uuid,
        p_mode text,
        p_destination_type text,
        p_destination_shelter_id uuid,
        p_destination_note text,
        p_confirmed_adult integer,
        p_confirmed_child integer,
        p_confirmed_elder integer,
        p_cannot_reach_reason text,
        p_notes text
      )
      returns void
      language plpgsql
      security definer
      set search_path = public, pg_temp
      as $body$
      declare
        v_assignment_id uuid;
        v_shelter_name text;
        v_new_people integer;
      begin
        if auth.uid() is null then
          raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
        end if;
        if p_mode is null or p_mode not in ('rescued', 'cannot_reach') then
          raise exception using errcode = '22023', message = 'สถานะผลการช่วยเหลือไม่ถูกต้อง';
        end if;
        if coalesce(p_confirmed_adult, -1) < 0
          or coalesce(p_confirmed_child, -1) < 0
          or coalesce(p_confirmed_elder, -1) < 0 then
          raise exception using errcode = '22023', message = 'จำนวนผู้ประสบภัยไม่ถูกต้อง';
        end if;

        select a.id
        into v_assignment_id
        from public.assignments a
        where a.sos_report_id = p_sos_report_id
          and a.rescuer_id = auth.uid()
        order by a.accepted_at desc nulls last
        limit 1
        for update;

        if v_assignment_id is null then
          raise exception using errcode = '42501', message = 'ไม่พบงานที่เจ้าหน้าที่คนนี้รับไว้';
        end if;

        if p_mode = 'rescued'
          and (
            p_destination_type is null
            or p_destination_type not in ('shelter', 'relative_home', 'hotel', 'other_safe')
          ) then
          raise exception using errcode = '22023', message = 'ปลายทางการช่วยเหลือไม่ถูกต้อง';
        end if;
        if p_mode = 'rescued' and p_destination_type = 'shelter' then
          if p_destination_shelter_id is null then
            raise exception using errcode = '22023', message = 'กรุณาเลือกศูนย์พักพิง';
          end if;
          select s.name into v_shelter_name
          from public.shelters s
          where s.id = p_destination_shelter_id and s.is_active = true
          for update;
          if not found then
            raise exception using errcode = 'P0002', message = 'ไม่พบศูนย์พักพิงที่เปิดให้บริการ';
          end if;
        end if;

        update public.assignments
        set status = case when p_mode = 'rescued' then 'completed' else 'cannot_reach' end,
            completed_at = now(),
            cannot_reach_reason = case when p_mode = 'cannot_reach' then p_cannot_reach_reason else null end,
            notes = coalesce(nullif(btrim(p_notes), ''), nullif(btrim(p_destination_note), ''))
        where id = v_assignment_id;

        update public.sos_reports
        set status = case when p_mode = 'rescued' then 'rescued' else 'cannot_reach' end,
            updated_at = now()
        where id = p_sos_report_id;
        if not found then
          raise exception using errcode = 'P0002', message = 'ไม่พบคำร้อง SOS';
        end if;

        insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
        values (
          p_sos_report_id,
          case
            when p_mode = 'cannot_reach' then 'unknown'
            when p_destination_type = 'shelter' then 'at_shelter'
            else 'rescued'
          end,
          case when p_mode = 'rescued' and p_destination_type = 'shelter' then v_shelter_name else null end,
          coalesce(nullif(btrim(p_notes), ''), nullif(btrim(p_destination_note), '')),
          now()
        )
        on conflict (sos_report_id) do update set
          status = excluded.status,
          shelter_name = excluded.shelter_name,
          notes = excluded.notes,
          updated_at = excluded.updated_at;

        if p_mode = 'rescued' and p_destination_type = 'shelter' then
          v_new_people := p_confirmed_adult + p_confirmed_child + p_confirmed_elder;
          insert into public.shelter_occupants (
            shelter_id,
            sos_report_id,
            full_name,
            phone,
            adult_count,
            child_count,
            elder_count,
            entry_source,
            registered_by,
            status
          )
          select
            p_destination_shelter_id,
            s.id,
            s.full_name,
            s.phone,
            p_confirmed_adult,
            p_confirmed_child,
            p_confirmed_elder,
            'rescuer',
            auth.uid(),
            'in_shelter'
          from public.sos_reports s
          where s.id = p_sos_report_id;

          update public.shelters
          set current_occupancy = coalesce(current_occupancy, 0) + v_new_people
          where id = p_destination_shelter_id;
        end if;

        if to_regclass('public.assignments') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public'
              and table_name = 'assignments'
              and column_name = 'destination_type'
          ) then
          execute $update$
            update public.assignments
            set destination_type = case when $1 = 'rescued' then $2 else null end,
                destination_shelter_id = case when $1 = 'rescued' and $2 = 'shelter' then $3 else null end,
                destination_note = case when $1 = 'rescued' then $4 else null end,
                confirmed_adult_count = case when $1 = 'rescued' then $5 else null end,
                confirmed_child_count = case when $1 = 'rescued' then $6 else null end,
                confirmed_elder_count = case when $1 = 'rescued' then $7 else null end
            where id = $8
          $update$
          using p_mode, p_destination_type, p_destination_shelter_id, p_destination_note,
            p_confirmed_adult, p_confirmed_child, p_confirmed_elder, v_assignment_id;
        end if;
      end;
      $body$
    $function$;
    execute $revoke$
      revoke all on function public.confirm_rescue_outcome(
        uuid, text, text, uuid, text, integer, integer, integer, text, text
      ) from public, anon
    $revoke$;
    execute $grant$
      grant execute on function public.confirm_rescue_outcome(
        uuid, text, text, uuid, text, integer, integer, integer, text, text
      ) to authenticated
    $grant$;
  end if;
end;
$$;

commit;
