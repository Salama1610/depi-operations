# Student service-link workflow

Students use the `/student` route (and are routed there automatically from `/` when their signed-in email matches a student record). The page always presents three service slots. A first submission must contain three distinct HTTP/HTTPS URLs.

Each URL receives a deterministic automatic check before it enters the QC queue. The current check validates URL format and recognizes marketplace patterns including Kafiil (`/service/<numeric-id>-<slug>`) and Khamsat (`/<category>/<subcategory>/<numeric-id>-<slug>`). The verifier is isolated in `lib/domain/service-links.ts` so the later business rules can replace the placeholder without changing the student API or UI.

QC reviews each slot independently:

- `Locked`: the URL is accepted and becomes read-only for the student.
- `Needs Correction`: the URL remains editable and the QC comment is shown above the resubmission control.
- `Pending`: the URL is waiting for a QC decision and is read-only until that decision is made.

The database keeps one submission summary per student, one unique row for each slot 1–3, and a review history for every QC decision. The API enforces that locked and pending URLs cannot be changed, while a correction can only replace the rejected slot. Once all three slots are locked, the submission is marked `Complete`.

The QC queue is available in the staff **Quality review** module. It exposes only non-locked service links, with automatic-check state, platform, revision, and a review dialog for locking or requesting correction.

Student authorization uses the hosting-provided authenticated identity headers and a server-side match against `students.email`. No student can read another student's links or the staff operations surface.
