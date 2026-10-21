-- 21 October 2026: a session its coordinator marks done.
--
-- A session ends at its start plus its duration. The group's coordinator (or
-- Coach or Project Operations) can mark it done once it has started; it then
-- counts as ended from that moment, so its students' feedback form opens
-- straight away instead of waiting for the scheduled end. The week the form
-- stays open runs from whichever came first.
-- Mirrors drizzle/0044.

alter table public.sessions add column if not exists ended_at timestamptz;
alter table public.sessions add column if not exists ended_by text references public.users(id);

comment on column public.sessions.ended_at is
  'When the coordinator marked the session done, if before its scheduled end; feedback opens from then.';
