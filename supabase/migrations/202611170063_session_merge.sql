-- 17 November 2026: one coach, two groups, the same time: a merge.
--
-- Coach Operations can give one coach two groups' sessions at the same time
-- and label it a merge. A merged session carries a merge_key shared with the
-- sessions it is merged with (one coach, one day); the one-session-a-day rule
-- still holds for every session without one. The application checks that
-- merged sessions start together and clears the key when a session moves or
-- changes coach.
-- Mirrors drizzle/0063.

alter table public.sessions add column if not exists merge_key text;

drop index if exists public.one_active_coach_session_per_day;
create unique index if not exists one_active_coach_session_per_day on public.sessions (coach_id, session_day)
  where coach_id is not null and status <> 'Cancelled' and merge_key is null;

comment on column public.sessions.merge_key is
  'Shared by the sessions one coach teaches together at the same time (a merge); empty for an ordinary session.';
