# DEPI Coaching & Freelancing Operations

Operations system for Career180 and Freelance Yard, implementing the supplied Round 5 V3 operating model end to end, with a separate authenticated student service-link portal. Staff permissions and student-record ownership are enforced server-side. Connections and recovery are documented in `docs/connections-and-recovery.md`.

## Run and validate

- Node 22.13+; install with `npm run install:ci`.
- `npm run dev` starts the local Vite development server on Windows, macOS or Linux.
- `npm run build` emits a Cloudflare-compatible Worker and assets.
- `node --experimental-strip-types --test tests/domain.test.mjs tests/integration.test.mjs` validates the actual service against SQLite plus domain rules.
- `npx tsc --noEmit` validates TypeScript.
- `npm run lint` checks source quality; after building, `npm run test:all` also checks generated HTML and UI components.
- `npm run db:generate` generates additive migrations after schema changes. Do not change previously applied migrations.

Production data lives in Supabase: PostgreSQL (`supabase/migrations/`, with integrity triggers, read-only scoped RLS and Auth identity binding), Supabase Auth, and a private evidence bucket. The deployed Worker reaches PostgreSQL over HTTPS through the server-only `public.depi_execute` function (`lib/data/rpc.ts`) when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, because Cloudflare's runtime cannot validate the Supabase pooler's private CA over raw TCP; the wire-protocol client (`lib/data/postgres.ts`, `SUPABASE_DB_URL`) serves Node tooling and tests, and production fails closed without Supabase settings; the D1/R2 bindings are honoured only with `LOCAL_DATA_FALLBACK=1` for previews and tests. `docs/data-path-migration.md` is the rehearsed cut-over and rollback runbook (`npm run migrate:supabase`), and `npm run test:postgres` / `npm run test:postgres-rpc` run the full service suite against an embedded PostgreSQL with the real migrations through the wire client and the HTTPS transport respectively. Row restrictions and role authorization continue to be enforced by server services.

## Initial use

Open the Site, sign in with Supabase, and choose a blank production workspace or the synthetic pilot. An administrator can also append the pilot later from Administration, but only while the production workspace still has no operational footprint. The guarded, retry-safe pilot keeps the existing owner and effective policy, then creates 1,000 synthetic students, 40 groups, 1,000 tasks, role-specific staff profiles, 40 sessions and 20 controlled-account metadata records. Representative synthetic records cover intake, attendance, account reservation/allocation, gigs, review stages, rejection correction, graduation, certification, outcomes, withdrawals, cases, reporting, retention and notifications. Fifteen tiny private PNG fixtures make proof links testable. Everything remains visibly labelled synthetic.

The initializing owner receives Project Operations and Operations Systems / Admin roles. Quality and Higher Board powers are not silently granted. Add or explicitly modify staff access in Administration, with a reason. Example staff addresses end in `example.invalid` and cannot be used as real accounts. App staff membership is checked separately from Supabase authentication.

## Supabase authentication setup

Pre-provision the authorized staff and student users in Supabase Auth, then configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, the server-only `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_EVIDENCE_BUCKET=depi-evidence` in the hosted Site environment. Apply `supabase/migrations/*.sql` to the project first (`node scripts/apply-supabase-migrations.mjs --db-url <session pooler URL>` records applied versions and is safe to rerun). Add `https://depi-coaching-operations.abdelrhman-shoman62.chatgpt.site/auth/callback` to the Supabase redirect allowlist for password recovery. Each Supabase user email must exactly match one active staff or student record; public self-registration is intentionally disabled. `scripts/provision-supabase-users.py` creates roster identities without sending bulk email, and each student activates access through the password-reset flow.

## Working features

