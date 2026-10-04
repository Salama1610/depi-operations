-- The DEPI portal's students and gigs sheets, and the account a service was paid from.
--
-- The leaders upload the portal's two exports several times a day; they are
-- the cohort's official record of gigs. Each upload is staged under its own
-- batch and replaces the sheet's previous upload only when every row has
-- arrived (portal_uploads records each one). The gigs sheet's portal student
-- id is the students sheet's id, and each portal student is linked to our
-- student by email, then phone (student_id; not a foreign key, since the
-- portal can hold people we do not).
--
-- A service a coordinator records now names the account used to pay for it.
-- Mirrors drizzle/0028.

alter table public.gigs
  add column if not exists paid_by_account text;

create table if not exists public.portal_uploads (
  id text primary key,
  sheet text not null check (sheet in ('students', 'gigs')),
  batch_id text not null unique,
  status text not null check (status in ('Staging', 'Active', 'Replaced', 'Abandoned')),
  file_name text,
  rows_total integer not null default 0,
  rows_linked integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  uploaded_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);
create index if not exists portal_uploads_sheet_idx on public.portal_uploads (sheet, status);

create table if not exists public.portal_students (
  id text primary key,
  batch_id text not null,
  student_id text,
  portal_id text,
  email text,
  full_name text,
  phone text,
  round_code text,
  city text,
  provider text,
  track text,
  profile text,
  status text,
  final_status text,
  graduate_type text,
  total_gigs numeric(10,2),
  approved_gigs numeric(10,2),
  rejected_gigs numeric(10,2),
  total_revenue numeric(14,2),
  proof_links jsonb not null default '[]'::jsonb
);
create index if not exists portal_students_batch_idx on public.portal_students (batch_id, portal_id);
create index if not exists portal_students_student_idx on public.portal_students (student_id);

create table if not exists public.portal_gigs (
  id text primary key,
  batch_id text not null,
  portal_gig_id text,
  portal_student_id text,
  student_email text,
  student_name text,
  title text,
  url text,
  category text,
  task text,
  organization text,
  client_name text,
  price numeric(14,2),
  created_on timestamptz,
  updated_on timestamptz,
  status text,
  provider_status text,
  auditor_status text,
  comment text,
  action_by text,
  proof_url text
);
create index if not exists portal_gigs_batch_idx on public.portal_gigs (batch_id, portal_student_id);

alter table public.portal_uploads enable row level security;
alter table public.portal_students enable row level security;
alter table public.portal_gigs enable row level security;
revoke all on table public.portal_uploads from anon, authenticated;
revoke all on table public.portal_students from anon, authenticated;
revoke all on table public.portal_gigs from anon, authenticated;
-- No policy: the API reads and writes these through the service role after it
-- has authorised the caller.
