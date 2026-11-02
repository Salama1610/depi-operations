-- 2 November 2026: every comment of the quality team on a portal gig is kept.
--
-- A portal gig review held one comment, replaced by each new decision. Each
-- decision (with its comment, or none), each comment added on its own, and
-- each new proof the student uploads is now one entry here, kept in order, so
-- the old comments and the new ones are read together: on the Portal gigs QC
-- card, by the coach and by the coordinator. Entries follow the review's proof
-- key (see 202611020048); when the student replaces the proof they move to the
-- new one, so the reason for a rejection stays next to the new proof.
-- Filled from the decisions already in the activity history.
-- Mirrors drizzle/0050.

create table if not exists public.portal_gig_review_notes (
  id text primary key,
  proof_key text not null,
  portal_gig_id text,
  kind text not null check (kind in ('decision', 'comment', 'new_proof')),
  status text,
  comment text,
  author text references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists portal_gig_review_notes_key_idx on public.portal_gig_review_notes (proof_key, created_at);

alter table public.portal_gig_review_notes enable row level security;
revoke all on table public.portal_gig_review_notes from anon, authenticated;

insert into public.portal_gig_review_notes (id, proof_key, portal_gig_id, kind, status, comment, author, created_at)
select 'PGN-' || a.id,
       r.proof_key,
       a.entity_id,
       'decision',
       a.value ->> 'status',
       nullif(trim(a.value ->> 'comment'), ''),
       (select u.id from public.users u where u.id = a.actor),
       a.created_at
  from public.audit_events a
  join public.portal_gig_reviews r on r.portal_gig_id = a.entity_id
 where a.action in ('Portal gig approved by quality', 'Portal gig rejected by quality', 'Portal gig review reopened')
on conflict (id) do nothing;

comment on table public.portal_gig_review_notes is
  'The quality team''s decisions and comments on each portal gig, in order, so earlier comments are kept next to new ones.';
