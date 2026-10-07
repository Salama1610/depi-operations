-- Client accounts: who owns each one, and which coordinator works it.
--
-- The owner is the coordinator written against the account in the accounts
-- sheet. It is a recorded value, not an assignment, and only the keeper of the
-- accounts list and administrators read it. The coordinator is the one a
-- supervisor assigns the account to now. Pending credit and the sheet's
-- comments come across with them. Mirrors drizzle/0031.

alter table public.accounts add column if not exists owner_name text;
alter table public.accounts add column if not exists coordinator_id text references public.users(id);
alter table public.accounts add column if not exists pending_credits numeric(14,2) not null default 0;
alter table public.accounts add column if not exists comments text;

create index if not exists idx_accounts_coordinator on public.accounts(coordinator_id);
