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
// Each approved service of a Service Team student on Kafiil or Nafezly (not
// Khamsat, which is not covered) earns an available client account on the same marketplace (the one
// with the most credit; a $0 account once none with credit is free, 22 Oct), linked to the student, that service and the student's
// coordinator: up to two accounts per student, so a third approved service
// earns none (19 October 2026). It is the coordinator's key: the account to
// order that service from. The student never sees it. One student per account,
// and the link is locked: only the people holding the "account-unlock" scope
// change or remove it.

export const serviceFixCategory = "Service correction";
export const taskProgressStates = ["Contacted the student", "Could not reach the student", "Student is fixing it"];
export const accountStates = ["In use", "Not used yet", "Needs a new account", "Does not work"];
/** The most client accounts one student is linked to, one per approved service. */
export const accountsPerStudent = 2;

// Service-link platforms are spelled as students see them; client accounts as
// the accounts sheet does.
// Khamsat services get no client account (22 October 2026): only Kafiil and Nafezly.
const marketplace: Record<string, string> = { Kafiil: "Kafeel", Nafezly: "Nafezly" };

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
 * Links client accounts to the student's approved services, oldest approval
 * first, until they hold two. Safe to call any number of times: services that
 * have an account, or a student who has two, are left as they are. `actor` is
 * whoever's action prompted it, for the audit; linked_by stays empty because
 * the app did it. Returns the accounts linked and what stopped it.
 */
export async function linkAccountKey(studentId: string, actor: any | null) {
  const s: any = await stmt(
    `SELECT s.id,s.name,s.lifecycle,g.id group_id,g.coordinator,g.supervisor,coalesce(g.delivery_model,'Regular') model,u.team
     FROM students s JOIN groups g ON g.id=s.group_id LEFT JOIN users u ON u.id=g.supervisor WHERE s.id=?`,
    studentId,
  ).first();
  // Service Team students only: theirs are the services ordered from client accounts.
  if (!s || s.lifecycle !== "Active" || s.team !== "Service Team" || s.model === "Industry" || !s.coordinator)
    return { linked: 0, reason: "not eligible" } as const;
  const held = Number((await stmt("SELECT count(*) n FROM accounts WHERE student_id=?", studentId).first() as any)?.n || 0);
  if (held >= accountsPerStudent) return { linked: 0, reason: "has two" } as const;
  const waiting = await all(
    `SELECT l.id,l.platform,l.slot FROM service_links l
     WHERE l.student_id=? AND l.qc_status='Locked' AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)
     ORDER BY l.qc_at,l.updated_at,l.slot`,
    studentId,
  );
  // Demo students try things out on demo accounts only; real students never get one (22 Oct).
  const side = String(s.group_id).startsWith("DEMO-") ? "id LIKE 'DEMO-%'" : "id NOT LIKE 'DEMO-%'";
  let linked = 0;
  let count = held;
  const missing: string[] = [];
  const t = now();
  for (const link of waiting) {
    if (count >= accountsPerStudent) break;
    const platform = marketplace[link.platform];
    if (!platform) continue;
    const account: any = await stmt(
      `SELECT id,label FROM accounts WHERE platform=? AND status='Available' AND student_id IS NULL AND active_assignment IS NULL AND ${side}
       ORDER BY credits DESC,id LIMIT 1`,
      platform,
    ).first();
    if (!account) {
      missing.push(platform);
      continue;
    }
    // Guarded: the account is still free and the student still under two.
    await db().batch([
      stmt(
        `UPDATE accounts SET student_id=?,service_link_id=?,linked_at=?,linked_by=?,coordinator_id=?,
           coordinator_2_id=CASE WHEN coordinator_2_id=? THEN NULL ELSE coordinator_2_id END
         WHERE id=? AND student_id IS NULL AND (SELECT count(*) FROM accounts x WHERE x.student_id=?)<?`,
        studentId, link.id, t, null, s.coordinator, s.coordinator, account.id, studentId, accountsPerStudent,
      ),
    ]);
    const now_linked: any = await stmt("SELECT student_id,service_link_id FROM accounts WHERE id=?", account.id).first();
    if (now_linked?.student_id !== studentId || now_linked?.service_link_id !== link.id) continue;
    linked++;
    count++;
    await db().batch([
      notify(s.coordinator, `Client account linked to ${s.name}'s ${link.platform} service ${link.slot}: use ${account.label}`, "student", studentId, "Information", `account-key:${account.id}:${link.id}`),
      auditStmt(actor || { id: "system" }, "account_link", account.id, { student_id: studentId, service_link_id: link.id, coordinator_id: s.coordinator, platform, automatic: true }, null),
    ]);
  }
  if (missing.length) {
    // Nobody to link: the people who keep the accounts hear about it once per student and marketplace.
    const keepers = await all(
      `SELECT id FROM users WHERE active=1 AND (roles LIKE '%Project Operations%' OR (roles LIKE '%Team Supervisor%' AND team='Service Team'))`,
    );
    await db().batch(
      [...new Set(missing)].flatMap((platform) =>
        keepers.map((k: any) =>
          notify(k.id, `No free ${platform} account for ${s.name}: add one`, "student", studentId, "Action Required", `account-key-missing:${studentId}:${platform}:${k.id}`),
        ),
      ),
    );
  }
  return { linked, reason: missing.length ? "no account" : "done", platforms: [...new Set(missing)] } as const;
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
    `SELECT DISTINCT l.student_id FROM service_links l JOIN students s ON s.id=l.student_id
     WHERE l.qc_status='Locked' AND s.lifecycle='Active' AND l.platform IN ('Kafiil','Nafezly')
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)
       AND (SELECT count(*) FROM accounts a WHERE a.student_id=l.student_id)<?`,
    accountsPerStudent,
  );
  let linked = 0;
  const missing = new Set<string>();
  for (const c of candidates) {
    const result = await linkAccountKey(c.student_id, actor);
    linked += result.linked;
    if ("platforms" in result) for (const p of result.platforms || []) missing.add(p);
  }
  return { tasks, linked, candidates: candidates.length, no_account_on: [...missing] };
}
