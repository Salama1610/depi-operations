-- 17 November 2026: the same service may be bought by up to three accounts.
--
-- The owner decided that a different account can buy the service another
-- account already buys, so a student with one or two approved services still
-- reaches three gigs. The unique index that allowed one account per service is
-- replaced by a plain one; the application keeps the limits (three accounts
-- per service, three per student, two students per account).
-- Mirrors drizzle/0062.

drop index if exists public.accounts_one_per_service;
create index if not exists accounts_by_service on public.accounts (service_link_id) where service_link_id is not null;

comment on column public.accounts.service_link_id is
  'The approved service this account orders for its first student; other accounts may buy the same service again (up to three accounts per service).';
