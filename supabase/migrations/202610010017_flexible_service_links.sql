-- A student submits at least three service links, in any mix of Nafezly,
-- Kafiil and Khamsat, with at most three on any one marketplace: up to nine.
--
-- Slots stop being three fixed places and become the order the links were
-- added in, 1 to 9. A submission holds between three and nine links. The
-- three-per-marketplace limit is the application's, where the marketplace is
-- read from the link. Mirrors drizzle/0024, which needs no change: the D1
-- schema never constrained the slot range or the link count.

alter table public.service_links
  drop constraint if exists service_links_slot_check;

alter table public.service_links
  add constraint service_links_slot_check check (slot between 1 and 9);

create or replace function app_private.validate_service_submission()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  links integer;
begin
  select count(*) into links from public.service_links l where l.student_id = new.student_id;
  if new.status <> 'Draft' and (links < 3 or links > 9) then
    raise exception 'A service submission holds between three and nine service links.' using errcode = '23514';
  end if;
  return null;
end;
$$;

comment on table public.service_links is
  'A student''s service links (3 to 9; at most 3 per marketplace) with per-revision QC.';
