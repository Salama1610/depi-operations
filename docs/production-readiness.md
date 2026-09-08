# Production readiness — explicit remaining work

This release is a functional synthetic-data pilot. Do not describe it as fully conforming to every section of the build brief.

| Area | Current behavior | Required production completion |
|---|---|---|
| Business reference | Attached Markdown defines implemented policy | Reconcile with current complete DEPI SOP; resolve any policy conflicts |
| Platform | Worker + React/Vinext + D1 + private R2 | Confirm platform adaptation or port services to PostgreSQL/Supabase with RLS |
| Identity | Trusted dispatch identity plus explicit staff membership and backend roles | Staff access UAT, MFA policy, session/security review, formal role matrix |
| Privacy | Private byte-validated image uploads and authorized proxy reads | Signed-link expiry if required, retention policy, antivirus if required, deletion workflow and file access logging |
| Policy | Baseline version, immutable approved content, review lifecycle | Complete policy editor and effective assignment UI; evaluate every operational threshold from the applied policy |
| Journey | Group-relative week, milestone and risk display | Full weekly entry/exit gates, milestone definitions, pathway exceptions, recovery playbooks |
| Risk | Read-time recommendations; documented operational status override | Scheduled risk checks and automatic supervisor case creation for every critical trigger |
| Accounts | Atomic allocation, reuse constraints, basic status changes | Reservations/timeouts, credit ledger/refunds, task bank, vault references and audited credential access |
| Evidence | Coach/L1/Quality stages, rejection tasks, L3 routing and ledger | Separate delivery/payment packages, revision-specific attachment history, stronger duplicate/fraud detection, final-resolution checklist |
| Graduation | Accepted paid USD gigs only | Approved FX rates and conversion evidence; policy transfer/recalculation rules and revocation handling |
| Spreadsheets | XLSX/CSV creation; first-sheet value import; rule-checked creates | Upsert/update conflict review, field mapping, all requested module round-trips, background large imports |
| Reporting | Current scope, contact compliance, risk and graduation | Forecasting, capacity planning, date-window metrics, SLA charts and proof audit score |
| Notifications | Current overdue task list, derived without duplicate persistence | Per-recipient durable notification center, read state, escalation delivery, scheduled digest |
| Automation | Safe successful-request idempotency and server transactions | n8n workflows, signed machine endpoint, retry/outbox, scheduled SLA alerts |
| Scale | 1,000 students; client filters and 25-row visual pagination | Server pagination, bounded query projections, 1,000+/5,000+ load tests, <2-second performance verification |
| Cases | Ownership, sequential states and separate verifier | Full subtype SLA matrix, linked account/gig proof, intervention playbook |
| Audit | Immutable database audit/review triggers; before/after for key edits | Failed-attempt security logs, immutable privileged infrastructure retention and export access review |
| Recovery | Source and migration history | Independent DB and object-store backups, retention, recovery objectives and restore drill |
| Delivery | Automated domain and service integration checks | Staging, full browser/mobile/WCAG 2.2 AA review, independent security review, UAT sign-off |

The synthetic fixture deliberately has no fake proof or fabricated graduates. A real pilot should start with the requested one supervisor, two coordinators and 2–5 groups, after production gates affecting confidentiality and integrity have been addressed. No real students have been imported or contacted.
