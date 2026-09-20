-- Service operations: the account-manager tier, the link from a published
-- service back to the controlled account it came from, and marketplace
-- credentials held by the programme.
--
-- Mirrors the additive Drizzle migration drizzle/0014. Every column is
-- nullable or in a new table, so existing rows are untouched.

-- 1. The tier above the supervisor. Groups that predate it stay null.
alter table public.groups
  add column if not exists account_manager text references public.users(id);

-- 2. Which controlled account published this service. Resolved from the
--    student's active assignment on that platform when the link is recorded,
--    so nobody has to type it, and left null when it cannot be resolved.
alter table public.service_links
  add column if not exists account_id text references public.accounts(id);

create index if not exists service_links_account_idx on public.service_links (account_id);

-- 3. Marketplace credentials, encrypted with a server-only key before they
--    reach the database. The ciphertext is useless without that key, and no
--    client role may read this table at all: the API decrypts, shows the value
--    briefly to an authorised person, and records who asked and why.
create table if not exists public.account_secrets (
  account_id text primary key references public.accounts(id),
  username text not null,
  secret text not null,
  iv text not null,
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now()
);

alter table public.account_secrets enable row level security;
revoke all on table public.account_secrets from anon, authenticated;
-- Deliberately no policy: only the service role, acting after the API has
-- authorised the caller, can read or write these rows.

comment on table public.account_secrets is
  'Encrypted marketplace credentials. Readable only by the backend service role after API authorisation.';
