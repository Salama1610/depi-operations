-- A staff member's job title, and the link a group meets on.
--
-- Coordinators hold one of two titles, Project Coordinator or Operations
-- Coordinator. The title is what the person is called; what they may do is still
-- decided by their roles, so both titles carry the Operations Coordinator role
-- and no permission rule has to learn a second name for the same job.
--
-- Every group meets on one standing Teams or LMS link, published with the
-- programme calendar. It belongs to the group rather than to each session.
--
-- Both columns are appended, so positional inserts written against the earlier
-- column order stay valid on both engines. Mirrors drizzle/0018.

alter table public.users
  add column if not exists title text;

alter table public.groups
  add column if not exists session_link text;

comment on column public.users.title is
  'Job title shown beside the name, e.g. Project Coordinator. Permissions come from roles.';
comment on column public.groups.session_link is
  'The standing Teams or LMS link the group meets on.';
