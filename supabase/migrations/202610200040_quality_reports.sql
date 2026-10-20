-- 20 October 2026: problems the quality team reports about a group.
--
-- A Quality Member or the Quality Lead picks the group, describes the problem
-- and chooses who it goes to: Coach Operations, Project Operations or both.
-- Those people get a notification and read it on the Problem reports tab,
-- where they mark it handled with a note; the administrators read them all.
-- Mirrors drizzle/0043.

create table if not exists public.quality_reports (
  id text primary key,
  group_id text not null references public.groups(id),
  audience text not null check (audience in ('Coach Operations', 'Project Operations', 'Both')),
  description text not null check (char_length(description) between 5 and 2000),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  status text not null default 'Open' check (status in ('Open', 'Handled')),
  handled_by text references public.users(id),
  handled_at timestamptz,
  handled_note text check (handled_note is null or char_length(handled_note) <= 1000)
);
create index if not exists quality_reports_status_idx on public.quality_reports (status, created_at);

alter table public.quality_reports enable row level security;
revoke all on table public.quality_reports from anon, authenticated;
-- No policy: /api/quality-reports reads and writes these through the service
-- role after it has authorised the caller.

comment on table public.quality_reports is
  'A problem the quality team reports about a group, sent to Coach Operations, Project Operations or both.';
