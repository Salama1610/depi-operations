-- A client-account request no longer has to come from the approved task bank.
--
-- The request names the marketplace, the gig the programme's client account
-- will order and the credit it needs; an approved task, when there is one,
-- still fills those in and is recorded here. Mirrors drizzle/0021.

alter table public.account_request_details
  alter column task_bank_id drop not null;
