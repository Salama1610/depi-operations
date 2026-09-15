# Build: DEPI Coaching & Freelancing Operations Control System

Build a production-oriented internal web application for managing the complete DEPI Round 5 coaching and freelancing operations workflow.

The application is **staff-only**.

Students must **never have accounts or access to the application**.

The system should replace fragmented operational work currently handled through spreadsheets, WhatsApp, screenshots, manual trackers, and separate reporting files.

The application should function as an **operations orchestration system**, not simply a CRM or database viewer.

The central operating principle is:

> Every active student must always have a known status, accountable owner, next action, due date, supporting evidence where required, and measurable progress toward graduation.

---

# 1. Source of Truth

Use the existing DEPI Round 5 Operations Control Manual / SOP as the business-policy source of truth.

Do not invent conflicting operational rules.

Where a rule may change between rounds, implement it as configurable/versioned policy rather than hard-coding it.

The app should enforce the SOP wherever possible instead of depending on staff memory.

Examples:

- missing mandatory proof → block completion;
- duplicate controlled account → block assignment;
- invalid workflow transition → block action;
- incomplete evidence → do not progress;
- graduation → calculate automatically;
- Quality decisions → cannot be edited by Operations.

---

# 2. Product Type

This is a:

**Staff-Only Coaching & Freelancing Operations Control System**

It should manage:

- students;
- groups;
- coaching journey;
- staff ownership;
- coordinator follow-up;
- WhatsApp contact evidence;
- sessions;
- attendance;
- student risk;
- freelancing activity;
- controlled client accounts;
- account requests;
- client activity;
- gigs/services;
- screenshot evidence;
- evidence verification;
- Quality review;
- rejection/correction;
- incidents;
- escalations;
- graduation;
- closure;
- reporting;
- import/export;
- system audit history.

---

# 3. User Roles

Implement role-based access for:

1. Project Operations / Project Manager
2. Team Supervisor
3. Operations Coordinator
4. Coach
5. Coach Operations
6. Quality Member
7. Quality Lead
8. Higher Board / Account Allocation
9. Operations Systems / Admin

There are **no student users**.

---

# 4. Role Principles

## Operations Coordinator

Owns assigned students operationally.

Can:

- view assigned groups/students;
- log student contacts;
- upload contact screenshots;
- update allowed student statuses;
- create next actions;
- create account requests;
- update gigs;
- record external student activity;
- upload client-activity screenshots;
- perform Evidence L1 completeness checks;
- open incidents/escalations.

Cannot:

- allocate controlled client accounts;
- approve final Quality evidence;
- modify Quality decisions;
- manually graduate students.

---

## Team Supervisor

Can:

- view assigned coordinators/groups;
- review operational exceptions;
- review At Risk/Critical students;
- audit contact screenshots;
- intervene in Critical cases;
- review coordinator performance;
- manage escalation cases.

---

## Coach

Can:

- view assigned groups;
- record attendance;
- update coaching milestones;
- flag struggling students;
- perform first evidence review;
- provide correction guidance.

Cannot:

- assign controlled accounts;
- modify Quality decisions;
- manually graduate students.

---

## Coach Operations

Can:

- manage coach assignments;
- monitor upcoming sessions;
- monitor attendance completion;
- monitor Coach evidence SLA;
- manage session exceptions.

---

## Quality Member

Can:

- access Quality queue;
- review qualifying evidence;
- run duplicate/integrity checks;
- accept/reject evidence using structured rejection codes.

Cannot modify Operations-created records outside Quality authority.

---

## Quality Lead

Can additionally:

- manage L3 reviews;
- handle second rejection;
- investigate duplicate evidence;
- handle suspected falsification;
- reopen Quality cases through a controlled audited workflow.

---

## Higher Board / Account Allocation

Can:

- manage controlled account pool;
- view account status;
- review account requests;
- approve task fit;
- assign controlled accounts;
- manage account incidents;
- manage account availability/credits.

---

## Operations Systems / Admin

Can:

- manage users;
- manage system configuration;
- import data;
- administer permissions;
- manage policy versions;
- monitor automations;
- inspect audit logs;
- resolve data/system issues.

Admin privileges must not silently allow manual Quality approval or graduation.

---

# 5. Main Navigation

Use role-aware navigation.

Core modules:

- Home
- My Work
- Students
- Groups
- Sessions
- Accounts
- Gigs
- Evidence
- Quality
- Cases
- Reports
- Administration

Only show relevant modules per user role.

---

