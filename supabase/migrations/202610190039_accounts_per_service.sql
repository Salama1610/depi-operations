-- 19 October 2026: a client account per approved service, not per student.
--
-- Each approved service on Kafiil, Nafezly or Khamsat earns its student an
-- available account with credit on the same marketplace, up to two accounts
-- per student (a third approved service earns none). The account records the
-- service it is for, so the coordinator knows which student and which service
-- it orders. The two-per-student cap is kept by the application, which links
-- with a guarded update; the unique index keeps one account per service.
-- Mirrors drizzle/0042.

drop index if exists public.accounts_one_per_student;
alter table public.accounts add column if not exists service_link_id text references public.service_links(id);
create unique index if not exists accounts_one_per_service on public.accounts (service_link_id) where service_link_id is not null;
create index if not exists accounts_student_idx on public.accounts (student_id) where student_id is not null;

comment on column public.accounts.service_link_id is
  'The approved service this account orders for its student (one account per service, two per student at most).';
