# Data path migration — D1/R2 to Supabase

Production runs on Supabase only: PostgreSQL for operational data, Supabase Auth for identity and a private Storage bucket for evidence screenshots. Cloudflare D1/R2 remain only as the source of the one-time import and as the rollback artifact. This document is the runbook for that switch.

## How the runtime reaches the database

`lib/server.ts` still exposes `db()` and `bucket()` to every route. They now resolve through two adapters:

- `lib/data/database.ts` selects the transport. In the deployed Worker it is the HTTPS transport (`lib/data/rpc.ts`): translated statements are posted with the service role to `public.depi_execute` (migration `202609200004`), one call per transaction, because workerd cannot validate the Supabase pooler's private certificate chain over raw TCP. The wire client (`lib/data/postgres.ts`) is used where Node runs (scripts, tests) when `SUPABASE_DB_URL` is set, or when `SUPABASE_DB_TRANSPORT=postgres` forces it. Without Supabase settings the adapter fails closed; the injected D1 binding is honoured only with `LOCAL_DATA_FALLBACK=1` (tests and developer previews).
- `lib/data/storage.ts` returns the private Supabase bucket when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, and likewise honours the R2 binding only with `LOCAL_DATA_FALLBACK=1`.

`lib/data/postgres.ts` implements the statement interface the application was written against (`prepare().bind().first()/all()/run()` and atomic `batch()`) on top of the `postgres` driver, and holds the SQL translation that both transports share. Application SQL is unchanged; the adapter translates the few SQLite idioms (positional `?`, `INSERT OR IGNORE`, `json_extract`, `json_group_array`, `group_concat`, scalar `min/max`, `LIKE`), qualifies `ON CONFLICT DO UPDATE` references, converts 0/1 literals for boolean columns, casts `CASE` assignments to the declared column type, and normalizes result values so rows look exactly like D1 rows (booleans as 1/0, timestamps as ISO strings, JSON as text, numerics as numbers). Constraint failures keep the `UNIQUE constraint failed` / `FOREIGN KEY constraint failed` wording the routes already map to user messages.

All rewrites are driven by `supabase/column-types.json`, the table → column → type contract that mirrors `supabase/migrations/`. Keep that file in step with the migrations; `tests/data-adapter.test.mjs` fails if the column order diverges from the deployed D1 schema.

## Validation

| Command | What it proves |
|---|---|
| `npm test` | Domain rules, the service integration suite on the SQLite mirror of D1, the Supabase schema parity checks and the adapter unit tests (translation, value semantics, atomic batches, integrity triggers) against an embedded PostgreSQL 18 with the real migrations applied. |
| `npm run test:postgres` | The complete service integration suite (the 1,000-student synthetic pilot, role gates, triggers, service links, backup export, the migration script end to end) executed against embedded PostgreSQL through the wire client. |
| `npm run test:postgres-rpc` | The same suite through the HTTPS-shaped transport and `public.depi_execute`, the path the deployed Worker uses. |
| `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:all` | Types, quality, the Worker bundle (which now includes the PostgreSQL driver) and the rendering checks. |

The embedded server is downloaded by `embedded-postgres` on install; no local PostgreSQL is required. `tests/helpers/supabase-stubs.sql` provides the `auth`/`storage` objects and roles the migrations reference so they can be applied to a plain server.

## Cut-over procedure

1. **Create the Supabase project** (free tier is sufficient). In the SQL editor or with the Supabase CLI, apply `supabase/migrations/*.sql` in timestamp order. The executing role must be able to manage the `storage` schema; the third migration creates the private `depi-evidence` bucket.
2. **Provision identities.** Run `scripts/provision-supabase-users.py` for the staff roster and students, and add the site's `/auth/callback` URL to the Auth redirect allowlist. `users.auth_user_id` may stay `NULL`; staff resolve by normalized email until bound.
3. **Export the current data.** From Administration, generate the encrypted backup (`depi-backup-YYYY-MM-DD.zip`). Freeze staff writes for the cut-over window.
4. **Rehearse** against the empty project:

   ```bash
   BACKUP_ENCRYPTION_KEY=<64 hex> node scripts/migrate-d1-to-supabase.mjs \
     --backup depi-backup-2026-09-18.zip --database "$SUPABASE_DB_URL" --dry-run --report rehearsal.json
   ```

   The script decrypts and verifies the archive, checks every exported column against the contract, loads all tables in foreign-key order inside one transaction, reconciles row counts and canonical content hashes per table, then rolls back. Fix any `DIFF` before continuing. The load runs with the application's PostgreSQL triggers disabled (as `pg_restore` does) because they guard live state transitions that historical rows already passed; foreign keys, uniqueness and check constraints stay enforced. Pass `--keep-triggers` to replay through the triggers anyway.
5. **Migrate.** Re-run without `--dry-run`, adding `--supabase-url`/`--service-role-key` (or the environment variables) so evidence objects are copied to the bucket and re-downloaded to verify their SHA-256 hashes. The command exits non-zero and writes the report if anything did not reconcile; rows are only committed when every table matches.
6. **Switch the runtime.** Set the protected settings and redeploy:

   ```text
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<service role key>
   SUPABASE_EVIDENCE_BUCKET=depi-evidence
   ```

   Those four are the runtime settings: the Worker reaches PostgreSQL over HTTPS through `public.depi_execute` with the service role. Do **not** set `SUPABASE_DB_URL` on the deployed Worker; it is the wire connection string for Node tooling only (this migration script, `scripts/apply-supabase-migrations.mjs`, tests). For those tools use the **transaction-mode pooler** (port 6543); the wire client disables prepared statements for it. Never expose the service-role key or the database URL to the browser.
7. **Smoke test** with a staff account and a student account: dashboard load, a contact with a screenshot, a service-link QC decision, an export, and a backup export. Read the audit log to confirm writes land in PostgreSQL.

## Rollback

The source is never modified. To roll back, remove the Supabase runtime settings from the protected settings, set `LOCAL_DATA_FALLBACK=1` for that deployment only, and redeploy; the Worker returns to D1/R2 with the data as it was at the export time. Any writes made on Supabase after the switch must be re-exported and replayed if you roll back and later switch again, so keep the freeze window short and record its start and end in the change log.

## Boundaries

- Row-level security policies in the migrations grant `authenticated` read scope only; the Worker writes with the service role after its own authorization, validation, rate-limit and audit steps, exactly as before.
- Supabase Auth sessions are unchanged; the migration only moves operational data.
- The additive Drizzle migration `drizzle/0013_*.sql` adds `users.auth_user_id` to the SQLite/D1 schema so both engines share one column set and the offline restore verifier accepts backups taken from either.