# 6. UX Principle

Do NOT recreate Excel inside the browser.

Avoid giant tables with dozens of columns.

The application should answer:

1. What do I need to do today?
2. What is overdue?
3. Which students are blocked?
4. Which groups are falling behind?
5. Who owns the problem?
6. What evidence proves the work was done?
7. Are we on track to meet graduation target?

Use:

- work queues;
- clear statuses;
- compact student views;
- drill-down pages;
- operational alerts;
- exception dashboards.

---

# 7. Coordinator Home

This is one of the most important pages.

Show:

- assigned students;
- assigned groups;

and action queues:

- Due Today
- Overdue
- No Contact
- At Risk
- Critical
- Gig Blocker
- Evidence Blocker
- Rejected Evidence
- Account Requests Pending
- Open Escalations

Each card should be clickable and open a filtered work queue.

Coordinator UX should prioritize:

**Do the next operational action**

rather than analytics.

---

# 8. Supervisor Home

Supervisor homepage should prioritize exceptions.

Show coordinator performance table:

- coordinator;
- students;
- contact compliance;
- overdue actions;
- no-contact students;
- Critical students;
- evidence blockers;
- proof-audit score;
- graduation trajectory.

Clicking a coordinator opens their exception workspace.

---

# 9. Project Operations Dashboard

Show:

- total active students;
- groups;
- 0/3;
- 1/3;
- 2/3;
- graduates;
- graduation forecast;
- target;
- At Risk;
- Critical;
- contact compliance;
- Coach SLA;
- Quality SLA;
- evidence backlog;
- rejection backlog;
- account capacity;
- open incidents;
- groups On Track / Delayed / Critical.

---

# 10. Student 360 Page

Every student should have one main operational profile.

Header:

- Student Name
- Student ID
- Group
- Track
- Provider
- Coordinator
- Supervisor
- Coach
- Journey Week
- Pathway

Status strip:

- Enrollment/Lifecycle Status
- Engagement Status
- Coaching Status
- Gig Status
- Evidence Status
- Graduation Status
- Trajectory Status

Tabs:

- Overview
- Contacts
- Tasks
- Sessions
- Gigs
- Evidence
- Accounts
- Cases
- Activity Timeline
- Audit

---

# 11. Separate Student Status Dimensions

Do not use one generic status.

## Engagement

- Active
- At Risk
- Critical
- Unresponsive

## Coaching

- Not Started
- Attending
- In Progress
- Coaching Complete

## Gig

- Not Ready
- Ready
- Account Requested
- Account Assigned
- Gig Opened
- Work Submitted
- Delivered
- Paid

## Evidence

- Not Submitted
- Coach Review
- Coordinator L1
- Quality Review
- Rejected
- Resubmitted
- Accepted

## Graduation

- 0/3
- 1/3
- 2/3
- Graduated
- $300 Graduate

Also create a separate lifecycle field such as:

- Active
- Paused
- Transferred
- Withdrawn
- Removed
- Graduate Closed
- Non-Graduate Closed

Do not confuse lifecycle status with engagement risk.

---

# 12. Weekly Coaching Journey

The system must support rolling group-relative weeks.

Stages:

- Pre-Launch
- Week 1
- Week 2
- Week 3
- Week 4
- Week 5
- Week 6
- Week 7
- Week 8

Different groups may be in different weeks simultaneously.

Do not calculate journey based purely on global cohort calendar week.

Each stage should have:

- entry criteria;
- expected milestone;
- required role actions;
- exit gate;
- exceptions;
- escalation triggers.

Groups move forward on schedule even if individual students lag.

Lagging students become:

- At Risk;
- Critical;
- recovery cases;

rather than forcing the entire group to repeat the week.

---

# 13. Pre-Launch Workflow

Support:

- roster import;
- duplicate Student ID validation;
- group creation;
- track/provider assignment;
- coordinator assignment;
- supervisor assignment;
- Coach assignment;
- contact validation;
- onboarding proof;
- readiness exceptions.

Group cannot become Ready to Launch without required ownership.

---

# 14. Student Contact Workflow

Coordinator clicks:

**Log Contact**

Required fields:

- Student
- Channel
- Contact date/time
- Outcome
- Screenshot/proof
- Next action
- Next action owner
- Due date

Optional/conditional:

- problem category;
- notes;
- escalation;
- severity.

Contact outcomes:

- Responded
- No Response
- Follow-Up Required
- Problem Identified
- Escalated

