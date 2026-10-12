-- The quality team's review of students' feedback after each session.
--
-- Every session that has feedback is given to one Quality Member, chosen at
-- random among those with the fewest reviews still pending; the Quality Lead
-- can hand one to someone else or share the pending ones out again. The
-- reviewer reads the session's results and marks it reviewed, with a note.
-- Mirrors drizzle/0038.

create table if not exists public.feedback_reviews (
  session_id text primary key references public.sessions(id),
  reviewer text not null references public.users(id),
  assigned_by text references public.users(id),
  assigned_at timestamptz not null default now(),
  status text not null default 'Pending' check (status in ('Pending', 'Reviewed')),
  note text check (note is null or char_length(note) <= 2000),
  reviewed_at timestamptz
);
create index if not exists feedback_reviews_reviewer_idx on public.feedback_reviews (reviewer, status);

alter table public.feedback_reviews enable row level security;
revoke all on table public.feedback_reviews from anon, authenticated;
-- No policy: /api/feedback-review reads and writes these through the service
-- role after it has authorised the caller.

comment on table public.feedback_reviews is
  'Which Quality Member reviews the student feedback of each session, and their note.';
