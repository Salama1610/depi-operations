-- How a low-rated session was handled.
--
-- A session's feedback score is the average of every rating its students gave
-- it (lib/domain/feedback.ts). Below 3 out of 5 it is a red flag, which stays
-- open on Coach Operations' first screen until someone records here what was
-- done about it, and optionally opens a case. One row per handled session; a
-- red session without a row is an open flag. The score is the one the session
-- had when it was handled. Mirrors drizzle/0032.

create table if not exists public.feedback_flags (
  session_id text primary key references public.sessions(id),
  score numeric(3,1) not null check (score >= 1 and score <= 5),
  note text not null check (char_length(note) between 1 and 2000),
  case_id text references public.cases(id),
  handled_by text not null references public.users(id),
  handled_at timestamptz not null default now()
);

alter table public.feedback_flags enable row level security;
revoke all on table public.feedback_flags from anon, authenticated;
-- No policy: /api/feedback reads and writes these through the service role
-- after it has authorised the caller and checked the session is in scope.

comment on table public.feedback_flags is
  'What Coach Operations did about a session whose students rated it below 3 of 5, and the case opened for it, if any.';