A contact **must not count toward weekly contact compliance without screenshot proof**.

Screenshot evidence must be required.

A contact record without:

- proof;
- outcome;
- next action;
- due date;

cannot be considered complete.

---

# 15. Contact Attempt Workflow

Track failed contact attempts explicitly.

Support attempt history such as:

- Attempt 1
- Attempt 2
- Attempt 3
- Attempt 4
- Attempt 5

Five failed attempts over two weeks trigger escalation toward Unresponsive according to policy.

Do not mark a student Unresponsive simply because nobody contacted them.

---

# 16. External Activity Principle

Students do not log into the application.

Student activity occurs externally through channels such as:

- WhatsApp;
- freelancing platforms;
- forms;
- email;
- other approved sources.

Authorized staff records that activity inside the app.

For externally originated actions, store both:

- who actually performed the action;
- which internal staff user recorded it.

Example:

performed\_by\_type = STUDENT

performed\_by\_student\_id = S123

recorded\_by\_user\_id = U456

recorded\_at = timestamp

This distinction must remain visible in the audit history.

---

# 17. Client Activity Screenshot Requirement

During any phase involving client-side activity, **screenshots are mandatory evidence**.

Examples:

- gig/order created;
- client-side activity;
- work requested;
- work delivered;
- client accepted/completed work;
- payment/release;
- platform confirmation;
- cancellation;
- access problem;
- account issue.

Each screenshot must be linked to structured metadata:

- Student ID
- Group ID
- Gig/Service ID
- Client Account ID where applicable
- Activity Type
- Platform
- Timestamp
- Recorded by
- Related status transition

Screenshot evidence does NOT replace structured fields.

For example:

Screenshot uploaded

does not automatically mean:

Gig = Delivered.

The corresponding structured status must also be explicitly recorded.

---

# 18. Screenshot / File Storage

Evidence files must use private storage.

Do not use public permanent URLs.

Requirements:

- private object storage;
- authorized file access;
- short-lived signed URLs;
- file type validation;
- file-size limits;
- randomized stored filenames;
- upload audit;
- no uncontrolled public links.

Recommended file types:

- PNG
- JPG/JPEG
- PDF if needed

Make allowed types configurable.

---

# 19. Week 2 Pathway

Support two operational paths:

## Outcome Path

Real freelancing activity.

## Support / Internal-Service Path

Controlled account + controlled task/service workflow.

Store pathway at group level.

Design data model so student-level exception pathway can be supported later if approved.

---

# 20. Controlled Account Request Workflow

Coordinator submits account request containing:

- Student ID
- Group
- Track
- Job Profile
- Gig Number
- Task
- Platform
- Required credit/value
- Notes

Request status example:

- Draft
- Submitted
- Under Review
- Assigned
- Rejected
- Cancelled

---

# 21. Controlled Account Eligibility

Before assignment, system must verify:

1. account status allows assignment;
2. sufficient credits;
3. account has not already been used by another student in same group;
4. same student has not previously used the account for another qualifying controlled gig;
5. task fit is approved.

If validation fails:

**Disable assignment.**

Do not merely display a warning.

---

# 22. Account State Machine

Support:

- Available
- Reserved
- Assigned
- Cooldown / Awaiting Closure
- Blocked
- Access Issue
- Funding Block
- Under Review
- Retired

Example normal flow:

Available
→ Reserved
→ Assigned
→ Cooldown
→ Available

Retired is terminal.

---

# 23. Account Concurrency

Do not rely only on frontend availability checks.

Prevent simultaneous assignment using backend/database transactions and constraints.

Two staff users must not be able to assign the same currently available account at the same time.

---

# 24. Credentials

Never store raw controlled account passwords in normal account records.

Normal record contains:

- account metadata;
- platform;
- account ID;
- credential secret reference.

Actual secret should live in protected secret storage/vault.

Credential access must be restricted and logged.

Log:

- user;
- account;
- timestamp;
- purpose.

Credential exposure should create a critical incident.

Credentials must NEVER appear in ordinary spreadsheet exports.

---

# 25. Controlled Gig Workflow

After valid allocation create a Gig/Service record.

Fields include:

- Gig ID
- Student
- Group
- Account
- Platform
- Task
- Value
- Currency
- Gig/order reference
- Due date
- Status
- Payment status
- screenshots/evidence

State flow:

Ready
→ Account Requested
→ Account Assigned
→ Gig Opened
→ Work Submitted
→ Delivered
→ Paid

Do not allow invalid skips.

Examples:

