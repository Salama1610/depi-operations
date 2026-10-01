-- The coordinator and the coach each answer for a session: attending, or
-- unavailable with a reason.
--
-- Attending is the confirmation already stamped in coordinator_confirmed_at and
-- coach_confirmed_at. Unavailable is recorded here as the reason given, and
-- the leaders are notified so they can cover or reschedule the session. A
-- reschedule clears both answers. Appended, so positional inserts stay valid
-- on both engines. Mirrors drizzle/0022.

alter table public.sessions
  add column if not exists coordinator_unavailable text;

alter table public.sessions
  add column if not exists coach_unavailable text;

comment on column public.sessions.coordinator_unavailable is
  'Why the group coordinator cannot attend this session; null when they have not said so.';
comment on column public.sessions.coach_unavailable is
  'Why the coach cannot attend this session; null when they have not said so.';
