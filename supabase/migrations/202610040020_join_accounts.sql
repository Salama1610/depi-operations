-- The logins people use to enter a session on the training provider's
-- platform.
--
-- The coordinators of a provider's groups share one login per provider (HRV,
-- YAT, EUI). On YAT each group also has its own login for the coach. Like the
-- marketplace credentials in account_secrets, the username and password are
-- encrypted with AES-GCM under the server-only CREDENTIAL_ENCRYPTION_KEY, with
-- the row id as additional data. No client role can read the table; the API
-- shows a login only to the people of that group (the coach and Coach
-- Operations, or the coordinator, their supervisor and Project Operations),
-- briefly, and audits every look. Mirrors drizzle/0027.

create table if not exists public.join_accounts (
  id text primary key,
  kind text not null check (kind in ('coach', 'coordinator')),
  provider text not null,
  group_id text references public.groups(id),
  username text not null,
  secret text not null,
  iv text not null,
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now(),
  check ((kind = 'coach') = (group_id is not null))
);

alter table public.join_accounts enable row level security;
revoke all on table public.join_accounts from anon, authenticated;

comment on table public.join_accounts is
  'Encrypted session join logins: one per provider for coordinators, one per group for the coach.';
