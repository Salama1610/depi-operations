import { actor, all, auditStmt, db, now, permit, rateLimit, refuseDemo, revokesStudents, stmt, uid } from "@/lib/server";
import { sameSide } from "@/lib/demo";
import { can, ensure } from "@/lib/domain/rules";
import { fingerprint, samePicture, type ProofPrint } from "@/lib/domain/proof-image";
import { proofKey, waitsForCoach } from "@/lib/domain/portal-review";

export const dynamic = "force-dynamic";

// Our quality team's check of the gigs students upload to the ministry portal.
//
// On the portal a gig is approved by the student's coach, then the ministry's
// quality reviewers, then a third-party company. Before the coach decides, one
// of our Quality Members checks it (by their own SOP) and approves or rejects
// it with a comment. The coach and the student's coordinator read the verdict
// in their own views (/api/coach-progress, /api/portal); the coach acts on the
// portal.
//
// The assignment is per student, not per gig. Each portal student (the
// sheet's Student ID, a GUID) has one Quality Member, who gets every gig of
// theirs that waits for the coach (provider status Pending or blank), in this
// sheet and in the ones uploaded later; a new student goes to whoever has the
// fewest students waiting. Each review is found again in a new upload by its
// proof link (lib/domain/portal-review), so the proof comes back to the same
// member with its verdict. A member sees their students; the Quality Lead and
// the administrators see them all and can move a student to someone else or
// share the students out again.
const lead = ["Quality Lead", "Operations Systems / Admin"];
const team = ["Quality Member", ...lead];
const noStore = { headers: { "Cache-Control": "no-store" } };
const verdicts = ["Pending", "Approved", "Rejected"];

type Member = { id: string; name: string; pending: number };
type Review = { portal_gig_id: string; proof_key: string; portal_student_id: string; reviewer: string; status: string };

/** The active Quality Members (not the lead, who hands the work out), with how many of their students wait for a verdict. */
async function members(u: any): Promise<Member[]> {
  const people = await all(
    `SELECT u.id,u.name,u.roles,(SELECT count(DISTINCT r.portal_student_id) FROM portal_gig_reviews r WHERE r.reviewer=u.id AND r.status='Pending') pending
     FROM users u WHERE u.active=1 AND ${sameSide(u, "u.id")} ORDER BY u.id`,
  );
  return people
    .map((p: any) => ({ ...p, roles: typeof p.roles === "string" ? JSON.parse(p.roles || "[]") : p.roles || [] }))
    .filter((p: any) => p.roles.includes("Quality Member") && !p.roles.includes("Quality Lead"))
    .map((p: any) => ({ id: p.id as string, name: p.name as string, pending: Number(p.pending) }));
}

/** One of the members with the fewest students waiting, at random, charged with one more. */
function draw(pool: Member[]) {
  const least = Math.min(...pool.map((p) => p.pending));
  const tied = pool.filter((p) => p.pending === least);
  const chosen = tied[Math.floor(Math.random() * tied.length)];
  chosen.pending += 1;
  return chosen.id;
}

// Proof screenshots are fetched only from the portal's own server, so a link
// in an uploaded sheet cannot point the app at anything else.
const proofHosts = /(^|\.)eyouthlearning\.com$/i;
// Each request stays well under the hosting time limit; the page calls again.
const proofBudgetMs = 7000;

