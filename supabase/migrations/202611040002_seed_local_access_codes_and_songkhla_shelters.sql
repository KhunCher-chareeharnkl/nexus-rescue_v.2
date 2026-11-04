-- Local development data only.
-- Do not apply these access codes or sample shelters to a production project.

begin;

insert into public.access_codes (role, code, active)
values
  ('rescuer', 'RESCUE2026', true),
  ('shelter_staff', 'OFFICER2026', true)
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
  sample.name,
  sample.address,
  'สงขลา',
  sample.capacity,
  0,
  true
from (
  values
    (
      'ศูนย์พักพิงชั่วคราวเทศบาลนครหาดใหญ่',
      'อำเภอหาดใหญ่ จังหวัดสงขลา',
      300
    ),
    (
      'ศูนย์พักพิงชั่วคราวเทศบาลนครสงขลา',
      'อำเภอเมืองสงขลา จังหวัดสงขลา',
      200
    ),
    (
      'ศูนย์พักพิงชั่วคราวอำเภอสะเดา',
      'อำเภอสะเดา จังหวัดสงขลา',
      150
    )
) as sample(name, address, capacity)
where not exists (
  select 1
  from public.shelters existing
  where existing.name = sample.name
    and existing.province = 'สงขลา'
);

commit;
