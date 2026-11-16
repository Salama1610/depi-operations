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

/**
 * The accounts a student is linked to: as an account's first student, or through
 * a service it buys. A retired account is off the system and does not count
 * (17 November 2026): a student whose second Kafeel account was retired was
 * taken for a holder of three and got no replacement.
 */
export const studentAccountsSql = `SELECT id account_id FROM accounts WHERE student_id=? AND status<>'Retired' UNION SELECT l.account_id FROM service_links l JOIN accounts a ON a.id=l.account_id WHERE l.student_id=? AND l.account_id IS NOT NULL AND a.status<>'Retired'`;

/** How many students an account buys from, as SQL on an accounts alias. */
/**
 * Frees the account places of students who have graduated on the portal
 * (13 November 2026): the accounts are there to get a student to three gigs,
 * so once the latest students sheet says Graduated they go back to the pool for
 * someone still working towards them. Runs after each students-sheet upload.
 * Each place is one save: its open orders are cancelled (with the credit they
 * took back on the account), the services and the account are unlinked, the
 * coordinator is told, and it is audited.
 */
export async function releaseGraduatedAccounts(actor: any) {
  const graduates = `SELECT p.student_id FROM portal_students p
    JOIN portal_uploads b ON b.batch_id=p.batch_id AND b.sheet='students' AND b.status='Active'
    JOIN students s ON s.id=p.student_id
    WHERE lower(trim(coalesce(p.final_status,'')))='graduated' AND s.lifecycle='Active' AND s.group_id NOT LIKE 'DEMO-%'`;
  const places = await all(
    `SELECT a.id account_id,a.label,a.student_id FROM accounts a WHERE a.status<>'Retired' AND a.student_id IN (${graduates})
     UNION ALL
     SELECT a.id,a.label,l.student_id FROM service_links l JOIN accounts a ON a.id=l.account_id
     WHERE a.status<>'Retired' AND l.student_id IN (${graduates}) AND l.student_id<>coalesce(a.student_id,'')`,
  );
  const t = now();
  let released = 0;
  for (const place of places as any[]) {
    const pupil: any = await stmt("SELECT s.name,g.coordinator FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?", place.student_id).first();
    const open = await all(
      "SELECT id FROM account_orders WHERE account_id=? AND student_id=? AND status NOT IN ('Proof Uploaded','Cancelled')",
      place.account_id,
      place.student_id,
    );
    const jobs: any[] = [];
    for (const order of open as any[]) {
      const tag = `[order ${order.id}]`;
      const row: any = await stmt(
        "SELECT COALESCE(sum(delta),0) n FROM account_credit_ledger WHERE account_id=? AND reason LIKE ? ESCAPE '\\'",
        place.account_id,
        "%" + likeText(tag),
      ).first();
      const refund = Math.round(-Number(row?.n || 0) * 100) / 100;
      if (refund)
        jobs.push(
          stmt("UPDATE accounts SET credits=credits+? WHERE id=?", refund, place.account_id),
          stmt(
            "INSERT INTO account_credit_ledger(id,account_id,delta,balance_after,reason,actor,created_at) SELECT ?,id,?,credits,?,?,? FROM accounts WHERE id=?",
            uid("CR"), refund, "Refund: order cancelled, the student graduated " + tag, actor?.id || "system", t, place.account_id,
          ),
        );
    }
    jobs.push(
      stmt(
        "UPDATE account_orders SET status='Cancelled',note=COALESCE(note||' · ','')||?,cancelled_at=?,updated_at=? WHERE account_id=? AND student_id=? AND status NOT IN ('Proof Uploaded','Cancelled')",
        "Closed: the student graduated on the portal, so the account went to another student.", t, t, place.account_id, place.student_id,
      ),
      stmt("UPDATE service_links SET account_id=NULL WHERE account_id=? AND student_id=?", place.account_id, place.student_id),
      stmt("UPDATE accounts SET student_id=NULL,service_link_id=NULL,linked_at=NULL,linked_by=NULL WHERE id=? AND student_id=?", place.account_id, place.student_id),
      stmt(
        "UPDATE accounts SET coordinator_id=NULL,coordinator_2_id=NULL WHERE id=? AND student_id IS NULL AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.account_id=accounts.id)",
        place.account_id,
      ),
      auditStmt(actor || { id: "system" }, "account_freed_graduated", place.account_id, { student_id: null }, { student_id: place.student_id }),
    );
    if (pupil?.coordinator)
      jobs.push(
        notify(pupil.coordinator, `${pupil.name} has graduated on the portal: client account ${place.label} went back to the pool`, "student", place.student_id, "Information", `account-graduated:${place.account_id}:${place.student_id}`),
      );
    await db().batch(jobs);
    released++;
  }
  return released;
}

