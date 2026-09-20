# Student service-link workflow

Students use the `/student` route (and are routed there automatically from `/` when their signed-in email matches a student record). The page always presents three service slots. A first submission must contain three distinct HTTP/HTTPS URLs.

Each URL receives a deterministic automatic check before it enters the QC queue. The check accepts only direct service pages on Kafiil (`/service/<numeric-id>-<slug>`), Nafezly (the same shape) and Khamsat (`/<category>/<subcategory>/<numeric-id>-<slug>`). It supports Arabic and English slugs, stores every link over HTTPS and upgrades an `http` address on those marketplaces rather than rejecting it, removes tracking parameters and fragments, limits input length, rejects custom ports and embedded credentials, and prevents normalized duplicates. Network availability, ownership and track fit remain explicit human QC checks. The approved rules and SOPs are in `docs/service-link-launch-pack.md`.

QC reviews each slot independently:

- `Locked`: the URL is accepted and becomes read-only for the student.
- `Needs Correction`: the URL remains editable and the QC comment is shown above the resubmission control.
- `Pending`: the URL is waiting for a QC decision and is read-only until that decision is made.

The database keeps one submission summary per student, one unique row for each slot 1–3, and a review history for every QC decision. The API enforces that locked and pending URLs cannot be changed, while a correction can only replace the rejected slot. Once all three slots are locked, the submission is marked `Complete`.

The QC queue is available in the staff **Quality review** module. It has platform, track, group, coordinator, age, automatic-result and correction-count filters; 25-row pagination; SLA indicators; correction templates; Quality Lead override reasons; reviewer activity; and immutable one-decision-per-revision protection. Student 360 shows all three links and their review history. Reports include submission, approval, correction, turnaround, platform, revision, reviewer and group/coordinator metrics with CSV/XLSX export.

## Required UAT scenarios

Verify: exactly three valid links; two/four-link rejection; normalized duplicate rejection; malformed and invalid marketplace URL rejection; one-link lock; locked and pending edit prevention; correction-only resubmission; all-three completion; student-to-student isolation; coordinator/non-quality denial; Quality Member review; automatic-failure override restricted to Quality Lead with reason; duplicate/concurrent decision protection; unlinked and closed-student denial; missing/duplicate-email reports; three reconciled 1,000-row roster batches; and report totals against direct database counts.

Student authorization uses the hosting-provided authenticated identity headers and a server-side match against `students.email`. No student can read another student's links or the staff operations surface.