Gig Opened → Paid

must be blocked if delivery requirements are unmet.

Cancelled/Failed records remain historical.

---

# 26. Outcome / External Freelancing Gig

Outcome-path gigs do not require controlled accounts.

Record:

- Student
- Platform/source
- Client reference
- Gig/order reference
- Value
- Original currency
- Start date
- Delivery date
- Payment status
- screenshot evidence
- supporting files
- source type

Then route the completed paid gig through the same evidence and Quality pipeline.

---

# 27. Graduation Rules

Make graduation policy configurable and versioned.

Current Round 5 rule:

Either:

3 qualifying gigs

with:

- each gig ≥ $5
- total ≥ $15

OR:

one qualifying gig ≥ $300.

Only **Quality-accepted qualifying evidence** counts.

No manual graduation field.

Graduation should be system-calculated.

Store:

- policy version;
- applied rule;
- calculation timestamp;
- qualifying evidence IDs.

---

# 28. Evidence Intake

Students do not upload evidence directly.

Evidence originates externally.

Authorized staff records it.

Evidence record should include:

- Evidence ID
- Student
- Gig
- External source
- student submission timestamp if known
- internal staff recorder
- system recorded timestamp
- screenshot/files
- Coach decision
- Coordinator L1 decision
- Quality decision
- rejection code
- review timestamps

---

# 29. Evidence State Machine

Not Submitted
→ Coach Review
→ Coordinator L1
→ Quality Review
→ Accepted

or:

Quality Review
→ Rejected
→ Correction
→ Resubmitted
→ Quality Review

Quality acceptance is immutable to Operations/Coaching.

Reopening requires Quality Lead workflow with audit trail.

---

# 30. Evidence SLA

Configurable policy defaults:

- Coach review ≤24h
- Coordinator L1 ≤24h
- Quality review ≤48h
- Rejection correction target ≤7 days

Track:

- SLA start;
- current owner;
- breach status;
- breach duration.

---

# 31. Quality Review

Quality queue defaults to oldest first.

Show:

- Student
- Group
- Track
- Gig
- Platform
- Account if relevant
- Value
- Evidence package
- Coach decision
- Coordinator L1
- previous reviews
- duplicate flags
- submission age

Quality checklist:

- Completeness
- Identity
- Delivery
- Payment/value
- Authenticity
- Source consistency
- Duplicate checks

Actions:

- Accept
- Reject
- Escalate L3

---

# 32. Rejection Codes

Use structured configurable rejection codes.

Initial codes can include:

- EV01 Missing delivery proof
- EV02 Missing/invalid payment proof
- EV03 Identity/account mismatch
- EV04 Value/graduation rule not met
- EV05 Wrong controlled account/task
- EV06 Duplicate gig/order/payment
- EV07 Evidence incomplete/inconsistent
- EV08 Work does not qualify
- EV09 Suspected falsified/manipulated evidence
- EV10 Platform/source inconsistency

Quality must select at least one structured code.

Free text may supplement but not replace the code.

---

# 33. Rejection Workflow

When rejected:

automatically:

- create correction task;
- assign coordinator;
- include rejection code;
- include correction requirements;
- create due date;
- notify relevant Coach/Coordinator;
- update student queue.

Second rejection or EV06/EV09:

→ Quality Lead escalation.

A rejection cannot simply be marked Done.

It closes only through:

- Accepted evidence;
- approved final L3 resolution.

---

# 34. Risk Engine

Implement configurable risk rules.

Examples:

At Risk:

- attendance <70%;
-

> 7 days without valid coordinator contact;

1. next action >3 days overdue;
2. inadequate journey progress.

Critical examples:

- attendance <50%;
- two or more milestones behind;
- second evidence rejection;
- five failed contact attempts;
- serious late-stage graduation risk.

---

# 35. Separate Computed Risk from Operational Status

Store:

- System Risk Recommendation
- Operational Engagement Status

Example:

System recommends Critical.

Triggers:

- attendance 43%;
- second evidence rejection;
- 8 days no progress.

Supervisor may confirm or override.

Override requires:

- reason;
- user;
- timestamp.

---

# 36. At Risk / Critical Workflow

At Risk:

Coordinator creates recovery plan:

- blocker;
- recovery action;
- owner;
- due date;
- Coach involvement.

Critical:

automatically creates Supervisor Intervention case.

Supervisor records:

- intervention;
- owner;
- deadline;
- outcome.

---

# 37. Incident / Case Management

Create universal Case system.