/**
 * Takes an account's place away from a student who has bought nothing through
 * it (17 November 2026), so a student who will can have it: the owner's
 * decision to use every account that is not buying. The service stays approved
 * and free for another account, the student's coordinator is told, and it is
 * audited. A place with an order that is not cancelled is refused: a purchase
 * in progress or made keeps its account. So is a place on an account its
 * coordinator has marked "In use": the order may simply not be recorded yet. Like releasing a graduate's place, an
 * account left with nobody gives up its coordinators.
 */
export async function releaseUnusedPlace(accountId: string, studentId: string, actor: any | null, reason: string) {
  const account: any = await stmt("SELECT id,label,platform,student_id,coordinator_state FROM accounts WHERE id=?", accountId).first();
  if (!account) return { released: false, reason: "no account" } as const;
  if (account.coordinator_state === "In use") return { released: false, reason: "marked in use" } as const;
  const links = await all("SELECT id FROM service_links WHERE account_id=? AND student_id=?", accountId, studentId);
  if (!links.length && account.student_id !== studentId) return { released: false, reason: "not on this account" } as const;
  const bought: any = await stmt("SELECT id FROM account_orders WHERE account_id=? AND student_id=? AND status<>'Cancelled' LIMIT 1", accountId, studentId).first();
  if (bought) return { released: false, reason: "has an order" } as const;
  const pupil: any = await stmt("SELECT s.name,g.coordinator FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?", studentId).first();
  const t = now();
  const jobs: any[] = [
    stmt("UPDATE service_links SET account_id=NULL WHERE account_id=? AND student_id=?", accountId, studentId),
    stmt("UPDATE accounts SET student_id=NULL,service_link_id=NULL,linked_at=NULL,linked_by=NULL WHERE id=? AND student_id=?", accountId, studentId),
    promoteRepeatStmt(studentId),
    stmt(
      "UPDATE accounts SET coordinator_id=NULL,coordinator_2_id=NULL WHERE id=? AND student_id IS NULL AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.account_id=accounts.id)",
      accountId,
    ),
    auditStmt(actor || { id: "system" }, "account_place_released_unused", accountId, { student_id: null }, { student_id: studentId }, uid("REQ"), reason),
  ];
  if (pupil?.coordinator)
    jobs.push(
      notify(
        pupil.coordinator,
        `Client account ${account.label} was taken from ${pupil.name}'s service: nothing had been bought with it, and it goes to a student who will`,
        "student", studentId, "Information", `account-released:${accountId}:${studentId}:${t}`,
      ),
    );
  await db().batch(jobs);
  return { released: true, platform: String(account.platform) } as const;
}

/**
 * Whether a marketplace has an account a new student can still take, on the
 * caller's side of the demo line. While the other marketplace has none, a
 * student may take a third account on the same one (13 November 2026, the
 * owner's decision): the two-and-one rule comes back by itself once accounts
 * on the other marketplace are added.
 */
export async function hasFreePlace(platform: string, demo: boolean) {
  const row: any = await stmt(
    `SELECT a.id FROM accounts a WHERE a.platform=? AND a.status='Available' AND a.active_assignment IS NULL
       AND a.id ${demo ? "LIKE" : "NOT LIKE"} 'DEMO-%' AND ${accountUsesSql("a")}<? LIMIT 1`,
    platform,
    studentsPerAccount,
  ).first();
  return Boolean(row);
}

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
 * Links one account to one approved service of a student. Guarded: the service
 * still has no account, the account is still under two students and the
 * student still under three accounts. One save (12 November 2026): the link and
 * the account change together or not at all, and whether this student is the
 * account's first or its second is decided by the database at that moment, not
 * by a read before it, so two students approved at once both end up on the
 * account. Returns whether the link was made; then the coordinator is told and
 * it is audited.
 */
