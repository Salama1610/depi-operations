-- A session is confirmed by two people: the group's coordinator and its coach.
--
-- Each side's confirmation is stamped separately; confirmed_at stays the moment
-- the second one arrived, so the session reads Confirmed only when both have.
-- The schedule is followed as a case until then, and a session case belongs to
-- a group rather than a student, so cases gain a group to scope it by.
-- Appended, so positional inserts stay valid on both engines. Mirrors drizzle/0020.

alter table public.sessions
  add column if not exists coordinator_confirmed_at timestamptz;

alter table public.sessions
  add column if not exists coach_confirmed_at timestamptz;

alter table public.cases
  add column if not exists group_id text references public.groups(id);

create index if not exists idx_cases_group on public.cases(group_id) where group_id is not null;

comment on column public.sessions.coordinator_confirmed_at is
  'When the group coordinator confirmed this session. Cleared on reschedule.';
comment on column public.sessions.coach_confirmed_at is
  'When the session coach confirmed this session. Cleared on reschedule.';
comment on column public.cases.group_id is
  'The group a case is about when it is not about one student, such as a session schedule.';
