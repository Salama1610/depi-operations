-- A coordinator's written feedback on a session that has ended.
--
-- One comment per session and writer, which they can edit. It goes to the
-- session's coach and Project Operations (and the administrators); students do
-- not see it (4 November 2026). Mirrors drizzle/0055.

create table if not exists public.session_notes (
  id text primary key,
  session_id text not null references public.sessions(id),
  author text not null references public.users(id),
  comments text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists session_notes_author on public.session_notes (session_id, author);

alter table public.session_notes enable row level security;
revoke all on table public.session_notes from anon, authenticated;
-- No policy: the operations API reads and writes these through the service role
-- after it has authorised the caller.

comment on table public.session_notes is
  'What a coordinator wrote about a session after it ended; read by its coach and Project Operations.';
