-- The hours of the week each coach can take a session, kept by Coach
-- Operations and the administrators. One row per coach; `slots` is a JSON
-- array of hours written "Sat-17" (Saturday 5 PM to 6 PM, Cairo time). Booked
-- hours are not stored here: they are read from the coach's sessions.
-- Mirrors drizzle/0039.

create table if not exists public.coach_availability (
  user_id text primary key references public.users(id),
  slots text not null default '[]',
  note text check (note is null or char_length(note) <= 500),
  updated_by text references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.coach_availability enable row level security;
revoke all on table public.coach_availability from anon, authenticated;
-- No policy: /api/coach-availability reads and writes these through the
-- service role after it has authorised the caller.

comment on table public.coach_availability is
  'The hours of the week each coach can take a session (JSON list of "Day-Hour", Cairo time).';
