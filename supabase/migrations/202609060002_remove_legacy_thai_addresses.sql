begin;

drop trigger if exists trg_sync_address_sos_reports on public.sos_reports;
drop trigger if exists trg_sync_address_damage_reports on public.damage_reports;

alter table public.sos_reports
  drop constraint if exists sos_reports_address_id_fkey;
alter table public.damage_reports
  drop constraint if exists damage_reports_address_id_fkey;

alter table public.sos_reports
  drop column if exists address_id;
alter table public.damage_reports
  drop column if exists address_id;

drop table if exists public.thai_addresses;

notify pgrst, 'reload schema';
commit;
