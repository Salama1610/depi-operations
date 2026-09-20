-- Quality work can be assigned, and distributed evenly.
--
-- A service link already carried its reviewer in service_links.qc_actor. An
-- evidence package had no equivalent, so gig review could only be picked up ad
-- hoc and nobody could see who owed what. Mirrors drizzle/0015.

alter table public.evidence
  add column if not exists qc_actor text references public.users(id);

create index if not exists evidence_qc_actor_idx on public.evidence (qc_actor);
create index if not exists service_links_qc_actor_idx on public.service_links (qc_actor);