- Responsive operations overview, complete program flow, work queues, student directory/360, groups, sessions, accounts, gigs, evidence, Quality, cases, reports and administration.
- Student service-link portal with Supabase email/password sign-in, server-validated cookie sessions, password reset, confirmed three-link submission, recoverable device drafts, strict Kafiil/Khamsat URL rules, per-link correction/locking, review history and timestamps.
- Service-link QC filters, assignment, pagination, SLA reminders, Quality Lead overrides, Student 360 history, operational metrics, exports, roster-health reporting and backup/restore coverage.
- Coach Operations session control with Regular (8) and Industry (5) delivery plans, policy-locked 180-minute duration, onboarded coach assignment, Cairo-day conflict prevention, coach confirmation, reasoned reschedule/cancellation, attendance completion, delivery notes and SLA/coverage dashboards.
- Identity from Supabase Auth; backend staff role and assigned-group checks; students access `/student` through their registered email without self-registration.
- Screenshot-backed contact logging, next actions, valid-contact compliance and risk recommendations.
- Private image storage, byte-signature checks, 8 MB upload limit, hashes, authorized file delivery and upload audit.
- Account request/allocation with database-enforced duplicate student/group use and concurrent eligibility protection.
- Sequential gig events, performed-by versus recorder, paid-gig evidence intake, Coach/L1/Quality review, rejection corrections and L3 escalation cases.
- Atomic graduation ledger entries based on accepted paid USD gigs and the group's policy.
- Auditable attendance, student transfers, controlled group closure and cases with separate verification.
- XLSX/CSV exports and imports for supported mutable operational modules; templates, validation preview, commit revalidation, reconciliation and error CSV.
- Editable draft policy versions, independent approval, effective-policy selection for new groups, protected approved contents and explicit access-change audit.
- Immutable audit and review history; actor-bound idempotency keys for successful mutations.
- A staff-triggered policy check creates contact/recovery tasks, supervisor interventions and review-SLA escalations in bounded, retry-safe batches.
- Independent maker-checker approval for Ministry report formats, controlled CSV/XLSX handoffs and report-run history.
- Safe atomic bulk group-owner, learner-classification and task actions; Quality, graduation and allocation stay individual.

## Added integration features

- Signed scheduled-job API, replay protection, run history and controlled failed-job retry.
- Inactive self-hosted n8n workflow files and a signing runner for hourly policy checks and weekly reports.
- Persistent per-recipient notifications with read state.
- Date-window activity reports, review SLA backlog, platform account capacity and explicit graduation scenarios.
- Restricted credential-vault adapter with purpose audit, timed display and exposure incident creation.
- AES-GCM encrypted database/evidence export and an offline recovery verifier; local restore drill passed.

These features need protected connection settings to run against real services. They have not been activated or published.

The service-link operating rules, student/QC procedures, roster import process, role matrix, incident response, launch checklist and UAT template are in `docs/service-link-launch-pack.md`.

## Organization-owned activation inputs

See `docs/production-readiness.md`. Before loading real student data, the organization must add the real role-separated staff roster, approve the Ministry report mapping and retention periods, connect the selected credential vault and backup destination, activate the scheduler if required, and complete staff UAT/security/recovery sign-off. These are environment and policy decisions; the product flow is implemented.

## Source layout

- `app/operations.tsx`: role-aware working surface and workflows.
- `app/api`: authenticated service interfaces, uploads, spreadsheets.
- `lib/domain/rules.ts`: business rules and baseline policy.
- `lib/server.ts`: centralized database, identity, scope, audit and graduation helpers.
- `lib/seed.ts`: synthetic, atomic pilot initialization and guarded blank-workspace append.
- `db/schema.ts`, `drizzle/`: normalized schema, migrations and integrity triggers.
- `supabase/migrations/`, `docs/supabase-backend.md`: PostgreSQL target, RLS, private storage and migration boundary.
- `lib/data/`, `scripts/migrate-d1-to-supabase.mjs`, `docs/data-path-migration.md`: PostgreSQL/Storage adapters, the reconciled data migration and its runbook.
- `tests/`: executable domain, service integration, rendering and UI component tests.
- `docs/`: setup, deployment, metric definitions and remaining release gates.
