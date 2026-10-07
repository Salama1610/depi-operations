-- Technical problems staff report from the workspace (/support).
--
-- The form is for bugs, access problems and error messages only; questions
-- about how to do the work go through the team structure. The reporter's
-- name, roles, the page they came from, the time and their browser are taken
-- by the app; the person adds what they did, what happened, what they
-- expected, how much it blocks them and, optionally, a screenshot (kept in
-- the private evidence bucket under support/). The system owner works the
-- reports to Resolved. Mirrors drizzle/0034.

create table if not exists public.support_reports (
  id text primary key,
  reporter text not null references public.users(id),
  reporter_roles text not null,
  page text not null check (char_length(page) between 1 and 80),
  url text,
  category text not null check (category in ('Bug', 'Access', 'Error')),
  severity text not null check (severity in ('Blocking', 'Major', 'Minor')),
  action text not null check (char_length(action) between 1 and 2000),
  happened text not null check (char_length(happened) between 1 and 2000),
  expected text check (expected is null or char_length(expected) <= 2000),
  occurred_at timestamptz not null,
  browser text,
  screenshot_key text,
  screenshot_type text check (screenshot_type is null or screenshot_type in ('image/png', 'image/jpeg')),
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved', 'Not a bug')),
  resolution text check (resolution is null or char_length(resolution) <= 2000),
  handled_by text references public.users(id),
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_reports_status_idx on public.support_reports (status, created_at);
create index if not exists support_reports_reporter_idx on public.support_reports (reporter, created_at);

alter table public.support_reports enable row level security;
revoke all on table public.support_reports from anon, authenticated;
-- No policy: /api/support reads and writes these through the service role,
-- showing a person their own reports and the administrators all of them.

comment on table public.support_reports is
  'Technical problems (bugs, access, errors) reported by staff from /support, and how the system owner resolved them.';
