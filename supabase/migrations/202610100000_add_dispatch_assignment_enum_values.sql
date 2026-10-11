-- This must run in a separate migration before automatic_rescue_dispatch.
-- PostgreSQL makes newly-added enum values usable only after this transaction
-- has committed.
do $$
begin
  if to_regtype('public.assignment_status') is null then
    return;
  end if;

  alter type public.assignment_status add value if not exists 'offered';
  alter type public.assignment_status add value if not exists 'declined';
  alter type public.assignment_status add value if not exists 'expired';
end;
$$;
