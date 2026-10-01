-- A student submits one service at a time.
--
-- A submission therefore holds from one link up to nine. Whether the student
-- has done enough (three links at least, with a Kafiil and a Nafezly service
-- among them) is the submission's status, worked out by the application, not
-- a reason to refuse the row. Open links on other sites are recorded with the
-- platform 'External service', which the platform check already allows.
-- Mirrors drizzle/0025, which needs no change.

create or replace function app_private.validate_service_submission()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  links integer;
begin
  select count(*) into links from public.service_links l where l.student_id = new.student_id;
  if new.status <> 'Draft' and (links < 1 or links > 9) then
    raise exception 'A service submission holds between one and nine service links.' using errcode = '23514';
  end if;
  return null;
end;
$$;

comment on table public.service_links is
  'A student''s service links, submitted one at a time (1 to 9; at most 3 per marketplace; a Kafiil and a Nafezly service required for completion) with per-revision QC.';
