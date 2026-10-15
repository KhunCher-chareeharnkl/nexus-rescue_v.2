-- Keep reassignment server-side. This job expires unanswered offers and then
-- dispatches the same SOS to the next eligible rescuer automatically.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not enabled. Enable it, then run this migration again.';
    return;
  end if;

  for v_job_id in
    select jobid from cron.job where jobname = 'nexus-expire-rescue-dispatches'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'nexus-expire-rescue-dispatches',
    '* * * * *',
    $command$select public.expire_stale_rescue_dispatches();$command$
  );
end;
$$;
