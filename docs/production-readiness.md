# Production readiness — Round 5 V3

The application implementation is reconciled with **DEPI Round 5 Operational Control Manual V3.0 (8 September 2026)**. It is a private, staff-only system; students never sign in.

## Implemented controls

| Area | Implemented behavior |
|---|---|
| Initialization | The first authorized owner chooses a blank production workspace or a visibly labelled 1,000-student synthetic pilot. Production mode creates no fake operational records. |
| Identity and scope | Trusted ChatGPT identity, active-staff membership, backend role checks, group scope, separation of policy/FX creation and approval, and no student accounts. |
| Journey control | Group-relative week, configurable milestones and lag thresholds, trajectory explanations, weekly gates, engagement/lifecycle history, transfer and closure gates. |
| Student operations | Screenshot-backed contacts, mandatory next actions, attendance, milestone history, scoped Student 360, global search and personal saved views. |
| Controlled accounts | V3 platforms (Kafeel, Nafezly, Khamsat), track task bank, Support-path-only requests, job profile/gig sequence, atomic eligibility/allocation, reuse and credit controls, vault adapter and exposure response. |
| Gigs and evidence | Ordered gig states, screenshot requirement for client activity, structured group/gig/account/activity/platform/time/source/performer linkage, duplicate checks, Coach/L1/Quality/L3 review, corrections and immutable history. |
| Graduation and FX | Accepted paid evidence only; 3 × USD 5 with USD 15 total or one USD 300 equivalent. Non-USD value counts only through a stored, separately approved, immutable FX record. |
| Cases and risk | Sequential cases, separate verification, root cause/prevention, configurable risk rules, idempotent recovery work and recipient notifications. |
| Data movement | Controlled XLSX/CSV templates, protected-field validation, row reconciliation history, formula-safe exports and audited export jobs. |
| Security and recovery | Byte-validated private images, authorized no-store reads, access audit, origin checks, endpoint throttling, replay guards, immutable audit triggers, encrypted consistent backup and verified restore. |
| Automation | Signed HMAC machine endpoint, replay protection, bounded jobs, durable run log, controlled retries and n8n workflow assets. |
| Retention | Admin workflow records scope, approved action, period, authority and reason. No legal periods are invented and saving a policy never deletes data. |
| Reporting | Period activity, SLA backlog, contact/graduation metrics, account capacity, group performance and labelled non-probabilistic scenarios. |

## Validation evidence

- 19 automated domain, permission, workflow, search, retention, security, backup and restore tests pass.
- TypeScript validation passes.
- The bounded production Worker build passes and includes every application and API route.
- Migrations are host-compatible; safeguards are installed at workspace initialization and restore.

## Organization-owned launch inputs

These are deployment decisions or credentials, not unfinished application features:

- Choose production or synthetic pilot at first launch, then add the real staff roster and role matrix.
- Configure the approved vault, automation signer/HMAC secret and independent backup encryption key/destination.
- Enter approved retention periods and authorities; the product intentionally ships with none.
- Activate the supplied scheduler workflows if scheduled notifications are required.
- Complete organizational security, accessibility/mobile, staff UAT and recovery-objective sign-off before loading real personal data.

No real student data has been loaded or contacted by this project.
