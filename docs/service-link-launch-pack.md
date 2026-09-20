# Student service-link launch pack

## Approved operating baseline

- Authentication: Supabase email/password sign-in. A student is authorized when the verified Supabase email matches exactly one active student record. Shared usernames and passwords, including `student1 / 123456`, are prohibited.
- Accepted platforms: Kafiil, Khamsat and Nafezly only. Approved on 20 September 2026; Nafezly was already an approved controlled-account platform.
- Links: direct public service-page URLs, stored over HTTPS. An `http` address on an approved marketplace whose service ID and slug are valid is upgraded to `https` and accepted, so no insecure link is ever recorded; `http` anywhere else fails. Shorteners, embedded credentials, custom ports, fragments and non-marketplace hosts fail automatically. Query strings are removed before duplicate comparison.
- Kafiil format: `/service/<numeric-id>-<Arabic-or-English-slug>`.
- Khamsat format: `/<category>/<subcategory>/<numeric-id>-<Arabic-or-English-slug>`.
- Nafezly format: `/service/<numeric-id>-<Arabic-or-English-slug>`, the same shape as Kafiil.
- The three normalized URLs must be distinct. The same approved platform and category may be used more than once.
- Coverage: the Quality review module lists every student in the reviewer's or coordinator's scope with one follow-up state, so a student who has submitted nothing is visible alongside those under review. The states are Not submitted, Awaiting QC, Needs student correction and Complete, filterable by track, group and coordinator. Coordinators and supervisors see this list; only Quality roles see the review queue and can decide a link.
- QC must open the page and confirm it is public, active, owned by the student, and relevant to the assigned track. Login-only, deleted, paused, rejected, unavailable, owner-mismatched, or track-mismatched services require correction.
- Automatic failure cannot be approved by a Quality Member. A Quality Lead may override it only with a recorded reason; the audit record remains immutable.
- Marketplace content is not fetched automatically in this release. Availability, owner, title and category are human QC decisions because marketplace contracts, stable page fields, and an approved identity-matching rule have not been supplied.

## Student SOP

1. Sign in with the Supabase account whose email was registered by the program team.
2. Open the Student services page and add exactly three direct Kafiil, Khamsat or Nafezly service URLs.
3. Review the normalized links in the confirmation dialog and submit them. Pending links are read-only.
4. Check the QC updates section. Approved links remain locked. A returned link shows the correction reason and becomes editable.
5. Correct only returned links, confirm the resubmission, and wait until all three links are approved.

Unsent edits are retained on the current device. Sign out after using a shared device. If sign-in says that no record is linked, ask the program team to correct the roster email; do not create a shared account.

## QC SOP and decision standard

Work oldest pending links first and use the filters for platform, track, group, coordinator, age, automatic result and correction count. The normal SLA is 48 hours.

For each link, confirm the URL opens the exact service page, the service is active and publicly visible, the seller belongs to the student, and the title/category fit the assigned track. Lock the link only when every check passes. Otherwise choose **Needs Correction** and use a specific correction template or write a clear action. Do not include private student data in comments.

Automatic failures require correction. A Quality Lead override is reserved for a documented verifier false-positive and requires an audit reason. Repeated corrections or ambiguous ownership should be escalated to the Quality Lead outside the approval action. Reviewer activity and turnaround appear in Reports.

## Admin roster import guide

Required student columns are `id`, `name`, `group_id`, and `email`. Optional controlled columns are `phone`, `lifecycle`, `engagement`, and `coaching`. Track, pathway, coordinator, supervisor and coach come from the referenced group, so groups and real role-separated staff must be loaded first.

Normalize the source email column before import. The preview rejects missing or malformed emails, duplicate IDs, duplicate emails, unknown groups, invalid lifecycle values and protected columns. Correct rejected rows in the source file and upload a new batch; imports never overwrite an existing student.

Import the Round 5 roster (2,948 workbook rows, 2,887 canonical students after 61 duplicate merges) as independently reconciled batches of no more than 1,000 rows. Validate 10 rows, then 100, then one 1,000-row batch before the full three-batch run. Each commit records created, skipped and rejected totals plus row-level failures. Administration shows missing and duplicate-email reports after import.

## Role and data ownership matrix

| Activity | Student | Coordinator/Supervisor | Quality Member | Quality Lead | Admin/Project Operations |
|---|---:|---:|---:|---:|---:|
| Submit or correct own links | Yes | No | No | No | No |
| View assigned student service profile | Own only | Assigned scope | Scoped QC | Scoped QC | Authorized scope |
| Lock format-passing link | No | No | Yes | Yes | No unless separately assigned Quality role |
| Override automatic failure | No | No | No | Yes, with reason | No unless separately assigned Quality Lead |
| Import roster | No | Authorized operations roles | No | No | Yes |
| View roster health and connections | No | No | No | No | Admin |
| Reveal a marketplace account credential | No | Yes, for accounts their groups use | No | No | Higher Board and Admin always; Project Operations within scope |

Each student record owns one submission, three numbered service-link rows, and immutable review rows keyed by link revision. Staff notifications are recipient-scoped. Student review history is loaded only through the authenticated student's own record.

## Incident response and recovery

For suspected cross-student exposure, disable the affected Site audience or staff account, preserve audit records, record an incident case, rotate any exposed connection secrets, and verify authorization tests before reopening. Do not delete audit or review history.

Encrypted backups include submissions, links and review history. Store the backup and encryption key separately. A recovery drill must restore to an isolated database, verify foreign keys and immutable audit triggers, compare student/link/review totals, and sample one completed and one correction workflow before sign-off.

## Launch checklist

- [ ] Real staff roster loaded; synthetic staff cannot authenticate.
- [ ] Quality Members and Quality Lead assigned separately from admin roles.
- [ ] Groups contain correct track, pathway, coordinator, supervisor and coach.
- [ ] Student roster preview completed at 10, 100 and 1,000 rows.
- [ ] Three reconciled 1,000-row production batches completed with zero unresolved failures.
- [ ] Administration reports zero missing and zero duplicate student emails.
- [ ] Link rules and 48-hour QC SLA approved by the program owner.
- [ ] Required end-to-end scenarios in `docs/student-service-links.md` passed in UAT.
- [ ] Android/mobile and keyboard/screen-reader checks completed.
- [ ] Backup, restore and incident-response drill signed off.
- [ ] Site audience reviewed; no shared or demo credentials published.

## UAT sign-off

Record the environment/version, test date, tester names and roles, roster batch IDs, total/created/rejected counts, scenarios executed, defects and resolutions, accessibility/mobile devices tested, backup restore evidence, remaining accepted risks, and approval names/dates for Operations, Quality, Security and the program owner. Production student access starts only after every launch checklist item is complete.
