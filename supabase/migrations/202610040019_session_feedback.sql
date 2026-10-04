-- Students' feedback after each session, on the session and its coach.
--
-- One row per student per session: how satisfied they were, how clear the
-- coach's explanation was and how useful the mentorship was (each 1 to 5),
-- whether they searched for a gig on the platforms, what they liked most and
-- any comments or support needed. Mirrors drizzle/0026.

create table if not exists public.session_feedback (
  id text primary key,
  session_id text not null references public.sessions(id),
  student_id text not null references public.students(id),
  satisfaction smallint not null check (satisfaction between 1 and 5),
  clarity smallint not null check (clarity between 1 and 5),
  searched_gig boolean not null,
  usefulness smallint not null check (usefulness between 1 and 5),
  liked text,
  comments text,
  created_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create index if not exists session_feedback_session_idx on public.session_feedback (session_id);

alter table public.session_feedback enable row level security;
revoke all on table public.session_feedback from anon, authenticated;
-- No policy: the API reads and writes these through the service role after it
-- has authorised the caller.

comment on table public.session_feedback is
  'A student''s feedback after a session: three 1-5 ratings, whether they searched for a gig, and comments.';
