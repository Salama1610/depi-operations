-- A student's open tasks, found directly.
--
-- The Program page reads each student's next task; with only the owner's index
-- every student scanned the whole tasks table: 1.8 seconds at 2,900 students
-- and 4,700 tasks (measured 4 November 2026). Mirrors drizzle/0054.

create index if not exists idx_tasks_student_status_due on public.tasks (student_id, status, due);
