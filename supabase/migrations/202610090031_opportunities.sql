-- Work opportunities the Service Team's coordinators find on the freelance
-- platforms and share with the students of one track.
--
-- A coordinator posts the link, what the job is, the track it suits, the
-- platform and the day the job was posted there. Supervisors and Project
-- Operations see every post; a student sees the ones for their own track.
-- A post is removed, not deleted, so who shared what stays on record.
-- Mirrors drizzle/0035.

create table if not exists public.opportunities (
  id text primary key,
  url text not null check (char_length(url) between 10 and 2000),
  title text not null check (char_length(title) between 3 and 200),
  track text not null,
  platform text not null check (char_length(platform) between 2 and 60),
  posted_on date not null,
  status text not null default 'Active' check (status in ('Active', 'Removed')),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  removed_by text references public.users(id),
  removed_at timestamptz
);
create index if not exists opportunities_track_idx on public.opportunities (track, status, posted_on);

alter table public.opportunities enable row level security;
revoke all on table public.opportunities from anon, authenticated;
-- No policy: /api/opportunities reads and writes these through the service
-- role after it has authorised the caller.

comment on table public.opportunities is
  'Job postings found by Service Team coordinators and shared with the students of a track.';
