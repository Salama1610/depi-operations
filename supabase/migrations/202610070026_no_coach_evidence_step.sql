-- A paid service's proof is no longer checked by the coach: it is recorded,
-- checked by the group's coordinator side, then decided by Quality. Proof
-- waiting at the old coach step moves to the coordinator check, and the coach
-- step can no longer be entered. Mirrors drizzle/0033.

update public.evidence set status = 'Coordinator L1', stage_at = now() where status = 'Coach Review';

create or replace function app_private.validate_evidence_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'Coordinator L1' and new.status = 'Quality Review') or
    (old.status = 'Quality Review' and new.status in ('Accepted', 'Rejected', 'L3 Review')) or
    (old.status = 'Rejected' and new.status in ('Quality Review', 'L3 Review')) or
    (old.status = 'L3 Review' and new.status in ('Accepted', 'Rejected', 'Closed L3')) or
    (old.status = 'Accepted' and new.status = 'L3 Review')
  ) then
    raise exception 'Invalid evidence workflow transition: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;
