-- National IDs are first passwords: no signed-in client may read them from the
-- database.
--
-- Every application table grants SELECT to the authenticated role so the
-- row-level policies of 202609180002 can scope direct PostgREST reads. A
-- table-level grant covers every column, so users.national_id (every member of
-- staff's, admins included) and students.national_id (within the reader's
-- scope) were readable by any active member of staff holding the public key.
-- This swaps the table-level SELECT on those two tables for a column-level one
-- on every other column. The app reads through the service role and is not
-- affected. A column added to either table later stays unreadable by the
-- authenticated role until it is granted here too: closed by default.

do $$
declare
  target text;
  readable text;
begin
  foreach target in array array['users', 'students'] loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into readable
      from information_schema.columns
     where table_schema = 'public' and table_name = target and column_name <> 'national_id';
    execute format('revoke select on table public.%I from authenticated', target);
    execute format('grant select (%s) on table public.%I to authenticated', readable, target);
  end loop;
end $$;
