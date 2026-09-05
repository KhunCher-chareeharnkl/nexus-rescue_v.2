-- Return only the caller's own active rescue jobs, independent of table RLS.

begin;

create or replace function public.get_my_active_rescue_assignments()
returns table (
  sos_report_id uuid,
  status text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select a.sos_report_id, a.status
  from public.assignments a
  where a.rescuer_id = auth.uid()
    and a.status in ('accepted', 'en_route', 'on_scene')
  order by a.accepted_at desc nulls last;
$$;

revoke all on function public.get_my_active_rescue_assignments() from public, anon;
grant execute on function public.get_my_active_rescue_assignments() to authenticated;

commit;
