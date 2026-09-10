import {
  actor,
  all,
  auditStmt,
  db,
  now,
  permit,
  rateLimit,
  scopeSql,
  stmt,
  student,
  uid,
} from "@/lib/server";
import { can, ensure } from "@/lib/domain/rules";
import { toCSV } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

const operations = ["Project Operations", "Operations Coordinator"];
const programLeads = ["Project Operations", "Team Supervisor"];
const reportFields: Record<string, string> = {
  student_id: "student_id",
  name: "name",
  email: "email",
  phone: "phone",
  track: "track",
  group: "group_name",
  lifecycle: "lifecycle",
  engagement: "engagement",
  coaching: "coaching",
  milestone: "milestone",
  graduation: "graduation",
  certificate_status: "certificate_status",
  final_assessment: "final_assessment",
  post_program_outcome: "post_program_outcome",
};

function requireWritableLearner(learner: any) {
  ensure(learner.group_status !== "Archived", "Archived groups are read-only.");
  return learner;
}

async function programData(u: any) {
  const q = scopeSql(u);
  const groups = await all(
    `SELECT g.*,c.name coordinator_name,s.name supervisor_name FROM groups g
     JOIN users c ON c.id=g.coordinator JOIN users s ON s.id=g.supervisor
     WHERE ${q.sql} ORDER BY g.start_date DESC,g.id`,
    ...q.args,
  );
  const students = await all(
    `SELECT s.*,g.name group_name,g.track,g.status group_status,g.coordinator,g.supervisor,
      (SELECT l.result FROM graduation_ledger l WHERE l.student_id=s.id ORDER BY l.calculated_at DESC LIMIT 1) graduation,
      (SELECT c.status FROM certificates c WHERE c.student_id=s.id ORDER BY c.issued_at DESC LIMIT 1) certificate_status,
      (SELECT ar.outcome FROM assessment_results ar JOIN assessments a ON a.id=ar.assessment_id WHERE ar.student_id=s.id AND a.type='Final' ORDER BY ar.assessed_at DESC LIMIT 1) final_assessment,
      (SELECT o.type||': '||o.status FROM post_program_outcomes o WHERE o.student_id=s.id ORDER BY o.created_at DESC LIMIT 1) post_program_outcome
     FROM students s JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY s.created_at DESC`,
    ...q.args,
  );
  const applications = can(u.roles, [
    ...operations,
    "Team Supervisor",
    "Operations Systems / Admin",
  ])
    ? await all(
        "SELECT * FROM applications ORDER BY updated_at DESC LIMIT 1000",
      )
    : [];
  const screenings = applications.length
    ? await all("SELECT * FROM screenings ORDER BY reviewed_at DESC LIMIT 2000")
    : [];
  const [
    groupCoaches,
    sessions,
    sessionReports,
    assessments,
    results,
    certificates,
    outcomes,
    withdrawals,
    closures,
  ] = await Promise.all([
    all(
      `SELECT x.*,u.name coach_name FROM group_coaches x JOIN users u ON u.id=x.user_id JOIN groups g ON g.id=x.group_id WHERE ${q.sql} ORDER BY x.assigned_at DESC`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM sessions x JOIN groups g ON g.id=x.group_id WHERE ${q.sql} ORDER BY x.starts_at DESC LIMIT 1000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM session_reports x JOIN sessions z ON z.id=x.session_id JOIN groups g ON g.id=z.group_id WHERE ${q.sql} ORDER BY x.submitted_at DESC LIMIT 1000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM assessments x LEFT JOIN groups g ON g.id=x.group_id WHERE x.group_id IS NULL OR ${q.sql} ORDER BY x.due_at DESC LIMIT 1000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM assessment_results x JOIN students s ON s.id=x.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.assessed_at DESC LIMIT 3000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM certificates x JOIN students s ON s.id=x.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.issued_at DESC LIMIT 2000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM post_program_outcomes x JOIN students s ON s.id=x.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.follow_up_at DESC LIMIT 3000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM withdrawal_decisions x JOIN students s ON s.id=x.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY x.decided_at DESC LIMIT 2000`,
      ...q.args,
    ),
    all(
      `SELECT x.* FROM group_closures x JOIN groups g ON g.id=x.group_id WHERE ${q.sql} ORDER BY x.created_at DESC`,
      ...q.args,
    ),
  ]);
  const [staff, definitions, retention, attachments] = await Promise.all([
    all(
      "SELECT id,name,email,roles,active FROM users WHERE active=1 ORDER BY name",
    ),
    can(u.roles, ["Project Operations", "Operations Systems / Admin"])
      ? all("SELECT * FROM report_definitions ORDER BY updated_at DESC")
      : Promise.resolve([]),
    can(u.roles, ["Project Operations", "Operations Systems / Admin"])
      ? all(
          "SELECT key,value FROM system_configuration WHERE key LIKE 'retention:%'",
        )
      : Promise.resolve([]),
    all(
      `SELECT a.id,a.student_id,a.name,a.mime,a.created_at FROM attachments a JOIN students s ON s.id=a.student_id JOIN groups g ON g.id=s.group_id WHERE ${q.sql} ORDER BY a.created_at DESC LIMIT 3000`,
      ...q.args,
    ),
  ]);
  const activeGroups = groups.filter((g) => g.status === "Active");
  const missingCoachGroups = activeGroups.filter((g) => {
    const assigned = groupCoaches.filter(
      (c) =>
        c.group_id === g.id &&
        c.status === "Active" &&
        c.onboarding_status === "Complete",
    );
    return (
      !assigned.some((c) => c.coach_type === "Outcome Coach") ||
      !assigned.some((c) => c.coach_type === "Support Coach")
    );
  });
  const roleSet = new Set(staff.flatMap((s) => JSON.parse(s.roles)));
  const requiredRoles = [
    "Project Operations",
    "Operations Coordinator",
    "Team Supervisor",
    "Coach",
    "Coach Operations",
    "Quality Member",
    "Quality Lead",
    "Higher Board",
    "Operations Systems / Admin",
  ];
  const missingRoles = requiredRoles.filter((r) => !roleSet.has(r));
  const unreportedSessions = sessions.filter(
    (s) =>
      s.starts_at < now() && !sessionReports.some((r) => r.session_id === s.id),
  );
  const readiness = [
    {
      key: "roles",
      label: "Independent operating roles assigned",
      status: missingRoles.length ? "Block" : "Pass",
      detail: missingRoles.length
        ? `Missing: ${missingRoles.join(", ")}`
        : "All required roles have an active staff owner.",
    },
    {
      key: "tracks",
      label: "Track and group structure",
      status:
        new Set(activeGroups.map((g) => g.track)).size >= 20 ? "Pass" : "Warn",
      detail: `${new Set(activeGroups.map((g) => g.track)).size} active tracks across ${activeGroups.length} active groups; Round 5 planning target is 20 tracks.`,
    },
    {
      key: "coaches",
      label: "Both coach functions onboarded",
      status: missingCoachGroups.length ? "Block" : "Pass",
      detail: missingCoachGroups.length
        ? `${missingCoachGroups.length} active groups still need an onboarded Outcome Coach or Support Coach.`
        : "Every active group has both coaching functions.",
    },
    {
      key: "sessions",
      label: "Session delivery reconciled",
      status: unreportedSessions.length ? "Warn" : "Pass",
      detail: unreportedSessions.length
        ? `${unreportedSessions.length} past sessions need notes and reconciled attendance.`
        : "Past sessions have delivery reports.",
    },
    {
      key: "ministry_report",
      label: "Ministry reporting handoff configured",
      status: definitions.some((d) => d.status === "Active") ? "Pass" : "Block",
      detail: definitions.some((d) => d.status === "Active")
        ? "An approved field mapping is active."
        : "Create the Ministry-provided report format before launch.",
    },
    {
      key: "retention",
      label: "Retention authority recorded",
      status: retention.length ? "Pass" : "Block",
      detail: retention.length
        ? `${retention.length} approved retention rules recorded.`
        : "Approved retention periods are still required; none were invented by the system.",
    },
    {
      key: "withdrawal",
      label: "Ministry withdrawal register available",
      status: "Pass",
      detail:
        "Withdrawal is recorded as a Ministry decision and never deletes the learner record.",
    },
  ];
  return {
    user: u,
    applications,
    screenings,
    groups,
    students,
    groupCoaches,
    sessions,
    sessionReports,
    assessments,
    results,
    certificates,
    outcomes,
    withdrawals,
    closures,
    staff,
    attachments,
    reportDefinitions: definitions,
    reportFields: Object.keys(reportFields),
    readiness,
    counts: {
      applications: applications.length,
      eligible: applications.filter((a) => a.status === "Eligible").length,
      admitted: applications.filter((a) => a.status === "Admitted").length,
      activeStudents: students.filter((s) => s.lifecycle === "Active").length,
      completedSessions: sessionReports.length,
      passedAssessments: results.filter((r) => r.outcome === "Passed").length,
      certificates: certificates.length,
      outcomes: outcomes.length,
    },
  };
}

export async function GET(req: Request) {
  try {
    const u = await actor();
    await rateLimit(`program:${u.id}`, 90, 60);
    const data = await programData(u);
    const q = new URL(req.url).searchParams;
    if (q.get("format") === "ministry_csv") {
      permit(u, ["Project Operations", "Operations Systems / Admin"]);
      const definition = data.reportDefinitions.find(
        (d: any) => d.id === q.get("definition"),
      );
      ensure(
        definition && definition.status === "Active",
        "Choose an active Ministry report definition.",
      );
      const columns: string[] = JSON.parse(definition.columns);
      const rows = data.students.map((s: any) =>
        Object.fromEntries(columns.map((c) => [c, s[reportFields[c]] ?? ""])),
      );
      await db().batch([
        stmt(
          "INSERT INTO report_runs VALUES(?,?,?,?,?,?)",
          uid("RPT"),
          definition.id,
          u.id,
          JSON.stringify({ scope: "current authorized groups" }),
          rows.length,
          now(),
        ),
        auditStmt(u, "Ministry report exported", definition.id, {
          columns,
          count: rows.length,
        }),
      ]);
      return new Response(toCSV(rows), {
        headers: {
          "Content-Type": "text/csv;charset=utf-8",
          "Content-Disposition": `attachment; filename="depi-ministry-handoff.csv"`,
          "Cache-Control": "private,no-store",
        },
      });
    }
    return Response.json(data, {
      headers: { "Cache-Control": "private,no-store" },
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    ensure(
      !origin || origin === new URL(req.url).origin,
      "Cross-site requests are not allowed.",
    );
    const x = await req.json();
    const u = await actor();
    await rateLimit(`program-write:${u.id}`, 120, 60);
    const requestId = x.request_id || uid("REQ");
    const prior: any = await stmt(
      "SELECT actor FROM audit_events WHERE request_id=?",
      requestId,
    ).first();
    if (prior) {
      ensure(
        prior.actor === u.id,
        "Request key belongs to a different staff action.",
      );
      return Response.json({ ok: true, replayed: true });
    }
    const id = x.id || uid();
    const t = now();
    const jobs: any[] = [];
    let entity = id;
    let previous: any = null;
    switch (x.action) {
      case "application": {
        permit(u, [...operations, "Operations Systems / Admin"]);
        ensure(
          x.name?.trim() && x.preferred_track?.trim() && x.source?.trim(),
          "Name, preferred track and registration source are required.",
        );
        ensure(
          x.email?.trim() || x.phone?.trim(),
          "Record at least one applicant contact method.",
        );
        ensure(
          !x.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email),
          "Enter a valid applicant email.",
        );
        jobs.push(
          stmt(
            "INSERT INTO applications(id,external_ref,name,email,phone,preferred_track,status,source,consent_ref,owner,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            x.external_ref?.trim() || null,
            x.name.trim(),
            x.email?.trim() || null,
            x.phone?.trim() || null,
            x.preferred_track.trim(),
            "Submitted",
            x.source.trim(),
            x.consent_ref?.trim() || null,
            x.owner || u.id,
            x.submitted_at && !Number.isNaN(Date.parse(x.submitted_at))
              ? new Date(x.submitted_at).toISOString()
              : t,
            t,
          ),
        );
        break;
      }
      case "screen_application": {
        permit(u, programLeads);
        const app: any = await stmt(
          "SELECT * FROM applications WHERE id=?",
          x.application_id,
        ).first();
        ensure(
          app && ["Submitted", "Screening", "Waitlisted"].includes(app.status),
          "Application is not awaiting screening.",
        );
        ensure(
          ["Eligible", "Ineligible", "Waitlisted"].includes(x.decision),
          "Choose an eligibility decision.",
        );
        ensure(
          Array.isArray(x.criteria) && x.criteria.length && x.reason?.trim(),
          "Record completed screening checks and a decision reason.",
        );
        previous = app;
        entity = app.id;
        jobs.push(
          stmt(
            "INSERT INTO screenings VALUES(?,?,?,?,?,?,?)",
            id,
            app.id,
            x.decision,
            JSON.stringify(x.criteria),
            x.reason.trim(),
            u.id,
            t,
          ),
          stmt(
            "UPDATE applications SET status=?,updated_at=? WHERE id=?",
            x.decision,
            t,
            app.id,
          ),
        );
        break;
      }
      case "admit_application": {
        permit(u, ["Project Operations"]);
        const app: any = await stmt(
          "SELECT * FROM applications WHERE id=?",
          x.application_id,
        ).first();
        ensure(
          app?.status === "Eligible",
          "Only an eligible application can be admitted.",
        );
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=? AND status='Active'",
          x.group_id,
        ).first();
        ensure(group, "Choose an active destination group.");
        ensure(
          group.track === app.preferred_track,
          "The destination group must match the screened track.",
        );
        ensure(
          /^S[\w-]{1,60}$/.test(x.student_id || ""),
          "Enter a valid unique student ID beginning with S.",
        );
        entity = x.student_id;
        jobs.push(
          stmt(
            "INSERT INTO students(id,name,group_id,email,phone,created_at) VALUES(?,?,?,?,?,?)",
            x.student_id,
            app.name,
            group.id,
            app.email || "",
            app.phone || "",
            t,
          ),
          stmt(
            "INSERT INTO admissions VALUES(?,?,?,?,?,?)",
            id,
            app.id,
            x.student_id,
            group.id,
            u.id,
            t,
          ),
          stmt(
            "UPDATE applications SET status='Admitted',updated_at=? WHERE id=?",
            t,
            app.id,
          ),
          stmt(
            "INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?)",
            uid("TSK"),
            x.student_id,
            "Complete learner onboarding contact",
            group.coordinator,
            new Date(Date.now() + 86400000).toISOString(),
            "Onboarding",
            "High",
            "Open",
            `admission-${app.id}`,
            t,
          ),
        );
        break;
      }
      case "assign_coach": {
        permit(u, ["Coach Operations", "Project Operations"]);
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=? AND status='Active'",
          x.group_id,
        ).first();
        ensure(group, "Choose an active group.");
        const coach: any = await stmt(
          "SELECT * FROM users WHERE id=? AND active=1",
          x.user_id,
        ).first();
        ensure(
          coach && JSON.parse(coach.roles).includes("Coach"),
          "Choose an active staff member with the Coach role.",
        );
        ensure(
          ["Outcome Coach", "Support Coach"].includes(x.coach_type),
          "Choose the coach function.",
        );
        const checklist = Array.isArray(x.checklist)
          ? [...new Set(x.checklist)]
          : [];
        const complete = checklist.length === 4;
        jobs.push(
          stmt(
            "INSERT INTO group_coaches(id,group_id,user_id,coach_type,status,onboarding_status,checklist,assigned_by,assigned_at,onboarded_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id,user_id,coach_type) DO UPDATE SET status='Active',onboarding_status=excluded.onboarding_status,checklist=excluded.checklist,assigned_by=excluded.assigned_by,onboarded_at=excluded.onboarded_at",
            id,
            group.id,
            coach.id,
            x.coach_type,
            "Active",
            complete ? "Complete" : "Pending",
            JSON.stringify(checklist),
            u.id,
            t,
            complete ? t : null,
          ),
        );
        entity = group.id;
        break;
      }
      case "complete_session": {
        permit(u, ["Coach", "Coach Operations", "Project Operations"]);
        const session: any = await stmt(
          "SELECT * FROM sessions WHERE id=?",
          x.session_id,
        ).first();
        ensure(
          session && session.starts_at <= t,
          "Only a started session can be completed.",
        );
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          session.group_id,
        ).first();
        ensure(
          group?.status === "Active",
          "Archived or closed groups are read-only.",
        );
        if (can(u.roles, ["Coach"])) {
          ensure(
            await stmt(
              "SELECT id FROM group_coaches WHERE group_id=? AND user_id=? AND status='Active' AND onboarding_status='Complete'",
              group.id,
              u.id,
            ).first(),
            "Only an onboarded coach assigned to this group can submit delivery notes.",
          );
        }
        const active: any = await stmt(
          "SELECT count(*) n FROM students WHERE group_id=? AND lifecycle='Active'",
          group.id,
        ).first();
        const marked: any = await stmt(
          "SELECT count(*) n FROM attendance a JOIN students s ON s.id=a.student_id WHERE a.session_id=? AND s.group_id=? AND s.lifecycle='Active'",
          session.id,
          group.id,
        ).first();
        ensure(
          active.n === marked.n,
          `Reconcile attendance for all ${active.n} active students first.`,
        );
        ensure(
          x.notes?.trim().length >= 20,
          "Session notes must document delivery, engagement and follow-up (at least 20 characters).",
        );
        jobs.push(
          stmt(
            "INSERT INTO session_reports VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET facilitator=excluded.facilitator,notes=excluded.notes,attendance_reconciled=1,submitted_at=excluded.submitted_at",
            session.id,
            u.id,
            x.notes.trim(),
            1,
            t,
          ),
          stmt("UPDATE sessions SET status='Completed' WHERE id=?", session.id),
        );
        entity = session.id;
        break;
      }
      case "assessment": {
        permit(u, ["Coach Operations", "Project Operations"]);
        ensure(
          x.title?.trim() &&
            ["Technical", "Coaching", "Final"].includes(x.type),
          "Assessment title and type are required.",
        );
        ensure(
          Number(x.max_score) > 0 &&
            Number(x.pass_score) >= 0 &&
            Number(x.pass_score) <= Number(x.max_score),
          "Pass score must be between zero and the maximum score.",
        );
        ensure(
          x.group_id &&
            (await stmt(
              "SELECT id FROM groups WHERE id=? AND status='Active'",
              x.group_id,
            ).first()),
          "Choose an active group.",
        );
        ensure(
          x.due_at && !Number.isNaN(Date.parse(x.due_at)),
          "Record a valid assessment due date.",
        );
        jobs.push(
          stmt(
            "INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?,?)",
            id,
            x.group_id,
            x.title.trim(),
            x.type,
            Number(x.max_score),
            Number(x.pass_score),
            new Date(x.due_at).toISOString(),
            "Open",
            u.id,
            t,
          ),
        );
        break;
      }
      case "assessment_result": {
        permit(u, [
          "Coach",
          "Coach Operations",
          "Project Operations",
          "Quality Member",
        ]);
        const assessment: any = await stmt(
          "SELECT * FROM assessments WHERE id=? AND status='Open'",
          x.assessment_id,
        ).first();
        ensure(assessment, "Choose an open assessment.");
        const learner = requireWritableLearner(await student(u, x.student_id));
        ensure(
          learner.group_id === assessment.group_id,
          "The learner is outside this assessment group.",
        );
        const score = Number(x.score);
        ensure(
          Number.isFinite(score) && score >= 0 && score <= assessment.max_score,
          "Score is outside the assessment range.",
        );
        if (x.evidence_id)
          ensure(
            await stmt(
              "SELECT id FROM attachments WHERE id=? AND student_id=?",
              x.evidence_id,
              learner.id,
            ).first(),
            "Assessment evidence must belong to the learner.",
          );
        const outcome =
          score >= assessment.pass_score ? "Passed" : "Needs reassessment";
        jobs.push(
          stmt(
            "INSERT INTO assessment_results(id,assessment_id,student_id,score,outcome,evidence_id,notes,assessed_by,assessed_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(assessment_id,student_id) DO UPDATE SET score=excluded.score,outcome=excluded.outcome,evidence_id=excluded.evidence_id,notes=excluded.notes,assessed_by=excluded.assessed_by,assessed_at=excluded.assessed_at",
            id,
            assessment.id,
            learner.id,
            score,
            outcome,
            x.evidence_id || null,
            x.notes?.trim() || "Recorded assessment result",
            u.id,
            t,
          ),
        );
        entity = learner.id;
        break;
      }
      case "issue_certificate": {
        permit(u, ["Project Operations", "Quality Lead"]);
        const learner = requireWritableLearner(await student(u, x.student_id));
        ensure(
          learner.lifecycle === "Graduate Closed",
          "Issue a certificate only after graduate closure.",
        );
        const graduation: any = await stmt(
          "SELECT result FROM graduation_ledger WHERE student_id=? ORDER BY calculated_at DESC LIMIT 1",
          learner.id,
        ).first();
        ensure(
          graduation &&
            ["Graduated", "$300 Graduate"].includes(graduation.result),
          "A computed qualifying graduation result is required.",
        );
        const finals: any = await stmt(
          "SELECT count(*) n FROM assessments WHERE group_id=? AND type='Final'",
          learner.group_id,
        ).first();
        if (finals.n)
          ensure(
            await stmt(
              "SELECT x.id FROM assessment_results x JOIN assessments a ON a.id=x.assessment_id WHERE x.student_id=? AND a.group_id=? AND a.type='Final' AND x.outcome='Passed'",
              learner.id,
              learner.group_id,
            ).first(),
            "The final assessment must be passed before certificate issue.",
          );
        ensure(
          ["Completion", "Achievement", "$300 Graduate"].includes(x.type),
          "Choose a certificate type.",
        );
        if (x.type === "$300 Graduate")
          ensure(
            graduation.result === "$300 Graduate",
            "This learner does not qualify for the $300 certificate.",
          );
        ensure(
          x.external_ref?.trim(),
          "Record the external certificate reference.",
        );
        jobs.push(
          stmt(
            "INSERT INTO certificates VALUES(?,?,?,?,?,?,?,?)",
            id,
            learner.id,
            x.type,
            "Issued",
            x.external_ref.trim(),
            u.id,
            t,
            t,
          ),
        );
        entity = learner.id;
        break;
      }
      case "post_program_outcome": {
        permit(u, [...operations, "Coach"]);
        const learner = requireWritableLearner(await student(u, x.student_id));
        ensure(
          [
            "Graduate Closed",
            "Non-Graduate Closed",
            "Withdrawn",
            "Removed",
          ].includes(learner.lifecycle),
          "Post-program outcomes start after learner closure or withdrawal.",
        );
        ensure(
          [
            "Employment",
            "Freelancing",
            "Internship",
            "Business",
            "Other",
          ].includes(x.type) && x.title?.trim(),
          "Outcome type and title are required.",
        );
        ensure(
          ["Reported", "Verified", "Follow-up due", "Closed"].includes(
            x.status,
          ),
          "Choose a valid outcome status.",
        );
        if (x.status === "Verified")
          ensure(
            x.proof_id &&
              (await stmt(
                "SELECT id FROM attachments WHERE id=? AND student_id=?",
                x.proof_id,
                learner.id,
              ).first()),
            "Verified outcomes require proof linked to the learner.",
          );
        ensure(
          x.follow_up_at && !Number.isNaN(Date.parse(x.follow_up_at)),
          "Record the next outcome follow-up date.",
        );
        jobs.push(
          stmt(
            "INSERT INTO post_program_outcomes VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            id,
            learner.id,
            x.type,
            x.organization?.trim() || null,
            x.title.trim(),
            x.value ? Number(x.value) : null,
            x.currency?.trim() || null,
            x.status,
            x.proof_id || null,
            new Date(x.follow_up_at).toISOString(),
            x.owner || u.id,
            t,
          ),
        );
        entity = learner.id;
        break;
      }
      case "withdrawal_decision": {
        permit(u, ["Project Operations"]);
        const learner = requireWritableLearner(await student(u, x.student_id));
        ensure(
          ["Approved", "Declined"].includes(x.decision),
          "Record the Ministry decision.",
        );
        ensure(
          x.ministry_reference?.trim() &&
            x.reason?.trim() &&
            x.decided_at &&
            !Number.isNaN(Date.parse(x.decided_at)),
          "Ministry reference, decision date and reason are required.",
        );
        previous = learner;
        jobs.push(
          stmt(
            "INSERT INTO withdrawal_decisions VALUES(?,?,?,?,?,?,?,?)",
            id,
            learner.id,
            x.ministry_reference.trim(),
            x.decision,
            x.reason.trim(),
            new Date(x.decided_at).toISOString(),
            u.id,
            t,
          ),
        );
        if (x.decision === "Approved")
          jobs.push(
            stmt(
              "UPDATE students SET lifecycle='Withdrawn' WHERE id=?",
              learner.id,
            ),
            stmt(
              "INSERT INTO student_status_events VALUES(?,?,?,?,?,?,?,?)",
              uid("STATUS"),
              learner.id,
              "Lifecycle",
              learner.lifecycle,
              "Withdrawn",
              u.id,
              `Ministry decision ${x.ministry_reference}: ${x.reason}`,
              t,
            ),
          );
        entity = learner.id;
        break;
      }
      case "group_close": {
        permit(u, ["Project Operations"]);
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          x.group_id,
        ).first();
        ensure(
          group?.status === "Active" && x.reason?.trim(),
          "Choose an active group and record the closure reason.",
        );
        const snapshot = await groupClosureSnapshot(group.id);
        ensure(
          snapshot.active_students === 0,
          "Close or transfer every active or paused learner first.",
        );
        ensure(
          snapshot.open_tasks === 0 && snapshot.open_cases === 0,
          "Resolve all open actions and cases before group closure.",
        );
        ensure(
          snapshot.active_gigs === 0 && snapshot.pending_evidence === 0,
          "Resolve active gigs and evidence reviews before group closure.",
        );
        jobs.push(
          stmt("UPDATE groups SET status='Closed' WHERE id=?", group.id),
          stmt(
            "INSERT INTO group_closures VALUES(?,?,?,?,?,?,?)",
            id,
            group.id,
            "Closed",
            JSON.stringify(snapshot),
            x.reason.trim(),
            u.id,
            t,
          ),
        );
        entity = group.id;
        previous = group;
        break;
      }
      case "group_archive": {
        permit(u, ["Project Operations"]);
        const group: any = await stmt(
          "SELECT * FROM groups WHERE id=?",
          x.group_id,
        ).first();
        ensure(
          group?.status === "Closed" && x.reason?.trim(),
          "Only a reconciled closed group can be archived.",
        );
        ensure(
          await stmt(
            "SELECT id FROM group_closures WHERE group_id=? AND action='Closed'",
            group.id,
          ).first(),
          "The closure reconciliation snapshot is missing.",
        );
        const snapshot = await groupClosureSnapshot(group.id);
        jobs.push(
          stmt("UPDATE groups SET status='Archived' WHERE id=?", group.id),
          stmt(
            "INSERT INTO group_closures VALUES(?,?,?,?,?,?,?)",
            id,
            group.id,
            "Archived",
            JSON.stringify(snapshot),
            x.reason.trim(),
            u.id,
            t,
          ),
        );
        entity = group.id;
        previous = group;
        break;
      }
      case "report_definition": {
        permit(u, ["Project Operations", "Operations Systems / Admin"]);
        const columns: string[] = Array.isArray(x.columns)
          ? [
              ...new Set<string>(
                x.columns.filter((c: unknown) => typeof c === "string"),
              ),
            ]
          : [];
        ensure(
          x.name?.trim() &&
            columns.length &&
            columns.every((c) => c in reportFields),
          "Report name and supported Ministry columns are required.",
        );
        ensure(
          x.reason?.trim(),
          "Record the reporting-format authority or change reason.",
        );
        jobs.push(
          stmt(
            "INSERT INTO report_definitions(id,name,status,columns,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET status='Active',columns=excluded.columns,created_by=excluded.created_by,updated_at=excluded.updated_at",
            id,
            x.name.trim(),
            "Active",
            JSON.stringify(columns),
            u.id,
            t,
            t,
          ),
        );
        entity = x.name.trim();
        break;
      }
      default:
        throw new Error("This program-flow operation is not supported.");
    }
    jobs.push(
      auditStmt(u, x.action, entity, x, previous, requestId, x.reason || null),
    );
    await db().batch(jobs);
    return Response.json({ ok: true });
  } catch (e: any) {
    const message = /UNIQUE constraint/.test(e.message)
      ? "A duplicate lifecycle record was blocked. Refresh and review the existing record."
      : /FOREIGN KEY/.test(e.message)
        ? "A linked learner, group, staff member or evidence record does not exist."
        : e.message;
    return Response.json({ error: message }, { status: 400 });
  }
}

async function groupClosureSnapshot(groupId: string) {
  const row: any = await stmt(
    `SELECT
      (SELECT count(*) FROM students WHERE group_id=? AND lifecycle IN ('Active','Paused')) active_students,
      (SELECT count(*) FROM tasks t JOIN students s ON s.id=t.student_id WHERE s.group_id=? AND t.status='Open') open_tasks,
      (SELECT count(*) FROM cases c JOIN students s ON s.id=c.student_id WHERE s.group_id=? AND c.status<>'Closed') open_cases,
      (SELECT count(*) FROM gigs z JOIN students s ON s.id=z.student_id WHERE s.group_id=? AND z.status NOT IN ('Paid','Cancelled','Failed')) active_gigs,
      (SELECT count(*) FROM evidence e JOIN students s ON s.id=e.student_id WHERE s.group_id=? AND e.status NOT IN ('Accepted','Closed L3')) pending_evidence,
      (SELECT count(*) FROM students WHERE group_id=?) students,
      (SELECT count(*) FROM certificates c JOIN students s ON s.id=c.student_id WHERE s.group_id=?) certificates`,
    groupId,
    groupId,
    groupId,
    groupId,
    groupId,
    groupId,
    groupId,
  ).first();
  return { ...row, captured_at: now() };
}
