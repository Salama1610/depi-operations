-- 23 October 2026: "Buy", the first step of a service's order.
--
-- The team's own service-status sheet follows each service as Buy, In
-- Progress, Done, Upload POH (proof uploaded) or Canceled. Buy is when the
-- coordinator buys the service through the student's client account, before
-- the student starts the work. The other states are unchanged. Postgres only:
-- the SQLite mirror (drizzle/0045) has no check on the status.

alter table public.account_orders drop constraint if exists account_orders_status_check;
alter table public.account_orders add constraint account_orders_status_check
  check (status in ('Buy', 'In Progress', 'Done', 'Proof Uploaded', 'Cancelled'));