Types:

- Student
- Account
- Gig
- Payment
- Evidence
- Quality
- Technical
- System

States:

Open
→ Triaged
→ Assigned
→ In Progress
→ Waiting
→ Resolved
→ Verified
→ Closed

Required fields:

- Case ID
- Type
- Subtype
- Severity
- Student
- Group
- Gig
- Account
- Owner
- Created by
- Created at
- Due date
- SLA
- Proof
- Root cause
- Resolution
- Preventive action
- Verifier

---

# 38. Incident Severity

Initial model:

S1 Critical

Systemic/integrity/security issue.

S2 High

Student/gig materially blocked.

S3 Standard

Known operational exception.

S4 Low

Minor/non-blocking issue.

Make severity rules configurable.

---

# 39. Group Page

Show:

- Group ID
- Track
- Provider
- Coordinator
- Supervisor
- Coach
- Pathway
- Journey Week
- start date
- students

Group KPIs:

- Active
- At Risk
- Critical
- 0/3
- 1/3
- 2/3
- Graduated
- contact compliance
- evidence backlog
- account blockers
- trajectory.

---

# 40. Group Trajectory

Support:

- Ahead
- On Track
- Delayed
- Critical

Use configurable expected milestones by week.

Initial logic:

Delayed:

one milestone behind.

Critical Journey Lag:

two or more milestones behind.

Show the reason, not just status.

---

# 41. Sessions

Session record:

- Session ID
- Group
- Coach
- date/time
- session number/week
- delivery model (Regular or Industry)
- policy-controlled duration
- status
- attendance
- notes
- student flags
- milestone update.

Session controls:

- Regular groups support 8 weekly sessions;
- Industry groups support 5 weekly sessions;
- Round 5 sessions are 180 minutes unless a new approved policy version changes the duration;
- the coach must be active, fully onboarded and assigned to the group;
- one active session is allowed per group/week and one group session per coach/Cairo day;
- the assigned Coach confirms; Coach Operations or Project Operations can reschedule or cancel with a reason;
- rescheduling resets Coach confirmation, while cancellation preserves history and blocks attendance.

Coach Operations dashboard:

- Sessions Today
- Unconfirmed Coaches
- Missing Attendance
- Cancelled Sessions
- Coach evidence >24h
- coverage gaps.

---

# 42. Attendance

Support bulk attendance entry/import.

Statuses may include:

- Present
- Absent
- Late
- Excused

Store source and recorder.

Attendance changes must remain auditable.

---

# 43. Tasks

Use a unified tasks/actions table where practical.

Each task should include:

- task ID;
- entity type;
- student/group/case/gig;
- owner;
- title/action;
- category;
- due date;
- priority;
- status;
- created by;
- source workflow;
- completed timestamp.

Queues should derive from tasks and workflow state.

---

# 44. Spreadsheet Interoperability

This is a major requirement.

**Operational data must be importable and exportable through spreadsheets.**

Support:

- XLSX
- CSV

Files should remain compatible with Excel and Google Sheets.

Modules supporting import/export:

- Students
- Groups
- Staff assignments
- Sessions
- Attendance
- Coordinator actions
- Contact records
- Account metadata
- Account requests
- Gigs/services
- Evidence metadata
- Risk/interventions
- Cases/incidents
- Graduation results
- KPI/report data
- configurable reference data where safe.

---

# 45. Export Workflow

User selects:

- module;
- filters;
- date range;
- fields where appropriate.

Then:

Export → XLSX / CSV.

Exports should retain stable IDs such as:

- student\_id
- group\_id
- gig\_id
- account\_id
- evidence\_id
- case\_id

Do not rely on names as identifiers.

---

# 46. Import Workflow

Provide:

**Download Import Template**

Flow:

Download template
→ Edit in Excel/Google Sheets
→ Upload
→ Validation Preview
→ Error/Conflict Review
→ Confirm
→ Import
→ Reconciliation Summary

Result must show:

- Created
- Updated
- Skipped
- Conflicted
- Rejected

Provide downloadable error file including:

- original row number;
- field;
- current value;
- error;
- expected format/rule.

---

# 47. Import Safety

Spreadsheet import must NEVER bypass system rules.

Example:

If spreadsheet attempts an invalid account assignment:

the import must reject that row using the same validation engine as the UI.

If spreadsheet contains:

Graduated = Yes

but accepted evidence is insufficient:

do not graduate student.

Imports are simply another system interface.

They do not override policy.

---

# 48. Export Security

