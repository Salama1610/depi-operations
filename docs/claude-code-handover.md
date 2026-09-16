# Claude Code handover — DEPI Operations

## Product state

This repository contains the DEPI Round 5 coaching/freelancing operations application and the student service-link portal. The hosted Site is:

<https://depi-coaching-operations.abdelrhman-shoman62.chatgpt.site>

The active workspace is intentionally populated with synthetic pilot data. Never treat `example.invalid` identities, `DEMO-*` records, the sample retention authority, or the sample Ministry mapping as production approvals.

## Stack and entry points

- Next/Vinext application compiled to a Cloudflare Worker.
- Managed D1 relational database plus private R2 evidence storage.
- Trusted ChatGPT hosting identity; students are linked server-side by their registered email (no application passwords).
- Main UI: `app/operations.tsx` and `app/program-flow.tsx`.
- Operations API: `app/api/operations/route.ts`.
- Program lifecycle API: `app/api/program/route.ts`.
- Central identity, scope, data loading and audit helpers: `lib/server.ts`.
- Business rules: `lib/domain/rules.ts`.
- Synthetic fixtures and blank-workspace upgrade: `lib/seed.ts`.
- Schema/migrations: `db/schema.ts`, `drizzle/` and `db/runtime-triggers.mjs`.

## Implemented feature inventory

1. Responsive home dashboard, work queue, global search, notifications and saved views.
2. Registration, screening, admission, group assignment and track-capacity controls.
3. Student directory and Student 360 with contact, attendance, gig, evidence, risk, milestone, lifecycle and audit history.
4. Group ownership, Outcome/Support Coach assignment and onboarding, weekly gates, transfer and archive controls.
5. Regular (8-session) and Industry (5-session) plans with policy-locked 180-minute sessions, Cairo-day conflict checks, coach confirmation, reasoned reschedule/cancel, attendance and delivery reports.
6. Controlled account pool, approved task bank, Support-path requests, reservations, maker-checker allocation, reuse guards, credit ledger and vault adapter.
7. Ordered gig workflow, client-activity proof, performed-by/recorder separation, cancellation/failure and approved FX conversion.
8. Paid-gig evidence intake with separate delivery/payment proofs; Coach → Coordinator L1 → Quality → L3 review, rejection codes, corrections and immutable review history.
9. Graduation calculation and immutable ledger: 3 accepted paid gigs of at least USD 5 totaling USD 15, or one qualifying USD 300 gig.
10. Sequential cases with severity, ownership, due dates, root cause, prevention, independent verification and escalation sources.
11. Assessments/results, certificates, post-program outcomes, Ministry withdrawal decisions and read-only lifecycle closure.
12. Operational reports, SLA metrics, coordinator/group performance, CSV/XLSX exports, safe templates/import preview/commit/error export and Ministry report definitions with independent approval.
13. Versioned policies, separate approval, effective-policy binding, FX maker-checker controls, role management and immutable activity audit.
14. Signed scheduled-job endpoint, replay protection, bounded policy checks, run history/retry control and n8n workflow assets.
15. Private byte-validated screenshots, authenticated no-store reads, encrypted database/evidence backup and offline restore verification.
16. Retention-policy recording without automatic deletion, connection status and recovery controls.
17. Admin-only synthetic pilot loader that works only on an empty operational workspace, preserves the existing owner/effective policy, is retry-safe and refuses mixed live/synthetic data.
18. Student service portal with exactly three service-link slots, strict Kafiil/Khamsat URL checks, confirmation and recoverable drafts, per-link QC locking, correction comments, editable rejected links only, timestamps, immutable review history and identity isolation.
19. Service-link QC assignment, filters, pagination, SLA reminders, correction templates, Quality Lead overrides, Student 360 visibility, reporting/export, roster health, and backup/restore coverage.

## Core workflows

### Learner lifecycle

Application → eligibility screening → admission/group → coaching delivery → final assessment → graduation result → certificate/outcome → controlled closure. Withdrawal records a Ministry decision and preserves the learner record.

### Weekly operations

Scoped roster → contact proof/outcome → owned next action → milestone/engagement update → weekly gate → risk/policy check → supervisor intervention when required.

### Session delivery

Schedule valid group week → validate assigned/onboarded coach and Cairo-day availability → coach confirms → session starts → reconcile every active learner's attendance → submit delivery notes → complete.

### Controlled freelancing

Approved task request → eligible account reservation → independent allocation → ordered gig events with proof → payment → evidence package → Coach review → Coordinator L1 → Quality decision → correction/L3 when required → graduation recalculation.

### Student service links

Student sign-in → three distinct public service URLs → automatic format/marketplace check → QC reviews each slot → correct links locked → incorrect links returned with a comment → student edits only returned slots → resubmission → all three locked → complete.

### Data and governance

Role-scoped mutation → origin/rate/idempotency checks → database constraints/triggers → immutable audit. Imports use template → preview → revalidation → commit → reconciliation. Ministry exports require an active independently approved field mapping.

## Synthetic pilot contents

- 1,000 students, 40 groups, 1,000 owned actions, 40 sessions and 20 controlled accounts.
- Synthetic staff for every operating role; their `example.invalid` addresses cannot authenticate.
- Completed, confirmed, scheduled and cancelled sessions plus reconciled attendance and notes.
- Submitted/reserved/allocated account examples, credit history and gigs in several states.
- Evidence in Coach, L1, Quality, Rejected and Accepted states, with private proof fixtures and review history.
- Service-link examples for `S10902` (one locked, one correction request, one awaiting QC) and `S10903` (all three locked), using Kafiil and Khamsat URL patterns.
- A qualifying graduate, certificate, verified outcome, withdrawal, assessment results, cases, group gates, FX, report mapping/run, retention example, automation run and notifications.

Useful showcase records: `S10901` is the graduated end-to-end learner; `DEMO-EV-4` is the overdue Coach review; `DEMO-EV-7` is rejected evidence; `DEMO-REQ-RESERVED` is ready for account approval; `SES-101` is completed with attendance.

## Validation commands

```bash
npm run lint
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
node /root/.codex/plugins/cache/openai-curated-remote/sites/0.1.62/scripts/build-site.mjs
```

All 38 tests, lint, TypeScript and the bounded production Worker build must pass before publishing. The portable commands are `npm run lint`, `npm run typecheck`, `npm run build`, and then `npm run test:all`. Do not modify already-applied migration files; generate an additive migration for schema changes.

## Deployment notes

The Site audience is being expanded for student access. Keep app-level authorization server-side: a signed-in identity must match a student email or an active staff user. Push the exact tested commit to the Sites remote, package the same commit, save a Site version, then deploy with the configured audience. Do not deploy a dirty worktree or a package that differs from the pushed commit.

## Organization-owned activation still required

- Replace synthetic staff with real, role-separated identities and deliberately share the private Site with them.
- Replace the sample Ministry field mapping and retention authority with approved organizational decisions.
- Configure the chosen vault, scheduler signer, backup encryption key and independent backup destination.
- Complete staff UAT, accessibility/security review and a hosted recovery-objective drill before any real personal data is loaded.

These are deployment/organizational inputs, not missing application flows.
