import { all, auditStmt, db, now, stmt, uid } from "./server";
import { accountMixProblem, otherMarketplace } from "./domain/student-accounts";
import { buysServices, serviceGroups } from "./domain/service-links";
import { likeText } from "./domain/rules";

// The groups that buy services through client accounts live with the rest of the service rules (lib/domain/service-links).
export { buysServices, serviceGroups };

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
// Each approved service on Kafiil or Nafezly (not Khamsat, which is not
// covered) of a student in one of the service groups earns an available
// client account on the same marketplace (the one with the most credit), linked
// to the student, that service and the student's coordinator. It is the
// coordinator's key: the account to order that service from. The student
// never sees it, and the link is locked: only the people holding the
// "account-unlock" scope change or remove it.
//
// Since 10 November 2026: only the students of the service groups below get
// accounts; a student gets up to three, each a different account; an account
// buys from two students at most, one service each, and never two students
// of the same job profile. The service link records the account that buys it
// (service_links.account_id); the account's first student stays on the
// account itself, and the second student's coordinator shares the account.
// Accounts that are not Available (Locked ones among them) are never given out.
//
// Since 12 November 2026 a student's three accounts are two on one marketplace
// and one on the other (Kafeel and Nafezly), never all three on the same one.
// A student who holds two accounts on one marketplace gets no third account for
// another service on it: their coordinator is told the third service has to be
// on the other marketplace (lib/domain/student-accounts).

export const serviceFixCategory = "Service correction";
export const taskProgressStates = ["Contacted the student", "Could not reach the student", "Student is fixing it"];
export const accountStates = ["In use", "Not used yet", "Needs a new account", "Does not work"];
/** The most client accounts one student is linked to, one per approved service, each a different account. */
export const accountsPerStudent = 3;
/** The most students one account buys from, one service each. */
export const studentsPerAccount = 2;

/** The accounts a student is linked to: as an account's first student, or through a service it buys. */
export const studentAccountsSql = `SELECT id account_id FROM accounts WHERE student_id=? UNION SELECT account_id FROM service_links WHERE student_id=? AND account_id IS NOT NULL`;

/** How many students an account buys from, as SQL on an accounts alias. */
export const accountUsesSql = (a = "a") =>
  `((CASE WHEN ${a}.student_id IS NULL THEN 0 ELSE 1 END) + (SELECT count(DISTINCT l.student_id) FROM service_links l WHERE l.account_id=${a}.id AND l.student_id<>coalesce(${a}.student_id,'')))`;

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
      `UPDATE tasks SET status='Closed' WHERE category=? AND status='Open' AND source LIKE ? ESCAPE '\\'${keep ? " AND source<>?" : ""}`,
      serviceFixCategory,
      likeText(fixSource(link.id)) + "%",
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
 * first, until they hold three. Safe to call any number of times: services that
 * have an account, or a student who has three, are left as they are. `actor` is
 * whoever's action prompted it, for the audit; linked_by stays empty because
 * the app did it. Returns the accounts linked and what stopped it.
 */