Do not include in ordinary exports:

- passwords;
- credentials;
- tokens;
- secret references that reveal secrets;
- protected security logs;
- sensitive backend configuration.

Evidence file URLs should not become permanent public links.

---

# 49. Policy Configuration

Create versioned Policy Sets.

Example:

Round 5 Policy v1

Fields can include:

- contact interval;
- Coach SLA;
- Coordinator L1 SLA;
- Quality SLA;
- correction SLA;
- failed contact attempts;
- graduation target;
- graduation rules;
- minimum gig value;
- large gig threshold;
- risk thresholds;
- allowed platforms;
- evidence requirements;
- account capacity rules;
- sampling rules;
- journey milestones.
- Regular and Industry session counts;
- session duration.

Policy lifecycle:

Draft
→ Reviewed
→ Approved
→ Effective
→ Superseded

Store:

- version;
- cohort/round;
- effective date;
- created by;
- approved by;
- change reason.

Historical records must continue referencing the policy version used at the time.

---

# 50. Role / Permission Architecture

Use backend-enforced RBAC and row-level restrictions.

Do not depend only on hiding buttons.

Examples:

Coordinator:

only assigned students/groups.

Supervisor:

assigned coordinator scope.

Coach:

assigned group scope.

Quality:

Quality-relevant evidence scope.

Higher Board:

account-related scope.

Project Operations:

broad operational scope.

Admin:

system scope.

Use database-enforced access controls where possible.

---

# 51. Data Model

Use normalized relational architecture.

Do not create one giant Student table.

Recommended entities:

- programs
- cohorts
- providers
- tracks
- policy\_sets
- users
- roles
- user\_roles
- user\_scopes
- groups
- group\_assignments
- students
- student\_enrollments
- student\_status\_events
- sessions
- attendance
- actions
- contact\_actions
- attachments
- tasks
- client\_accounts
- account\_requests
- account\_assignments
- task\_bank
- gigs
- gig\_events
- payments
- evidence\_submissions
- evidence\_reviews
- rejection\_codes
- risk\_events
- interventions
- cases
- case\_events
- escalations
- graduation\_ledger
- notifications
- imports
- import\_rows
- exports
- audit\_events
- system\_configuration

---

# 52. Data Integrity

Use:

- primary keys;
- foreign keys;
- unique constraints;
- status enums/reference tables;
- transaction-based critical operations;
- immutable event history where appropriate.

Important invariants must be database protected.

Examples:

- Student ID unique within appropriate scope.
- Same controlled account cannot be used by two students in same group.
- Same student cannot reuse same controlled account for qualifying controlled work.
- Quality acceptance cannot be altered by coordinator.
- invalid status transition must fail.

---

# 53. Audit History

Create two concepts.

## Operational Timeline

Human-friendly activity history.

Example:

Sara contacted Ahmed.

## Security/System Audit

Detailed immutable event.

Store:

- actor;
- action;
- entity type;
- entity ID;
- previous value;
- new value;
- timestamp;
- reason;
- request/correlation ID;
- result.

Normal users must not delete or rewrite audit history.

---

# 54. Notifications

Implement internal notification center.

Support recipients based on roles.

Examples:

Coordinator:

- task due;
- overdue;
- rejection;
- account assigned;
- Critical student.

Supervisor:

- Critical escalation;
- contact compliance problem;
- unowned case.

Coach:

- evidence awaiting review;
- upcoming session.

Quality:

- review assigned;
- approaching SLA.

Higher Board:

- account request;
- account incident.

Severity:

- Informational
- Action Required
- Urgent
- Critical

Avoid duplicate/spam notifications.

---

# 55. Automation Rules

Initial examples:

A01

last valid contact >7 days

→ No Contact queue.

A02

contact without proof

→ does not count.

A03

completed contact requires next action + due date unless formally closed.

A04

same Account ID + same Group ID previously used by another student

→ hard block.

A05

same Student ID + Account ID previously used

→ hard block.

A06

Blocked/Assigned/Funding Block account

→ cannot newly assign.

A07

credits insufficient

→ block.

A08

Coach Evidence Review >24h

→ alert Coach Ops.

A09

Quality >48h

→ alert Quality Lead.

A10

Rejected evidence cannot close without acceptance/final L3.

A11

duplicate gig/order/payment/evidence indicators

→ QA Hold.

A12

graduation calculated only from Quality-accepted qualifying evidence.

Keep critical integrity logic in backend/database.

Use n8n primarily for:

