-- The day the client paid for a gig.
--
-- A gig is now recorded once it is paid, with its proof, so the payment date is
-- part of the record. It is checked on entry to be on or after the day the
-- student's group started, so work from before the round does not count toward
-- graduation. Gigs recorded step by step before this change have no date.
-- Appended, so positional inserts stay valid on both engines. Mirrors drizzle/0019.

alter table public.gigs
  add column if not exists paid_on date;

comment on column public.gigs.paid_on is
  'The day the client paid. On or after the group start date for recorded gigs.';
