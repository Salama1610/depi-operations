-- Hand-made links between a student on the DEPI portal and one of ours.
--
-- When an upload cannot match a portal student, Project Operations or an
-- administrator links them by typing our student's national ID. The link is
-- kept here, by the portal's own student ID (and the email the portal had),
-- so every later upload links that person the same way, before any other
-- rule. Only our student is kept, never the national ID typed.
-- Mirrors drizzle/0046.

create table if not exists public.portal_links (
  portal_id text primary key,
  email text,
  student_id text not null references public.students(id),
  linked_by text not null references public.users(id),
  linked_at timestamptz not null default now()
);
create index if not exists portal_links_email_idx on public.portal_links (email);

alter table public.portal_links enable row level security;
revoke all on table public.portal_links from anon, authenticated;
-- No policy: /api/portal reads and writes these through the service role
-- after it has authorised the caller.

comment on table public.portal_links is
  'Portal students linked to ours by hand (through a national ID), applied to every later upload.';
