-- Keep shelter occupants linked to the rescue assignment that delivered them.

begin;

alter table public.shelter_occupants
  add column if not exists assignment_id uuid
  references public.assignments(id)
  on delete set null;

create index if not exists shelter_occupants_assignment_id_idx
  on public.shelter_occupants (assignment_id);

notify pgrst, 'reload schema';

commit;
