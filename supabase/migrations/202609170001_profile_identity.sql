begin;

-- อีเมลอยู่ใน auth.users ซึ่งหน้าแอดมินอ่านโดยตรงไม่ได้
-- จึงเก็บสำเนาที่ใช้ระบุตัวเจ้าหน้าที่ใน public.profiles เท่านั้น
alter table public.profiles
  add column if not exists email text;

-- เติมอีเมลให้บัญชีเดิมจากระบบยืนยันตัวตน
update public.profiles as profile
set email = lower(auth_user.email)
from auth.users as auth_user
where auth_user.id = profile.id
  and auth_user.email is not null
  and profile.email is distinct from lower(auth_user.email);

create unique index if not exists profiles_email_unique_idx
  on public.profiles (lower(email))
  where email is not null;

comment on column public.profiles.email is
  'สำเนาอีเมลจาก auth.users สำหรับแสดงและค้นหารายชื่อเจ้าหน้าที่';

commit;
