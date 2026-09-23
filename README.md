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

Pre-provision the authorized staff and student users in Supabase Auth, then configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, the server-only `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_EVIDENCE_BUCKET=depi-evidence` in the hosted Site environment. Apply `supabase/migrations/*.sql` to the project first (`node scripts/apply-supabase-migrations.mjs --db-url <session pooler URL>` records applied versions and is safe to rerun). Add `https://depi-coaching-operations.abdelrhman-shoman62.chatgpt.site/auth/callback` to the Supabase redirect allowlist for password recovery. Each Supabase user email must exactly match one active staff or student record; public self-registration is intentionally disabled. Two provisioning tools exist. `scripts/provision-student-logins.mjs` reads the students straight from the operational database and creates their accounts, either with a random secret they claim through password recovery or, for a supervised rollout, with the student's own 14-digit national ID or business ID as a first-login password; it is a dry run unless `--apply` is passed. `scripts/provision-supabase-users.py` does the same from a private SQLite roster build. Neither sends bulk email. A national ID or student ID is printed on the roster and is therefore a first-login credential, not a secret, so students must change it immediately.

## Interface language

The interface is available in English and Arabic. The toggle in every header (sign-in, password reset, student portal, staff console) stores the choice in the `depi_lang` cookie and reloads, so the server renders the chosen language and text direction (`<html lang dir>`) from the first paint. English is the source text: `lib/i18n/ar.ts` maps each English string to Arabic and `t("…")` (from `useT()` in client components, `getT()` on the server) falls back to the English when no entry exists, which is how names, identifiers, URLs and codes pass through untouched. Status values, roles, filter options and table headings are translated where they are displayed, so the stored English values and the API contract do not change. `tests/i18n.test.mjs` fails when an interface string has no Arabic entry or a translation loses a `{placeholder}`.

## Working features

- Responsive operations overview, complete program flow, work queues, student directory/360, groups, sessions, accounts, gigs, evidence, Quality, cases, reports and administration.
- Student service-link portal with Supabase email/password sign-in, server-validated cookie sessions, password reset, confirmed three-link submission, recoverable device drafts, strict Kafiil, Khamsat and Nafezly URL rules, per-link correction/locking, review history and timestamps.
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

## Publishing to a Google Sheet

`scripts/publish-to-google-sheet.mjs` writes operational views into a Google Sheet, one tab per dataset: groups, service-link status, controlled accounts and roster health. It is deliberately one way. The workspace holds the rules, the constraints and the audit trail, so a two-way sync would let a pasted cell bypass all of them. Marketplace credentials are never published.

It needs a Google service account: create a project, enable the Sheets API, download the service-account key, and share the sheet with that account's address as an Editor. Nothing is billed at this volume. Run with `--dry-run` first to see the row counts.

## Brand

The interface uses the Freelance Yard identity: the orange and navy palette from the supplied colour sheet, Bebas Neue for display text and Montserrat for everything else, with GE SS Two as the Arabic face where installed. The logo files live in `public/brand/`. The layout reflows from wide desktop down to phone width.

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

## Spreadsheets

Every dataset exports as CSV, as an Excel sheet, or as one workbook with a tab per dataset (`/api/export?module=workbook`). Workbooks carry a bold frozen header, fitted columns and numeric cells, so they open cleanly in Excel and Google Sheets.

Sheets from other sources are linked on the **national ID**. On upload the application proposes which heading fills which field — it recognises English and Arabic headings — and which column identifies the student; you confirm or correct that, and the mapping can be remembered by source name so the next arrival of the same sheet needs no setup. Identifiers damaged by Excel (scientific notation, Arabic-Indic digits, spaces, dashes, a leading apostrophe) are recovered before matching.

Staff are added the same way: a sheet of name, email and roles creates or updates the people who can sign in, and a group is handed over by naming the person — their email or their name resolves to the right account, so no internal reference ever has to appear in a sheet. Access is withdrawn from the staff directory, which stops the person signing in and removes them from the list a group can be handed to, while their history stays.

Imports run in two modes from the import workspace. **Add new records** creates rows through the same workflow actions as the forms (1,000 rows per upload). **Update existing records** merges sheets from other sources into students, groups and accounts: rows are matched by ID (students also by email, national ID or TP ID), only the columns present change, empty cells keep the stored value, unknown columns are ignored and listed, and every row shows its field-by-field diff before anything is applied (5,000 rows per upload). Fields that the workflow governs (group moves, lifecycle, engagement, account status) are refused with a pointer to the action that owns them. Each applied change is audited with its previous value, and a batch replays safely.

