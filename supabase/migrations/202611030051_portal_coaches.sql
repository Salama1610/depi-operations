-- The ministry portal's coach for each group.
--
-- The portal has its own coach assignment per group (its "Coaches" sheet:
-- Group Code, Coach, Coach Email). Only that coach can carry a gig out on the
-- portal, so the gigs our quality team approved or rejected go to them on the
-- coach's Gigs tab, not to the group's coach here when the two differ
-- (3 November 2026). An upload of the sheet replaces the whole list.
-- Mirrors drizzle/0052.

create table if not exists public.portal_coaches (
  group_id text primary key references public.groups(id),
  coach_name text,
  coach_email text,
  coach_user_id text references public.users(id),
  uploaded_by text not null references public.users(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists portal_coaches_user_idx on public.portal_coaches (coach_user_id);

alter table public.portal_coaches enable row level security;
revoke all on table public.portal_coaches from anon, authenticated;
-- No policy: /api/portal-coaches and /api/coach-gigs read and write these
-- through the service role after they have authorised the caller.

comment on table public.portal_coaches is
  'The ministry portal''s coach for each group, from its Coaches sheet; they carry out our QC-checked gigs on the portal.';
