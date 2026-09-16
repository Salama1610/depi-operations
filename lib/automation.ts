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

  const qualityLeads = snapshot.staff.filter((staff: any) => staff.active && JSON.parse(staff.roles || "[]").includes("Quality Lead"));
  const overdueServiceLinks = snapshot.serviceLinks.filter((link: any) => link.qc_status === "Pending" && Date.now() - Date.parse(link.updated_at) > 48 * 3600000);
  for (const link of overdueServiceLinks.slice(0, 100))
    for (const lead of qualityLeads)
      jobs.push(notify(lead.id, `Service-link QC overdue: ${link.student_name}`, "student", link.student_id, "Action Required", `service-qc-overdue:${link.id}:${link.revision}:${lead.id}`));

  const summary = {
    planned: plan.length,
    processed: batch.length,
    remaining: Math.max(0, plan.length - batch.length),
    tasks: batch.filter((action) => action.kind === "task").length,
    cases: batch.filter((action) => action.kind === "case").length,
    notifications: Math.min(due.length, 100) + Math.min(overdueServiceLinks.length, 100) * qualityLeads.length,
    notifications_remaining: Math.max(0, due.length - 100) + Math.max(0, overdueServiceLinks.length - 100),
    overdue_service_links: overdueServiceLinks.length,
  };
  jobs.push(auditStmt(u, "policy_check", "workspace", summary, null, requestId));
  await db().batch(jobs);
  return summary;
}
