-- The coach's decision on a portal gig.
--
-- The ministry portal's gigs sheet has three decisions: Trainer Status (the
-- coach), Provider Status (the portal's own quality check, not ours) and
-- Auditor Status (the third party). Until now Provider Status was read as the
-- coach's, so gigs the coach had already decided stayed in our QC queue
-- (7 November 2026). Mirrors drizzle/0056.

alter table public.portal_gigs add column if not exists trainer_status text;

comment on column public.portal_gigs.trainer_status is
  'The sheet''s Trainer Status: the coach''s decision on the portal. Provider Status is the portal''s own QC.';