/** Fetches and fingerprints one proof screenshot; the error is kept when it cannot. */
async function printProof(link: string, timeoutMs: number) {
  try {
    const at = new URL(link);
    if (!/^https?:$/.test(at.protocol) || !proofHosts.test(at.hostname)) return { error: "Not a portal proof link" };
    const res = await fetch(at, { headers: { "User-Agent": "Mozilla/5.0 (DEPI quality check)" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { error: "HTTP " + res.status };
    // A screenshot, or a PDF of screenshots.
    if (!/^(image\/|application\/pdf)/i.test(res.headers.get("content-type") || "")) return { error: "Not an image or a PDF" };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 30 * 1024 * 1024) return { error: "File too large" };
    return await fingerprint(bytes);
  } catch (e: any) {
    return { error: String(e?.name === "TimeoutError" ? "Timed out" : e?.message || e).slice(0, 120) };
  }
}

async function activeGigsBatch() {
  return (await stmt("SELECT batch_id FROM portal_uploads WHERE sheet='gigs' AND status='Active' ORDER BY committed_at DESC LIMIT 1").first()) as any;
}
async function activeStudentsBatch() {
  return (await stmt("SELECT batch_id FROM portal_uploads WHERE sheet='students' AND status='Active' ORDER BY committed_at DESC LIMIT 1").first()) as any;
}

/** Runs the statements a few hundred at a time, so a big sheet never makes one oversized request. */
async function inBatches(statements: any[]) {
  for (let i = 0; i < statements.length; i += 200) await db().batch(statements.slice(i, i + 200));
}

/**
 * Brings the queue in line with the latest gigs sheet: a review follows its
 * proof to the row that carries it now, a gig whose proof was replaced is
 * checked again, gigs new to the queue go to their student's member, and a
 * student whose gigs sit with two members is put back with one.
 */
async function syncQueue(u: any, pool: Member[], gigsBatch: string, studentsBatch: string) {
  const sheet = await all(
    `SELECT z.portal_gig_id,z.portal_student_id,z.student_name,z.title,z.url,z.proof_url,z.provider_status,p.student_id,s.name linked_name,s.lifecycle
     FROM portal_gigs z
     LEFT JOIN portal_students p ON p.batch_id=? AND p.portal_id=z.portal_student_id
     LEFT JOIN students s ON s.id=p.student_id
     WHERE z.batch_id=? AND coalesce(trim(z.portal_gig_id),'')<>'' AND coalesce(trim(z.portal_student_id),'')<>''
     ORDER BY z.portal_student_id,z.created_on`,
    studentsBatch,
    gigsBatch,
  );
  const reviews = (await all(
    "SELECT portal_gig_id,proof_key,portal_student_id,reviewer,status FROM portal_gig_reviews ORDER BY assigned_at,portal_gig_id",
  )) as Review[];
  const writes: any[] = [];
  // A review saved without its key (before the key existed) takes it from its own row.
  for (const r of reviews.filter((r) => !r.proof_key)) {
    const g = sheet.find((g: any) => String(g.portal_gig_id).trim() === r.portal_gig_id);
    const key = g ? proofKey(g) : "";
    r.proof_key = key && !reviews.some((o) => o.proof_key === key) ? key : "gig:" + r.portal_gig_id;
    writes.push(stmt("UPDATE portal_gig_reviews SET proof_key=? WHERE portal_gig_id=? AND proof_key IS NULL", r.proof_key, r.portal_gig_id));
  }
  const byKey = new Map(reviews.map((r) => [r.proof_key, r]));
  const byGig = new Map(reviews.map((r) => [r.portal_gig_id, r]));
  // One row per proof. Where a student put one proof on several gigs: the row
  // its review is on already, else the one still waiting for the coach, else
  // the earliest.
  const sameProof = new Map<string, any[]>();
  for (const g of sheet) sameProof.set(proofKey(g), [...(sameProof.get(proofKey(g)) || []), g]);
  const first = (a: any, b: any) =>
    Number(!waitsForCoach(a)) - Number(!waitsForCoach(b)) ||
    String(a.created_on || "").localeCompare(String(b.created_on || "")) ||
    String(a.portal_gig_id).localeCompare(String(b.portal_gig_id), "en", { numeric: true });
  const rows = new Map<string, any>();
  for (const [key, list] of sameProof) {
    const current = list.find((g) => String(g.portal_gig_id).trim() === byKey.get(key)?.portal_gig_id);
    rows.set(key, current || [...list].sort(first)[0]);
  }
  // Each student's member: the one holding their gigs still waiting, else the latest given.
  const holder = new Map<string, string>();
  for (const r of reviews) holder.set(r.portal_student_id, r.reviewer);
  for (const r of reviews) if (r.status === "Pending") holder.set(r.portal_student_id, r.reviewer);
  const waiting = new Set(reviews.filter((r) => r.status === "Pending").map((r) => r.portal_student_id));
  const inPool = (id?: string) => Boolean(id) && pool.some((p) => p.id === id);
  const t = now();
  let followed = 0;

  // The same proof under another gig ID in this sheet: the review, its member and verdict follow it.
  for (const [key, g] of rows) {
    const r = byKey.get(key);
    const id = String(g.portal_gig_id).trim();
    if (!r || r.portal_gig_id === id || byGig.has(id)) continue;
    writes.push(stmt("UPDATE portal_gig_reviews SET portal_gig_id=?,title=?,url=? WHERE proof_key=?", id, g.title || null, g.url || null, key));
    byGig.delete(r.portal_gig_id);
    r.portal_gig_id = id;
    byGig.set(id, r);
    followed++;
  }

  const fresh: any[] = [];
  for (const [key, g] of rows) {
    if (byKey.has(key) || !waitsForCoach(g) || g.lifecycle === "Revoked") continue;
    const id = String(g.portal_gig_id).trim();
    const old = byGig.get(id);
    if (!old) {
      fresh.push({ ...g, id, key });
      continue;
    }
    // The gig carries a new proof: a new thing to check, by the student's member.
    if (rows.has(old.proof_key)) continue;
    writes.push(
      stmt(
        "UPDATE portal_gig_reviews SET proof_key=?,title=?,url=?,status='Pending',comment=NULL,reviewed_by=NULL,reviewed_at=NULL,assigned_at=? WHERE portal_gig_id=?",
        key, g.title || null, g.url || null, t, id,
      ),
      auditStmt(u, "Portal gig proof replaced: checked again", id, { proof_key: key, was: old.proof_key, status: old.status }, null),
    );
    byKey.delete(old.proof_key);
    old.proof_key = key;
    old.status = "Pending";
    byKey.set(key, old);
    waiting.add(old.portal_student_id);
  }

  // New gigs go to their student's member; a new student to whoever has the fewest waiting.
  if (fresh.length && pool.length) {
    for (const g of fresh) {
      const student = String(g.portal_student_id);
      let reviewer = holder.get(student);
      if (!reviewer || !inPool(reviewer)) reviewer = draw(pool);
      else if (!waiting.has(student)) pool.find((p) => p.id === reviewer)!.pending++;
      holder.set(student, reviewer);
      waiting.add(student);
      writes.push(
        stmt(
          `INSERT INTO portal_gig_reviews(portal_gig_id,proof_key,portal_student_id,student_id,student_name,title,url,reviewer,assigned_by,assigned_at,status)
           VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
          g.id, g.key, student, g.student_id || null, g.linked_name || g.student_name || null,
          g.title || null, g.url || null, reviewer, null, t, "Pending",
        ),
      );
      reviews.push({ portal_gig_id: g.id, proof_key: g.key, portal_student_id: student, reviewer, status: "Pending" });
    }
  }

  // One student, one member: a student whose member left gets a new one (while
  // they have gigs waiting), and every gig of a student sits with that member.
  let regrouped = 0;
  for (const [student, reviewer] of holder) {
    const target = !inPool(reviewer) && waiting.has(student) && pool.length ? draw(pool) : reviewer;
    if (reviews.some((r) => r.portal_student_id === student && r.reviewer !== target)) {
      writes.push(stmt("UPDATE portal_gig_reviews SET reviewer=?,assigned_at=? WHERE portal_student_id=? AND reviewer<>?", target, t, student, target));
      regrouped++;
    }
  }

  if (fresh.length && pool.length) writes.push(auditStmt(u, "Portal gig reviews assigned", "portal-gig-reviews", { gigs: fresh.length, automatic: true }));
  if (followed || regrouped)
    writes.push(auditStmt(u, "Portal gig reviews kept with their proof and student", "portal-gig-reviews", { followed, students_regrouped: regrouped }));
  if (writes.length) await inBatches(writes);
}

export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, team);
    await rateLimit("portal-qc:" + u.id, 60, 60);
    const leads = can(u.roles, lead);
    const [gigsBatch, studentsBatch] = await Promise.all([activeGigsBatch(), activeStudentsBatch()]);
    const pool = await members(u);

    // The queue follows the latest sheet: new gigs waiting for the coach are handed out now.
    if (gigsBatch) await syncQueue(u, pool, gigsBatch.batch_id, studentsBatch?.batch_id || "");
    const loads = gigsBatch ? await members(u) : pool;

    const mine = leads ? "" : " AND r.reviewer=?";
    const hidden = revokesStudents(u) ? "" : " AND COALESCE(s.lifecycle,'')<>'Revoked'";
    const reviews = await all(
      `SELECT r.*,p.name reviewer_name,d.name reviewed_by_name,s.group_id,g.track,g.provider,
              z.status portal_status,z.provider_status,z.auditor_status,z.price,z.created_on,z.category,z.proof_url,z.comment portal_comment,
              CASE WHEN z.portal_gig_id IS NULL THEN 0 ELSE 1 END in_sheet
       FROM portal_gig_reviews r
       LEFT JOIN users p ON p.id=r.reviewer LEFT JOIN users d ON d.id=r.reviewed_by
       LEFT JOIN students s ON s.id=r.student_id LEFT JOIN groups g ON g.id=s.group_id
       LEFT JOIN portal_gigs z ON z.batch_id=? AND z.portal_gig_id=r.portal_gig_id
       WHERE 1=1${mine}${hidden} ORDER BY r.status='Pending' DESC, r.portal_student_id, r.assigned_at`,
      gigsBatch?.batch_id || "",
      ...(leads ? [] : [u.id]),
    );
    // What else in the sheet repeats this gig: the same proof on another row,
    // or the same link entered again on the same day. Shown on the card, so
    // the reviewer checks the proof against them before deciding.
    if (gigsBatch && reviews.length) {
      const sheet = await all(
        "SELECT portal_gig_id,lower(trim(url)) link,lower(trim(proof_url)) proof,substr(CAST(created_on AS TEXT),1,10) AS gig_day FROM portal_gigs WHERE batch_id=?",
        gigsBatch.batch_id,
      );
      // The same picture under another link, from the fingerprints already taken.
      const prints = await all(
        `SELECT z.portal_gig_id,z.portal_student_id student,trim(z.proof_url) proof_url,i.sha256,i.dhash FROM portal_gigs z
         JOIN proof_images i ON i.proof_url=trim(z.proof_url)
         WHERE z.batch_id=? AND (i.sha256 IS NOT NULL OR i.dhash IS NOT NULL)`,
        gigsBatch.batch_id,
      );
      for (const p of prints as any[]) p.student = String(p.student || "");
      const printOf = new Map<string, any>(prints.map((p: any) => [p.portal_gig_id, p]));
      const byProof = new Map<string, string[]>();
      const byLinkDay = new Map<string, string[]>();
      for (const g of sheet) {
        if (g.proof) byProof.set(g.proof, [...(byProof.get(g.proof) || []), g.portal_gig_id]);
        if (g.link && g.gig_day) byLinkDay.set(g.link + " " + g.gig_day, [...(byLinkDay.get(g.link + " " + g.gig_day) || []), g.portal_gig_id]);
      }
      const others = (list: string[] | undefined, id: string) => (list || []).filter((x) => x !== id);
      for (const r of reviews as any[]) {
        const z = sheet.find((g: any) => g.portal_gig_id === r.portal_gig_id);
        r.same_proof = z?.proof ? others(byProof.get(z.proof), r.portal_gig_id) : [];
        r.same_link_day = z?.link && z.gig_day ? others(byLinkDay.get(z.link + " " + z.gig_day), r.portal_gig_id) : [];
        const mine = printOf.get(r.portal_gig_id);
        r.proof_checked = Boolean(mine);
        r.same_picture = mine
          ? samePicture(mine as ProofPrint, prints as ProofPrint[])
              .map((p: any) => p.portal_gig_id)
              .filter((id: string) => id !== r.portal_gig_id && !r.same_proof.includes(id))
          : [];
      }
    }
    return Response.json(
      {
        reviews,
        reviewers: leads ? loads.map(({ id, name, pending }) => ({ id, name, pending })) : [],
        lead: leads,
        me: u.id,
        sheet: Boolean(gigsBatch),
        proofs: gigsBatch
          ? await stmt(
              `SELECT count(DISTINCT trim(z.proof_url)) total,
                      count(DISTINCT CASE WHEN i.proof_url IS NOT NULL THEN trim(z.proof_url) END) checked
               FROM portal_gigs z LEFT JOIN proof_images i ON i.proof_url=trim(z.proof_url)
               WHERE z.batch_id=? AND coalesce(trim(z.proof_url),'')<>''`,
              gigsBatch.batch_id,
            ).first()
          : null,
        team: pool.length,
      },
      noStore,
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, team);
    await rateLimit("portal-qc-write:" + u.id, 120, 60);
    ensure(
      !req.headers.get("origin") || req.headers.get("origin") === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const leads = can(u.roles, lead);
    const t = now();
    const requestId = String(x.request_id || uid("REQ"));
    const review = async (id: string) => {
      const row: any = await stmt("SELECT * FROM portal_gig_reviews WHERE portal_gig_id=?", id).first();
      ensure(row, "This gig is not in the quality queue.");
      return row;
    };

    if (x.action === "check_proofs") {
      // A few proof screenshots fingerprinted per call, the ones still waiting
      // for a verdict first; the page calls again until none is left.
      const sheet: any = await activeGigsBatch();
      if (!sheet) return Response.json({ ok: true, checked: 0, remaining: 0 });
      const due = await all(
        `SELECT DISTINCT trim(z.proof_url) proof_url, CASE WHEN r.status='Pending' THEN 0 ELSE 1 END waiting
         FROM portal_gigs z LEFT JOIN portal_gig_reviews r ON r.portal_gig_id=z.portal_gig_id
         LEFT JOIN proof_images i ON i.proof_url=trim(z.proof_url)
         WHERE z.batch_id=? AND coalesce(trim(z.proof_url),'')<>''
           AND (i.proof_url IS NULL OR (i.sha256 IS NULL AND i.checked_at < ?))
         ORDER BY 2 LIMIT 12`,
        sheet.batch_id,
        // A proof that could not be fetched is tried again an hour later.
        new Date(Date.now() - 3600000).toISOString(),
      );
      const started = Date.now();
      const results: any[] = [];
      for (let i = 0; i < due.length; i += 4) {
        const left = proofBudgetMs - (Date.now() - started);
        if (left < 1500) break;
        const chunk = due.slice(i, i + 4);
        const prints = await Promise.all(chunk.map((d: any) => printProof(d.proof_url, left)));
        chunk.forEach((d: any, k: number) => results.push({ url: d.proof_url, ...prints[k] }));
      }
      if (results.length)
        await db().batch(
          results.map((p) =>
            stmt(
              `INSERT INTO proof_images(proof_url,sha256,dhash,bytes,error,checked_at) VALUES(?,?,?,?,?,?)
               ON CONFLICT(proof_url) DO UPDATE SET sha256=excluded.sha256,dhash=excluded.dhash,bytes=excluded.bytes,error=excluded.error,checked_at=excluded.checked_at`,
              p.url, p.sha256 || null, p.dhash || null, p.bytes || null, p.error || null, t,
            ),
          ),
        );
      const left: any = await stmt(
        `SELECT count(DISTINCT trim(z.proof_url)) n FROM portal_gigs z LEFT JOIN proof_images i ON i.proof_url=trim(z.proof_url)
         WHERE z.batch_id=? AND coalesce(trim(z.proof_url),'')<>'' AND i.proof_url IS NULL`,
        sheet.batch_id,
      ).first();
      return Response.json({ ok: true, checked: results.length, failed: results.filter((p) => p.error).length, remaining: Number(left?.n || 0) });
    }

    if (x.action === "decide") {
      // Approve or reject (with the reason), or put it back to pending.
      const row = await review(String(x.portal_gig_id || ""));
      ensure(leads || row.reviewer === u.id, "Only the reviewer it was given to, or the Quality Lead, can decide on it.");
      const status = String(x.status || "");
      ensure(verdicts.includes(status), "Choose Approved, Rejected or Pending.");
      const comment = String(x.comment || "").trim();
      ensure(comment.length <= 2000, "Keep the comment under 2,000 characters.");
      ensure(status !== "Rejected" || comment.length >= 3, "Write why the gig is rejected, so the coach can tell the student.");
      const done = status !== "Pending";
      // A decision is taken on the proof: the reviewer opens it first.
      const hasProof = Boolean(row.proof_key) && !String(row.proof_key).startsWith("gig:");
      if (done && hasProof) ensure(x.proof_checked === true, "Open the proof before you approve or reject the gig.");
      await db().batch([
        stmt(
          "UPDATE portal_gig_reviews SET status=?,comment=?,reviewed_by=?,reviewed_at=? WHERE portal_gig_id=?",
          status, comment || null, done ? u.id : null, done ? t : null, row.portal_gig_id,
        ),
        auditStmt(u, done ? `Portal gig ${status.toLowerCase()} by quality` : "Portal gig review reopened", row.portal_gig_id, { status, comment: comment || null, proof_checked: x.proof_checked === true }, row, requestId),
      ]);
      return Response.json({ ok: true });
    }

    ensure(leads, "Only the Quality Lead hands out portal gig reviews.");
    const pool = await members(u);
    if (x.action === "reassign") {
      // The student moves as a whole: every gig of theirs, decided or not, and the ones still to come.
      const student = x.portal_student_id ? String(x.portal_student_id) : (await review(String(x.portal_gig_id || ""))).portal_student_id;
      ensure(pool.some((p) => p.id === x.reviewer), "Choose an active Quality Member.");
      const theirs = await all("SELECT portal_gig_id,reviewer FROM portal_gig_reviews WHERE portal_student_id=?", student);
      ensure(theirs.length, "This student is not in the quality queue.");
      await db().batch([
        stmt("UPDATE portal_gig_reviews SET reviewer=?,assigned_by=?,assigned_at=? WHERE portal_student_id=?", x.reviewer, u.id, t, student),
        auditStmt(u, "Portal gig reviews reassigned", student, { reviewer: x.reviewer, gigs: theirs.length }, { reviewers: [...new Set(theirs.map((r: any) => r.reviewer))] }, requestId),
      ]);
      return Response.json({ ok: true, moved: theirs.length });
    }

    if (x.action === "redistribute") {
      // The students waiting for a verdict shared out again evenly, each with all their gigs.
      ensure(pool.length, "There is no active Quality Member to give reviews to.");
      const students = (await all("SELECT DISTINCT portal_student_id FROM portal_gig_reviews WHERE status='Pending'")).map((r: any) => String(r.portal_student_id));
      for (const p of pool) p.pending = 0;
      for (let i = students.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [students[i], students[j]] = [students[j], students[i]];
      }
      await inBatches([
        ...students.map((student) =>
          stmt("UPDATE portal_gig_reviews SET reviewer=?,assigned_by=?,assigned_at=? WHERE portal_student_id=?", draw(pool), u.id, t, student),
        ),
        auditStmt(u, "Portal gig reviews shared out", "portal-gig-reviews", { students: students.length, reviewers: pool.length }, null, requestId),
      ]);
      return Response.json({ ok: true, moved: students.length });
    }

    throw new Error("Choose a portal gig review action.");
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
