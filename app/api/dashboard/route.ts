import { actor, all, permit, rateLimit, refuseDemo } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * The administrator's dashboard: every tracker and what everyone did, as lean
 * rows the page filters and adds up itself. Read-only; no national IDs, phone
 * numbers, passwords or the before/after values of the audit history, only who
 * did what and when. Demo records and the Depi Industry groups are left out.
 */
export async function GET() {
  try {
    const u = await actor();
    refuseDemo(u);
    permit(u, ["Operations Systems / Admin"]);
    await rateLimit("dashboard:" + u.id, 30, 60);
    const real = (column: string) => `${column} NOT LIKE 'DEMO-%'`;
    const shownGroup = `COALESCE(g.delivery_model,'Regular')<>'Industry' AND ${real("g.id")}`;
    const viaStudent = (alias: string) => `JOIN students s ON s.id=${alias}.student_id JOIN groups g ON g.id=s.group_id WHERE ${shownGroup}`;
    const viaSession = (alias: string) => `JOIN sessions se ON se.id=${alias}.session_id JOIN groups g ON g.id=se.group_id WHERE ${shownGroup}`;
    const [
      staff,
      groups,
      students,
      sessions,
      attendance,
      contacts,
      tasks,
      cases,
      links,
      reviews,
      gigs,
      evidence,
      feedback,
      flags,
      checks,
      accounts,
      ledger,
      requests,
      audit,
      support,
    ] = await Promise.all([
      all(`SELECT id,name,roles,team,title,active FROM users WHERE ${real("id")} AND id NOT LIKE 'system-%'`),
      all(`SELECT g.id,g.track,g.provider,g.pathway,g.coordinator,g.supervisor,g.coach,g.status,g.start_date FROM groups g WHERE ${shownGroup}`),
      all(`SELECT s.id,s.name,s.group_id,s.lifecycle,s.engagement,s.milestone,s.last_contact,s.created_at FROM students s JOIN groups g ON g.id=s.group_id WHERE ${shownGroup}`),
      all(`SELECT se.id,se.group_id,se.coach_id,se.coordinator_id,se.starts_at,se.status,se.week,se.coordinator_confirmed_at,se.coach_confirmed_at,
              CASE WHEN se.coordinator_unavailable IS NULL THEN 0 ELSE 1 END coordinator_away,
              CASE WHEN se.coach_unavailable IS NULL THEN 0 ELSE 1 END coach_away
         FROM sessions se JOIN groups g ON g.id=se.group_id WHERE ${shownGroup}`),
      all(`SELECT a.session_id,a.student_id,a.status,a.recorder,a.updated_at FROM attendance a ${viaSession("a")}`),
      all(`SELECT c.student_id,c.channel,c.outcome,c.occurred_at,c.recorder,c.owner,c.created_at FROM contacts c ${viaStudent("c")}`),
      all(`SELECT t.student_id,t.owner,t.due,t.status,t.category,t.priority,t.created_at FROM tasks t ${viaStudent("t")}`),
      all(`SELECT c.id,c.student_id,COALESCE(c.group_id,s.group_id) group_id,c.type,c.severity,c.status,c.owner,c.due,c.created_at
             FROM cases c LEFT JOIN students s ON s.id=c.student_id LEFT JOIN groups g ON g.id=COALESCE(c.group_id,s.group_id)
            WHERE g.id IS NULL OR (${shownGroup})`),
      all(`SELECT l.id,l.student_id,l.platform,l.qc_status,l.auto_status,l.qc_actor,l.qc_at,l.submitted_at,l.updated_at,l.revision FROM service_links l ${viaStudent("l")}`),
      all(`SELECT r.service_link_id,r.decision,r.reviewed_by,r.reviewed_at,l.student_id FROM service_link_reviews r JOIN service_links l ON l.id=r.service_link_id ${viaStudent("l")}`),
      all(`SELECT z.id,z.student_id,z.platform,z.status,z.value,z.currency,z.created_at,z.paid_on FROM gigs z ${viaStudent("z")}`),
      all(`SELECT e.student_id,e.status,e.recorder,e.qc_actor,e.stage_at,e.created_at FROM evidence e ${viaStudent("e")}`),
      all(`SELECT f.session_id,f.satisfaction,f.clarity,f.usefulness,f.created_at FROM session_feedback f ${viaSession("f")}`),
      all(`SELECT x.session_id,x.score,x.handled_by,x.handled_at FROM feedback_flags x ${viaSession("x")}`).catch(() => []),
      all(`SELECT k.session_id,k.item,k.done_by,k.done_at FROM session_checks k ${viaSession("k")}`),
      all(`SELECT id,platform,status,credits,pending_credits,coordinator_id FROM accounts WHERE ${real("id")}`),
      all(`SELECT account_id,delta,reason,actor,created_at FROM account_credit_ledger WHERE ${real("account_id")}`),
      all(`SELECT r.student_id,r.platform,r.value,r.status,r.recorder,r.created_at FROM account_requests r ${viaStudent("r")}`),
      all(`SELECT actor,action,entity_id,created_at FROM audit_events WHERE ${real("actor")} ORDER BY created_at DESC LIMIT 20000`),
      all("SELECT reporter,category,severity,status,created_at FROM support_reports").catch(() => []),
    ]);
    const parse = (v: any) => {
      try {
        return Array.isArray(v) ? v : JSON.parse(v || "[]");
      } catch {
        return [];
      }
    };
    return Response.json(
      {
        generated_at: new Date().toISOString(),
        staff: staff.map((p: any) => ({ ...p, roles: parse(p.roles) })),
        groups,
        students,
        sessions,
        attendance,
        contacts,
        tasks,
        cases,
        links,
        reviews,
        gigs,
        evidence,
        feedback,
        flags,
        checks,
        accounts,
        ledger,
        requests,
        audit,
        support,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 403 });
  }
}
