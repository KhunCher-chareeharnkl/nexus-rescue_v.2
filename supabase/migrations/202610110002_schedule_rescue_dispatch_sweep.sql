-- Vercel Hobby permits daily cron jobs only. Keep the two-minute offer timeout
-- reliable by scheduling it next to the data in Supabase instead.
--
-- Supabase projects normally expose pg_cron in the `cron` schema. The guard
-- intentionally leaves the schema unchanged if an administrator has disabled
-- the extension; the notice tells them exactly what needs enabling.
do $$
declare
  v_job_id bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not enabled. Enable the pg_cron extension, then run this migration again.';
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
