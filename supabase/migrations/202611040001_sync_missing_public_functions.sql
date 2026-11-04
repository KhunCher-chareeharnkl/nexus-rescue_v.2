-- Add public functions present in the hosted schema but missing from Local.
-- Function definitions only; no production table data is included.

begin;

CREATE OR REPLACE FUNCTION "public"."accept_rescue_job"("p_sos_report_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_rescuer_id uuid := auth.uid();
  v_existing_active_id uuid;
  v_sos_status text;
  v_new_assignment_id uuid;
BEGIN
  IF v_rescuer_id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบตัวตนผู้ใช้งาน (ยังไม่ได้ login)';
  END IF;

  -- ล็อกแถว assignments ของกู้ภัยคนนี้กันกดรับงานซ้อนพร้อมกันจากคนละแท็บ/อุปกรณ์
  PERFORM 1 FROM public.assignments
  WHERE rescuer_id = v_rescuer_id AND status IN ('accepted', 'en_route', 'on_scene')
  FOR UPDATE;

  SELECT id INTO v_existing_active_id
  FROM public.assignments
  WHERE rescuer_id = v_rescuer_id AND status IN ('accepted', 'en_route', 'on_scene')
  LIMIT 1;

  IF v_existing_active_id IS NOT NULL THEN
    RAISE EXCEPTION 'คุณมีงานที่กำลังดำเนินการอยู่แล้ว กรุณาปิดงานเดิมก่อน';
  END IF;

  -- ล็อกแถว sos_reports ตัวนี้ กันคนอื่นกดรับพร้อมกันตอนเดียว
  SELECT status INTO v_sos_status FROM public.sos_reports WHERE id = p_sos_report_id FOR UPDATE;

  IF v_sos_status IS NULL THEN
    RAISE EXCEPTION 'ไม่พบเคสนี้ในระบบ';
  END IF;
  IF v_sos_status NOT IN ('pending') THEN
    RAISE EXCEPTION 'เคสนี้ถูกรับไปแล้ว หรือปิดไปแล้ว (สถานะปัจจุบัน: %)', v_sos_status;
  END IF;

  INSERT INTO public.assignments (sos_report_id, rescuer_id, status, accepted_at)
  VALUES (p_sos_report_id, v_rescuer_id, 'accepted', now())
  RETURNING id INTO v_new_assignment_id;

  UPDATE public.sos_reports
  SET status = 'assigned', updated_at = now()
  WHERE id = p_sos_report_id;

  INSERT INTO public.victim_status (sos_report_id, status, updated_at)
  VALUES (p_sos_report_id, 'rescue_assigned', now())
  ON CONFLICT (sos_report_id) DO UPDATE
    SET status = 'rescue_assigned', updated_at = now();

  RETURN v_new_assignment_id;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."approve_staff_request"("p_request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  req record;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์อนุมัติคำขอนี้';
  END IF;

  SELECT * INTO req FROM public.staff_role_requests
    WHERE id = p_request_id AND status = 'pending';

  IF req.id IS NULL THEN
    RAISE EXCEPTION 'ไม่พบคำขอ หรือถูกดำเนินการไปแล้ว';
  END IF;

  UPDATE public.profiles
    SET role = req.requested_role, shelter_id = req.requested_shelter_id
    WHERE id = req.requester_id;

  UPDATE public.staff_role_requests
    SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = p_request_id;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  invite record;
BEGIN
  SELECT * INTO invite FROM public.staff_invites
    WHERE lower(email) = lower(NEW.email) AND used = false
    LIMIT 1;

  INSERT INTO public.profiles (id, full_name, role, shelter_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'เจ้าหน้าที่'),
    COALESCE(invite.role, 'rescuer'),  -- ถ้าไม่เคยกรอกรหัสมาก่อนเลย (เช่น เข้าตรง) ยัง fallback เป็น rescuer เหมือนเดิม
    invite.shelter_id
  );

  IF invite.id IS NOT NULL THEN
    UPDATE public.staff_invites SET used = true WHERE id = invite.id;
  END IF;

  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;


CREATE OR REPLACE FUNCTION "public"."redeem_access_code"("p_email" "text", "p_code" "text", "p_role" "text", "p_shelter_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  match_count int;
  existing_user_id uuid;
BEGIN
  IF p_role NOT IN ('rescuer', 'shelter_staff') THEN
    RAISE EXCEPTION 'role ไม่ถูกต้อง';
  END IF;

  IF p_role = 'shelter_staff' AND p_shelter_id IS NULL THEN
    RAISE EXCEPTION 'กรุณาเลือกศูนย์พักพิง';
  END IF;

  SELECT count(*) INTO match_count FROM public.access_codes
    WHERE role = p_role AND code = p_code AND active = true;
  IF match_count = 0 THEN
    RAISE EXCEPTION 'รหัสอ้างอิงไม่ถูกต้อง หรือถูกยกเลิกแล้ว';
  END IF;

  -- เช็คว่าอีเมลนี้เคยสมัครสมาชิกไปแล้วหรือยัง (มี auth.users อยู่แล้ว)
  SELECT id INTO existing_user_id
    FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;

  IF existing_user_id IS NOT NULL THEN
    -- มีบัญชีอยู่แล้ว -> trigger handle_new_user() จะไม่ทำงานอีก (มันรันแค่ตอน insert user ใหม่)
    -- ต้อง update profiles.role/shelter_id ตรงๆ เดี๋ยวนี้เลย
    UPDATE public.profiles
      SET role = p_role, shelter_id = p_shelter_id
      WHERE id = existing_user_id;
  ELSE
    -- ยังไม่เคยสมัคร -> จองไว้ใน staff_invites เหมือนเดิม รอ trigger ทำงานตอน signup จริง
    INSERT INTO public.staff_invites (email, role, shelter_id, used)
    VALUES (lower(p_email), p_role, p_shelter_id, false)
    ON CONFLICT (email) DO UPDATE
      SET role = EXCLUDED.role, shelter_id = EXCLUDED.shelter_id, used = false;
  END IF;

  RETURN true;
END;
$$;


CREATE OR REPLACE FUNCTION "public"."sync_address_text_from_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.address_id is not null then
    select province, district, sub_district
      into new.province, new.district, new.sub_district
      from thai_addresses
      where id = new.address_id;
  end if;
  return new;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."update_shelter_occupancy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE public.shelters s
  SET current_occupancy = COALESCE((
    SELECT SUM(adult_count + child_count + elder_count)
    FROM public.shelter_occupants
    WHERE shelter_id = s.id AND status = 'in_shelter'
  ), 0)
  WHERE s.id = COALESCE(NEW.shelter_id, OLD.shelter_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

notify pgrst, 'reload schema';

commit;