async function linkPlace(account: any, link: any, s: any, studentId: string, platform: string, actor: any | null) {
  const t = now();
  const guard = `(SELECT count(*) FROM (${studentAccountsSql}) y)<?`;
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
  const linkedNow: any = await stmt("SELECT account_id FROM service_links WHERE id=?", link.id).first();
  if (linkedNow?.account_id !== account.id) return false;
  await db().batch([
    notify(s.coordinator, `Client account linked to ${s.name}'s ${link.platform} service ${link.slot}: use ${account.label}`, "student", studentId, "Information", `account-key:${account.id}:${link.id}`),
    auditStmt(actor || { id: "system" }, "account_link", account.id, { student_id: studentId, service_link_id: link.id, coordinator_id: s.coordinator, platform, automatic: true }, null),
  ]);
  return true;
}

/**
 * An account Project Operations linked to the student by hand before they had
 * an approved service (17 November 2026) takes the student's first one: it is
 * the account for it, in place of another account being taken for the same
 * student. Guarded like a link: the service still has no account and the
 * account is still the student's with no service. Returns whether it was made.
 */
async function bindBareAccount(account: any, link: any, s: any, studentId: string, platform: string, actor: any | null) {
  await db().batch([
    stmt(
      "UPDATE service_links SET account_id=? WHERE id=? AND account_id IS NULL AND EXISTS (SELECT 1 FROM accounts a WHERE a.id=? AND a.student_id=? AND a.service_link_id IS NULL AND a.status='Available')",
      account.id, link.id, account.id, studentId,
    ),
    stmt(
      "UPDATE accounts SET service_link_id=? WHERE id=? AND student_id=? AND service_link_id IS NULL AND EXISTS (SELECT 1 FROM service_links k WHERE k.id=? AND k.account_id=?)",
      link.id, account.id, studentId, link.id, account.id,
    ),
  ]);
  const bound: any = await stmt("SELECT service_link_id FROM accounts WHERE id=?", account.id).first();
  if (bound?.service_link_id !== link.id) return false;
  await db().batch([
    notify(s.coordinator, `Client account ${account.label} is for ${s.name}'s ${link.platform} service ${link.slot}: use it`, "student", studentId, "Information", `account-key:${account.id}:${link.id}`),
    auditStmt(actor || { id: "system" }, "account_link", account.id, { student_id: studentId, service_link_id: link.id, coordinator_id: s.coordinator, platform, automatic: true, kept_by_hand: true }, null),
  ]);
  return true;
}

/**
 * Gives one named account to one approved service of a student (17 November
 * 2026), for a plan worked out beforehand rather than the catch-up's own pick.
 * The same rules hold as for the catch-up: the account is Available, not marked
 * "Does not work", on the service's marketplace, with a place left, never one
 * the student already has, nor one buying from a student of the same job
 * profile; the service is approved and has no account.
 */
export async function assignAccountPlace(accountId: string, studentId: string, linkId: string, actor: any | null) {
  const s: any = await stmt(
    `SELECT s.id,s.name,s.lifecycle,s.job_profile,g.id group_id,g.coordinator FROM students s JOIN groups g ON g.id=s.group_id WHERE s.id=?`,
    studentId,
  ).first();
  if (!s || s.lifecycle !== "Active" || !s.coordinator) return { linked: false, reason: "student not eligible" } as const;
  const demo = String(s.group_id).startsWith("DEMO-");
  if (!demo && !buysServices(s.group_id)) return { linked: false, reason: "not a service group" } as const;
  const link: any = await stmt(
    `SELECT l.id,l.platform,l.slot FROM service_links l WHERE l.id=? AND l.student_id=? AND l.qc_status='Locked' AND l.account_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)`,
    linkId, studentId,
  ).first();
  if (!link) return { linked: false, reason: "service has an account or is not approved" } as const;
  const platform = marketplace[link.platform];
  if (!platform) return { linked: false, reason: "no account for this marketplace" } as const;
  if ((await all(studentAccountsSql, studentId, studentId)).length >= accountsPerStudent) return { linked: false, reason: "has three" } as const;
  const profile = String(s.job_profile || "").trim().toLowerCase();
  const sameProfile = profile
    ? `EXISTS (SELECT 1 FROM students x WHERE lower(trim(coalesce(x.job_profile,'')))=? AND (x.id=a.student_id OR x.id IN (SELECT l.student_id FROM service_links l WHERE l.account_id=a.id)))`
    : "0=1";
  const account: any = await stmt(
    `SELECT a.id,a.label FROM accounts a WHERE a.id=? AND a.platform=? AND a.status='Available' AND a.active_assignment IS NULL AND coalesce(a.coordinator_state,'')<>'Does not work'
       AND a.id ${demo ? "LIKE" : "NOT LIKE"} 'DEMO-%' AND ${accountUsesSql("a")}<? AND coalesce(a.student_id,'')<>? AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.account_id=a.id AND l.student_id=?)
       AND NOT ${sameProfile}`,
    accountId, platform, studentsPerAccount, studentId, studentId, ...(profile ? [profile] : []),
  ).first();
  if (!account) return { linked: false, reason: "account cannot take this student" } as const;
  return (await linkPlace(account, link, s, studentId, platform, actor)) ? ({ linked: true } as const) : ({ linked: false, reason: "taken meanwhile" } as const);
}

