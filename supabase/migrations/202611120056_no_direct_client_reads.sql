-- No signed-in client reads the database directly (12 November 2026).
--
-- 202609180002 granted SELECT on the core tables to the authenticated role,
-- scoped by row-level policies, for direct PostgREST reads. The app never
-- made one: every read goes through the server with the service role
-- (lib/data/rpc.ts, lib/data/storage.ts), where each route applies its own
-- scope. The policies were far looser than the app (no demo isolation, no
-- revoked students, no reviewer scope, no audit cleaning), and the demo
-- sign-ins, whose password is public, counted as active staff in them. So
-- anyone signed in could read every student's contact details by calling
-- PostgREST with the publishable key.
--
-- This removes every table, column and sequence privilege of the anon and
-- authenticated roles in the public schema, stops new tables getting them by
-- default, and drops the browser read policy on the private evidence bucket.
-- Row-level security stays enabled on every table, so a privilege granted by
-- mistake later still returns no rows. depi_execute stays service-role only.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

drop policy if exists evidence_objects_scoped_read on storage.objects;
