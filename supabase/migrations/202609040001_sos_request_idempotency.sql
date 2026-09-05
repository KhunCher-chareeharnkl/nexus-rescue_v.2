-- Prevent a client retry after a lost network response from creating a second SOS report.
alter table public.sos_reports
  add column if not exists client_request_id uuid;

create unique index if not exists sos_reports_client_request_id_unique
  on public.sos_reports (client_request_id)
  where client_request_id is not null;
