-- Saved column mappings for uploaded sheets.
--
-- Operations receives the same sheets every round from the ministry, the
-- providers and the coaches, each with its own column headings in English or
-- Arabic. Once somebody has said which heading fills which field, nobody
-- should have to say it again: the mapping is stored by source name and
-- offered back on the next upload.
--
-- The mapping is shared, not personal, because the sheet belongs to the
-- programme rather than to the person who happened to upload it first.
-- Mirrors the additive Drizzle migration drizzle/0016.

create table if not exists public.import_mappings (
  id text primary key,
  module text not null,
  name text not null,
  key_field text not null,
  mapping jsonb not null default '{}'::jsonb,
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module, name)
);

create index if not exists import_mappings_module_idx on public.import_mappings (module, name);

alter table public.import_mappings enable row level security;
revoke all on table public.import_mappings from anon, authenticated;
-- No policy: the API reads and writes these through the service role after it
-- has authorised the caller, exactly like the imports they belong to.

comment on table public.import_mappings is
  'Remembered heading-to-field mappings for uploaded spreadsheets, keyed by source name.';
