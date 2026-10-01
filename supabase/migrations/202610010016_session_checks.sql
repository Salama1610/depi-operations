-- The per-session checklist from the operations sheet.
--
-- Before each session the coordinator notifies the trainer, confirms on
-- WhatsApp and confirms the technical set-up; during it the coach marks that
-- they joined; after it the coordinator sends and, from the second session,
-- collects the assignment. Each ticked step is one row: who ticked it and
-- when. Steps the app already knows (trainer confirmed, attendance recorded,
-- all confirmations) are worked out, not stored. A reschedule clears the
-- before-steps. Mirrors drizzle/0023.

create table if not exists public.session_checks (
  id text primary key,
  session_id text not null references public.sessions(id),
  item text not null,
  done_by text not null references public.users(id),
  done_at timestamptz not null default now(),
  unique (session_id, item)
);

create index if not exists session_checks_session_idx on public.session_checks (session_id);

alter table public.session_checks enable row level security;
revoke all on table public.session_checks from anon, authenticated;
-- No policy: the API reads and writes these through the service role after it
-- has authorised the caller.

comment on table public.session_checks is
  'Ticked steps of the per-session checklist: one row per session and step.';
