-- Where a coordinator bought a student's service.
--
-- On the Service status sheet (Accounts) the coordinator now writes what they
-- paid for each service (the order's amount, already kept) and the
-- marketplace they bought it on (Taha, 2 November 2026). Mirrors drizzle/0048.

alter table public.account_orders
  add column if not exists bought_on text check (bought_on is null or char_length(bought_on) <= 60);

comment on column public.account_orders.bought_on is
  'The marketplace the coordinator bought the service on, as they wrote it.';
