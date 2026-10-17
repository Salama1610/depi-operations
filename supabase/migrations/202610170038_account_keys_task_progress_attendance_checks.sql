-- Asked for on 17 October 2026.
--
-- accounts.student_id: the student a client account is the key for. Once a
-- Service Team student has two approved service links, an available account
-- with credit on the same marketplace is linked to them and to their
-- coordinator. The student never sees it; the coordinator uses it to order that
-- student's services. One student per account and one account per student. A
-- linked account is locked: only the people holding the "account-unlock" scope
-- can release it. linked_by is null when the app linked it automatically.
--
-- accounts.coordinator_state / coordinator_note: the coordinator's word on the
-- account (in use, not used yet, needs a new account, does not work).
--
-- task_progress: where a coordinator stands on a task without closing it, e.g.
-- "Contacted the student" on a service link the quality team sent back. The
-- task itself closes when the quality team approves the corrected link.
--
-- attendance_checks: the quality team's check of a held session's register,
-- Valid or Has problems with a note, read by Coach and Project Operations.
-- Mirrors drizzle/0041.

alter table public.accounts add column if not exists student_id text references public.students(id);
alter table public.accounts add column if not exists linked_at timestamptz;
alter table public.accounts add column if not exists linked_by text references public.users(id);
alter table public.accounts add column if not exists coordinator_state text
  check (coordinator_state is null or coordinator_state in ('In use', 'Not used yet', 'Needs a new account', 'Does not work'));
alter table public.accounts add column if not exists coordinator_note text
  check (coordinator_note is null or char_length(coordinator_note) <= 1000);
alter table public.accounts add column if not exists coordinator_state_at timestamptz;
alter table public.accounts add column if not exists coordinator_state_by text references public.users(id);
create unique index if not exists accounts_one_per_student on public.accounts (student_id) where student_id is not null;

create table if not exists public.task_progress (
  task_id text primary key references public.tasks(id),
  status text not null check (status in ('Contacted the student', 'Could not reach the student', 'Student is fixing it')),
  note text check (note is null or char_length(note) <= 1000),
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.task_progress enable row level security;
revoke all on table public.task_progress from anon, authenticated;

create table if not exists public.attendance_checks (
  session_id text primary key references public.sessions(id),
  status text not null check (status in ('Valid', 'Has problems')),
  note text check (note is null or char_length(note) <= 2000),
  checked_by text not null references public.users(id),
  checked_at timestamptz not null default now()
);
create index if not exists attendance_checks_status_idx on public.attendance_checks (status);
alter table public.attendance_checks enable row level security;
revoke all on table public.attendance_checks from anon, authenticated;
-- No policies: the API reads and writes these through the service role after
-- it has authorised the caller.

comment on column public.accounts.student_id is
  'The student this client account is the key for (one each way); locked until released by an account-unlock holder.';
comment on table public.task_progress is 'A coordinator''s progress on an open task, such as having contacted the student.';
comment on table public.attendance_checks is 'The quality team''s check of a held session''s attendance register.';