/**
 * The most accounts that may buy one service (17 November 2026, the owner's
 * decision: the same service can be bought by two or three different accounts,
 * each purchase being a gig of its own on the portal).
 */
export const accountsPerService = 3;

/**
 * Hands a service to the account that also buys it, when the account that was
 * recorded on it goes (17 November 2026). A repeat purchase is an account whose
 * first student and service are this one while the service's own account is
 * another; when that account is released the service would otherwise be left
 * with no account recorded and never be offered one again.
 */
export const promoteRepeatStmt = (studentId: string) =>
  stmt(
    `UPDATE service_links SET account_id=(SELECT r.id FROM accounts r WHERE r.service_link_id=service_links.id AND r.student_id=service_links.student_id AND r.status<>'Retired' ORDER BY r.linked_at,r.id LIMIT 1)
     WHERE student_id=? AND account_id IS NULL
       AND EXISTS (SELECT 1 FROM accounts r WHERE r.service_link_id=service_links.id AND r.student_id=service_links.student_id AND r.status<>'Retired')`,
    studentId,
  );

type RepeatStep = { studentId: string; studentName: string; coordinator: string; linkId: string; linkPlatform: string; slot: number; accountId: string; accountLabel: string; marketplace: string };

/**
 * Plans the repeat purchases (17 November 2026): for students short of three
 * accounts whose approved services all have an account already, the same
 * service is bought again by another account until they hold three, at most
 * three accounts on one service. Nothing is written. Closest to three gigs on
 * the portal first, then the fewest accounts needed; a student whose three
 * cannot all be found gets none, so no place is spent on a student who cannot
 * finish. A repeat takes the first-student slot of an account that has room
 * (empty, or with one student who is on it through their own service), so the
 * account's other student keeps their place and the second place stays free.
 */
