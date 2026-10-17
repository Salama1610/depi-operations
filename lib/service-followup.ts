import { all, auditStmt, db, now, stmt, uid } from "./server";

// The same notice as lib/automation's notify; kept here so neither file imports the other.
function notify(recipient: string, title: string, entityType: string, entityId: string, severity: string, source: string) {
  return stmt("INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?,?,?)", uid("NTF"), recipient, title, entityType, entityId, severity, source, now(), null);
}

// What follows a quality decision on a student's service links (asked for on
// 17 October 2026).
//
// A link sent back for correction becomes a task for the coordinator of that
// student, who records that they contacted the student. The task stays open
// until the quality team approves the corrected link; a new correction comment
// replaces it with a new task.
//
// Once a Service Team student has two approved links, an available client
// account with credit on the same marketplace is linked to them and their
// coordinator. It is the coordinator's key: the account to order that
// student's services from. The student never sees it. One student per account,
// one account per student, and the link is locked until someone holding the
// "account-unlock" scope releases it.

export const serviceFixCategory = "Service correction";
export const taskProgressStates = ["Contacted the student", "Could not reach the student", "Student is fixing it"];
export const accountStates = ["In use", "Not used yet", "Needs a new account", "Does not work"];
/** Approved links a student needs before an account is linked to them. */
export const linksForAccount = 2;

// Service-link platforms are spelled as students see them; client accounts as
// the accounts sheet does.
const marketplace: Record<string, string> = { Kafiil: "Kafeel", Nafezly: "Nafezly", Khamsat: "Khamsat" };

const fixSource = (linkId: string) => `service-fix:${linkId}:`;

/**
 * The statements that go with a quality decision on one link: a correction
 * opens a task for the student's coordinator (closing the one for an earlier
 * comment); an approval closes them all.
 */
export async function serviceFixStatements(link: any, decision: "Locked" | "Needs Correction", comment: string, at: string) {
  const close = (keep?: string) =>
    stmt(
      `UPDATE tasks SET status='Closed' WHERE category=? AND status='Open' AND source LIKE ?${keep ? " AND source<>?" : ""}`,
      serviceFixCategory,
      fixSource(link.id) + "%",
      ...(keep ? [keep] : []),
    );
  if (decision === "Locked") return [close()];
  const owner: any = await stmt(
    "SELECT coalesce(g.coordinator,g.supervisor) owner, s.name FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?",
    link.student_id,
  ).first();
  if (!owner?.owner) return [close()];
  const source = fixSource(link.id) + (Number(link.revision) || 1);
  const title = `Service link sent back by quality: tell ${owner.name || "the student"} — ${comment}`.slice(0, 480);
  return [
    close(source),
    stmt(
      "INSERT OR IGNORE INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
      uid("TSK"), link.student_id, title, owner.owner, new Date(Date.parse(at) + 2 * 86400000).toISOString(),
      serviceFixCategory, "High", "Open", source, at,
    ),
    notify(owner.owner, "A service link was sent back: contact the student", "student", link.student_id, "Action Required", "service-fix-notice:" + source),
  ];
}

/**
 * Links a client account to the student if they now qualify (linked_by stays
 * empty: the app did it; `actor` is whoever's action prompted it, for the audit). Safe to call any
 * number of times: a student who has one, or does not qualify yet, is left as
 * they are. Returns what happened, for the caller to report.
 */
