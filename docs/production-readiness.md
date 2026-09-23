# Production readiness — Round 5 V3

The application implementation is reconciled with **DEPI Round 5 Operational Control Manual V3.0 (8 September 2026)**. Staff use the operations workspace; registered students sign in to a separate service-link portal. Hosting audience settings do not replace server-side authorization.

## Implemented controls

| Area | Implemented behavior |
|---|---|
| Initialization | The first authorized owner chooses a blank production workspace or a visibly labelled 1,000-student synthetic pilot. An admin-only guard can append that pilot later only if the operational footprint is still empty; it preserves the owner/policy and refuses mixed live/synthetic data. |
| Identity and scope | Supabase Auth with server-validated cookie sessions, active-staff membership, backend role checks, group scope, functional Outcome/Support Coach assignments, role-conflict launch gate, separation of policy/FX/report creation and approval, and student access linked to a unique normalized roster email. Shared demo passwords are prohibited. |
| Student service links | Exactly three direct service pages on Kafiil, Khamsat or Nafezly, stored over HTTPS, normalized duplicate prevention, confirmation and draft recovery, timestamps and history, correction-only editing, per-link lock, review by the coordinator of the student's group (scoped and paginated, one link at a time), 48-hour reminders to that coordinator and their supervisor, no override of a locked or automatically failed link, metrics/exports, roster health and recovery coverage. |
| Complete program flow | Registration, eligibility screening, admission/group assignment, coach matching/onboarding, session reconciliation, assessments, certificates, post-program outcomes, Ministry withdrawal decisions, group closure and read-only archive. |
| Journey control | Group-relative week, configurable milestones and lag thresholds, trajectory explanations, weekly gates, engagement/lifecycle history, transfer and closure gates. |
| Session operations | Regular/Industry delivery limits, policy-controlled duration, active onboarded coach assignment, same-day coach conflict and duplicate-week protection, coach confirmation, reasoned reschedule/cancellation, complete attendance reconciliation, delivery notes, SLA backlog and coverage-gap monitoring. |
| Student operations | Screenshot-backed contacts, mandatory next actions, attendance, milestone history, scoped Student 360, global search and personal saved views. |
| Controlled accounts | V3 platforms (Kafeel, Nafezly, Khamsat), track task bank, Support-path-only requests, job profile/gig sequence, atomic eligibility/allocation, reuse and credit controls, vault adapter and exposure response. |
| Gigs and evidence | Ordered gig states, screenshot requirement for client activity, structured group/gig/account/activity/platform/time/source/performer linkage, duplicate checks, Coach/L1/Quality/L3 review (the quality stage is open to the coordinator side, since quality tracks programme activities in a separate system), corrections and immutable history. |
| Graduation and FX | Accepted paid evidence only; 3 × USD 5 with USD 15 total or one USD 300 equivalent. Non-USD value counts only through a stored, separately approved, immutable FX record. |
| Cases and risk | Sequential cases, separate verification, root cause/prevention, configurable risk rules, idempotent recovery work and recipient notifications. |
| Data movement | Controlled XLSX/CSV templates and multi-tab workbook export, sheets from other sources linked on the national ID through a confirmed, reusable column mapping, protected-field validation, partial-column updates that leave unmapped and empty cells alone, row reconciliation history, formula-safe operational and lifecycle exports, audited export jobs, and safe atomic bulk ownership/classification/task actions. |
| Security and recovery | Byte-validated private images, authorized no-store reads, access audit, origin checks, endpoint throttling, replay guards, immutable audit triggers, encrypted consistent backup and verified restore. |
| Automation | Signed HMAC machine endpoint, replay protection, bounded jobs, durable run log, controlled retries and n8n workflow assets. |
| Retention | Admin workflow records scope, approved action, period, authority and reason. No legal periods are invented and saving a policy never deletes data. |
| Reporting | Period activity, SLA backlog, contact/graduation metrics, account capacity, group performance, labelled non-probabilistic scenarios, and independently approved Ministry CSV/XLSX definitions with run history. |

## Validation evidence

- 89 unit and 28 integration checks pass on 23 September 2026 — domain, permission, workflow, student identity/isolation, service-link validation, spreadsheet round trip, sheet linking, staffing, concurrency and query plans, 1,000-row roster preview, import, search, retention, security and backup/restore — and the integration suite runs identically against SQLite, a real PostgreSQL server and the deployed HTTPS transport.
- TypeScript and lint validation pass.
- The production Next.js build passes; the Cloudflare Worker build remains available under its own script.
- Migrations are host-compatible; safeguards are installed at workspace initialization and restore.

## Organization-owned launch inputs

These are deployment decisions or credentials, not unfinished application features:

- Choose production or synthetic pilot at first launch, then add the real staff roster and role matrix (a staff sheet does this in one upload, and groups are handed over by naming the person).
- Configure the approved vault, automation signer/HMAC secret and independent backup encryption key/destination.
- Enter approved retention periods and authorities; the product intentionally ships with none.
- Create the Ministry-supplied report mapping as a draft and have a different authorized staff member approve it.
- Import the approved Round 5 roster (2,948 workbook rows reconciling to 2,887 canonical students after 61 duplicate merges, 131 groups, five tracks) in reconciled batches of at most 1,000 rows, and obtain program-owner approval for marketplace ownership/track-fit decision standards.
- Activate the supplied scheduler workflows if scheduled notifications are required.
- Complete organizational security, accessibility/mobile, staff UAT and recovery-objective sign-off before loading real personal data.

The approved Round 5 roster was loaded into the Supabase project on 20 September 2026 through the application's authenticated roster-import flow: 5 tracks, 131 groups, 2,887 canonical students and 2,948 source rows, reconciled against `depi-r5-reconciliation.json`. No student has been contacted, and no Supabase Auth identity has been created for a student yet. Until the organization-owned inputs above are complete, treat the workspace as loaded but not launched.