- scheduled checks;
- alerts;
- external communications;
- weekly reporting;
- workflow orchestration.

The system must remain safe if n8n is unavailable.

---

# 56. Idempotency

Automations/events must not create duplicates on retry.

Use event IDs/idempotency keys.

Example:

Quality rejection event processed twice must NOT create two correction tasks.

---

# 57. Search

Global search:

- Student Name
- Student ID
- Group ID
- phone
- Gig ID
- Account ID
- Evidence ID
- Case ID

---

# 58. Filters

Operational lists should support filters such as:

- Provider
- Track
- Group
- Journey Week
- Coordinator
- Supervisor
- Coach
- Engagement
- Graduation
- Evidence
- Pathway
- Risk
- Account status
- Case severity

Support saved views.

---

# 59. Bulk Actions

Safe bulk actions:

- assign coordinator;
- assign supervisor where authorized;
- export;
- classification updates;
- create tasks.

Do NOT allow dangerous bulk actions such as:

- bulk Quality approval;
- bulk graduation;
- uncontrolled account allocation.

---

# 60. Reporting Metric Definitions

Do not calculate KPIs ambiguously.

Create a metric dictionary.

Example:

Contact Compliance =

active students requiring contact with a valid contact within configured interval

÷

all active students requiring contact.

Define exclusions.

Every KPI should define:

- numerator;
- denominator;
- date logic;
- policy version;
- exclusions;
- owner.

---

# 61. Security

Implement:

- authentication;
- RBAC;
- database row-level access;
- private file storage;
- signed URLs;
- strong secret handling;
- secure session management;
- audit logging;
- controlled exports;
- rate limiting where appropriate.

Privileged roles should be MFA-ready.

---

# 62. Data Classification

Use classifications such as:

Restricted:

- client credentials.

Confidential:

- student contact details;
- WhatsApp screenshots;
- payment evidence.

Internal:

- KPI reports;
- performance reports.

Do not expose Confidential/Restricted data unnecessarily.

---

# 63. Retention

Build retention support, but do not invent final legal periods.

Make retention periods configurable according to approved organizational/legal policy.

Support:

- archive;
- anonymization where required;
- secure deletion workflow if legally required.

---

# 64. Backup & Recovery

Back up separately:

1. relational database;
2. uploaded screenshots/evidence files.

Do not assume database backup covers object storage.

Create restore procedures and health monitoring.

---

# 65. Application Architecture

Preferred initial architecture:

## Frontend

Next.js + React

## UI

Tailwind CSS + reusable component system

## Backend

Application service layer / server functions

## Database

PostgreSQL

## Practical platform

Supabase is acceptable.

## Storage

Private Supabase Storage / S3-compatible object storage.

## Authentication

Supabase Auth or equivalent.

## Automation

n8n.

Use a **modular monolith**, not microservices.

Domain modules:

- Identity
- Students
- Groups
- Sessions
- Actions
- Accounts
- Gigs
- Evidence
- Quality
- Risk
- Cases
- Reporting
- Configuration
- Audit

---

# 66. Environments

Separate:

- Local
- Development
- Staging
- Production

Do not use production data casually in testing.

---

# 67. Release Process

Support:

Development
→ automated tests
→ staging
→ UAT
→ production.

Use:

- database migrations;
- rollback capability;
- feature flags where appropriate;
- versioned releases.

---

# 68. Accessibility

Target WCAG 2.2 AA.

Requirements include:

- keyboard navigation;
- visible focus;
- labelled inputs;
- proper validation messages;
- accessible status messages;
- usable target sizes;
- proper contrast;
- semantic UI.

---

# 69. Responsive Design

Coordinator workflow must work well on:

- desktop;
- tablet;
- mobile web.

Screenshot upload and contact logging should be especially mobile-friendly.

Do not require horizontal table scrolling for common daily workflows.

---

# 70. Performance

Design for thousands of students.

Target typical:

- normal page loads around <2 seconds;
- responsive filters/search;
- pagination/server filtering for large datasets;
- asynchronous uploads;
- queue generation without blocking UI.

---

# 71. Error Handling

Every operation must provide useful error states.

Bad:

“Something went wrong.”

Good:

“This account cannot be assigned because it was already used by another student in Group G104.”

Import errors should specify row/field/rule.

---

# 72. MVP Build Order

## MVP 1 — Operational Core

Build:

