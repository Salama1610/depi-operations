import { all, stmt, db, uid, now, auditStmt, loadData, permit } from "./server";
import { planPolicyActions } from "./domain/policy-actions";

export function notify(recipient: string, title: string, entityType: string, entityId: string, severity: string, source: string) {
  return stmt(
    "INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,?)",
    uid("NTF"), recipient, title, entityType, entityId, severity, source, now(), null,
  );
}

export async function policyChecks(u: any, requestId: string) {
  permit(u, ["Project Operations", "Team Supervisor", "Operations Systems / Admin"]);
  const snapshot = await loadData(u);
  const plan = planPolicyActions(snapshot);
  const batch = plan.slice(0, 100);
  const jobs = [];
  for (const action of batch) {
    const id = uid(action.kind === "task" ? "TSK" : "CASE");
    if (action.kind === "task")
      jobs.push(stmt("INSERT OR IGNORE INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)", id, action.student_id, action.title, action.owner, action.due, action.category, action.priority, "Open", action.source, now()));
    else
      jobs.push(stmt("INSERT OR IGNORE INTO cases(id,student_id,title,type,severity,status,owner,due,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, action.student_id, action.title, action.type, action.severity, "Open", action.owner, action.due, action.source, now()));
    jobs.push(notify(action.owner, action.title, "student", action.student_id, action.kind === "case" ? "Urgent" : "Action Required", "policy:" + action.source));
  }

  const noticeKeys = new Set((await all("SELECT source FROM notifications WHERE source LIKE ?", "due:%")).map((notice) => notice.source));
  const due = snapshot.tasks.filter((task: any) => task.status === "Open" && Date.parse(task.due) < Date.now() && !noticeKeys.has(`due:${task.id}:${task.due}`));
  for (const task of due.slice(0, 100))
    jobs.push(notify(task.owner, "Overdue: " + task.title, "student", task.student_id, "Action Required", `due:${task.id}:${task.due}`));

  // An unreviewed service link is chased with the people who own that
  // student's group, since the review is theirs.
  const owners = new Map<string, string[]>(
    snapshot.students.map((student: any) => [student.id, [student.coordinator, student.supervisor].filter(Boolean)]),
  );
  const overdueServiceLinks = snapshot.serviceLinks.filter((link: any) => link.qc_status === "Pending" && Date.now() - Date.parse(link.updated_at) > 48 * 3600000);
  let serviceLinkReminders = 0;
  for (const link of overdueServiceLinks.slice(0, 100))
    for (const owner of new Set(owners.get(link.student_id) || [])) {
      jobs.push(notify(owner, `Service link waiting for review: ${link.student_name}`, "student", link.student_id, "Action Required", `service-review-overdue:${link.id}:${link.revision}:${owner}`));
      serviceLinkReminders++;
    }

  // A session in the coming week that its coordinator and coach have not both
  // confirmed is followed as a case, owned by the coordinator. Sessions
  // scheduled in the app open theirs at once; this catches the imported
  // calendar a week at a time instead of all at once.
  const groupsById = new Map<string, any>(snapshot.groups.map((group: any) => [group.id, group]));
  const soon = Date.now() + 7 * 86400000;
  const unconfirmed = snapshot.sessions.filter(
    (session: any) => session.status === "Scheduled" && Date.parse(session.starts_at) > Date.now() && Date.parse(session.starts_at) <= soon && groupsById.get(session.group_id)?.coordinator,
  );
  for (const session of unconfirmed.slice(0, 100)) {
    const group = groupsById.get(session.group_id);
    jobs.push(stmt(
      "INSERT OR IGNORE INTO cases(id,student_id,title,type,severity,status,owner,due,source,created_at,group_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      uid("CASE"), null, `Confirm session · ${group.id} · Week ${session.week}`, "Session", "S3 Standard", "Open", group.coordinator, session.starts_at, "session-" + session.id, now(), group.id,
    ));
  }

  const summary = {
    session_cases: Math.min(unconfirmed.length, 100),
    planned: plan.length,
    processed: batch.length,
    remaining: Math.max(0, plan.length - batch.length),
    tasks: batch.filter((action) => action.kind === "task").length,
    cases: batch.filter((action) => action.kind === "case").length,
    notifications: Math.min(due.length, 100) + serviceLinkReminders,
    notifications_remaining: Math.max(0, due.length - 100) + Math.max(0, overdueServiceLinks.length - 100),
    overdue_service_links: overdueServiceLinks.length,
  };
  jobs.push(auditStmt(u, "policy_check", "workspace", summary, null, requestId));
  await db().batch(jobs);
  return summary;
}
