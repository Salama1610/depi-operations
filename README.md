# DEPI Coaching & Freelancing Operations

Private staff-only operations system for Career180 and Freelance Yard, implementing the supplied Round 5 V3 operating model end to end. Connections and recovery are documented in `docs/connections-and-recovery.md`.

## Run and validate

- Node 22.13+; install with `npm run install:ci`.
- `npm run dev` uses the bundled Sites development environment.
- `npm run build` emits a Cloudflare-compatible Worker and assets.
- `node --experimental-strip-types --test tests/domain.test.mjs tests/integration.test.mjs` validates the actual service against SQLite plus domain rules.
- `npx tsc --noEmit` validates TypeScript.
- `npm run db:generate` generates additive migrations after schema changes. Do not change previously applied migrations.

The hosted application uses managed D1 relational storage and a private R2 bucket. This is an intentional platform adaptation of the preferred PostgreSQL/Supabase architecture. Database constraints and triggers protect account allocation, contact completeness, audit immutability, gig transitions and paid evidence intake. Row restrictions and role authorization are enforced by server services; D1 does not provide PostgreSQL RLS.

## Initial use

Open the private Site while signed in and choose a blank production workspace or the synthetic pilot. Initialization is one atomic database batch. The pilot creates 1,000 synthetic students, 40 groups, 1,000 tasks, role-specific staff profiles, 40 sessions and 20 account metadata records. No screenshots, payments, accepted evidence or graduation are fabricated. All students therefore initially need valid contact; zero accepted evidence is intentional.

The initializing owner receives Project Operations and Operations Systems / Admin roles. Quality and Higher Board powers are not silently granted. Add or explicitly modify staff access in Administration, with a reason. Example staff addresses end in `example.invalid` and cannot be used as real accounts. Access remains owner-private at the hosting layer until explicitly shared. App staff membership does not itself broaden the Site audience.

## Working features

- Responsive operations overview, complete program flow, work queues, student directory/360, groups, sessions, accounts, gigs, evidence, Quality, cases, reports and administration.
- Staff identity from trusted hosting dispatch; backend role and assigned-group checks; no student registration.
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

## Organization-owned activation inputs

See `docs/production-readiness.md`. Before loading real student data, the organization must add the real role-separated staff roster, approve the Ministry report mapping and retention periods, connect the selected credential vault and backup destination, activate the scheduler if required, and complete staff UAT/security/recovery sign-off. These are environment and policy decisions; the product flow is implemented.

## Source layout

- `app/operations.tsx`: role-aware working surface and workflows.
- `app/api`: authenticated service interfaces, uploads, spreadsheets.
- `lib/domain/rules.ts`: business rules and baseline policy.
- `lib/server.ts`: centralized database, identity, scope, audit and graduation helpers.
- `lib/seed.ts`: synthetic, atomic pilot initialization.
- `db/schema.ts`, `drizzle/`: normalized schema, migrations and integrity triggers.
- `tests/`: executable domain and service integration tests.
- `docs/`: setup, deployment, metric definitions and remaining release gates.