export async function planRepeatPurchases() {
  const latest = "(SELECT batch_id FROM portal_uploads WHERE sheet='students' AND status='Active' ORDER BY committed_at DESC LIMIT 1)";
  const held = `(SELECT count(*) FROM (SELECT a.id FROM accounts a WHERE a.student_id=s.id AND a.status<>'Retired' UNION SELECT l.account_id FROM service_links l JOIN accounts a ON a.id=l.account_id WHERE l.student_id=s.id AND a.status<>'Retired') z)`;
  const students = (
    (await all(
      `SELECT s.id,s.name,s.group_id,lower(trim(coalesce(s.job_profile,''))) profile,g.coordinator,${held} held,
          coalesce(po.a,0) approved, coalesce(po.t,0)-coalesce(po.r,0) live,
          (SELECT min(coalesce(l.qc_at,l.updated_at)) FROM service_links l WHERE l.student_id=s.id AND l.qc_status='Locked') oldest
       FROM students s JOIN groups g ON g.id=s.group_id
       LEFT JOIN (SELECT student_id, max(coalesce(approved_gigs,0)) a, max(coalesce(total_gigs,0)) t, max(coalesce(rejected_gigs,0)) r FROM portal_students WHERE batch_id=${latest} AND student_id IS NOT NULL GROUP BY student_id) po ON po.student_id=s.id
       WHERE s.lifecycle='Active' AND s.group_id NOT LIKE 'DEMO-%' AND g.coordinator IS NOT NULL AND coalesce(g.delivery_model,'Regular')<>'Industry'
         AND EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id AND l.qc_status='Locked' AND l.platform IN ('Kafiil','Nafezly'))
         AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.student_id=s.id AND l.qc_status='Locked' AND l.platform IN ('Kafiil','Nafezly') AND l.account_id IS NULL
                           AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id))
         AND NOT EXISTS (SELECT 1 FROM portal_students p WHERE p.student_id=s.id AND p.batch_id=${latest} AND lower(trim(coalesce(p.final_status,'')))='graduated')
         AND ${held}<?`,
      accountsPerStudent,
    )) as any[]
  )
    .filter((s) => buysServices(String(s.group_id)))
    .map((s) => ({ ...s, held: Number(s.held), live: Math.max(0, Number(s.live)), approved: Number(s.approved) }))
    .sort((p, q) => q.live - p.live || q.approved - p.approved || q.held - p.held || String(p.oldest).localeCompare(String(q.oldest)) || String(p.id).localeCompare(String(q.id)));
  const pool = (await all(
    `SELECT a.id,a.label,a.platform,a.credits,${accountUsesSql("a")} uses,
        CASE WHEN a.student_id IS NULL OR EXISTS (SELECT 1 FROM service_links k WHERE k.account_id=a.id AND k.student_id=a.student_id) THEN 1 ELSE 0 END shaped
     FROM accounts a WHERE a.status='Available' AND a.active_assignment IS NULL AND a.id NOT LIKE 'DEMO-%' AND coalesce(a.coordinator_state,'')<>'Does not work'
       AND a.platform IN ('Kafeel','Nafezly') AND ${accountUsesSql("a")}<?`,
    studentsPerAccount,
  )) as any[];
  const occupants = new Map<string, string[]>();
  for (const o of (await all(
    `SELECT a.id account_id,lower(trim(coalesce(x.job_profile,''))) profile FROM accounts a JOIN students x ON x.id=a.student_id OR x.id IN (SELECT l.student_id FROM service_links l WHERE l.account_id=a.id)
     WHERE a.id NOT LIKE 'DEMO-%'`,
  )) as any[]) {
    if (!occupants.has(o.account_id)) occupants.set(o.account_id, []);
    occupants.get(o.account_id)!.push(String(o.profile || ""));
  }
  const taken = new Set<string>(); // accounts given a repeat in this plan: one each, it uses the first-student slot
  const steps: RepeatStep[] = [];
  const skipped: { studentId: string; reason: string }[] = [];
  for (const s of students) {
    const mine = new Set((await all(studentAccountsSql, s.id, s.id)).map((r: any) => String(r.account_id)));
    if (mine.size >= accountsPerStudent) continue;
    const links = (await all(
      `SELECT l.id,l.platform,l.slot,
          (SELECT count(*) FROM (SELECT account_id x FROM service_links WHERE id=l.id AND account_id IS NOT NULL UNION SELECT id FROM accounts r WHERE r.service_link_id=l.id AND r.status<>'Retired') z) buyers
       FROM service_links l WHERE l.student_id=? AND l.qc_status='Locked' AND l.platform IN ('Kafiil','Nafezly') ORDER BY l.qc_at,l.updated_at,l.slot`,
      s.id,
    )) as any[];
    const added = new Map<string, number>();
    const here = new Set<string>();
    const picks: RepeatStep[] = [];
    const fits = (platform: string) =>
      pool
        .filter(
          (a) =>
            a.platform === platform && Number(a.shaped) === 1 && !taken.has(a.id) && !here.has(a.id) && !mine.has(a.id) &&
            (!s.profile || !(occupants.get(a.id) || []).includes(s.profile)),
        )
        .sort((p, q) => Number(q.uses) - Number(p.uses) || Number(q.credits) - Number(p.credits) || String(p.id).localeCompare(String(q.id)));
    while (picks.length < accountsPerStudent - mine.size) {
      const options = links
        .map((l) => ({ l, buyers: Number(l.buyers) + (added.get(l.id) || 0), fit: fits(marketplace[l.platform]) }))
        .filter((o) => o.buyers < accountsPerService && o.fit.length)
        .sort((p, q) => p.buyers - q.buyers || q.fit.length - p.fit.length);
      const best = options[0];
      if (!best) break;
      const account = best.fit[0];
      picks.push({
        studentId: s.id, studentName: s.name, coordinator: s.coordinator, linkId: best.l.id, linkPlatform: best.l.platform, slot: Number(best.l.slot),
        accountId: account.id, accountLabel: account.label, marketplace: marketplace[best.l.platform],
      });
      added.set(best.l.id, (added.get(best.l.id) || 0) + 1);
      here.add(account.id);
    }
    if (picks.length < accountsPerStudent - mine.size) {
      skipped.push({ studentId: s.id, reason: picks.length ? "not enough places to reach three" : "no place that fits" });
      continue;
    }
    for (const p of picks) taken.add(p.accountId);
    steps.push(...picks);
  }
  return { steps, skipped, students: new Set(steps.map((p) => p.studentId)).size };
}

