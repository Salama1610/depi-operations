-- A student contact no longer needs a screenshot; a short comment is asked
-- for instead (decided 10 Oct 2026). The app checks the comment. A screenshot
-- that is attached must still belong to the same student.
-- Mirrors drizzle/0037.

alter table public.contacts alter column proof_id drop not null;

create or replace function app_private.validate_contact()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if btrim(new.next_action) = '' or btrim(new.outcome) = '' then
    raise exception 'Complete contact requires an outcome and next action.' using errcode = '23514';
  end if;
  if new.proof_id is not null and not exists (
    select 1 from public.attachments a
    where a.id = new.proof_id and a.student_id = new.student_id
  ) then
    raise exception 'Contact proof must belong to the same student.' using errcode = '23514';
  end if;
  return new;
end;
$$;
