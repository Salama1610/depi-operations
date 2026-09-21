# Private deployment status

## Current deployment (2026-09-21)

- **Hosting**: Vercel, team Career-180-TMS, project `depi-operations`, production URL `https://depi-r5.vercel.app`, Node runtime, `next build`. Linked to GitHub `Salama1610/depi-operations` (branch `main` deploys automatically).
- **Database**: Supabase project `gmpvyuoepbvmsmlyhjdq` ("Depi R5", West EU Ireland, PostgreSQL 17), reached over the HTTPS transport (`depi_execute`). All 8 migrations recorded; 60 tables, RLS on all; private bucket `depi-evidence`.
- **Data**: roster import `ROSTER-65847283428B8258` — 5 tracks, 131 groups, 2,887 students (2,887 unique emails), 2,948 source rows, 61 duplicates linked, status Reconciled. Bootstrap admin provisioned; 12 pilot student logins in `CAI5_SWD5_G1` (national-ID first password).
- **Auth**: site URL and redirect allowlist point at the Vercel URL (plus preview hosts and localhost); public sign-up disabled — accounts are provisioned only.
- **Vercel environment** (Production and Preview): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EVIDENCE_BUCKET`, `CREDENTIAL_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, `AUTOMATION_HMAC_SECRET`. The Supabase↔Vercel integration's own variables (`POSTGRES_*`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, …) are present but unused by the app.
- Deployment Protection is off. `depi-operations-bay.vercel.app` and the `…-career-180-tms.vercel.app` alias redirect (308) to `depi-r5.vercel.app`. A duplicate project `depi-operations-3ixw` (created from the dashboard, invalid Supabase variables) still exists and can be deleted.
- **Previous project** `wfqkcafsolcqkarvilvg` (old Supabase account) still holds a full copy of the roster and the same pilot accounts; retire it once the new deployment is confirmed.

The DEPI Round 5 Operations workspace is privately published at:

<https://depi-coaching-operations.abdelrhman-shoman62.chatgpt.site>

## The published build is behind the repository

As of 20 September 2026 the published Site still serves a build from before the Supabase authentication change: it returns the superseded "Sign in with your staff account" message. The Supabase data path, the roster import flow and the Supabase sign-in are all committed but **not deployed**.

To publish the current commit, the operator must:

1. Push the tested commit to the Sites remote. This requires the operator's own Sites credentials; the push cannot be completed from an unattended session.
2. Package that same commit, save a Site version, and deploy it privately with the configured audience.
3. Set the runtime settings before or with that deployment: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_EVIDENCE_BUCKET=depi-evidence`. The service-role key is server-only. No database connection string is needed by the deployed Worker.
4. Add the Site's `/auth/callback` URL to the Supabase Auth redirect allowlist.
5. Wait for a terminal successful deployment before distributing the URL.

Do not deploy a dirty worktree or a package that differs from the pushed commit.

## Supabase project state

The operational database, Auth and private evidence storage are live and hold the approved Round 5 roster. All four migrations are applied and recorded in `supabase_migrations.schema_migrations`: 59 tables with row-level security enabled on every one, 22 application triggers, the private 8 MB `depi-evidence` bucket, and the server-only `depi_execute` transport function.

The workspace was initialized as production by the bootstrap administrator, who is currently the only active staff user. Every group still references the three disabled `system-unassigned-*` placeholder records, and every group start date is the import placeholder.

## Release history

An earlier migration failure was resolved without deleting or resetting a database. The hosted runner had split trigger bodies at internal semicolons. Table, index and foreign-key migrations remain in the Drizzle archive; equivalent database triggers are installed after migrations during workspace initialization and restore.

The release includes a blank-production first-run choice and a separate clearly labelled synthetic pilot. An administrator can append the pilot to an already initialized workspace only while it still contains no operational records. This guarded path preserves the owner and effective policy and refuses to mix fixtures into active operations.

## Validation of the current commit

114 automated tests pass, including the full service suite run three ways: against the SQLite mirror of the D1 schema, against PostgreSQL through the wire client, and against PostgreSQL through the HTTPS transport the deployed Worker uses. TypeScript validation, lint, the production Worker build, additive migration generation and encrypted restore verification all pass.