/**
 * One repeat purchase: the account joins the service as the account's first
 * student, whose coordinator it is written to; a student already on it through
 * their own service keeps their place and their coordinator moves to the
 * second. Guarded in one statement: the account still Available with a place,
 * still empty of a first student or holding one who is on it through a
 * service, the student still under three accounts, the service still under
 * three. Returns whether it was made; then the coordinator is told and it is
 * audited.
 */
async function linkRepeat(step: RepeatStep, actor: any | null) {
  const t = now();
  await db().batch([
    stmt(
      `UPDATE accounts SET student_id=?,service_link_id=?,linked_at=?,linked_by=?,
         coordinator_2_id=CASE WHEN coordinator_id IS NOT NULL AND coordinator_id<>? THEN coordinator_id WHEN coordinator_2_id=? THEN NULL ELSE coordinator_2_id END,
         coordinator_id=?
       WHERE id=? AND status='Available' AND active_assignment IS NULL AND coalesce(coordinator_state,'')<>'Does not work'
         AND (student_id IS NULL OR EXISTS (SELECT 1 FROM service_links k WHERE k.account_id=accounts.id AND k.student_id=accounts.student_id))
         AND (SELECT ${accountUsesSql("a")} FROM accounts a WHERE a.id=?)<?
         AND (SELECT count(*) FROM (${studentAccountsSql}) y)<?
         AND (SELECT count(*) FROM (SELECT account_id x FROM service_links WHERE id=? AND account_id IS NOT NULL UNION SELECT id FROM accounts r WHERE r.service_link_id=? AND r.status<>'Retired') z)<?
         AND coalesce(student_id,'')<>? AND NOT EXISTS (SELECT 1 FROM service_links k WHERE k.account_id=accounts.id AND k.student_id=?)`,
      step.studentId, step.linkId, t, null, step.coordinator, step.coordinator, step.coordinator,
      step.accountId, step.accountId, studentsPerAccount, step.studentId, step.studentId, accountsPerStudent, step.linkId, step.linkId, accountsPerService, step.studentId, step.studentId,
    ),
  ]);
  const linkedNow: any = await stmt("SELECT student_id,service_link_id FROM accounts WHERE id=?", step.accountId).first();
  if (linkedNow?.student_id !== step.studentId || linkedNow?.service_link_id !== step.linkId) return false;
  await db().batch([
    notify(
      step.coordinator,
      `Client account ${step.accountLabel} was added to ${step.studentName}'s ${step.linkPlatform} service ${step.slot}: buy the same service again with it`,
      "student", step.studentId, "Information", `account-repeat:${step.accountId}:${step.linkId}`,
    ),
    auditStmt(actor || { id: "system" }, "account_link", step.accountId, { student_id: step.studentId, service_link_id: step.linkId, coordinator_id: step.coordinator, platform: step.marketplace, repeat: true }, null),
  ]);
  return true;
}

/**
 * Buys the same service again with the accounts nobody else needs (17
 * November 2026): plans (planRepeatPurchases) and, unless `apply` is false,
 * does it. Only the people who keep the accounts run it, on purpose: it spends
 * places a student approved tomorrow might need.
 */
