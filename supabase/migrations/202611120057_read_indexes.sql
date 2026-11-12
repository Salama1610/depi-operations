-- Indexes for reads that run on every workspace load (12 November 2026).
--
-- Each of these columns is read per student or per person on every load, and
-- had no index, so the table was scanned in full each time: a student's
-- evidence (graduation and the quality scope), their gigs and their attendance,
-- the gigs bought through an account, and the person's own recent history
-- (audit_events by actor, newest first). The tables are small enough that
-- building the indexes holds a write lock for well under a second. Mirrors
-- drizzle/0057.

create index if not exists idx_evidence_student on public.evidence (student_id);
create index if not exists idx_gigs_student on public.gigs (student_id);
create index if not exists idx_gigs_account on public.gigs (account_id);
create index if not exists idx_attendance_student on public.attendance (student_id);
create index if not exists idx_audit_events_actor_date on public.audit_events (actor, created_at);
