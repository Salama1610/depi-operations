-- Orders placed through a Service Team student's client account.
--
-- When a coordinator buys a student's service with the client account linked
-- to that student, they record the order and follow it: In Progress, then
-- Done, then Proof Uploaded once the proof is in; or Cancelled (with a note).
-- Project Operations and the Service Team's supervisors read the counts on
-- their overview. Mirrors drizzle/0045.

create table if not exists public.account_orders (
  id text primary key,
  account_id text not null references public.accounts(id),
  student_id text not null references public.students(id),
  service_link_id text references public.service_links(id),
  coordinator text not null references public.users(id),
  order_ref text check (order_ref is null or char_length(order_ref) <= 120),
  amount numeric(12,2) check (amount is null or amount >= 0),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'In Progress' check (status in ('In Progress', 'Done', 'Proof Uploaded', 'Cancelled')),
  proof_id text references public.attachments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz,
  proof_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists account_orders_account_idx on public.account_orders (account_id);
create index if not exists account_orders_student_idx on public.account_orders (student_id);
create index if not exists account_orders_status_idx on public.account_orders (status, updated_at);

alter table public.account_orders enable row level security;
revoke all on table public.account_orders from anon, authenticated;
-- No policy: /api/operations reads and writes these through the service role
-- after it has authorised the caller.

comment on table public.account_orders is
  'Orders a coordinator places through a Service Team student''s client account, and how each one ended.';