export async function linkAccountKey(studentId: string, actor: any | null) {
  const s: any = await stmt(
    `SELECT s.id,s.name,s.lifecycle,s.job_profile,g.id group_id,g.coordinator,g.supervisor,coalesce(g.delivery_model,'Regular') model
     FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?`,
    studentId,
  ).first();
  // The service groups' students only: theirs are the services ordered from client accounts.
  const demo = String(s?.group_id || "").startsWith("DEMO-");
  if (!s || s.lifecycle !== "Active" || (!demo && !buysServices(s.group_id)) || s.model === "Industry" || !s.coordinator)
    return { linked: 0, reason: "not eligible" } as const;
  const accountsOf = async () => new Set((await all(studentAccountsSql, studentId, studentId)).map((r: any) => String(r.account_id)));
  // The marketplaces of the accounts the student holds, for the two-and-one rule.
  const platformsOf = async (ids: Set<string>) =>
    ids.size ? (await all(`SELECT platform FROM accounts WHERE id IN (${[...ids].map(() => "?").join(",")})`, ...ids)).map((r: any) => String(r.platform)) : [];
  let mine = await accountsOf();
  let heldPlatforms = await platformsOf(mine);
  if (mine.size >= accountsPerStudent) return { linked: 0, reason: "has three" } as const;
  const waiting = await all(
    `SELECT l.id,l.platform,l.slot FROM service_links l
     WHERE l.student_id=? AND l.qc_status='Locked' AND l.account_id IS NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)
     ORDER BY l.qc_at,l.updated_at,l.slot`,
    studentId,
  );
  const profile = String(s.job_profile || "").trim().toLowerCase();
  // Demo students try things out on demo accounts only; real students never get one (22 Oct).
  const side = String(s.group_id).startsWith("DEMO-") ? "id LIKE 'DEMO-%'" : "id NOT LIKE 'DEMO-%'";
  let linked = 0;
  const missing: string[] = [];
  const sameMarketplace: { platform: string; linkId: string }[] = [];
  const t = now();
  for (const link of waiting) {
    if (mine.size >= accountsPerStudent) break;
    const platform = marketplace[link.platform];
    if (!platform) continue;
    // Two accounts on this marketplace already: a third here would make three on one.
    if (accountMixProblem(heldPlatforms, platform) === "same") {
      sameMarketplace.push({ platform, linkId: String(link.id) });
      continue;
    }
    // A free account first, then one with a student left to share; never one
    // this student already has, nor one buying from a student of the same job profile.
    const sameProfile = profile
      ? `EXISTS (SELECT 1 FROM students x WHERE lower(trim(coalesce(x.job_profile,'')))=? AND (x.id=a.student_id OR x.id IN (SELECT l.student_id FROM service_links l WHERE l.account_id=a.id)))`
      : "0=1";
    const account: any = await stmt(
      `SELECT a.id,a.label,a.student_id FROM accounts a WHERE a.platform=? AND a.status='Available' AND a.active_assignment IS NULL AND a.${side}
         AND ${accountUsesSql("a")}<? AND coalesce(a.student_id,'')<>? AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.account_id=a.id AND l.student_id=?)
         AND NOT ${sameProfile}
       ORDER BY CASE WHEN a.student_id IS NULL THEN 0 ELSE 1 END,a.credits DESC,a.id LIMIT 1`,
      platform, studentsPerAccount, studentId, studentId, ...(profile ? [profile] : []),
    ).first();
    if (!account) {
      missing.push(platform);
      continue;
    }
    // Guarded: the service still has no account, the account is still under
    // two students and the student still under three accounts.
    const guard = `(SELECT count(*) FROM (${studentAccountsSql}) y)<?`;
    // One save (12 November 2026): the link and the account change together
    // or not at all, and whether this student is the account's first or its
    // second is decided by the database at that moment, not by the read
    // above, so two students approved at once both end up on the account.
    const linkedHere = "EXISTS (SELECT 1 FROM service_links k WHERE k.id=? AND k.account_id=?)";
    await db().batch([
      stmt(
        `UPDATE service_links SET account_id=? WHERE id=? AND account_id IS NULL AND ${guard}
           AND (SELECT ${accountUsesSql("a")} FROM accounts a WHERE a.id=?)<?`,
        account.id, link.id, studentId, studentId, accountsPerStudent, account.id, studentsPerAccount,
      ),
      // A second student: their coordinator shares the account.
      stmt(
        `UPDATE accounts SET coordinator_2_id=COALESCE(coordinator_2_id,CASE WHEN coordinator_id=? THEN NULL ELSE ? END)
         WHERE id=? AND student_id IS NOT NULL AND student_id<>? AND ${linkedHere}`,
        s.coordinator, s.coordinator, account.id, studentId, link.id, account.id,
      ),
      // The first student is kept on the account itself.
      stmt(
        `UPDATE accounts SET student_id=?,service_link_id=?,linked_at=?,linked_by=?,coordinator_id=?,
           coordinator_2_id=CASE WHEN coordinator_2_id=? THEN NULL ELSE coordinator_2_id END
         WHERE id=? AND student_id IS NULL AND ${linkedHere}`,
        studentId, link.id, t, null, s.coordinator, s.coordinator, account.id, link.id, account.id,
      ),
    ]);
    const now_linked: any = await stmt("SELECT account_id FROM service_links WHERE id=?", link.id).first();
    if (now_linked?.account_id !== account.id) continue;
    linked++;
    mine = await accountsOf();
    heldPlatforms = await platformsOf(mine);
    await db().batch([
      notify(s.coordinator, `Client account linked to ${s.name}'s ${link.platform} service ${link.slot}: use ${account.label}`, "student", studentId, "Information", `account-key:${account.id}:${link.id}`),
      auditStmt(actor || { id: "system" }, "account_link", account.id, { student_id: studentId, service_link_id: link.id, coordinator_id: s.coordinator, platform, automatic: true }, null),
    ]);
  }
  if (sameMarketplace.length) {
    // The coordinator hears once per service: the third service has to be on the other marketplace.
    await db().batch(
      sameMarketplace.map((blocked) =>
        notify(
          s.coordinator,
          `${s.name}'s two accounts are both on ${blocked.platform}: the third service has to be on ${otherMarketplace(blocked.platform)}`,
          "student", studentId, "Action Required", `account-mix:${studentId}:${blocked.linkId}:${s.coordinator}`,
        ),
      ),
    );
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
  return {
    linked,
    reason: missing.length ? "no account" : sameMarketplace.length ? "same marketplace" : "done",
    platforms: [...new Set(missing)],
    sameMarketplace: sameMarketplace.length,
  } as const;
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
  const candidates = (
    await all(
      `SELECT DISTINCT l.student_id,s.group_id FROM service_links l JOIN students s ON s.id=l.student_id
       WHERE l.qc_status='Locked' AND s.lifecycle='Active' AND l.platform IN ('Kafiil','Nafezly') AND l.account_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)`,
    )
  ).filter((c: any) => buysServices(c.group_id));
  let linked = 0;
  let sameMarketplaceBlocked = 0;
  const missing = new Set<string>();
  for (const c of candidates) {
    const result = await linkAccountKey(c.student_id, actor);
    linked += result.linked;
    sameMarketplaceBlocked += "sameMarketplace" in result ? Number(result.sameMarketplace) || 0 : 0;
    if ("platforms" in result) for (const p of result.platforms || []) missing.add(p);
  }
  return { tasks, linked, candidates: candidates.length, no_account_on: [...missing], same_marketplace: sameMarketplaceBlocked };
}

/**
 * A submission's state, read from its links. It is Complete when at least
 * three Kafiil or Nafezly links are approved and nothing is waiting for QC;
 * links in "Other" are reviewed but are not needed for it. Approved links short of that are In Progress: the
 * student has more to add. The student's own submissions and the staff
 * QC decision both write it with this (2 November 2026).
 */
export function submissionStatus(studentId: string, t: string, completedAt: "now" | "latest") {
  const done = `(NOT EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Pending')
    AND (SELECT count(*) FROM service_links WHERE student_id=? AND platform IN ('Kafiil','Nafezly') AND qc_status='Locked')>=3
    AND ((SELECT group_id FROM students WHERE id=?) NOT IN (${serviceGroups.map((g) => `'${g}'`).join(",")})
      OR (EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND platform='Kafiil' AND qc_status='Locked')
          AND EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND platform='Nafezly' AND qc_status='Locked'))))`;
  const doneArgs = [studentId, studentId, studentId, studentId, studentId];
  return stmt(
    `UPDATE service_submissions SET status=CASE
       WHEN ${done} THEN 'Complete'
       WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Needs Correction') THEN 'Needs Correction'
       WHEN EXISTS (SELECT 1 FROM service_links WHERE student_id=? AND qc_status='Pending') THEN 'Pending QC'
       ELSE 'In Progress' END,
       qc_completed_at=CASE WHEN ${done} THEN ${completedAt === "now" ? "?" : "(SELECT max(qc_at) FROM service_links WHERE student_id=?)"} ELSE NULL END,
       updated_at=? WHERE student_id=?`,
    ...doneArgs,
    studentId,
    studentId,
    ...doneArgs,
    completedAt === "now" ? t : studentId,
    t,
    studentId,
  );
}
