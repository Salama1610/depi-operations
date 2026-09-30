# Private deployment status

## Current deployment (2026-09-30)

- **Hosting**: Vercel, team Career-180-TMS, project `depi-operations`, production URL `https://depi-r5.vercel.app`, Node runtime, `next build`. Linked to GitHub `Salama1610/depi-operations` (branch `main` deploys automatically).
- **Database**: Supabase project `gmpvyuoepbvmsmlyhjdq` ("Depi R5", West EU Ireland, PostgreSQL 17), reached over the HTTPS transport (`depi_execute`). 12 migrations recorded; 61 tables, RLS on all; private bucket `depi-evidence`. Migrations are applied with `scripts/apply-supabase-migrations.mjs --credentials <file> --management-api`.
- **Roster**: import `ROSTER-D8F69A41505E300C` from `Database27-9.xlsx` — 2,867 rows, 2,867 students, no duplicates. 2,867 students are Active; 20 who are not in that sheet are kept as Withdrawn (19) or Removed (1) with their sign-ins suspended. 4 active tracks (Data Analytics, Digital Arts, Management & ERP, Software Development); 128 active groups and 4 closed (the three Industry groups and `GIZ5_ERP6_S1`).
- **Staff**: 39 active — 3 administrators, 2 Project Operations, 2 Coach Operations, 4 team supervisors (one of them also Project Operations), 25 coordinators (Project or Operations Coordinator), 1 Quality Lead and 4 Quality Members. Every active group has a coordinator and a supervisor; no group has a coach yet.
- **Calendar**: 1,024 sessions, eight per active group, 11 October to 13 December 2026, each group with its Teams/LMS link. No session has a coach yet, so none can be confirmed and no attendance has been recorded.
- **Auth**: 2,926 sign-in accounts, 20 of them suspended. Students and staff sign in with their email and, the first time, their 14-digit national ID. The site URL and redirect allowlist point at the Vercel URL (plus preview hosts and localhost); public sign-up is disabled — accounts are provisioned only.
- **Vercel environment** (Production and Preview): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_EVIDENCE_BUCKET`, `CREDENTIAL_ENCRYPTION_KEY`, `BACKUP_ENCRYPTION_KEY`, `AUTOMATION_HMAC_SECRET`. The Supabase↔Vercel integration's own variables (`POSTGRES_*`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SECRET_KEY`, …) are present but unused by the app.
- Deployment Protection is off, and Preview deployments use the production database: a pushed branch is reachable, so work that must not reach users stays unpushed. `depi-operations-bay.vercel.app` and the `…-career-180-tms.vercel.app` alias redirect (308) to `depi-r5.vercel.app`. A duplicate project `depi-operations-3ixw` (created from the dashboard, invalid Supabase variables) still exists, builds every push, and can be deleted.
- **Previous project** `wfqkcafsolcqkarvilvg` (old Supabase account) still holds a copy of the first roster and the pilot accounts; retire it.

## History

The workspace was first published as a Codex Site (`depi-coaching-operations.abdelrhman-shoman62.chatgpt.site`) running as a Cloudflare Worker. It moved to Vercel on 21 September 2026; `npm run build:cloudflare` still produces the Worker build, but nothing is deployed there.

An earlier migration failure was resolved without deleting or resetting a database. The hosted runner had split trigger bodies at internal semicolons. Table, index and foreign-key migrations remain in the Drizzle archive; equivalent database triggers are installed after migrations during workspace initialization and restore.

The release includes a blank-production first-run choice and a separate clearly labelled synthetic pilot. An administrator can append the pilot to an already initialized workspace only while it still contains no operational records. This guarded path preserves the owner and effective policy and refuses to mix fixtures into active operations.

## Validation

`npm test` runs the domain, integration, schema, transport, i18n and weekly-view suites; `npm run test:postgres` runs the full service suite against an embedded PostgreSQL with the real migrations. Both, with TypeScript validation, lint and `next build`, pass on every commit pushed to `main`.
