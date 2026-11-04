-- Local development seed data only.
-- Do not use these access codes in a hosted or production project.

insert into public.access_codes (role, code, active)
values
  ('rescuer', 'RESCUE2026', true),
  ('shelter_staff', 'SHELTER2026', true)
on conflict (code) do update
set role = excluded.role,
    active = excluded.active;

insert into public.shelters (
  name,
  address,
  province,
  capacity,
  current_occupancy,
  is_active
)
select
  'ศูนย์พักพิงทดสอบ Local',
  'ที่อยู่ทดสอบสำหรับการพัฒนา',
  'เชียงใหม่',
  100,
  0,
  true
where not exists (
  select 1
  from public.shelters
  where name = 'ศูนย์พักพิงทดสอบ Local'
);
