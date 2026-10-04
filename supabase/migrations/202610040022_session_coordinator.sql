-- Each session remembers its coordinator, as it already remembers its coach.
--
-- Coaches and coordinators are paid by the sessions they held, so a session
-- keeps the people it had: changing a group's coach or coordinator, or putting
-- a backup coach on one session, changes the sessions still to come and never
-- the ones already held. Existing sessions take their group's coordinator.
-- Mirrors drizzle/0029.

alter table public.sessions
  add column if not exists coordinator_id text references public.users(id);

update public.sessions s
   set coordinator_id = g.coordinator
  from public.groups g
 where g.id = s.group_id and s.coordinator_id is null;

create index if not exists sessions_coordinator_idx on public.sessions (coordinator_id);

comment on column public.sessions.coordinator_id is
  'The coordinator of this session, kept when the group''s coordinator later changes. Used for payment.';
