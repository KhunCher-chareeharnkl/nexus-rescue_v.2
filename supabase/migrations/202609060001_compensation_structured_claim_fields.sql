begin;

alter table public.damage_reports
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists house_number text,
  add column if not exists village_no text,
  add column if not exists soi text,
  add column if not exists postal_code text,
  add column if not exists damage_end_date date,
  add column if not exists damage_duration_days integer,
  add column if not exists registered_resident boolean not null default false,
  add column if not exists rental_agreement_image_url text,
  add column if not exists house_registration_image_url text;

update public.damage_reports
set
  first_name = coalesce(nullif(btrim(first_name), ''), nullif(split_part(btrim(full_name), ' ', 1), '')),
  last_name = coalesce(nullif(btrim(last_name), ''), nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')),
  damage_end_date = coalesce(damage_end_date, incident_date),
  damage_duration_days = coalesce(damage_duration_days, 1)
where first_name is null
   or last_name is null
   or damage_end_date is null
   or damage_duration_days is null;

alter table public.damage_reports drop constraint if exists damage_reports_postal_code_check;
alter table public.damage_reports add constraint damage_reports_postal_code_check
  check (postal_code is null or postal_code ~ '^[0-9]{5}$') not valid;

alter table public.damage_reports drop constraint if exists damage_reports_damage_period_check;
alter table public.damage_reports add constraint damage_reports_damage_period_check
  check (
    damage_duration_days is null or damage_duration_days >= 1
  ) not valid;

alter table public.damage_reports drop constraint if exists damage_reports_damage_end_date_check;
alter table public.damage_reports add constraint damage_reports_damage_end_date_check
  check (
    damage_end_date is null or incident_date is null or damage_end_date >= incident_date
  ) not valid;

create or replace function public.prepare_compensation_structured_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
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

drop trigger if exists prepare_compensation_structured_fields_trigger on public.damage_reports;
create trigger prepare_compensation_structured_fields_trigger
before insert or update on public.damage_reports
for each row execute function public.prepare_compensation_structured_fields();

create index if not exists damage_reports_structured_address_idx
  on public.damage_reports (province, district, sub_district, house_number, postal_code)
  where claim_category = 'housing_property';

comment on column public.damage_reports.registered_resident is
  'ผู้ยื่นยืนยันว่ามีชื่อในทะเบียนบ้านของที่อยู่อาศัยที่ยื่นคำร้อง';

notify pgrst, 'reload schema';
commit;