export async function repeatPurchases(actor: any | null, apply = true) {
  const plan = await planRepeatPurchases();
  let linked = 0;
  let refused = 0;
  if (apply) {
    for (const step of plan.steps) {
      if (await linkRepeat(step, actor)) linked++;
      else refused++;
    }
  }
  return {
    planned: plan.steps.length,
    students: plan.students,
    linked,
    refused,
    skipped: plan.skipped.length,
    on: { Kafeel: plan.steps.filter((p) => p.marketplace === "Kafeel").length, Nafezly: plan.steps.filter((p) => p.marketplace === "Nafezly").length },
  };
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
  // The accounts are there to get a student to three gigs and graduation: one
  // who has graduated on the portal (the latest students sheet) gets none
  // (13 November 2026).
  const graduated: any = await stmt(
    `SELECT 1 x FROM portal_students p WHERE p.student_id=? AND lower(trim(coalesce(p.final_status,'')))='graduated'
       AND p.batch_id=(SELECT batch_id FROM portal_uploads WHERE sheet='students' AND status='Active' ORDER BY committed_at DESC LIMIT 1)`,
    studentId,
  ).first();
  if (graduated) return { linked: 0, reason: "graduated" } as const;
  const accountsOf = async () => new Set((await all(studentAccountsSql, studentId, studentId)).map((r: any) => String(r.account_id)));
  // The marketplaces of the accounts the student holds, for the two-and-one rule.
  const platformsOf = async (ids: Set<string>) =>
    ids.size ? (await all(`SELECT platform FROM accounts WHERE id IN (${[...ids].map(() => "?").join(",")})`, ...ids)).map((r: any) => String(r.platform)) : [];
  const waitingSql = `SELECT l.id,l.platform,l.slot FROM service_links l
     WHERE l.student_id=? AND l.qc_status='Locked' AND l.account_id IS NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.service_link_id=l.id)
     ORDER BY l.qc_at,l.updated_at,l.slot`;
  // An account linked to the student by hand before they had a service takes
  // their first approved one on its marketplace (17 November 2026); it is
  // already one of the student's accounts, so it counts apart from the three.
  let bound = 0;
  for (const link of await all(waitingSql, studentId)) {
    const platform = marketplace[link.platform];
    if (!platform) continue;
    const bare: any = await stmt(
      `SELECT a.id,a.label FROM accounts a WHERE a.student_id=? AND a.service_link_id IS NULL AND a.platform=? AND a.status='Available' AND a.active_assignment IS NULL
         AND coalesce(a.coordinator_state,'')<>'Does not work' AND a.id ${demo ? "LIKE" : "NOT LIKE"} 'DEMO-%' ORDER BY a.linked_at,a.id LIMIT 1`,
      studentId, platform,
    ).first();
    if (bare && (await bindBareAccount(bare, link, s, studentId, platform, actor))) bound++;
  }
  let mine = await accountsOf();
  let heldPlatforms = await platformsOf(mine);
  if (mine.size >= accountsPerStudent) return { linked: bound, reason: bound ? "done" : "has three" } as const;
  const waiting = await all(waitingSql, studentId);
  const profile = String(s.job_profile || "").trim().toLowerCase();
  // Demo students try things out on demo accounts only; real students never get one (22 Oct).
  const side = String(s.group_id).startsWith("DEMO-") ? "id LIKE 'DEMO-%'" : "id NOT LIKE 'DEMO-%'";
  let linked = 0;
  const missing: string[] = [];
  const sameMarketplace: { platform: string; linkId: string }[] = [];
  for (const link of waiting) {
    if (mine.size >= accountsPerStudent) break;
    const platform = marketplace[link.platform];
    if (!platform) continue;
    // Two accounts on this marketplace already: a third here would make three
    // on one, which waits for the other marketplace while it has a free place.
    if (accountMixProblem(heldPlatforms, platform) === "same" && (await hasFreePlace(otherMarketplace(platform), demo))) {
      sameMarketplace.push({ platform, linkId: String(link.id) });
      continue;
    }
    // A free account first, then one with a student left to share; never one
    // this student already has, nor one buying from a student of the same job profile.
    const sameProfile = profile
      ? `EXISTS (SELECT 1 FROM students x WHERE lower(trim(coalesce(x.job_profile,'')))=? AND (x.id=a.student_id OR x.id IN (SELECT l.student_id FROM service_links l WHERE l.account_id=a.id)))`
      : "0=1";
    const account: any = await stmt(
      `SELECT a.id,a.label,a.student_id FROM accounts a WHERE a.platform=? AND a.status='Available' AND a.active_assignment IS NULL AND coalesce(a.coordinator_state,'')<>'Does not work' AND a.${side}
         AND ${accountUsesSql("a")}<? AND coalesce(a.student_id,'')<>? AND NOT EXISTS (SELECT 1 FROM service_links l WHERE l.account_id=a.id AND l.student_id=?)
         AND NOT ${sameProfile}
       ORDER BY CASE WHEN a.student_id IS NULL THEN 0 ELSE 1 END,a.credits DESC,a.id LIMIT 1`,
      platform, studentsPerAccount, studentId, studentId, ...(profile ? [profile] : []),
    ).first();
    if (!account) {
      missing.push(platform);
      continue;
    }
    if (!(await linkPlace(account, link, s, studentId, platform, actor))) continue;
    linked++;
    mine = await accountsOf();
    heldPlatforms = await platformsOf(mine);
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
    linked: linked + bound,
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