export async function linkAccountKey(studentId: string, actor: any | null) {
  const s: any = await stmt(
    `SELECT s.id,s.name,s.lifecycle,g.id group_id,g.coordinator,g.supervisor,coalesce(g.delivery_model,'Regular') model,u.team
     FROM students s JOIN groups g ON g.id=s.group_id LEFT JOIN users u ON u.id=g.supervisor WHERE s.id=?`,
    studentId,
  ).first();
  // Service Team students only: theirs are the services ordered from client accounts.
  if (!s || s.lifecycle !== "Active" || s.team !== "Service Team" || s.model === "Industry" || !s.coordinator)
    return { linked: false, reason: "not eligible" } as const;
  if (await stmt("SELECT id FROM accounts WHERE student_id=?", studentId).first()) return { linked: false, reason: "has one" } as const;
  const approved = await all(
    "SELECT platform FROM service_links WHERE student_id=? AND qc_status='Locked' ORDER BY qc_at,updated_at,id",
    studentId,
  );
  if (approved.length < linksForAccount) return { linked: false, reason: "not enough approved" } as const;
  // The marketplace of their first approved link that is on one.
  const platform = approved.map((l: any) => marketplace[l.platform]).find(Boolean);
  if (!platform) return { linked: false, reason: "no marketplace" } as const;
  const t = now();
  const account: any = await stmt(
    `SELECT id,label FROM accounts WHERE platform=? AND status='Available' AND student_id IS NULL AND active_assignment IS NULL AND credits>0
     ORDER BY credits DESC,id LIMIT 1`,
    platform,
  ).first();
  if (!account) {
    // Nobody to link: the people who keep the accounts hear about it once per student.
    const keepers = await all(
      `SELECT id FROM users WHERE active=1 AND (roles LIKE '%Project Operations%' OR (roles LIKE '%Team Supervisor%' AND team='Service Team'))`,
    );
    await db().batch(
      keepers.map((k: any) =>
        notify(k.id, `No ${platform} account with credit for ${s.name}: add or top up one`, "student", studentId, "Action Required", `account-key-missing:${studentId}:${k.id}`),
      ),
    );
    return { linked: false, reason: "no account", platform } as const;
  }
  await db().batch([
    stmt(
      `UPDATE accounts SET student_id=?,linked_at=?,linked_by=?,coordinator_id=?,
         coordinator_2_id=CASE WHEN coordinator_2_id=? THEN NULL ELSE coordinator_2_id END
       WHERE id=? AND student_id IS NULL`,
      studentId, t, null, s.coordinator, s.coordinator, account.id,
    ),
    notify(s.coordinator, `Client account linked to ${s.name}: use ${account.label} for their orders`, "student", studentId, "Information", `account-key:${account.id}:${studentId}`),
    auditStmt(actor || { id: "system" }, "account_link", account.id, { student_id: studentId, coordinator_id: s.coordinator, platform, automatic: !actor }, null),
  ]);
  const now_linked: any = await stmt("SELECT student_id FROM accounts WHERE id=?", account.id).first();
  return now_linked?.student_id === studentId
    ? ({ linked: true, account_id: account.id, platform } as const)
    : ({ linked: false, reason: "taken" } as const);
}

/**
 * Catches up on everything the decisions above should have done: a task for
 * every link waiting for correction without one, and an account for every
 * Service Team student who already has enough approved links.
 */
export async function serviceFollowUpSweep(actor: any) {
  const waiting = await all(
    `SELECT l.id,l.student_id,l.revision,l.qc_comment,coalesce(l.qc_at,l.updated_at) at FROM service_links l
     JOIN students s ON s.id=l.student_id
     WHERE l.qc_status='Needs Correction' AND s.lifecycle='Active'
       AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.source='service-fix:'||l.id||':'||coalesce(l.revision,1))`,
  );
  let tasks = 0;
  for (const link of waiting) {
    const jobs = await serviceFixStatements(link, "Needs Correction", String(link.qc_comment || "see the quality comment"), String(link.at || now()));
    await db().batch(jobs);
    tasks++;
  }
  const candidates = await all(
    `SELECT l.student_id FROM service_links l JOIN students s ON s.id=l.student_id
     WHERE l.qc_status='Locked' AND s.lifecycle='Active' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.student_id=l.student_id)
     GROUP BY l.student_id HAVING count(*)>=?`,
    linksForAccount,
  );
  let linked = 0;
  const missing = new Set<string>();
  for (const c of candidates) {
    const result = await linkAccountKey(c.student_id, actor);
    if (result.linked) linked++;
    else if (result.reason === "no account" && "platform" in result) missing.add(result.platform);
  }
  return { tasks, linked, candidates: candidates.length, no_account_on: [...missing] };
}