- authentication;
- users/roles;
- roster import;
- groups;
- students;
- Coordinator Home;
- Supervisor Home;
- Student 360;
- contact logging;
- screenshot proof;
- next actions;
- queues;
- risk;
- cases;
- audit;
- spreadsheet import/export.

This should replace the coordinator operating tracker.

---

## MVP 2 — Account + Client Activity

Add:

- client account pool;
- task bank;
- account requests;
- allocation;
- concurrency protection;
- screenshot-based client activity;
- gigs;
- account incidents.

---

## MVP 3 — Evidence & Quality

Add:

- evidence intake;
- Coach review;
- Coordinator L1;
- Quality review;
- rejection codes;
- correction workflow;
- graduation engine.

---

## MVP 4 — Full Control Layer

Add:

- advanced dashboards;
- policy configuration;
- forecasting;
- capacity planning;
- advanced analytics;
- automated weekly management reports.

---

# 73. MVP Pilot

Use realistic fake data before production:

approximately:

- 1,000 fake students;
- 40 groups;
- multiple coordinators;
- Coaches;
- accounts;
- gigs;
- evidence;
- incidents.

Test:

- duplicate assignment;
- concurrent account assignment;
- missing screenshot;
- missing next action;
- overdue contact;
- Coach SLA;
- Quality SLA;
- rejected evidence;
- second rejection;
- account suspension;
- invalid import;
- duplicate automation event;
- role-access violation;
- failed upload;
- student transfer;
- group closure.

Then pilot live with approximately:

- 1 Supervisor;
- 2 Coordinators;
- 2–5 Groups;
- 100–200 students.

---

# 74. Acceptance Criteria Examples

## Contact

Given active student,

when coordinator tries to complete contact without screenshot,

then system blocks completion.

---

## Contact compliance

Given active student has no valid contact in configured interval,

then student appears in No Contact queue.

---

## Account duplicate

Given Account A was already used by Student X in Group G,

when assignment is attempted for Student Y in Group G,

then backend rejects assignment.

---

## Account concurrency

Given two Higher Board users attempt to reserve the same available account,

only one assignment transaction may succeed.

---

## Student reuse

Given Student X already used Account A,

when Account A is proposed for another qualifying controlled gig for Student X,

then assignment fails.

---

## Client activity evidence

Given a client-side action requires screenshot evidence,

when user updates the activity without screenshot,

then the required workflow transition is blocked.

---

## Quality

Given Quality rejects evidence,

system automatically creates a correction workflow.

---

## Graduation

Given evidence is not Quality Accepted,

it must not increment graduation progress.

---

## Import

Given spreadsheet contains an invalid account assignment,

that row is rejected while valid rows may continue according to import policy.

Import must not bypass constraints.

---

## Audit

Given a gig is cancelled,

its historical record remains available.

---

# 75. Development Deliverables

Do not stop at UI mockups.

Produce:

1. working application;
2. database schema;
3. migrations;
4. seed/demo data;
5. role and RLS policies;
6. file-storage policies;
7. backend business rules;
8. workflow state machines;
9. import/export engine;
10. automated tests;
11. environment configuration documentation;
12. deployment instructions;
13. README;
14. admin/setup guide.

---

# 76. Coding Expectations

Use:

- clean typed code;
- reusable components;
- consistent naming;
- domain separation;
- validation schemas;
- centralized authorization;
- centralized workflow rules;
- centralized policy configuration;
- proper error handling.

Do not scatter critical business rules throughout UI components.

Avoid hard-coded Round 5-specific values where they should be configurable.

---

# 77. Build Behavior

Do not ask unnecessary clarifying questions.

Where a minor implementation detail is undefined:

1. choose the safest reasonable default;
2. make it configurable where appropriate;
3. document the assumption.

Do not invent new business rules that conflict with this specification.

Prioritize:

1. data integrity;
2. operational usability;
3. auditability;
4. permissions;
5. workflow correctness;
6. spreadsheet interoperability;
7. visual polish.

---

# 78. Final Product Standard

The finished system should allow us to answer at any moment:

- Which students need attention?
- Why do they need attention?
- Who owns the action?
- What is due?
- What is overdue?
- What proof exists?
- What client activity happened?
- Which account was used?
- Has Quality accepted the evidence?
- What is the student's graduation position?
- Which groups are falling behind?
- Which coordinators need intervention?
- Is account capacity sufficient?
- Is Quality becoming a bottleneck?
- Are we forecast to achieve the graduation target?
- Can every important decision be audited?

The application should feel like an **operations command center that actively drives the work**, not a passive record-keeping system.
