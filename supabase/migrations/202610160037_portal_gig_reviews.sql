-- Our quality team's check of the gigs students upload to the ministry portal.
--
-- On the portal a gig is approved by the student's coach, then by the
-- ministry's quality reviewers, then by a third-party company. Before the
-- coach decides, one of our Quality Members checks it against their own SOP
-- and approves or rejects it with a comment; the coach and the student's
-- coordinator read that verdict and the coach acts on the portal.
--
-- A gig is known by its portal id, which survives every new upload of the
-- gigs sheet, so a verdict stays with its gig. Every gig still waiting for the
-- coach (provider status Pending) is given to the Quality Member already
-- holding that student's gigs, or else to the least-loaded member; the Quality
-- Lead can hand one to someone else or share the pending ones out again.
-- Mirrors drizzle/0040.

create table if not exists public.portal_gig_reviews (
  portal_gig_id text primary key check (char_length(portal_gig_id) between 1 and 120),
  portal_student_id text not null,
  student_id text references public.students(id),
  student_name text,
  title text,
  url text,
  reviewer text not null references public.users(id),
  assigned_by text references public.users(id),
  assigned_at timestamptz not null default now(),
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
  comment text check (comment is null or char_length(comment) <= 2000),
  reviewed_by text references public.users(id),
  reviewed_at timestamptz
);
create index if not exists portal_gig_reviews_reviewer_idx on public.portal_gig_reviews (reviewer, status);
create index if not exists portal_gig_reviews_student_idx on public.portal_gig_reviews (portal_student_id);

alter table public.portal_gig_reviews enable row level security;
revoke all on table public.portal_gig_reviews from anon, authenticated;
-- No policy: /api/portal-qc, /api/portal and /api/coach-progress read and
-- write these through the service role after they have authorised the caller.

comment on table public.portal_gig_reviews is
  'Our Quality Member''s verdict on each ministry-portal gig before the coach approves it there.';
