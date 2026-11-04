


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."assignment_status" AS ENUM (
    'accepted',
    'en_route',
    'on_scene',
    'completed',
    'cannot_reach',
    'offered',
    'declined',
    'expired'
);


ALTER TYPE "public"."assignment_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_rescue_assignment"("p_sos_report_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_role text;
  v_report_status text;
  v_assignment_id uuid;
  v_assigned_rescuer_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนรับงาน';
  end if;
  if p_sos_report_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบรหัสคำร้อง SOS';
  end if;

  -- ล็อกโปรไฟล์เพื่อกันเจ้าหน้าที่คนเดียวรับสองงานพร้อมกันจากหลายอุปกรณ์
  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active = true
  for update;
  if v_role is distinct from 'rescuer' then
    raise exception using errcode = '42501', message = 'เฉพาะเจ้าหน้าที่กู้ภัยที่เปิดใช้งานเท่านั้นที่รับงานได้';
  end if;

  -- ล็อกคำร้อง: เจ้าหน้าที่คนอื่นต้องรอผลก่อน จึงไม่มีผู้รับซ้อนกัน
  select status into v_report_status
  from public.sos_reports
  where id = p_sos_report_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบคำร้อง SOS นี้';
  end if;

  if v_report_status = 'assigned' then
    select id, rescuer_id into v_assignment_id, v_assigned_rescuer_id
    from public.assignments
    where sos_report_id = p_sos_report_id
      and status in ('accepted', 'en_route', 'on_scene')
    order by accepted_at desc nulls last
    limit 1
    for update;
    if v_assigned_rescuer_id = auth.uid() then
      return jsonb_build_object('assignment_id', v_assignment_id, 'already_accepted', true);
    end if;
    raise exception using errcode = '23505', message = 'คำร้องนี้มีเจ้าหน้าที่รับงานแล้ว';
  end if;

  if v_report_status not in ('pending', 'cannot_reach') then
    raise exception using errcode = '23514', message = 'คำร้องนี้ไม่สามารถรับงานได้ในสถานะปัจจุบัน';
  end if;

  select id into v_assignment_id
  from public.assignments
  where rescuer_id = auth.uid()
    and status in ('accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if v_assignment_id is not null then
    raise exception using errcode = '23505', message = 'คุณมีภารกิจที่กำลังดำเนินการอยู่ กรุณาปิดงานเดิมก่อน';
  end if;

  insert into public.assignments (sos_report_id, rescuer_id, status, accepted_at)
  values (p_sos_report_id, auth.uid(), 'accepted', now())
  returning id into v_assignment_id;

  update public.sos_reports
  set status = 'assigned', updated_at = now()
  where id = p_sos_report_id;

  insert into public.victim_status (sos_report_id, status, updated_at)
  values (p_sos_report_id, 'rescue_assigned', now())
  on conflict (sos_report_id) do update
  set status = excluded.status,
      updated_at = excluded.updated_at;

  return jsonb_build_object('assignment_id', v_assignment_id, 'already_accepted', false);
end;
$$;


ALTER FUNCTION "public"."accept_rescue_assignment"("p_sos_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_handoff_rescue_case"("p_sos_report_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_assignment public.assignments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_dispatch jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may transfer a rescue case';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'A handoff reason is required';
  end if;

  select * into v_assignment
  from public.assignments
  where sos_report_id = p_sos_report_id and status in ('offered', 'accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'No open rescue assignment was found for this case';
  end if;

  -- Keep a truthful audit trail: the assignment was cancelled by the control
  -- centre, and the dispatch attempt records the handoff reason explicitly.
  update public.assignments
  set status = 'declined', completed_at = now(), notes = 'ADMIN HANDOFF: ' || v_reason
  where id = v_assignment.id;
  update public.rescue_dispatch_attempts
  set status = 'handed_off', responded_at = now(), reason = v_reason
  where assignment_id = v_assignment.id and status in ('offered', 'accepted');
  update public.rescuer_presence
  set availability = 'offline', updated_at = now()
  where rescuer_id = v_assignment.rescuer_id;

  delete from public.rescue_dispatch_searches where sos_report_id = p_sos_report_id;
  update public.sos_reports set status = 'pending', updated_at = now() where id = p_sos_report_id;
  insert into public.victim_status (sos_report_id, status, notes, updated_at)
  values (p_sos_report_id, 'unknown', 'ส่วนกลางส่งต่อเคส: ' || v_reason, now())
  on conflict (sos_report_id) do update set status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

  v_dispatch := public.dispatch_rescue_case(p_sos_report_id);
  return jsonb_build_object('handed_off', true, 'previous_rescuer_id', v_assignment.rescuer_id, 'dispatch', v_dispatch);
end;
$$;


ALTER FUNCTION "public"."admin_handoff_rescue_case"("p_sos_report_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_redrive_rescue_case"("p_sos_report_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may retry dispatch';
  end if;
  return public.dispatch_rescue_case(p_sos_report_id);
end;
$$;


ALTER FUNCTION "public"."admin_redrive_rescue_case"("p_sos_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_damage_report_status"("p_report_id" "uuid", "p_status" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."admin_update_damage_report_status"("p_report_id" "uuid", "p_status" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_rescue_assignment"("p_sos_report_id" "uuid", "p_next_status" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_assignment public.assignments%rowtype;
  v_sos_status text;
  v_victim_status text;
  v_victim_note text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'rescuer' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active rescuer may update a mission';
  end if;
  if p_next_status not in ('en_route', 'on_scene', 'completed') then
    raise exception using errcode = '22023', message = 'Invalid mission transition';
  end if;

  select * into v_assignment
  from public.assignments
  where sos_report_id = p_sos_report_id
    and rescuer_id = auth.uid()
    and status in ('accepted', 'en_route', 'on_scene')
  order by accepted_at desc nulls last
  limit 1
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'You do not own an active mission for this case';
  end if;

  if (v_assignment.status = 'accepted' and p_next_status not in ('en_route', 'completed'))
     or (v_assignment.status = 'en_route' and p_next_status not in ('on_scene', 'completed'))
     or (v_assignment.status = 'on_scene' and p_next_status <> 'completed') then
    raise exception using errcode = '23514', message = 'Mission state transition is not permitted';
  end if;

  v_sos_status := case when p_next_status = 'completed' then 'rescued' else 'assigned' end;
  v_victim_status := case when p_next_status = 'completed' then 'rescued' else 'rescue_assigned' end;
  v_victim_note := case p_next_status
    when 'en_route' then 'ทีมกู้ภัยเริ่มเดินทางไปยังจุดเกิดเหตุแล้ว'
    when 'on_scene' then 'ทีมกู้ภัยถึงจุดเกิดเหตุและกำลังดำเนินการช่วยเหลือ'
    else null
  end;

  update public.assignments
  set status = p_next_status::public.assignment_status,
      notes = coalesce(nullif(btrim(p_notes), ''), notes),
      completed_at = case when p_next_status = 'completed' then now() else completed_at end
  where id = v_assignment.id;
  update public.sos_reports set status = v_sos_status, updated_at = now() where id = p_sos_report_id;
  insert into public.victim_status (sos_report_id, status, notes, updated_at)
  values (p_sos_report_id, v_victim_status, coalesce(nullif(btrim(p_notes), ''), v_victim_note), now())
  on conflict (sos_report_id) do update set
    status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

  return jsonb_build_object('assignment_id', v_assignment.id, 'status', p_next_status);
end;
$$;


ALTER FUNCTION "public"."advance_rescue_assignment"("p_sos_report_id" "uuid", "p_next_status" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_dispatch_on_case_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.status in ('pending', 'cannot_reach')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.dispatch_rescue_case(new.id);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."auto_dispatch_on_case_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_rescue_outcome"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
      $_$;


ALTER FUNCTION "public"."confirm_rescue_outcome"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  v_deceased_total integer := 0;
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
        or coalesce(person->>'destination_type', '') not in (
          'shelter',
          'hospital',
          'deceased',
          'relative_home',
          'hotel',
          'other_safe'
        )
    ) then
      raise exception using errcode = '22023', message = 'ชื่อ กลุ่มอายุ หรือผลการนำส่งของบุคคลไม่ครบ';
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
      raise exception using errcode = '22023',
        message = 'กรุณาระบุชื่อปลายทาง สถานที่เสียชีวิต หรือหน่วยงานรับต่อให้ครบ';
    end if;

    select
      count(*)::integer,
      count(*) filter (
        where coalesce((person->>'is_primary_destination')::boolean, false)
      )::integer,
      count(*) filter (where person->>'destination_type' = 'hospital')::integer,
      count(*) filter (where person->>'destination_type' = 'deceased')::integer,
      count(*) filter (
        where coalesce((person->>'is_primary_destination')::boolean, false)
          and person->>'age_group' = 'adult'
      )::integer,
      count(*) filter (
        where coalesce((person->>'is_primary_destination')::boolean, false)
          and person->>'age_group' = 'child'
      )::integer,
      count(*) filter (
        where coalesce((person->>'is_primary_destination')::boolean, false)
          and person->>'age_group' = 'elder'
      )::integer
    into
      v_accounted_total,
      v_primary_total,
      v_hospital_total,
      v_deceased_total,
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
          message = 'ศูนย์พักพิงยังไม่กำหนดจำนวนที่รับได้สูงสุด';
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
      deceased_total,
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
      v_deceased_total,
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


ALTER FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_rescue_outcome_v3"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assignment_id uuid;
  v_requested_adult integer;
  v_requested_child integer;
  v_requested_elder integer;
  v_requested_total integer;
  v_contact_phone text;
  v_accounted_total integer;
  v_primary_total integer;
  v_hospital_total integer;
  v_deceased_total integer;
  v_manifest_id uuid;
begin
  if p_mode is distinct from 'rescued' then
    perform public.confirm_rescue_outcome_v2(
      p_sos_report_id,
      p_mode,
      p_destination_type,
      p_destination_shelter_id,
      p_destination_note,
      p_confirmed_adult,
      p_confirmed_child,
      p_confirmed_elder,
      p_cannot_reach_reason,
      p_notes,
      p_people,
      p_count_discrepancy_note
    );
    return;
  end if;

  if p_people is null or jsonb_typeof(p_people) <> 'array' or jsonb_array_length(p_people) = 0 then
    raise exception using errcode = '22023', message = 'กรุณาระบุจำนวนผู้ประสบภัยที่พบ';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where coalesce((person->>'is_primary_destination')::boolean, false)
    )::integer,
    count(*) filter (where person->>'destination_type' = 'hospital')::integer,
    count(*) filter (where person->>'destination_type' = 'deceased')::integer
  into v_accounted_total, v_primary_total, v_hospital_total, v_deceased_total
  from jsonb_array_elements(p_people) person;

  if v_primary_total > 0 then
    perform public.confirm_rescue_outcome_v2(
      p_sos_report_id,
      p_mode,
      p_destination_type,
      p_destination_shelter_id,
      p_destination_note,
      p_confirmed_adult,
      p_confirmed_child,
      p_confirmed_elder,
      p_cannot_reach_reason,
      p_notes,
      p_people,
      p_count_discrepancy_note
    );
    return;
  end if;

  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_people) person
    where nullif(btrim(person->>'full_name'), '') is null
      or coalesce(person->>'age_group', '') not in ('adult', 'child', 'elder')
      or coalesce(person->>'destination_type', '') not in ('hospital', 'deceased', 'other_safe')
      or nullif(btrim(person->>'destination_name'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'ข้อมูลกลุ่มอายุหรือปลายทางของผู้ประสบภัยไม่ครบ';
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
  if v_accounted_total <> v_requested_total
    and nullif(btrim(p_count_discrepancy_note), '') is null then
    raise exception using errcode = '22023', message = 'จำนวนผู้ประสบภัยไม่ตรงกับคำร้อง กรุณาระบุเหตุผล';
  end if;

  -- ฟังก์ชันเดิมต้องมีปลายทางหลัก จึงใช้ other_safe เป็นค่าทางเทคนิคสำหรับ assignment
  -- ส่วนปลายทางจริงที่ตรวจสอบย้อนหลังได้เก็บครบใน rescue_delivery_people
  perform public.confirm_rescue_outcome(
    p_sos_report_id => p_sos_report_id,
    p_mode => 'rescued',
    p_destination_type => 'other_safe',
    p_destination_shelter_id => null,
    p_destination_note => 'ผู้ประสบภัยทุกคนแยกไปปลายทางรายบุคคล โปรดดูบัญชีการนำส่ง',
    p_confirmed_adult => 0,
    p_confirmed_child => 0,
    p_confirmed_elder => 0,
    p_cannot_reach_reason => null,
    p_notes => p_notes
  );

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
    deceased_total,
    count_discrepancy_note
  ) values (
    p_sos_report_id,
    v_assignment_id,
    auth.uid(),
    'other_safe',
    null,
    v_requested_adult,
    v_requested_child,
    v_requested_elder,
    v_accounted_total,
    0,
    v_hospital_total,
    v_deceased_total,
    nullif(btrim(p_count_discrepancy_note), '')
  ) returning id into v_manifest_id;

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
    false,
    person.value->>'destination_type',
    btrim(person.value->>'destination_name'),
    nullif(btrim(person.value->>'notes'), '')
  from jsonb_array_elements(p_people) with ordinality person(value, ordinality);
end;
$$;


ALTER FUNCTION "public"."confirm_rescue_outcome_v3"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_rescue_outcome_v4"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text", "p_victim_status" "text", "p_victim_shelter_name" "text", "p_victim_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_active_assignment_id uuid;
  v_outcome_note text;
  v_sos_status text;
  v_victim_status text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนยืนยันผลการช่วยเหลือ';
  end if;

  select a.id into v_active_assignment_id
  from public.assignments a
  where a.sos_report_id = p_sos_report_id
    and a.rescuer_id = auth.uid()
    and a.status in ('accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last
  limit 1
  for update;

  if v_active_assignment_id is null then
    raise exception using errcode = '42501', message = 'คุณไม่ใช่ผู้รับผิดชอบภารกิจนี้ หรือภารกิจสิ้นสุดแล้ว';
  end if;

  if p_mode = 'cannot_reach' then
    if p_cannot_reach_reason not in ('no_access', 'deceased') then
      raise exception using errcode = '22023', message = 'กรุณาเลือกเข้าไม่ถึงหรือเสียชีวิต';
    end if;

    if p_cannot_reach_reason = 'no_access'
      and p_victim_status is distinct from 'unknown' then
      raise exception using errcode = '22023', message = 'กรณีเข้าไม่ถึงต้องบันทึกสถานะผู้ประสบภัยเป็นรอตรวจสอบ';
    end if;

    if p_cannot_reach_reason = 'deceased'
      and p_victim_status not in ('unknown', 'deceased') then
      raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยกรณีเสียชีวิตไม่ถูกต้อง';
    end if;

    v_outcome_note := coalesce(
      nullif(btrim(coalesce(p_notes, '')), ''),
      case p_cannot_reach_reason
        when 'no_access' then 'เจ้าหน้าที่เข้าถึงพื้นที่ไม่ได้: รอประเมินและเข้าช่วยเหลือใหม่'
        when 'deceased' then 'ยืนยันเหตุเสียชีวิต: ปิดเคสและรอการประสานหน่วยงานที่เกี่ยวข้อง'
      end
    );

    -- Keep the assignment outcome for audit, but close the SOS only when the
    -- confirmed outcome is deceased. A no-access case remains available to retry.
    update public.assignments
    set status = 'cannot_reach',
        cannot_reach_reason = p_cannot_reach_reason,
        notes = v_outcome_note,
        completed_at = coalesce(completed_at, now())
    where id = v_active_assignment_id;

    v_sos_status := case when p_cannot_reach_reason = 'deceased' then 'closed' else 'cannot_reach' end;
    v_victim_status := case when p_cannot_reach_reason = 'deceased' then 'deceased' else 'unknown' end;

    update public.sos_reports
    set status = v_sos_status,
        updated_at = now()
    where id = p_sos_report_id;

    insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
    values (
      p_sos_report_id,
      v_victim_status,
      null,
      coalesce(nullif(btrim(coalesce(p_victim_notes, '')), ''), v_outcome_note),
      now()
    )
    on conflict (sos_report_id) do update
    set status = excluded.status,
        shelter_name = excluded.shelter_name,
        notes = excluded.notes,
        updated_at = excluded.updated_at;

    return jsonb_build_object(
      'sos_report_id', p_sos_report_id,
      'atomic', true,
      'outcome', p_cannot_reach_reason,
      'sos_status', v_sos_status
    );
  end if;

  perform public.confirm_rescue_outcome_v3(
    p_sos_report_id,
    p_mode,
    p_destination_type,
    p_destination_shelter_id,
    p_destination_note,
    p_confirmed_adult,
    p_confirmed_child,
    p_confirmed_elder,
    p_cannot_reach_reason,
    p_notes,
    p_people,
    p_count_discrepancy_note
  );

  if p_mode = 'rescued' and p_victim_status not in ('rescued', 'at_shelter') then
    raise exception using errcode = '22023', message = 'สถานะผู้ประสบภัยหลังช่วยเหลือไม่ถูกต้อง';
  end if;

  insert into public.victim_status (sos_report_id, status, shelter_name, notes, updated_at)
  values (
    p_sos_report_id,
    p_victim_status,
    nullif(btrim(p_victim_shelter_name), ''),
    nullif(btrim(p_victim_notes), ''),
    now()
  )
  on conflict (sos_report_id) do update
  set status = excluded.status,
      shelter_name = excluded.shelter_name,
      notes = excluded.notes,
      updated_at = excluded.updated_at;

  return jsonb_build_object('sos_report_id', p_sos_report_id, 'atomic', true);
end;
$$;


ALTER FUNCTION "public"."confirm_rescue_outcome_v4"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text", "p_victim_status" "text", "p_victim_shelter_name" "text", "p_victim_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") IS 'ยืนยันการออกจากศูนย์ ปรับยอดคน และอัปเดต victim_status ใน transaction เดียว';



CREATE OR REPLACE FUNCTION "public"."confirm_shelter_request_exit"("p_sos_report_id" "uuid", "p_shelter_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."confirm_shelter_request_exit"("p_sos_report_id" "uuid", "p_shelter_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_death_confirmation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."create_death_confirmation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dispatch_rescue_case"("p_sos_report_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_case public.sos_reports%rowtype;
  v_rescuer_id uuid;
  v_distance_km double precision;
  v_eta_minutes integer;
  v_assignment_id uuid;
  v_attempt_no integer;
  v_started_at timestamptz;
  v_search_round integer;
  v_radius_km integer;
  v_respond_by timestamptz := now() + interval '90 seconds';
begin
  select * into v_case from public.sos_reports where id = p_sos_report_id for update;
  if not found or v_case.status not in ('pending', 'cannot_reach') then
    return jsonb_build_object('assigned', false, 'reason', 'case_not_dispatchable');
  end if;

  if exists (
    select 1 from public.assignments
    where sos_report_id = p_sos_report_id
      and status in ('offered', 'accepted', 'en_route', 'on_scene')
  ) then
    return jsonb_build_object('assigned', false, 'reason', 'case_already_open');
  end if;

  insert into public.rescue_dispatch_searches (sos_report_id)
  values (p_sos_report_id)
  on conflict (sos_report_id) do update set updated_at = now()
  returning started_at into v_started_at;

  -- 0-59 sec: 5 km, 1-2:59 min: 15 km, then 50 km within its service area.
  v_search_round := least(3, greatest(1, floor(extract(epoch from now() - v_started_at) / 60)::integer + 1));
  v_radius_km := case v_search_round when 1 then 5 when 2 then 15 else 50 end;

  if v_case.lat is null or v_case.lng is null then
    return jsonb_build_object('assigned', false, 'reason', 'case_location_missing', 'search_radius_km', v_radius_km);
  end if;

  select p.id,
    6371 * 2 * asin(sqrt(
      power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
      + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
      * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
    )) as distance_km
  into v_rescuer_id, v_distance_km
  from public.rescuer_presence rp
  join public.profiles p on p.id = rp.rescuer_id
  where p.role = 'rescuer'
    and p.is_active = true
    and rp.availability = 'available'
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '2 minutes'
    and exists (
      select 1 from public.rescuer_service_areas area
      where area.rescuer_id = p.id
        and lower(btrim(area.province)) = lower(btrim(v_case.province))
        and (area.district is null or lower(btrim(area.district)) = lower(btrim(v_case.district)))
    )
    and not exists (
      select 1 from public.assignments active
      where active.rescuer_id = p.id
        and active.status in ('offered', 'accepted', 'en_route', 'on_scene')
    )
    and not exists (
      select 1 from public.rescue_dispatch_attempts prior
      where prior.sos_report_id = p_sos_report_id and prior.rescuer_id = p.id
    )
    and 6371 * 2 * asin(sqrt(
      power(sin(radians(v_case.lat - rp.latitude) / 2), 2)
      + cos(radians(rp.latitude)) * cos(radians(v_case.lat))
      * power(sin(radians(v_case.lng - rp.longitude) / 2), 2)
    )) <= v_radius_km
  order by distance_km, rp.location_updated_at desc
  limit 1;

  if v_rescuer_id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_available_rescuer_in_radius', 'search_round', v_search_round, 'search_radius_km', v_radius_km);
  end if;

  v_eta_minutes := greatest(1, ceil(v_distance_km / 30.0 * 60.0)::integer);
  select coalesce(max(attempt_no), 0) + 1 into v_attempt_no
  from public.rescue_dispatch_attempts where sos_report_id = p_sos_report_id;

  insert into public.assignments (sos_report_id, rescuer_id, status)
  values (p_sos_report_id, v_rescuer_id, 'offered')
  returning id into v_assignment_id;

  insert into public.rescue_dispatch_attempts (
    sos_report_id, assignment_id, rescuer_id, attempt_no, status, respond_by,
    estimated_arrival_minutes, search_radius_km
  ) values (
    p_sos_report_id, v_assignment_id, v_rescuer_id, v_attempt_no, 'offered', v_respond_by,
    v_eta_minutes, v_radius_km
  );

  return jsonb_build_object(
    'assigned', true, 'assignment_id', v_assignment_id, 'rescuer_id', v_rescuer_id,
    'respond_by', v_respond_by, 'eta_minutes', v_eta_minutes,
    'search_round', v_search_round, 'search_radius_km', v_radius_km
  );
end;
$$;


ALTER FUNCTION "public"."dispatch_rescue_case"("p_sos_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_admin_notification"("p_event_type" "text", "p_title" "text", "p_body" "text", "p_target_url" "text" DEFAULT '/officer/admin'::"text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  insert into public.notification_outbox (recipient_id, event_type, title, body, target_url)
  select id, p_event_type, p_title, p_body, p_target_url
  from public.profiles
  where is_active = true and role in ('admin', 'gov');
$$;


ALTER FUNCTION "public"."enqueue_admin_notification"("p_event_type" "text", "p_title" "text", "p_body" "text", "p_target_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_assignment_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  insert into public.notification_outbox (recipient_id, event_type, title, body, target_url)
  values (
    new.rescuer_id,
    case when new.status = 'offered' then 'dispatch_offer' else 'assignment_created' end,
    case when new.status = 'offered' then 'มีภารกิจใหม่ กรุณายืนยันภายใน 2 นาที' else 'ได้รับมอบหมายภารกิจช่วยเหลือ' end,
    case when new.status = 'offered' then 'ระบบเลือกคุณเป็นทีมที่เหมาะสมที่สุด กรุณาตอบรับหรือปฏิเสธทันที' else 'มีภารกิจใหม่ที่ต้องตรวจสอบและรับงาน' end,
    '/officer/dashboard'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_assignment_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_death_review_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform public.enqueue_admin_notification(
    'death_review_required', 'รอยืนยันกรณีเสียชีวิต',
    'มีรายงานเสียชีวิตจากหน้างาน รอผู้ดูแลตรวจสอบและยืนยัน',
    '/officer/admin'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_death_review_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_sos_created_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  perform public.enqueue_admin_notification(
    'sos_created', 'มีคำขอความช่วยเหลือใหม่',
    'มีคำขอ SOS ใหม่ใน ' || new.province || ' กรุณาตรวจสอบและมอบหมายภารกิจ',
    '/officer/admin'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."enqueue_sos_created_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_rescue_dispatches"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_assignment record;
  v_case record;
  v_expired integer := 0;
  v_dispatched integer := 0;
  v_arrival_handoffs integer := 0;
  v_arrival_gps_paused integer := 0;
  v_distance_m double precision;
begin
  for v_assignment in
    select a.id, a.sos_report_id
    from public.assignments a
    join public.rescue_dispatch_attempts d on d.assignment_id = a.id
    where a.status = 'offered' and d.status = 'offered' and d.respond_by <= now()
    for update of a, d skip locked
  loop
    update public.assignments set status = 'expired', completed_at = now() where id = v_assignment.id;
    update public.rescue_dispatch_attempts set status = 'expired', responded_at = now(), reason = 'response_timeout'
      where assignment_id = v_assignment.id;
    perform public.dispatch_rescue_case(v_assignment.sos_report_id);
    v_expired := v_expired + 1;
  end loop;

  for v_assignment in
    select
      a.id,
      a.sos_report_id,
      a.rescuer_id,
      a.arrival_gps_stale_notified_at,
      s.lat as case_lat,
      s.lng as case_lng,
      rp.latitude as rescuer_lat,
      rp.longitude as rescuer_lng,
      rp.location_updated_at,
      d.estimated_arrival_minutes
    from public.assignments a
    join public.sos_reports s on s.id = a.sos_report_id
    left join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
    left join public.rescue_dispatch_attempts d on d.assignment_id = a.id
    where a.status in ('accepted', 'en_route')
      and a.accepted_at is not null
      and now() > a.accepted_at
        + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute'
    order by a.accepted_at
    for update of a skip locked
  loop
    if v_assignment.location_updated_at is null
       or v_assignment.location_updated_at < now() - interval '5 minutes'
       or v_assignment.rescuer_lat is null
       or v_assignment.rescuer_lng is null
       or v_assignment.case_lat is null
       or v_assignment.case_lng is null then
      if v_assignment.arrival_gps_stale_notified_at is null then
        update public.assignments
        set arrival_gps_stale_notified_at = now()
        where id = v_assignment.id
          and arrival_gps_stale_notified_at is null;

        if found then
          perform public.enqueue_admin_notification(
            'rescue_arrival_gps_stale',
            'ตรวจสอบภารกิจกู้ภัย: พิกัดไม่อัปเดต',
            'ภารกิจเลยเวลา ETA + 10 นาที แต่ตรวจสอบตำแหน่งล่าสุดไม่ได้ ระบบจึงพักการส่งต่องานอัตโนมัติ กรุณาตรวจสอบเคส ' || v_assignment.sos_report_id::text,
            '/officer/admin'
          );
          v_arrival_gps_paused := v_arrival_gps_paused + 1;
        end if;
      end if;
      continue;
    end if;

    v_distance_m := 6371000 * 2 * asin(sqrt(least(1.0, greatest(0.0,
      power(sin(radians(v_assignment.case_lat - v_assignment.rescuer_lat) / 2), 2)
      + cos(radians(v_assignment.rescuer_lat)) * cos(radians(v_assignment.case_lat))
      * power(sin(radians(v_assignment.case_lng - v_assignment.rescuer_lng) / 2), 2)
    ))));

    if v_distance_m <= 500 then
      update public.assignments
      set status = 'on_scene'
      where id = v_assignment.id and status in ('accepted', 'en_route');
      continue;
    end if;

    update public.assignments
    set status = 'expired',
        completed_at = now(),
        notes = concat_ws(E'\n', nullif(notes, ''), 'AUTO HANDOFF: arrival deadline exceeded')
    where id = v_assignment.id and status in ('accepted', 'en_route');
    if not found then
      continue;
    end if;

    update public.rescue_dispatch_attempts
    set status = 'handed_off',
        responded_at = now(),
        reason = 'arrival_deadline_exceeded'
    where assignment_id = v_assignment.id and status = 'accepted';

    update public.rescuer_presence rp
    set availability = 'available', updated_at = now()
    where rp.rescuer_id = v_assignment.rescuer_id
      and rp.location_updated_at >= now() - interval '5 minutes'
      and not exists (
        select 1
        from public.assignments active
        where active.rescuer_id = rp.rescuer_id
          and active.id <> v_assignment.id
          and active.status in ('offered', 'accepted', 'en_route', 'on_scene')
      );

    update public.sos_reports
    set status = 'pending', updated_at = now()
    where id = v_assignment.sos_report_id and status = 'assigned';
    if not found then
      continue;
    end if;

    insert into public.victim_status (sos_report_id, status, notes, updated_at)
    values (
      v_assignment.sos_report_id,
      'unknown',
      'ระบบส่งต่อภารกิจอัตโนมัติ เนื่องจากเลยกำหนดเวลาเดินทางและตำแหน่งยังห่างจากจุดเกิดเหตุ',
      now()
    )
    on conflict (sos_report_id) do update
    set status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at;

    v_arrival_handoffs := v_arrival_handoffs + 1;
  end loop;

  -- Also retries cases created while every rescuer was offline.
  for v_case in
    select id from public.sos_reports s
    where s.status in ('pending', 'cannot_reach')
      and not exists (
        select 1 from public.assignments a where a.sos_report_id = s.id
          and a.status in ('offered', 'accepted', 'en_route', 'on_scene')
      )
    order by s.created_at
    limit 100
  loop
    if (public.dispatch_rescue_case(v_case.id)->>'assigned')::boolean then
      v_dispatched := v_dispatched + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'expired', v_expired,
    'new_offers', v_dispatched,
    'arrival_handoffs', v_arrival_handoffs,
    'arrival_gps_paused', v_arrival_gps_paused
  );
end;
$$;


ALTER FUNCTION "public"."expire_stale_rescue_dispatches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_rescue_case_control"("p_sos_report_id" "uuid") RETURNS TABLE("assignment_id" "uuid", "rescuer_id" "uuid", "rescuer_name" "text", "agency" "text", "assignment_status" "text", "accepted_at" timestamp with time zone, "estimated_arrival_minutes" integer, "eta_deadline" timestamp with time zone, "latitude" double precision, "longitude" double precision, "location_updated_at" timestamp with time zone, "location_is_stale" boolean, "rescue_is_overdue" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may view rescue case control data';
  end if;

  return query
  select
    a.id,
    a.rescuer_id,
    p.full_name::text,
    p.agency::text,
    a.status::text,
    a.accepted_at,
    d.estimated_arrival_minutes,
    case when a.accepted_at is null then null
      else a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute'
    end,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at,
    coalesce(rp.location_updated_at < now() - interval '5 minutes', true),
    coalesce(
      a.status in ('accepted', 'en_route')
      and a.accepted_at is not null
      and now() > a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute',
      false
    )
  from public.assignments a
  join public.profiles p on p.id = a.rescuer_id
  left join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
  left join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.sos_report_id = p_sos_report_id
    and a.status in ('offered', 'accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last, d.offered_at desc
  limit 1;
end;
$$;


ALTER FUNCTION "public"."get_admin_rescue_case_control"("p_sos_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_rescue_case_control_v2"("p_sos_report_id" "uuid") RETURNS TABLE("assignment_id" "uuid", "rescuer_id" "uuid", "rescuer_name" "text", "agency" "text", "assignment_status" "text", "accepted_at" timestamp with time zone, "estimated_arrival_minutes" integer, "arrival_target_at" timestamp with time zone, "escalation_at" timestamp with time zone, "resolution_review_at" timestamp with time zone, "latitude" double precision, "longitude" double precision, "location_updated_at" timestamp with time zone, "location_is_stale" boolean, "arrival_is_overdue" boolean, "resolution_is_overdue" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only an active administrator may view rescue case control data';
  end if;

  return query
  select
    a.id,
    a.rescuer_id,
    p.full_name::text,
    p.agency::text,
    a.status::text,
    a.accepted_at,
    d.estimated_arrival_minutes,
    case when a.accepted_at is null then null
      else a.accepted_at + coalesce(d.estimated_arrival_minutes, 30) * interval '1 minute'
    end,
    case when a.accepted_at is null then null
      else a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute'
    end,
    case when a.accepted_at is null then null
      else a.accepted_at + case s.urgency_level
        when 'critical' then interval '60 minutes'
        when 'high' then interval '120 minutes'
        when 'medium' then interval '240 minutes'
        else interval '480 minutes'
      end
    end,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at,
    coalesce(rp.location_updated_at < now() - interval '5 minutes', true),
    coalesce(
      a.status in ('accepted', 'en_route') and a.accepted_at is not null
      and now() > a.accepted_at + (coalesce(d.estimated_arrival_minutes, 30) + 10) * interval '1 minute',
      false
    ),
    coalesce(
      a.status in ('accepted', 'en_route', 'on_scene') and a.accepted_at is not null
      and now() > a.accepted_at + case s.urgency_level
        when 'critical' then interval '60 minutes'
        when 'high' then interval '120 minutes'
        when 'medium' then interval '240 minutes'
        else interval '480 minutes'
      end,
      false
    )
  from public.assignments a
  join public.sos_reports s on s.id = a.sos_report_id
  join public.profiles p on p.id = a.rescuer_id
  left join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
  left join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.sos_report_id = p_sos_report_id
    and a.status in ('offered', 'accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last, d.offered_at desc
  limit 1;
end;
$$;


ALTER FUNCTION "public"."get_admin_rescue_case_control_v2"("p_sos_report_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_rescuer_locations"() RETURNS TABLE("rescuer_id" "uuid", "display_name" "text", "agency" "text", "availability" "text", "latitude" double precision, "longitude" double precision, "location_updated_at" timestamp with time zone, "assignment_status" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    p.id::uuid as rescuer_id,
    p.full_name::text as display_name,
    p.agency::text as agency,
    rp.availability::text as availability,
    rp.latitude::double precision as latitude,
    rp.longitude::double precision as longitude,
    rp.location_updated_at::timestamptz as location_updated_at,
    active.status::text as assignment_status
  from public.rescuer_presence rp
  join public.profiles p on p.id = rp.rescuer_id
  left join lateral (
    select a.status
    from public.assignments a
    where a.rescuer_id = p.id
      and a.status in ('accepted', 'en_route', 'on_scene')
    order by a.accepted_at desc nulls last
    limit 1
  ) active on true
  where exists (
      select 1 from public.profiles admin
      where admin.id = auth.uid() and admin.role = 'admin' and admin.is_active = true
    )
    and p.role = 'rescuer'
    and p.is_active = true
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '15 minutes'
  order by
    case rp.availability when 'busy' then 0 when 'available' then 1 else 2 end,
    rp.location_updated_at desc;
$$;


ALTER FUNCTION "public"."get_admin_rescuer_locations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_active_rescue_assignments"() RETURNS TABLE("sos_report_id" "uuid", "status" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select a.sos_report_id, a.status
  from public.assignments a
  where a.rescuer_id = auth.uid()
    and a.status in ('accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last;
$$;


ALTER FUNCTION "public"."get_my_active_rescue_assignments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_pending_rescue_dispatches"() RETURNS TABLE("sos_report_id" "uuid", "respond_by" timestamp with time zone, "estimated_arrival_minutes" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select a.sos_report_id, d.respond_by, d.estimated_arrival_minutes
  from public.assignments a
  join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.rescuer_id = auth.uid() and a.status = 'offered' and d.status = 'offered'
  order by d.offered_at desc;
$$;


ALTER FUNCTION "public"."get_my_pending_rescue_dispatches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_rescuer_dispatch_readiness"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_presence public.rescuer_presence%rowtype;
  v_area_count integer;
  v_active_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'rescuer' and is_active
  ) then
    raise exception using errcode = '42501', message = 'Only an active rescuer may view dispatch readiness';
  end if;
  select * into v_presence from public.rescuer_presence where rescuer_id = auth.uid();
  select count(*) into v_area_count from public.rescuer_service_areas where rescuer_id = auth.uid();
  select count(*) into v_active_count from public.assignments
    where rescuer_id = auth.uid() and status in ('offered', 'accepted', 'en_route', 'on_scene');

  return jsonb_build_object(
    'availability', coalesce(v_presence.availability, 'offline'),
    'has_current_location', coalesce(v_presence.location_updated_at >= now() - interval '2 minutes', false),
    'location_updated_at', v_presence.location_updated_at,
    'service_area_count', v_area_count,
    'open_assignment_count', v_active_count,
    'ready', coalesce(v_presence.availability = 'available' and v_presence.location_updated_at >= now() - interval '2 minutes' and v_area_count > 0 and v_active_count = 0, false)
  );
end;
$$;


ALTER FUNCTION "public"."get_my_rescuer_dispatch_readiness"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") RETURNS TABLE("agency" "text", "assignment_status" "text", "latitude" double precision, "longitude" double precision, "location_updated_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  -- Victims currently authenticate their tracker with the telephone number
  -- used when creating the SOS. Do not return any location for another case.
  if not exists (
    select 1 from public.sos_reports
    where id = p_sos_report_id and phone = btrim(p_phone)
  ) then
    raise exception using errcode = '42501', message = 'This SOS request does not match the supplied phone number';
  end if;

  return query
  select
    coalesce(nullif(btrim(p.agency), ''), 'ทีมกู้ภัยที่ได้รับมอบหมาย')::text,
    a.status::text,
    rp.latitude,
    rp.longitude,
    rp.location_updated_at
  from public.assignments a
  join public.profiles p on p.id = a.rescuer_id
  join public.rescuer_presence rp on rp.rescuer_id = a.rescuer_id
  where a.sos_report_id = p_sos_report_id
    and a.status in ('accepted', 'en_route', 'on_scene')
    and rp.latitude is not null and rp.longitude is not null
    and rp.location_updated_at >= now() - interval '5 minutes'
  order by a.accepted_at desc nulls last
  limit 1;
end;
$$;


ALTER FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_shelter_occupant_to_delivery_person"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."link_shelter_occupant_to_delivery_person"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_rescuer_offline_after_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.status in ('completed', 'cannot_reach')
     and old.status in ('accepted', 'en_route', 'on_scene')
     and not exists (
       select 1 from public.assignments
       where rescuer_id = new.rescuer_id and id <> new.id
         and status in ('accepted', 'en_route', 'on_scene')
     ) then
    update public.rescuer_presence
    set availability = 'offline', updated_at = now()
    where rescuer_id = new.rescuer_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."mark_rescuer_offline_after_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normalize_compensation_address"("p_province" "text", "p_district" "text", "p_sub_district" "text", "p_address_details" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select lower(regexp_replace(
    concat_ws('|', btrim(p_province), btrim(p_district), btrim(p_sub_district), btrim(p_address_details)),
    '[[:space:][:punct:]]+', '', 'g'
  ));
$$;


ALTER FUNCTION "public"."normalize_compensation_address"("p_province" "text", "p_district" "text", "p_sub_district" "text", "p_address_details" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_compensation_claim"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_sos_status text;
  v_destination_status text;
begin
  new.updated_at := now();
  if new.claim_category is null then return new; end if;

  if new.sos_report_id is null then
    raise exception using errcode = '22023', message = 'ไม่พบเลขอ้างอิงคำขอความช่วยเหลือ';
  end if;
  select status into v_sos_status
  from public.sos_reports where id = new.sos_report_id;
  if v_sos_status is null or v_sos_status not in ('rescued', 'closed') then
    raise exception using errcode = '22023', message = 'ยื่นเยียวยาได้หลังภารกิจช่วยเหลือเสร็จแล้ว';
  end if;
  select status into v_destination_status
  from public.victim_status where sos_report_id = new.sos_report_id;
  if v_destination_status is null or v_destination_status not in ('rescued', 'returned_home') then
    raise exception using errcode = '22023', message = 'ยื่นเยียวยาได้หลังออกจากศูนย์พักพิงหรือถึงจุดปลอดภัยแล้ว';
  end if;

  new.id_card_number := regexp_replace(coalesce(new.id_card_number, ''), '[^0-9]', '', 'g');
  if char_length(new.id_card_number) <> 13 then
    raise exception using errcode = '22023', message = 'เลขบัตรประชาชนต้องมี 13 หลัก';
  end if;
  if nullif(btrim(new.id_card_image_url), '') is null then
    raise exception using errcode = '22023', message = 'กรุณาแนบรูปบัตรประชาชน';
  end if;
  if nullif(btrim(new.bank_book_image_url), '') is null then
    raise exception using errcode = '22023', message = 'กรุณาแนบรูปหน้าสมุดบัญชีธนาคาร';
  end if;
  if cardinality(coalesce(new.image_urls, '{}'::text[])) < 1 then
    raise exception using errcode = '22023', message = 'กรุณาแนบรูปความเสียหายอย่างน้อย 1 รูป';
  end if;

  if new.claim_category = 'housing_property' then
    if new.housing_tenure is null then
      raise exception using errcode = '22023', message = 'กรุณาระบุความเกี่ยวข้องกับที่อยู่อาศัย';
    end if;
    if nullif(btrim(new.address_details), '') is null then
      raise exception using errcode = '22023', message = 'กรุณากรอกบ้านเลขที่และรายละเอียดที่อยู่';
    end if;
    new.property_address_key := public.normalize_compensation_address(new.province, new.district, new.sub_district, new.address_details);
    new.agriculture_damage_types := '{}'::text[];
    new.farmer_registered_before_disaster := null;
    new.farmer_registration_number := null;
    new.crop_area_rai := null;
    new.fishery_area_rai := null;
    new.livestock_count := null;
  else
    if new.farmer_registered_before_disaster is distinct from true then
      raise exception using errcode = '22023', message = 'ต้องเป็นเกษตรกรที่ขึ้นทะเบียนไว้ก่อนเกิดภัยพิบัติ';
    end if;
    if cardinality(coalesce(new.agriculture_damage_types, '{}'::text[])) < 1 then
      raise exception using errcode = '22023', message = 'กรุณาเลือกประเภทความเสียหายด้านการประกอบอาชีพ';
    end if;
    if 'crop' = any(new.agriculture_damage_types) and coalesce(new.crop_area_rai, 0) <= 0 then
      raise exception using errcode = '22023', message = 'กรุณาระบุจำนวนไร่ของพืชผลที่เสียหาย';
    end if;
    if 'fishery' = any(new.agriculture_damage_types) and coalesce(new.fishery_area_rai, 0) <= 0 then
      raise exception using errcode = '22023', message = 'กรุณาระบุจำนวนไร่ของพื้นที่ประมงที่เสียหาย';
    end if;
    if 'livestock' = any(new.agriculture_damage_types) and coalesce(new.livestock_count, 0) <= 0 then
      raise exception using errcode = '22023', message = 'กรุณาระบุจำนวนปศุสัตว์ที่เสียหาย';
    end if;
    new.property_address_key := null;
    new.housing_tenure := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prepare_compensation_claim"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_compensation_structured_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if nullif(btrim(new.first_name), '') is not null then
    new.full_name := concat_ws(' ', nullif(btrim(new.first_name), ''), nullif(btrim(new.last_name), ''));
  end if;

  if new.incident_date is not null then
    new.damage_end_date := coalesce(new.damage_end_date, new.incident_date);
    new.damage_duration_days := (new.damage_end_date - new.incident_date) + 1;
  end if;

  if new.claim_category = 'housing_property' then
    new.property_address_key := public.normalize_compensation_address(
      new.province, new.district, new.sub_district, new.address_details
    );
    if tg_op = 'INSERT' and new.housing_tenure = 'renter'
      and nullif(btrim(new.rental_agreement_image_url), '') is null then
      raise exception using errcode = '22023', message = 'โปรดแนบสัญญาเช่าหรือหลักฐานหอพัก';
    end if;
    if tg_op = 'INSERT' and new.registered_resident is true
      and nullif(btrim(new.house_registration_image_url), '') is null then
      raise exception using errcode = '22023', message = 'โปรดแนบสำเนาทะเบียนบ้าน';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prepare_compensation_structured_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_rescue_delivery_person"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."prepare_rescue_delivery_person"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_followup public.post_shelter_followups%rowtype;
  v_role text;
  v_profile_shelter_id uuid;
  v_arrived_home boolean;
  v_home_habitable boolean;
  v_water_available boolean;
  v_electricity_available boolean;
  v_toilet_usable boolean;
  v_access_route_safe boolean;
  v_has_injured_person boolean;
  v_has_vulnerable_person boolean;
  v_needs_food boolean;
  v_needs_medicine boolean;
  v_needs_temporary_shelter boolean;
  v_needs_rescue_followup boolean;
  v_damage_description text;
  v_image_urls text[];
  v_notes text;
  v_next_status text;
  v_submitter_type text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'กรุณาเข้าสู่ระบบก่อนบันทึกผลติดตาม';
  end if;

  if p_followup_id is null or p_assessment is null or jsonb_typeof(p_assessment) <> 'object' then
    raise exception using errcode = '22023', message = 'ข้อมูลแบบประเมินไม่ถูกต้อง';
  end if;

  select *
  into v_followup
  from public.post_shelter_followups f
  where f.id = p_followup_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ไม่พบรายการติดตามหลังกลับบ้าน';
  end if;

  if v_followup.status = 'closed' then
    raise exception using errcode = '23514', message = 'รายการติดตามนี้ถูกปิดแล้ว';
  end if;

  select p.role, p.shelter_id
  into v_role, v_profile_shelter_id
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;

  if v_role is null
     or not (
       v_role = 'admin'
       or (v_role = 'shelter_staff' and v_profile_shelter_id = v_followup.shelter_id)
       or (
         v_role = 'rescuer'
         and v_followup.sos_report_id is not null
         and exists (
           select 1 from public.assignments a
           where a.sos_report_id = v_followup.sos_report_id
             and a.rescuer_id = auth.uid()
         )
       )
     ) then
    raise exception using errcode = '42501', message = 'คุณไม่มีสิทธิ์บันทึกรายการติดตามนี้';
  end if;

  if not (p_assessment ? 'arrived_home')
     or jsonb_typeof(p_assessment -> 'arrived_home') <> 'boolean' then
    raise exception using errcode = '22023', message = 'กรุณาระบุว่าผู้ประสบภัยกลับถึงบ้านหรือไม่';
  end if;

  select *
  into
    v_arrived_home,
    v_home_habitable,
    v_water_available,
    v_electricity_available,
    v_toilet_usable,
    v_access_route_safe,
    v_has_injured_person,
    v_has_vulnerable_person,
    v_needs_food,
    v_needs_medicine,
    v_needs_temporary_shelter,
    v_needs_rescue_followup,
    v_damage_description,
    v_image_urls,
    v_notes
  from jsonb_to_record(p_assessment) as x(
    arrived_home boolean,
    home_habitable boolean,
    water_available boolean,
    electricity_available boolean,
    toilet_usable boolean,
    access_route_safe boolean,
    has_injured_person boolean,
    has_vulnerable_person boolean,
    needs_food boolean,
    needs_medicine boolean,
    needs_temporary_shelter boolean,
    needs_rescue_followup boolean,
    damage_description text,
    image_urls text[],
    notes text
  );

  if v_arrived_home and (
    v_home_habitable is null
    or v_water_available is null
    or v_electricity_available is null
    or v_toilet_usable is null
    or v_access_route_safe is null
    or v_has_injured_person is null
    or v_has_vulnerable_person is null
    or v_needs_food is null
    or v_needs_medicine is null
    or v_needs_temporary_shelter is null
    or v_needs_rescue_followup is null
  ) then
    raise exception using errcode = '22023', message = 'กรุณาตอบแบบประเมินหลังกลับบ้านให้ครบทุกข้อ';
  end if;

  v_image_urls := coalesce(v_image_urls, '{}'::text[]);
  v_damage_description := nullif(btrim(v_damage_description), '');
  v_notes := nullif(btrim(v_notes), '');

  if cardinality(v_image_urls) > 6 then
    raise exception using errcode = '22023', message = 'แนบรูปภาพได้ไม่เกิน 6 รูป';
  end if;
  if v_damage_description is not null and char_length(v_damage_description) > 2000 then
    raise exception using errcode = '22023', message = 'รายละเอียดความเสียหายต้องไม่เกิน 2,000 ตัวอักษร';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception using errcode = '22023', message = 'หมายเหตุต้องไม่เกิน 2,000 ตัวอักษร';
  end if;

  if not v_arrived_home
     or not coalesce(v_home_habitable, true)
     or not coalesce(v_water_available, true)
     or not coalesce(v_electricity_available, true)
     or not coalesce(v_toilet_usable, true)
     or not coalesce(v_access_route_safe, true)
     or coalesce(v_has_injured_person, false)
     or coalesce(v_needs_food, false)
     or coalesce(v_needs_medicine, false)
     or coalesce(v_needs_temporary_shelter, false)
     or coalesce(v_needs_rescue_followup, false) then
    v_next_status := 'needs_assistance';
  else
    v_next_status := 'completed';
  end if;

  v_submitter_type := case v_role
    when 'shelter_staff' then 'shelter_staff'
    when 'rescuer' then 'rescuer'
    else 'admin'
  end;

  update public.post_shelter_followups
  set status = v_next_status,
      contacted_at = coalesce(contacted_at, now()),
      completed_at = now(),
      arrived_home = v_arrived_home,
      home_habitable = v_home_habitable,
      water_available = v_water_available,
      electricity_available = v_electricity_available,
      toilet_usable = v_toilet_usable,
      access_route_safe = v_access_route_safe,
      has_injured_person = v_has_injured_person,
      has_vulnerable_person = v_has_vulnerable_person,
      needs_food = v_needs_food,
      needs_medicine = v_needs_medicine,
      needs_temporary_shelter = v_needs_temporary_shelter,
      needs_rescue_followup = v_needs_rescue_followup,
      damage_description = v_damage_description,
      image_urls = v_image_urls,
      notes = v_notes,
      submitted_by_type = v_submitter_type,
      submitted_by = auth.uid()
  where id = v_followup.id;

  return jsonb_build_object(
    'id', v_followup.id,
    'status', v_next_status,
    'needs_assistance', v_next_status = 'needs_assistance',
    'completed_at', now()
  );
end;
$$;


ALTER FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") IS 'บันทึกผลติดตามหลังกลับบ้าน ตรวจสิทธิ์ และจัดสถานะ completed หรือ needs_assistance อัตโนมัติ';



CREATE OR REPLACE FUNCTION "public"."register_shelter_occupant"("p_shelter_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_adult_count" integer, "p_child_count" integer, "p_elder_count" integer, "p_request_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."register_shelter_occupant"("p_shelter_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_adult_count" integer, "p_child_count" integer, "p_elder_count" integer, "p_request_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_shelter_delivery_person"("p_delivery_person_id" "uuid", "p_occupant_id" "uuid", "p_full_name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."rename_shelter_delivery_person"("p_delivery_person_id" "uuid", "p_occupant_id" "uuid", "p_full_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."respond_to_rescue_dispatch"("p_sos_report_id" "uuid", "p_accept" boolean, "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_assignment_id uuid;
  v_respond_by timestamptz;
  v_expired boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in before responding to a dispatch';
  end if;

  select a.id, d.respond_by into v_assignment_id, v_respond_by
  from public.assignments a
  join public.rescue_dispatch_attempts d on d.assignment_id = a.id
  where a.sos_report_id = p_sos_report_id
    and a.rescuer_id = auth.uid()
    and a.status = 'offered' and d.status = 'offered'
  for update of a, d;
  if v_assignment_id is null then
    raise exception using errcode = 'P0002', message = 'No pending dispatch was found for this case';
  end if;

  if v_respond_by <= now() then
    update public.assignments set status = 'expired', completed_at = now() where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'expired', responded_at = now(), reason = 'response_timeout'
      where assignment_id = v_assignment_id;
    v_expired := true;
  elsif p_accept then
    update public.assignments set status = 'accepted', accepted_at = now() where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'accepted', responded_at = now()
      where assignment_id = v_assignment_id;
    update public.sos_reports set status = 'assigned', updated_at = now() where id = p_sos_report_id;
    insert into public.victim_status (sos_report_id, status, updated_at)
    values (p_sos_report_id, 'rescue_assigned', now())
    on conflict (sos_report_id) do update set status = excluded.status, updated_at = excluded.updated_at;
    update public.rescuer_presence set availability = 'busy', updated_at = now() where rescuer_id = auth.uid();
    return jsonb_build_object('accepted', true, 'assignment_id', v_assignment_id);
  else
    update public.assignments set status = 'declined', completed_at = now(), notes = nullif(btrim(coalesce(p_reason, '')), '')
      where id = v_assignment_id;
    update public.rescue_dispatch_attempts set status = 'declined', responded_at = now(), reason = nullif(btrim(coalesce(p_reason, '')), '')
      where assignment_id = v_assignment_id;
  end if;

  perform public.dispatch_rescue_case(p_sos_report_id);
  return jsonb_build_object('accepted', false, 'expired', v_expired, 'redispatched', true);
end;
$$;


ALTER FUNCTION "public"."respond_to_rescue_dispatch"("p_sos_report_id" "uuid", "p_accept" boolean, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_death_case_confirmation"("p_confirmation_id" "uuid", "p_decision" "text", "p_review_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."review_death_case_confirmation"("p_confirmation_id" "uuid", "p_decision" "text", "p_review_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if new.status = 'exited'
     and new.exit_destination = 'home'
     and (
       old.status is distinct from new.status
       or old.exit_destination is distinct from new.exit_destination
     ) then
    insert into public.post_shelter_followups (
      sos_report_id,
      shelter_occupant_id,
      shelter_id,
      round_no,
      household_name,
      contact_phone,
      status,
      due_at,
      submitted_by_type
    ) values (
      new.sos_report_id,
      new.id,
      new.shelter_id,
      1,
      new.full_name,
      new.phone,
      'pending',
      coalesce(new.exit_date, now()) + interval '1 day',
      'system'
    )
    on conflict (shelter_occupant_id, round_no) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_rescuer_presence"("p_availability" "text", "p_latitude" double precision DEFAULT NULL::double precision, "p_longitude" double precision DEFAULT NULL::double precision) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'rescuer' and is_active = true
  ) then
    raise exception using errcode = '42501', message = 'Only active rescuers can publish availability';
  end if;
  if p_availability not in ('available', 'busy', 'offline') then
    raise exception using errcode = '22023', message = 'Invalid availability';
  end if;
  if p_availability = 'available'
     and (p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90 or p_longitude not between -180 and 180) then
    raise exception using errcode = '22023', message = 'A current location is required before going available';
  end if;
  if p_availability = 'available' and exists (
    select 1 from public.assignments
    where rescuer_id = auth.uid() and status in ('accepted', 'en_route', 'on_scene')
  ) then
    raise exception using errcode = '23514', message = 'Finish or hand off the active mission before going available';
  end if;

  insert into public.rescuer_presence (
    rescuer_id, availability, latitude, longitude, location_updated_at, updated_at
  ) values (
    auth.uid(), p_availability, p_latitude, p_longitude,
    case when p_latitude is null then null else now() end, now()
  )
  on conflict (rescuer_id) do update set
    availability = excluded.availability,
    latitude = coalesce(excluded.latitude, public.rescuer_presence.latitude),
    longitude = coalesce(excluded.longitude, public.rescuer_presence.longitude),
    location_updated_at = case when excluded.latitude is null
      then public.rescuer_presence.location_updated_at else now() end,
    updated_at = now();
end;
$$;


ALTER FUNCTION "public"."set_rescuer_presence"("p_availability" "text", "p_latitude" double precision, "p_longitude" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_victim_destination"("p_sos_report_id" "uuid", "p_status" "text", "p_shelter_name" "text", "p_notes" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."sync_victim_destination"("p_sos_report_id" "uuid", "p_status" "text", "p_shelter_name" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_post_shelter_followup_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_post_shelter_followup_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_shelter_capacity"("p_shelter_id" "uuid", "p_capacity" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."update_shelter_capacity"("p_shelter_id" "uuid", "p_capacity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."write_operation_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."write_operation_audit"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."access_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role" "text" NOT NULL,
    "code" "text" NOT NULL,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "access_codes_role_check" CHECK (("role" = ANY (ARRAY['rescuer'::"text", 'shelter_staff'::"text"])))
);


ALTER TABLE "public"."access_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "rescuer_id" "uuid" NOT NULL,
    "notes" "text",
    "accepted_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "status" "public"."assignment_status" DEFAULT 'accepted'::"public"."assignment_status" NOT NULL,
    "cannot_reach_reason" "text",
    "arrival_gps_stale_notified_at" timestamp with time zone,
    CONSTRAINT "assignments_cannot_reach_reason_check" CHECK (("cannot_reach_reason" = ANY (ARRAY['no_access'::"text", 'deceased'::"text"]))),
    CONSTRAINT "assignments_status_check" CHECK (("status" = ANY (ARRAY['offered'::"public"."assignment_status", 'accepted'::"public"."assignment_status", 'en_route'::"public"."assignment_status", 'on_scene'::"public"."assignment_status", 'completed'::"public"."assignment_status", 'cannot_reach'::"public"."assignment_status", 'declined'::"public"."assignment_status", 'expired'::"public"."assignment_status"])))
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."damage_report_status_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "damage_report_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "old_status" "text" NOT NULL,
    "new_status" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."damage_report_status_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."damage_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid",
    "full_name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "province" "text" NOT NULL,
    "district" "text" NOT NULL,
    "sub_district" "text" NOT NULL,
    "address_details" "text",
    "damage_type" "text",
    "damage_value" numeric,
    "description" "text",
    "image_urls" "text"[] DEFAULT '{}'::"text"[],
    "home_status" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "incident_date" "date",
    "id_card_number" "text",
    "id_card_image_url" "text",
    "victim_confirmed" boolean DEFAULT false,
    "victim_confirmed_at" timestamp with time zone,
    "claim_category" "text",
    "housing_tenure" "text",
    "property_address_key" "text",
    "farmer_registered_before_disaster" boolean,
    "farmer_registration_number" "text",
    "agriculture_damage_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "crop_area_rai" numeric,
    "fishery_area_rai" numeric,
    "livestock_count" integer,
    "bank_book_image_url" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "house_number" "text",
    "village_no" "text",
    "soi" "text",
    "postal_code" "text",
    "damage_end_date" "date",
    "damage_duration_days" integer,
    "registered_resident" boolean DEFAULT false NOT NULL,
    "rental_agreement_image_url" "text",
    "house_registration_image_url" "text",
    CONSTRAINT "damage_reports_agriculture_values_check" CHECK (((("crop_area_rai" IS NULL) OR ("crop_area_rai" >= (0)::numeric)) AND (("fishery_area_rai" IS NULL) OR ("fishery_area_rai" >= (0)::numeric)) AND (("livestock_count" IS NULL) OR ("livestock_count" >= 0)))),
    CONSTRAINT "damage_reports_claim_category_check" CHECK ((("claim_category" IS NULL) OR ("claim_category" = ANY (ARRAY['housing_property'::"text", 'agriculture_livelihood'::"text"])))),
    CONSTRAINT "damage_reports_damage_type_check" CHECK (("damage_type" = ANY (ARRAY['housing'::"text", 'vehicle'::"text", 'agriculture'::"text", 'property'::"text", 'other'::"text"]))),
    CONSTRAINT "damage_reports_home_status_check" CHECK (("home_status" = ANY (ARRAY['returned'::"text", 'temporary_shelter'::"text", 'cannot_return'::"text"]))),
    CONSTRAINT "damage_reports_housing_tenure_check" CHECK ((("housing_tenure" IS NULL) OR ("housing_tenure" = ANY (ARRAY['owner'::"text", 'renter'::"text", 'other_person'::"text"])))),
    CONSTRAINT "damage_reports_image_limit_check" CHECK (("cardinality"(COALESCE("image_urls", '{}'::"text"[])) <= 8)),
    CONSTRAINT "damage_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."damage_reports" OWNER TO "postgres";


COMMENT ON COLUMN "public"."damage_reports"."claim_category" IS 'housing_property=ที่อยู่อาศัยและทรัพย์สิน, agriculture_livelihood=เกษตร ประมง ปศุสัตว์';



COMMENT ON COLUMN "public"."damage_reports"."property_address_key" IS 'ที่อยู่ปรับรูปแบบสำหรับป้องกันบ้านหลังเดียวถูกยื่นซ้ำ';



COMMENT ON COLUMN "public"."damage_reports"."registered_resident" IS 'ผู้ยื่นยืนยันว่ามีชื่อในทะเบียนบ้านของที่อยู่อาศัยที่ยื่นคำร้อง';



CREATE TABLE IF NOT EXISTS "public"."death_case_confirmations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "reported_by" "uuid",
    "reported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reported_note" "text",
    "evidence_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "review_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "death_case_confirmations_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'confirmed'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."death_case_confirmations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_outbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "target_url" "text" DEFAULT '/officer/dashboard'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text"
);


ALTER TABLE "public"."notification_outbox" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."operation_audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "actor_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "before_data" "jsonb",
    "after_data" "jsonb"
);


ALTER TABLE "public"."operation_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_shelter_followups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid",
    "shelter_occupant_id" "uuid",
    "shelter_id" "uuid",
    "round_no" integer DEFAULT 1 NOT NULL,
    "household_name" "text" NOT NULL,
    "contact_phone" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "due_at" timestamp with time zone DEFAULT ("now"() + '1 day'::interval) NOT NULL,
    "contacted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "arrived_home" boolean,
    "home_habitable" boolean,
    "water_available" boolean,
    "electricity_available" boolean,
    "toilet_usable" boolean,
    "access_route_safe" boolean,
    "has_injured_person" boolean,
    "has_vulnerable_person" boolean,
    "needs_food" boolean,
    "needs_medicine" boolean,
    "needs_temporary_shelter" boolean,
    "needs_rescue_followup" boolean,
    "damage_description" "text",
    "image_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "notes" "text",
    "submitted_by_type" "text" DEFAULT 'system'::"text" NOT NULL,
    "submitted_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "post_shelter_followups_damage_description_length_check" CHECK ((("damage_description" IS NULL) OR ("char_length"("damage_description") <= 2000))),
    CONSTRAINT "post_shelter_followups_has_source_check" CHECK ((("sos_report_id" IS NOT NULL) OR ("shelter_occupant_id" IS NOT NULL))),
    CONSTRAINT "post_shelter_followups_image_limit_check" CHECK (("cardinality"("image_urls") <= 6)),
    CONSTRAINT "post_shelter_followups_notes_length_check" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 2000))),
    CONSTRAINT "post_shelter_followups_round_no_check" CHECK (("round_no" >= 1)),
    CONSTRAINT "post_shelter_followups_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'contacted'::"text", 'completed'::"text", 'needs_assistance'::"text", 'closed'::"text"]))),
    CONSTRAINT "post_shelter_followups_submitted_by_type_check" CHECK (("submitted_by_type" = ANY (ARRAY['system'::"text", 'victim'::"text", 'shelter_staff'::"text", 'rescuer'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."post_shelter_followups" OWNER TO "postgres";


COMMENT ON TABLE "public"."post_shelter_followups" IS 'ประวัติการติดตามความปลอดภัยและสภาพความเป็นอยู่หลังออกจากศูนย์พักพิง';



COMMENT ON COLUMN "public"."post_shelter_followups"."round_no" IS 'ลำดับการติดตามของรายการผู้พักพิงเดียวกัน รองรับการติดตามซ้ำ';



COMMENT ON COLUMN "public"."post_shelter_followups"."status" IS 'pending=รอติดตาม, contacted=ติดต่อแล้วแต่ข้อมูลยังไม่ครบ, completed=ปลอดภัย, needs_assistance=ต้องช่วยต่อ, closed=ปิดรายการ';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "role" "text" DEFAULT 'rescuer'::"text",
    "agency" "text",
    "is_active" boolean DEFAULT true,
    "current_lat" double precision,
    "current_lng" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "shelter_id" "uuid",
    "email" "text",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['rescuer'::"text", 'shelter_staff'::"text", 'admin'::"text", 'gov'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."email" IS 'สำเนาอีเมลจาก auth.users สำหรับแสดงและค้นหารายชื่อเจ้าหน้าที่';



CREATE TABLE IF NOT EXISTS "public"."rescue_delivery_manifests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "assignment_id" "uuid",
    "rescuer_id" "uuid" NOT NULL,
    "primary_destination_type" "text" NOT NULL,
    "shelter_id" "uuid",
    "requested_adult_count" integer DEFAULT 0 NOT NULL,
    "requested_child_count" integer DEFAULT 0 NOT NULL,
    "requested_elder_count" integer DEFAULT 0 NOT NULL,
    "accounted_total" integer NOT NULL,
    "primary_destination_total" integer NOT NULL,
    "hospital_total" integer DEFAULT 0 NOT NULL,
    "count_discrepancy_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deceased_total" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "rescue_delivery_manifests_accounted_total_check" CHECK (("accounted_total" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_deceased_total_check" CHECK (("deceased_total" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_hospital_total_check" CHECK (("hospital_total" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_primary_destination_total_check" CHECK (("primary_destination_total" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_primary_destination_type_check" CHECK (("primary_destination_type" = ANY (ARRAY['shelter'::"text", 'relative_home'::"text", 'hotel'::"text", 'other_safe'::"text"]))),
    CONSTRAINT "rescue_delivery_manifests_requested_adult_count_check" CHECK (("requested_adult_count" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_requested_child_count_check" CHECK (("requested_child_count" >= 0)),
    CONSTRAINT "rescue_delivery_manifests_requested_elder_count_check" CHECK (("requested_elder_count" >= 0))
);


ALTER TABLE "public"."rescue_delivery_manifests" OWNER TO "postgres";


COMMENT ON TABLE "public"."rescue_delivery_manifests" IS 'หัวรายการนำส่ง ใช้กระทบยอดจำนวนคนใน SOS กับคนที่ไปถึงปลายทางและโรงพยาบาล';



COMMENT ON COLUMN "public"."rescue_delivery_manifests"."deceased_total" IS 'จำนวนผู้เสียชีวิตในเหตุการณ์นี้ที่ถูกบันทึกแบบรายบุคคล';



CREATE TABLE IF NOT EXISTS "public"."rescue_delivery_people" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "manifest_id" "uuid" NOT NULL,
    "sequence_no" integer NOT NULL,
    "full_name" "text" NOT NULL,
    "age_group" "text" NOT NULL,
    "is_primary_destination" boolean DEFAULT false NOT NULL,
    "destination_type" "text" NOT NULL,
    "destination_name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "identity_status" "text" DEFAULT 'reported_name'::"text" NOT NULL,
    "reference_code" "text",
    "handoff_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "departed_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "received_by" "text",
    CONSTRAINT "rescue_delivery_people_age_group_check" CHECK (("age_group" = ANY (ARRAY['adult'::"text", 'child'::"text", 'elder'::"text"]))),
    CONSTRAINT "rescue_delivery_people_destination_type_check" CHECK (("destination_type" = ANY (ARRAY['shelter'::"text", 'hospital'::"text", 'deceased'::"text", 'relative_home'::"text", 'hotel'::"text", 'other_safe'::"text"]))),
    CONSTRAINT "rescue_delivery_people_full_name_check" CHECK (("char_length"("btrim"("full_name")) > 0)),
    CONSTRAINT "rescue_delivery_people_handoff_status_check" CHECK (("handoff_status" = ANY (ARRAY['not_required'::"text", 'pending_receipt'::"text", 'received'::"text"]))),
    CONSTRAINT "rescue_delivery_people_identity_status_check" CHECK (("identity_status" = ANY (ARRAY['reported_name'::"text", 'temporary'::"text"]))),
    CONSTRAINT "rescue_delivery_people_sequence_no_check" CHECK (("sequence_no" > 0))
);


ALTER TABLE "public"."rescue_delivery_people" OWNER TO "postgres";


COMMENT ON TABLE "public"."rescue_delivery_people" IS 'บัญชีรายชื่อรายบุคคลของการนำส่ง พร้อมกลุ่มอายุและปลายทางจริง';



COMMENT ON COLUMN "public"."rescue_delivery_people"."identity_status" IS 'reported_name = ทราบชื่อ/ข้อมูลอ้างอิง, temporary = ระบบสร้างชื่อและรหัสชั่วคราว';



COMMENT ON COLUMN "public"."rescue_delivery_people"."reference_code" IS 'รหัสติดตามบุคคลภายในภารกิจ เช่น P01 โดยไม่ต้องทราบชื่อจริง';



COMMENT ON COLUMN "public"."rescue_delivery_people"."handoff_status" IS 'สถานะการส่งมอบโรงพยาบาล: pending_receipt รอยืนยันรับ, received รับแล้ว';



CREATE TABLE IF NOT EXISTS "public"."rescue_dispatch_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "rescuer_id" "uuid" NOT NULL,
    "attempt_no" integer NOT NULL,
    "status" "text" NOT NULL,
    "offered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "respond_by" timestamp with time zone NOT NULL,
    "responded_at" timestamp with time zone,
    "estimated_arrival_minutes" integer,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_radius_km" integer,
    CONSTRAINT "rescue_dispatch_attempts_status_check" CHECK (("status" = ANY (ARRAY['offered'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text", 'handed_off'::"text"])))
);


ALTER TABLE "public"."rescue_dispatch_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rescue_dispatch_searches" (
    "sos_report_id" "uuid" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rescue_dispatch_searches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rescuer_presence" (
    "rescuer_id" "uuid" NOT NULL,
    "availability" "text" DEFAULT 'offline'::"text" NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "location_updated_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rescuer_presence_availability_check" CHECK (("availability" = ANY (ARRAY['available'::"text", 'busy'::"text", 'offline'::"text"]))),
    CONSTRAINT "rescuer_presence_latitude_check" CHECK ((("latitude" IS NULL) OR (("latitude" >= ('-90'::integer)::double precision) AND ("latitude" <= (90)::double precision)))),
    CONSTRAINT "rescuer_presence_longitude_check" CHECK ((("longitude" IS NULL) OR (("longitude" >= ('-180'::integer)::double precision) AND ("longitude" <= (180)::double precision))))
);


ALTER TABLE "public"."rescuer_presence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rescuer_service_areas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rescuer_id" "uuid" NOT NULL,
    "province" "text" NOT NULL,
    "district" "text",
    "is_mutual_aid" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rescuer_service_areas_province_check" CHECK (("char_length"("btrim"("province")) > 0))
);


ALTER TABLE "public"."rescuer_service_areas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shelter_occupant_name_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shelter_id" "uuid" NOT NULL,
    "occupant_id" "uuid" NOT NULL,
    "delivery_person_id" "uuid",
    "previous_full_name" "text" NOT NULL,
    "next_full_name" "text" NOT NULL,
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shelter_occupant_name_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shelter_occupants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shelter_id" "uuid" NOT NULL,
    "sos_report_id" "uuid",
    "full_name" "text" NOT NULL,
    "phone" "text",
    "adult_count" integer DEFAULT 1,
    "child_count" integer DEFAULT 0,
    "elder_count" integer DEFAULT 0,
    "entry_source" "text" NOT NULL,
    "registered_by" "uuid",
    "status" "text" DEFAULT 'in_shelter'::"text",
    "entry_date" timestamp with time zone DEFAULT "now"(),
    "exit_date" timestamp with time zone,
    "exit_destination" "text",
    "exit_note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "exit_recorded_by" "uuid",
    "delivery_person_id" "uuid",
    CONSTRAINT "shelter_occupants_entry_source_check" CHECK (("entry_source" = ANY (ARRAY['rescuer'::"text", 'self_registered'::"text"]))),
    CONSTRAINT "shelter_occupants_exit_destination_check" CHECK (("exit_destination" = ANY (ARRAY['home'::"text", 'relative_home'::"text", 'other_shelter'::"text", 'other'::"text"]))),
    CONSTRAINT "shelter_occupants_status_check" CHECK (("status" = ANY (ARRAY['in_shelter'::"text", 'exited'::"text"])))
);


ALTER TABLE "public"."shelter_occupants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."shelter_occupants"."exit_recorded_by" IS 'เจ้าหน้าที่ที่ยืนยันการออกจากศูนย์ผ่าน confirm_shelter_exit';



COMMENT ON COLUMN "public"."shelter_occupants"."delivery_person_id" IS 'เชื่อมผู้พักพิงรายบุคคลกับรายชื่อที่กู้ภัยนำส่ง เพื่อให้ศูนย์แก้ชื่อและจัดการเป็นคำร้องได้';



CREATE TABLE IF NOT EXISTS "public"."shelter_request_exit_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "shelter_id" "uuid" NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "exit_destination" "text" NOT NULL,
    "exit_at" timestamp with time zone NOT NULL,
    "exit_note" "text",
    "exited_count" integer NOT NULL,
    "recorded_by" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "shelter_request_exit_audit_exit_destination_check" CHECK (("exit_destination" = ANY (ARRAY['home'::"text", 'relative_home'::"text", 'other_shelter'::"text", 'other'::"text"]))),
    CONSTRAINT "shelter_request_exit_audit_exited_count_check" CHECK (("exited_count" > 0))
);


ALTER TABLE "public"."shelter_request_exit_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shelter_self_registration_requests" (
    "request_key" "uuid" NOT NULL,
    "shelter_id" "uuid" NOT NULL,
    "occupant_id" "uuid",
    "registered_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shelter_self_registration_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shelters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "province" "text",
    "lat" double precision,
    "lng" double precision,
    "capacity" integer DEFAULT 0,
    "current_occupancy" integer DEFAULT 0,
    "contact_phone" "text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shelters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sos_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "province" "text" NOT NULL,
    "district" "text" NOT NULL,
    "sub_district" "text" NOT NULL,
    "address_details" "text",
    "lat" double precision,
    "lng" double precision,
    "adult_count" integer DEFAULT 0,
    "child_count" integer DEFAULT 0,
    "elder_count" integer DEFAULT 0,
    "urgency_level" "text" DEFAULT 'medium'::"text",
    "water_level" integer DEFAULT 1,
    "special_needs" "text",
    "needed_items" "text"[],
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "client_request_id" "uuid",
    CONSTRAINT "sos_reports_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'assigned'::"text", 'rescued'::"text", 'cannot_reach'::"text", 'closed'::"text"]))),
    CONSTRAINT "sos_reports_urgency_level_check" CHECK (("urgency_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "sos_reports_water_level_check" CHECK ((("water_level" >= 1) AND ("water_level" <= 5)))
);


ALTER TABLE "public"."sos_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "role" "text" NOT NULL,
    "shelter_id" "uuid",
    "invited_by" "uuid",
    "used" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "staff_invites_role_check" CHECK (("role" = ANY (ARRAY['rescuer'::"text", 'shelter_staff'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."staff_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."staff_role_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "requested_role" "text" DEFAULT 'shelter_staff'::"text" NOT NULL,
    "requested_shelter_id" "uuid" NOT NULL,
    "agency" "text",
    "note" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "staff_role_requests_requested_role_check" CHECK (("requested_role" = 'shelter_staff'::"text")),
    CONSTRAINT "staff_role_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."staff_role_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thai_address_districts" (
    "id" integer NOT NULL,
    "province_id" integer NOT NULL,
    "name_th" "text" NOT NULL,
    "name_en" "text"
);


ALTER TABLE "public"."thai_address_districts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thai_address_provinces" (
    "id" integer NOT NULL,
    "name_th" "text" NOT NULL,
    "name_en" "text"
);


ALTER TABLE "public"."thai_address_provinces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thai_address_subdistricts" (
    "id" integer NOT NULL,
    "district_id" integer NOT NULL,
    "name_th" "text" NOT NULL,
    "name_en" "text",
    "zip_code" "text",
    "latitude" double precision,
    "longitude" double precision
);


ALTER TABLE "public"."thai_address_subdistricts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."thai_address_directory" WITH ("security_invoker"='true') AS
 SELECT "province"."name_th" AS "province",
    "district"."name_th" AS "district",
    "subdistrict"."name_th" AS "sub_district",
    "subdistrict"."zip_code",
    "subdistrict"."latitude",
    "subdistrict"."longitude"
   FROM (("public"."thai_address_subdistricts" "subdistrict"
     JOIN "public"."thai_address_districts" "district" ON (("district"."id" = "subdistrict"."district_id")))
     JOIN "public"."thai_address_provinces" "province" ON (("province"."id" = "district"."province_id")));


ALTER VIEW "public"."thai_address_directory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thai_address_sync_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "source" "text" NOT NULL,
    "status" "text" NOT NULL,
    "province_count" integer DEFAULT 0 NOT NULL,
    "district_count" integer DEFAULT 0 NOT NULL,
    "subdistrict_count" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    CONSTRAINT "thai_address_sync_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."thai_address_sync_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."victim_status" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sos_report_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text",
    "shelter_name" "text",
    "notes" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "victim_status_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'rescue_assigned'::"text", 'rescued'::"text", 'at_shelter'::"text", 'returned_home'::"text", 'unknown'::"text", 'deceased'::"text"])))
);


ALTER TABLE "public"."victim_status" OWNER TO "postgres";


ALTER TABLE ONLY "public"."access_codes"
    ADD CONSTRAINT "access_codes_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."access_codes"
    ADD CONSTRAINT "access_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."damage_report_status_audit"
    ADD CONSTRAINT "damage_report_status_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_damage_end_date_check" CHECK ((("damage_end_date" IS NULL) OR ("incident_date" IS NULL) OR ("damage_end_date" >= "incident_date"))) NOT VALID;



ALTER TABLE "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_damage_period_check" CHECK ((("damage_duration_days" IS NULL) OR ("damage_duration_days" >= 1))) NOT VALID;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_postal_code_check" CHECK ((("postal_code" IS NULL) OR ("postal_code" ~ '^[0-9]{5}$'::"text"))) NOT VALID;



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_sos_report_id_key" UNIQUE ("sos_report_id");



ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_subscriptions"
    ADD CONSTRAINT "notification_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."notification_subscriptions"
    ADD CONSTRAINT "notification_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."operation_audit_logs"
    ADD CONSTRAINT "operation_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_round_unique" UNIQUE ("shelter_occupant_id", "round_no");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_sos_report_id_key" UNIQUE ("sos_report_id");



ALTER TABLE ONLY "public"."rescue_delivery_people"
    ADD CONSTRAINT "rescue_delivery_people_manifest_id_sequence_no_key" UNIQUE ("manifest_id", "sequence_no");



ALTER TABLE ONLY "public"."rescue_delivery_people"
    ADD CONSTRAINT "rescue_delivery_people_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_assignment_id_key" UNIQUE ("assignment_id");



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_sos_report_id_attempt_no_key" UNIQUE ("sos_report_id", "attempt_no");



ALTER TABLE ONLY "public"."rescue_dispatch_searches"
    ADD CONSTRAINT "rescue_dispatch_searches_pkey" PRIMARY KEY ("sos_report_id");



ALTER TABLE ONLY "public"."rescuer_presence"
    ADD CONSTRAINT "rescuer_presence_pkey" PRIMARY KEY ("rescuer_id");



ALTER TABLE ONLY "public"."rescuer_service_areas"
    ADD CONSTRAINT "rescuer_service_areas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shelter_occupant_name_audit"
    ADD CONSTRAINT "shelter_occupant_name_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shelter_request_exit_audit"
    ADD CONSTRAINT "shelter_request_exit_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shelter_self_registration_requests"
    ADD CONSTRAINT "shelter_self_registration_requests_pkey" PRIMARY KEY ("request_key");



ALTER TABLE "public"."shelters"
    ADD CONSTRAINT "shelters_capacity_must_be_positive" CHECK ((COALESCE("capacity", 0) > 0)) NOT VALID;



ALTER TABLE ONLY "public"."shelters"
    ADD CONSTRAINT "shelters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sos_reports"
    ADD CONSTRAINT "sos_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_role_requests"
    ADD CONSTRAINT "staff_role_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."thai_address_districts"
    ADD CONSTRAINT "thai_address_districts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."thai_address_districts"
    ADD CONSTRAINT "thai_address_districts_province_id_name_th_key" UNIQUE ("province_id", "name_th");



ALTER TABLE ONLY "public"."thai_address_provinces"
    ADD CONSTRAINT "thai_address_provinces_name_th_key" UNIQUE ("name_th");



ALTER TABLE ONLY "public"."thai_address_provinces"
    ADD CONSTRAINT "thai_address_provinces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."thai_address_subdistricts"
    ADD CONSTRAINT "thai_address_subdistricts_district_id_name_th_key" UNIQUE ("district_id", "name_th");



ALTER TABLE ONLY "public"."thai_address_subdistricts"
    ADD CONSTRAINT "thai_address_subdistricts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."thai_address_sync_runs"
    ADD CONSTRAINT "thai_address_sync_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."victim_status"
    ADD CONSTRAINT "victim_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."victim_status"
    ADD CONSTRAINT "victim_status_sos_report_id_key" UNIQUE ("sos_report_id");



CREATE UNIQUE INDEX "assignments_one_open_case_idx" ON "public"."assignments" USING "btree" ("sos_report_id") WHERE ("status" = ANY (ARRAY['offered'::"public"."assignment_status", 'accepted'::"public"."assignment_status", 'en_route'::"public"."assignment_status", 'on_scene'::"public"."assignment_status"]));



CREATE INDEX "assignments_rescuer_id_idx" ON "public"."assignments" USING "btree" ("rescuer_id");



CREATE INDEX "assignments_sos_report_id_idx" ON "public"."assignments" USING "btree" ("sos_report_id");



CREATE INDEX "damage_report_status_audit_report_created_idx" ON "public"."damage_report_status_audit" USING "btree" ("damage_report_id", "created_at" DESC);



CREATE UNIQUE INDEX "damage_reports_person_category_unique" ON "public"."damage_reports" USING "btree" ("id_card_number", "claim_category") WHERE (("claim_category" IS NOT NULL) AND ("id_card_number" IS NOT NULL));



CREATE UNIQUE INDEX "damage_reports_property_address_unique" ON "public"."damage_reports" USING "btree" ("property_address_key") WHERE (("claim_category" = 'housing_property'::"text") AND ("property_address_key" IS NOT NULL));



CREATE INDEX "damage_reports_sos_category_idx" ON "public"."damage_reports" USING "btree" ("sos_report_id", "claim_category", "created_at" DESC) WHERE ("sos_report_id" IS NOT NULL);



CREATE INDEX "damage_reports_sos_report_id_idx" ON "public"."damage_reports" USING "btree" ("sos_report_id") WHERE ("sos_report_id" IS NOT NULL);



CREATE INDEX "damage_reports_structured_address_idx" ON "public"."damage_reports" USING "btree" ("province", "district", "sub_district", "house_number", "postal_code") WHERE ("claim_category" = 'housing_property'::"text");



CREATE INDEX "death_case_confirmations_status_created_idx" ON "public"."death_case_confirmations" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "notification_outbox_pending_idx" ON "public"."notification_outbox" USING "btree" ("created_at") WHERE ("sent_at" IS NULL);



CREATE INDEX "notification_subscriptions_profile_idx" ON "public"."notification_subscriptions" USING "btree" ("profile_id");



CREATE INDEX "operation_audit_logs_actor_created_idx" ON "public"."operation_audit_logs" USING "btree" ("actor_id", "created_at" DESC);



CREATE INDEX "operation_audit_logs_entity_created_idx" ON "public"."operation_audit_logs" USING "btree" ("entity_type", "entity_id", "created_at" DESC);



CREATE INDEX "post_shelter_followups_phone_idx" ON "public"."post_shelter_followups" USING "btree" ("contact_phone") WHERE ("contact_phone" IS NOT NULL);



CREATE INDEX "post_shelter_followups_shelter_idx" ON "public"."post_shelter_followups" USING "btree" ("shelter_id", "created_at" DESC);



CREATE INDEX "post_shelter_followups_sos_idx" ON "public"."post_shelter_followups" USING "btree" ("sos_report_id", "created_at" DESC);



CREATE INDEX "post_shelter_followups_status_due_idx" ON "public"."post_shelter_followups" USING "btree" ("status", "due_at");



CREATE UNIQUE INDEX "profiles_email_unique_idx" ON "public"."profiles" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "rescue_delivery_manifests_shelter_idx" ON "public"."rescue_delivery_manifests" USING "btree" ("shelter_id", "created_at" DESC);



CREATE INDEX "rescue_delivery_people_manifest_idx" ON "public"."rescue_delivery_people" USING "btree" ("manifest_id", "sequence_no");



CREATE INDEX "rescue_delivery_people_pending_handoff_idx" ON "public"."rescue_delivery_people" USING "btree" ("destination_type", "handoff_status") WHERE ("destination_type" = 'hospital'::"text");



CREATE INDEX "rescue_delivery_people_reference_code_idx" ON "public"."rescue_delivery_people" USING "btree" ("manifest_id", "reference_code");



CREATE INDEX "rescue_dispatch_attempts_case_idx" ON "public"."rescue_dispatch_attempts" USING "btree" ("sos_report_id", "offered_at" DESC);



CREATE INDEX "rescue_dispatch_attempts_rescuer_idx" ON "public"."rescue_dispatch_attempts" USING "btree" ("rescuer_id", "status", "offered_at" DESC);



CREATE INDEX "rescuer_presence_available_idx" ON "public"."rescuer_presence" USING "btree" ("location_updated_at" DESC) WHERE ("availability" = 'available'::"text");



CREATE INDEX "rescuer_service_areas_coverage_idx" ON "public"."rescuer_service_areas" USING "btree" ("province", "district", "rescuer_id");



CREATE INDEX "rescuer_service_areas_unique_coverage_idx" ON "public"."rescuer_service_areas" USING "btree" ("rescuer_id", "province", COALESCE("district", ''::"text"));



CREATE INDEX "shelter_occupant_name_audit_occupant_idx" ON "public"."shelter_occupant_name_audit" USING "btree" ("occupant_id", "changed_at" DESC);



CREATE UNIQUE INDEX "shelter_occupants_delivery_person_unique" ON "public"."shelter_occupants" USING "btree" ("delivery_person_id") WHERE ("delivery_person_id" IS NOT NULL);



CREATE INDEX "shelter_occupants_shelter_status_idx" ON "public"."shelter_occupants" USING "btree" ("shelter_id", "status");



CREATE INDEX "shelter_occupants_sos_report_idx" ON "public"."shelter_occupants" USING "btree" ("shelter_id", "sos_report_id", "status");



CREATE INDEX "shelter_request_exit_audit_request_idx" ON "public"."shelter_request_exit_audit" USING "btree" ("shelter_id", "sos_report_id", "recorded_at" DESC);



CREATE INDEX "shelter_self_registration_requests_shelter_idx" ON "public"."shelter_self_registration_requests" USING "btree" ("shelter_id", "created_at" DESC);



CREATE UNIQUE INDEX "sos_reports_client_request_id_unique" ON "public"."sos_reports" USING "btree" ("client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "thai_address_districts_province_idx" ON "public"."thai_address_districts" USING "btree" ("province_id");



CREATE INDEX "thai_address_subdistricts_district_idx" ON "public"."thai_address_subdistricts" USING "btree" ("district_id");



CREATE OR REPLACE TRIGGER "auto_dispatch_on_sos_change" AFTER INSERT OR UPDATE OF "status" ON "public"."sos_reports" FOR EACH ROW EXECUTE FUNCTION "public"."auto_dispatch_on_case_change"();



CREATE OR REPLACE TRIGGER "create_death_confirmation_after_outcome" AFTER INSERT OR UPDATE OF "status", "cannot_reach_reason" ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."create_death_confirmation"();



CREATE OR REPLACE TRIGGER "enqueue_assignment_notification_after_insert" AFTER INSERT ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_assignment_notification"();



CREATE OR REPLACE TRIGGER "enqueue_death_review_notification_after_insert" AFTER INSERT ON "public"."death_case_confirmations" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_death_review_notification"();



CREATE OR REPLACE TRIGGER "enqueue_sos_created_notification_after_insert" AFTER INSERT ON "public"."sos_reports" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_sos_created_notification"();



CREATE OR REPLACE TRIGGER "link_shelter_occupant_to_delivery_person_trigger" BEFORE INSERT ON "public"."shelter_occupants" FOR EACH ROW EXECUTE FUNCTION "public"."link_shelter_occupant_to_delivery_person"();



CREATE OR REPLACE TRIGGER "mark_rescuer_offline_after_assignment" AFTER UPDATE OF "status" ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."mark_rescuer_offline_after_assignment"();



CREATE OR REPLACE TRIGGER "operation_audit_assignments" AFTER INSERT OR UPDATE OF "status", "cannot_reach_reason", "completed_at" ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."write_operation_audit"();



CREATE OR REPLACE TRIGGER "operation_audit_sos_reports" AFTER INSERT OR UPDATE OF "status" ON "public"."sos_reports" FOR EACH ROW EXECUTE FUNCTION "public"."write_operation_audit"();



CREATE OR REPLACE TRIGGER "operation_audit_victim_status" AFTER INSERT OR UPDATE OF "status", "shelter_name" ON "public"."victim_status" FOR EACH ROW EXECUTE FUNCTION "public"."write_operation_audit"();



CREATE OR REPLACE TRIGGER "prepare_compensation_claim_trigger" BEFORE INSERT OR UPDATE ON "public"."damage_reports" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_compensation_claim"();



CREATE OR REPLACE TRIGGER "prepare_compensation_structured_fields_trigger" BEFORE INSERT OR UPDATE ON "public"."damage_reports" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_compensation_structured_fields"();



CREATE OR REPLACE TRIGGER "prepare_rescue_delivery_person_trigger" BEFORE INSERT OR UPDATE ON "public"."rescue_delivery_people" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_rescue_delivery_person"();



CREATE OR REPLACE TRIGGER "schedule_post_shelter_followup_on_home_exit_trigger" AFTER UPDATE OF "status", "exit_destination" ON "public"."shelter_occupants" FOR EACH ROW EXECUTE FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"();



CREATE OR REPLACE TRIGGER "touch_post_shelter_followup_updated_at_trigger" BEFORE UPDATE ON "public"."post_shelter_followups" FOR EACH ROW EXECUTE FUNCTION "public"."touch_post_shelter_followup_updated_at"();



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_rescuer_id_fkey" FOREIGN KEY ("rescuer_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id");



ALTER TABLE ONLY "public"."damage_report_status_audit"
    ADD CONSTRAINT "damage_report_status_audit_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."damage_report_status_audit"
    ADD CONSTRAINT "damage_report_status_audit_damage_report_id_fkey" FOREIGN KEY ("damage_report_id") REFERENCES "public"."damage_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."damage_reports"
    ADD CONSTRAINT "damage_reports_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id");



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."death_case_confirmations"
    ADD CONSTRAINT "death_case_confirmations_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_outbox"
    ADD CONSTRAINT "notification_outbox_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_subscriptions"
    ADD CONSTRAINT "notification_subscriptions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."operation_audit_logs"
    ADD CONSTRAINT "operation_audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_shelter_occupant_id_fkey" FOREIGN KEY ("shelter_occupant_id") REFERENCES "public"."shelter_occupants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_shelter_followups"
    ADD CONSTRAINT "post_shelter_followups_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id");



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_rescuer_id_fkey" FOREIGN KEY ("rescuer_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."rescue_delivery_manifests"
    ADD CONSTRAINT "rescue_delivery_manifests_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rescue_delivery_people"
    ADD CONSTRAINT "rescue_delivery_people_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "public"."rescue_delivery_manifests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_rescuer_id_fkey" FOREIGN KEY ("rescuer_id") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."rescue_dispatch_attempts"
    ADD CONSTRAINT "rescue_dispatch_attempts_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rescue_dispatch_searches"
    ADD CONSTRAINT "rescue_dispatch_searches_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rescuer_presence"
    ADD CONSTRAINT "rescuer_presence_rescuer_id_fkey" FOREIGN KEY ("rescuer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rescuer_service_areas"
    ADD CONSTRAINT "rescuer_service_areas_rescuer_id_fkey" FOREIGN KEY ("rescuer_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shelter_occupant_name_audit"
    ADD CONSTRAINT "shelter_occupant_name_audit_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_occupant_name_audit"
    ADD CONSTRAINT "shelter_occupant_name_audit_delivery_person_id_fkey" FOREIGN KEY ("delivery_person_id") REFERENCES "public"."rescue_delivery_people"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_occupant_name_audit"
    ADD CONSTRAINT "shelter_occupant_name_audit_occupant_id_fkey" FOREIGN KEY ("occupant_id") REFERENCES "public"."shelter_occupants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shelter_occupant_name_audit"
    ADD CONSTRAINT "shelter_occupant_name_audit_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_delivery_person_id_fkey" FOREIGN KEY ("delivery_person_id") REFERENCES "public"."rescue_delivery_people"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_exit_recorded_by_fkey" FOREIGN KEY ("exit_recorded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id");



ALTER TABLE ONLY "public"."shelter_occupants"
    ADD CONSTRAINT "shelter_occupants_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id");



ALTER TABLE ONLY "public"."shelter_request_exit_audit"
    ADD CONSTRAINT "shelter_request_exit_audit_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_request_exit_audit"
    ADD CONSTRAINT "shelter_request_exit_audit_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shelter_request_exit_audit"
    ADD CONSTRAINT "shelter_request_exit_audit_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shelter_self_registration_requests"
    ADD CONSTRAINT "shelter_self_registration_requests_occupant_id_fkey" FOREIGN KEY ("occupant_id") REFERENCES "public"."shelter_occupants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shelter_self_registration_requests"
    ADD CONSTRAINT "shelter_self_registration_requests_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shelter_self_registration_requests"
    ADD CONSTRAINT "shelter_self_registration_requests_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_invites"
    ADD CONSTRAINT "staff_invites_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "public"."shelters"("id");



ALTER TABLE ONLY "public"."staff_role_requests"
    ADD CONSTRAINT "staff_role_requests_requested_shelter_id_fkey" FOREIGN KEY ("requested_shelter_id") REFERENCES "public"."shelters"("id");



ALTER TABLE ONLY "public"."staff_role_requests"
    ADD CONSTRAINT "staff_role_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."staff_role_requests"
    ADD CONSTRAINT "staff_role_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."thai_address_districts"
    ADD CONSTRAINT "thai_address_districts_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "public"."thai_address_provinces"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."thai_address_subdistricts"
    ADD CONSTRAINT "thai_address_subdistricts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "public"."thai_address_districts"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."victim_status"
    ADD CONSTRAINT "victim_status_sos_report_id_fkey" FOREIGN KEY ("sos_report_id") REFERENCES "public"."sos_reports"("id");



CREATE POLICY "admins can read compensation review audit" ON "public"."damage_report_status_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "profile"
  WHERE (("profile"."id" = "auth"."uid"()) AND ("profile"."role" = 'admin'::"text") AND ("profile"."is_active" = true)))));



CREATE POLICY "admins manage service areas" ON "public"."rescuer_service_areas" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active")))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "admins read address sync history" ON "public"."thai_address_sync_runs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "admins read death confirmations" ON "public"."death_case_confirmations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "admins read dispatch attempts" ON "public"."rescue_dispatch_attempts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "admins read notification outbox" ON "public"."notification_outbox" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "admins read operational audit" ON "public"."operation_audit_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text") AND "profiles"."is_active"))));



CREATE POLICY "authorized officers can read delivery manifests" ON "public"."rescue_delivery_manifests" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND (("p"."role" = 'admin'::"text") OR (("p"."role" = 'rescuer'::"text") AND ("rescue_delivery_manifests"."rescuer_id" = "auth"."uid"())) OR (("p"."role" = 'shelter_staff'::"text") AND ("p"."shelter_id" = "rescue_delivery_manifests"."shelter_id")))))));



CREATE POLICY "authorized officers can read delivery people" ON "public"."rescue_delivery_people" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."rescue_delivery_manifests" "m"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("m"."id" = "rescue_delivery_people"."manifest_id") AND (("p"."role" = 'admin'::"text") OR (("p"."role" = 'rescuer'::"text") AND ("m"."rescuer_id" = "auth"."uid"())) OR (("p"."role" = 'shelter_staff'::"text") AND ("p"."shelter_id" = "m"."shelter_id")))))));



ALTER TABLE "public"."damage_report_status_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."death_case_confirmations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."operation_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."post_shelter_followups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "post_shelter_followups_staff_select" ON "public"."post_shelter_followups" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_active" = true) AND (("p"."role" = ANY (ARRAY['admin'::"text", 'gov'::"text"])) OR (("p"."role" = 'shelter_staff'::"text") AND ("p"."shelter_id" = "post_shelter_followups"."shelter_id")) OR (("p"."role" = 'rescuer'::"text") AND ("post_shelter_followups"."sos_report_id" IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM "public"."assignments" "a"
          WHERE (("a"."sos_report_id" = "post_shelter_followups"."sos_report_id") AND ("a"."rescuer_id" = "auth"."uid"()))))))))));



CREATE POLICY "public read thai districts" ON "public"."thai_address_districts" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read thai provinces" ON "public"."thai_address_provinces" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "public read thai subdistricts" ON "public"."thai_address_subdistricts" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."rescue_delivery_manifests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rescue_delivery_people" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rescue_dispatch_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rescue_dispatch_searches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rescuer_presence" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rescuer_service_areas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rescuers read own presence" ON "public"."rescuer_presence" FOR SELECT TO "authenticated" USING (("rescuer_id" = "auth"."uid"()));



CREATE POLICY "rescuers read own service areas" ON "public"."rescuer_service_areas" FOR SELECT TO "authenticated" USING (("rescuer_id" = "auth"."uid"()));



CREATE POLICY "shelter staff can read occupant name audit" ON "public"."shelter_occupant_name_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_active" = true) AND (("p"."role" = 'admin'::"text") OR (("p"."role" = 'shelter_staff'::"text") AND ("p"."shelter_id" = "shelter_occupant_name_audit"."shelter_id")))))));



CREATE POLICY "shelter staff can read request exit audit" ON "public"."shelter_request_exit_audit" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_active" = true) AND (("p"."role" = 'admin'::"text") OR (("p"."role" = 'shelter_staff'::"text") AND ("p"."shelter_id" = "shelter_request_exit_audit"."shelter_id")))))));



ALTER TABLE "public"."shelter_occupant_name_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shelter_request_exit_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shelter_self_registration_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."thai_address_districts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."thai_address_provinces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."thai_address_subdistricts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."thai_address_sync_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users manage own push subscriptions" ON "public"."notification_subscriptions" TO "authenticated" USING (("profile_id" = "auth"."uid"())) WITH CHECK (("profile_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."accept_rescue_assignment"("p_sos_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_rescue_assignment"("p_sos_report_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_rescue_assignment"("p_sos_report_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_handoff_rescue_case"("p_sos_report_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_handoff_rescue_case"("p_sos_report_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_handoff_rescue_case"("p_sos_report_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_redrive_rescue_case"("p_sos_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_redrive_rescue_case"("p_sos_report_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_redrive_rescue_case"("p_sos_report_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_update_damage_report_status"("p_report_id" "uuid", "p_status" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_update_damage_report_status"("p_report_id" "uuid", "p_status" "text", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_damage_report_status"("p_report_id" "uuid", "p_status" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_rescue_assignment"("p_sos_report_id" "uuid", "p_next_status" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_rescue_assignment"("p_sos_report_id" "uuid", "p_next_status" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_rescue_assignment"("p_sos_report_id" "uuid", "p_next_status" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_dispatch_on_case_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."auto_dispatch_on_case_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_dispatch_on_case_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_rescue_outcome"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v2"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_rescue_outcome_v3"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v3"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v3"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_rescue_outcome_v4"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text", "p_victim_status" "text", "p_victim_shelter_name" "text", "p_victim_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v4"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text", "p_victim_status" "text", "p_victim_shelter_name" "text", "p_victim_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_rescue_outcome_v4"("p_sos_report_id" "uuid", "p_mode" "text", "p_destination_type" "text", "p_destination_shelter_id" "uuid", "p_destination_note" "text", "p_confirmed_adult" integer, "p_confirmed_child" integer, "p_confirmed_elder" integer, "p_cannot_reach_reason" "text", "p_notes" "text", "p_people" "jsonb", "p_count_discrepancy_note" "text", "p_victim_status" "text", "p_victim_shelter_name" "text", "p_victim_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_shelter_exit"("p_occupant_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirm_shelter_request_exit"("p_sos_report_id" "uuid", "p_shelter_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirm_shelter_request_exit"("p_sos_report_id" "uuid", "p_shelter_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirm_shelter_request_exit"("p_sos_report_id" "uuid", "p_shelter_id" "uuid", "p_exit_destination" "text", "p_exit_at" timestamp with time zone, "p_exit_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_death_confirmation"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_death_confirmation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_death_confirmation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."dispatch_rescue_case"("p_sos_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dispatch_rescue_case"("p_sos_report_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_admin_notification"("p_event_type" "text", "p_title" "text", "p_body" "text", "p_target_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_admin_notification"("p_event_type" "text", "p_title" "text", "p_body" "text", "p_target_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_admin_notification"("p_event_type" "text", "p_title" "text", "p_body" "text", "p_target_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_assignment_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_assignment_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_assignment_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_death_review_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_death_review_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_death_review_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_sos_created_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_sos_created_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_sos_created_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_rescue_dispatches"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_rescue_dispatches"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_rescue_case_control"("p_sos_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_rescue_case_control"("p_sos_report_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_rescue_case_control"("p_sos_report_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_rescue_case_control_v2"("p_sos_report_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_rescue_case_control_v2"("p_sos_report_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_rescue_case_control_v2"("p_sos_report_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_rescuer_locations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_rescuer_locations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_rescuer_locations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_active_rescue_assignments"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_active_rescue_assignments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_active_rescue_assignments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_pending_rescue_dispatches"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_pending_rescue_dispatches"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_pending_rescue_dispatches"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_rescuer_dispatch_readiness"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_rescuer_dispatch_readiness"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_rescuer_dispatch_readiness"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_victim_assigned_rescuer_location"("p_sos_report_id" "uuid", "p_phone" "text") TO "anon";



GRANT ALL ON FUNCTION "public"."link_shelter_occupant_to_delivery_person"() TO "anon";
GRANT ALL ON FUNCTION "public"."link_shelter_occupant_to_delivery_person"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_shelter_occupant_to_delivery_person"() TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_rescuer_offline_after_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."mark_rescuer_offline_after_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_rescuer_offline_after_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."normalize_compensation_address"("p_province" "text", "p_district" "text", "p_sub_district" "text", "p_address_details" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_compensation_address"("p_province" "text", "p_district" "text", "p_sub_district" "text", "p_address_details" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_compensation_address"("p_province" "text", "p_district" "text", "p_sub_district" "text", "p_address_details" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_compensation_claim"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_compensation_claim"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_compensation_claim"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_compensation_structured_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_compensation_structured_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_compensation_structured_fields"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prepare_rescue_delivery_person"() TO "anon";
GRANT ALL ON FUNCTION "public"."prepare_rescue_delivery_person"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prepare_rescue_delivery_person"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_post_shelter_followup"("p_followup_id" "uuid", "p_assessment" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_shelter_occupant"("p_shelter_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_adult_count" integer, "p_child_count" integer, "p_elder_count" integer, "p_request_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_shelter_occupant"("p_shelter_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_adult_count" integer, "p_child_count" integer, "p_elder_count" integer, "p_request_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_shelter_occupant"("p_shelter_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_adult_count" integer, "p_child_count" integer, "p_elder_count" integer, "p_request_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rename_shelter_delivery_person"("p_delivery_person_id" "uuid", "p_occupant_id" "uuid", "p_full_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rename_shelter_delivery_person"("p_delivery_person_id" "uuid", "p_occupant_id" "uuid", "p_full_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_shelter_delivery_person"("p_delivery_person_id" "uuid", "p_occupant_id" "uuid", "p_full_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."respond_to_rescue_dispatch"("p_sos_report_id" "uuid", "p_accept" boolean, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."respond_to_rescue_dispatch"("p_sos_report_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."respond_to_rescue_dispatch"("p_sos_report_id" "uuid", "p_accept" boolean, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_death_case_confirmation"("p_confirmation_id" "uuid", "p_decision" "text", "p_review_note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_death_case_confirmation"("p_confirmation_id" "uuid", "p_decision" "text", "p_review_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_death_case_confirmation"("p_confirmation_id" "uuid", "p_decision" "text", "p_review_note" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"() TO "anon";
GRANT ALL ON FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."schedule_post_shelter_followup_on_home_exit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_rescuer_presence"("p_availability" "text", "p_latitude" double precision, "p_longitude" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_rescuer_presence"("p_availability" "text", "p_latitude" double precision, "p_longitude" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_rescuer_presence"("p_availability" "text", "p_latitude" double precision, "p_longitude" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_victim_destination"("p_sos_report_id" "uuid", "p_status" "text", "p_shelter_name" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_victim_destination"("p_sos_report_id" "uuid", "p_status" "text", "p_shelter_name" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_victim_destination"("p_sos_report_id" "uuid", "p_status" "text", "p_shelter_name" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_post_shelter_followup_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_post_shelter_followup_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_post_shelter_followup_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_shelter_capacity"("p_shelter_id" "uuid", "p_capacity" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_shelter_capacity"("p_shelter_id" "uuid", "p_capacity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_shelter_capacity"("p_shelter_id" "uuid", "p_capacity" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."write_operation_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."write_operation_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."write_operation_audit"() TO "service_role";



GRANT ALL ON TABLE "public"."access_codes" TO "anon";
GRANT ALL ON TABLE "public"."access_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."access_codes" TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."damage_report_status_audit" TO "anon";
GRANT ALL ON TABLE "public"."damage_report_status_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."damage_report_status_audit" TO "service_role";



GRANT ALL ON TABLE "public"."damage_reports" TO "anon";
GRANT ALL ON TABLE "public"."damage_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."damage_reports" TO "service_role";



GRANT ALL ON TABLE "public"."death_case_confirmations" TO "anon";
GRANT ALL ON TABLE "public"."death_case_confirmations" TO "authenticated";
GRANT ALL ON TABLE "public"."death_case_confirmations" TO "service_role";



GRANT ALL ON TABLE "public"."notification_outbox" TO "anon";
GRANT ALL ON TABLE "public"."notification_outbox" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_outbox" TO "service_role";



GRANT ALL ON TABLE "public"."notification_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."notification_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."operation_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."operation_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."operation_audit_logs" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."post_shelter_followups" TO "authenticated";
GRANT ALL ON TABLE "public"."post_shelter_followups" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."rescue_delivery_manifests" TO "anon";
GRANT ALL ON TABLE "public"."rescue_delivery_manifests" TO "authenticated";
GRANT ALL ON TABLE "public"."rescue_delivery_manifests" TO "service_role";



GRANT ALL ON TABLE "public"."rescue_delivery_people" TO "anon";
GRANT ALL ON TABLE "public"."rescue_delivery_people" TO "authenticated";
GRANT ALL ON TABLE "public"."rescue_delivery_people" TO "service_role";



GRANT ALL ON TABLE "public"."rescue_dispatch_attempts" TO "anon";
GRANT ALL ON TABLE "public"."rescue_dispatch_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."rescue_dispatch_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."rescue_dispatch_searches" TO "anon";
GRANT ALL ON TABLE "public"."rescue_dispatch_searches" TO "authenticated";
GRANT ALL ON TABLE "public"."rescue_dispatch_searches" TO "service_role";



GRANT ALL ON TABLE "public"."rescuer_presence" TO "anon";
GRANT ALL ON TABLE "public"."rescuer_presence" TO "authenticated";
GRANT ALL ON TABLE "public"."rescuer_presence" TO "service_role";



GRANT ALL ON TABLE "public"."rescuer_service_areas" TO "anon";
GRANT ALL ON TABLE "public"."rescuer_service_areas" TO "authenticated";
GRANT ALL ON TABLE "public"."rescuer_service_areas" TO "service_role";



GRANT ALL ON TABLE "public"."shelter_occupant_name_audit" TO "anon";
GRANT ALL ON TABLE "public"."shelter_occupant_name_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."shelter_occupant_name_audit" TO "service_role";



GRANT ALL ON TABLE "public"."shelter_occupants" TO "anon";
GRANT ALL ON TABLE "public"."shelter_occupants" TO "authenticated";
GRANT ALL ON TABLE "public"."shelter_occupants" TO "service_role";



GRANT ALL ON TABLE "public"."shelter_request_exit_audit" TO "anon";
GRANT ALL ON TABLE "public"."shelter_request_exit_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."shelter_request_exit_audit" TO "service_role";



GRANT ALL ON TABLE "public"."shelter_self_registration_requests" TO "anon";
GRANT ALL ON TABLE "public"."shelter_self_registration_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."shelter_self_registration_requests" TO "service_role";



GRANT ALL ON TABLE "public"."shelters" TO "anon";
GRANT ALL ON TABLE "public"."shelters" TO "authenticated";
GRANT ALL ON TABLE "public"."shelters" TO "service_role";



GRANT ALL ON TABLE "public"."sos_reports" TO "anon";
GRANT ALL ON TABLE "public"."sos_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."sos_reports" TO "service_role";



GRANT ALL ON TABLE "public"."staff_invites" TO "anon";
GRANT ALL ON TABLE "public"."staff_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_invites" TO "service_role";



GRANT ALL ON TABLE "public"."staff_role_requests" TO "anon";
GRANT ALL ON TABLE "public"."staff_role_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_role_requests" TO "service_role";



GRANT ALL ON TABLE "public"."thai_address_districts" TO "anon";
GRANT ALL ON TABLE "public"."thai_address_districts" TO "authenticated";
GRANT ALL ON TABLE "public"."thai_address_districts" TO "service_role";



GRANT ALL ON TABLE "public"."thai_address_provinces" TO "anon";
GRANT ALL ON TABLE "public"."thai_address_provinces" TO "authenticated";
GRANT ALL ON TABLE "public"."thai_address_provinces" TO "service_role";



GRANT ALL ON TABLE "public"."thai_address_subdistricts" TO "anon";
GRANT ALL ON TABLE "public"."thai_address_subdistricts" TO "authenticated";
GRANT ALL ON TABLE "public"."thai_address_subdistricts" TO "service_role";



GRANT ALL ON TABLE "public"."thai_address_directory" TO "anon";
GRANT ALL ON TABLE "public"."thai_address_directory" TO "authenticated";
GRANT ALL ON TABLE "public"."thai_address_directory" TO "service_role";



GRANT ALL ON TABLE "public"."thai_address_sync_runs" TO "anon";
GRANT ALL ON TABLE "public"."thai_address_sync_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."thai_address_sync_runs" TO "service_role";



GRANT ALL ON TABLE "public"."victim_status" TO "anon";
GRANT ALL ON TABLE "public"."victim_status" TO "authenticated";
GRANT ALL ON TABLE "public"."victim_status" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







