begin;

alter table public.damage_reports
  add column if not exists claim_category text,
  add column if not exists housing_tenure text,
  add column if not exists property_address_key text,
  add column if not exists farmer_registered_before_disaster boolean,
  add column if not exists farmer_registration_number text,
  add column if not exists agriculture_damage_types text[] not null default '{}'::text[],
  add column if not exists crop_area_rai numeric,
  add column if not exists fishery_area_rai numeric,
  add column if not exists livestock_count integer,
  add column if not exists bank_book_image_url text,
  add column if not exists updated_at timestamp with time zone not null default now();

alter table public.damage_reports drop constraint if exists damage_reports_claim_category_check;
alter table public.damage_reports add constraint damage_reports_claim_category_check
  check (claim_category is null or claim_category in ('housing_property', 'agriculture_livelihood'));
alter table public.damage_reports drop constraint if exists damage_reports_housing_tenure_check;
alter table public.damage_reports add constraint damage_reports_housing_tenure_check
  check (housing_tenure is null or housing_tenure in ('owner', 'renter', 'other_person'));
alter table public.damage_reports drop constraint if exists damage_reports_agriculture_values_check;
alter table public.damage_reports add constraint damage_reports_agriculture_values_check check (
  (crop_area_rai is null or crop_area_rai >= 0)
  and (fishery_area_rai is null or fishery_area_rai >= 0)
  and (livestock_count is null or livestock_count >= 0)
);
alter table public.damage_reports drop constraint if exists damage_reports_image_limit_check;
alter table public.damage_reports add constraint damage_reports_image_limit_check
  check (cardinality(coalesce(image_urls, '{}'::text[])) <= 8);

create or replace function public.normalize_compensation_address(
  p_province text, p_district text, p_sub_district text, p_address_details text
)
returns text language sql immutable strict set search_path = public, pg_temp as $$
  select lower(regexp_replace(
    concat_ws('|', btrim(p_province), btrim(p_district), btrim(p_sub_district), btrim(p_address_details)),
    '[[:space:][:punct:]]+', '', 'g'
  ));
$$;

create or replace function public.prepare_compensation_claim()
returns trigger language plpgsql set search_path = public, pg_temp as $$
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

drop trigger if exists prepare_compensation_claim_trigger on public.damage_reports;
create trigger prepare_compensation_claim_trigger before insert or update on public.damage_reports
for each row execute function public.prepare_compensation_claim();

create unique index if not exists damage_reports_person_category_unique
  on public.damage_reports (id_card_number, claim_category)
  where claim_category is not null and id_card_number is not null;
create unique index if not exists damage_reports_property_address_unique
  on public.damage_reports (property_address_key)
  where claim_category = 'housing_property' and property_address_key is not null;
create index if not exists damage_reports_sos_category_idx
  on public.damage_reports (sos_report_id, claim_category, created_at desc)
  where sos_report_id is not null;

comment on column public.damage_reports.claim_category is
  'housing_property=ที่อยู่อาศัยและทรัพย์สิน, agriculture_livelihood=เกษตร ประมง ปศุสัตว์';
comment on column public.damage_reports.property_address_key is
  'ที่อยู่ปรับรูปแบบสำหรับป้องกันบ้านหลังเดียวถูกยื่นซ้ำ';

notify pgrst, 'reload schema';
commit;
