"use client";
import { dataTransferRoles } from "@/lib/domain/rules";
import { useT } from "@/lib/i18n/context";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = Record<string, any>;

const screeningChecks = [
  "Identity and registration record checked",
  "Contact details confirmed",
  "Track prerequisites reviewed",
  "Program availability confirmed",
];
const onboardingChecks = [
  "Role boundaries acknowledged",
  "Group roster reviewed",
  "Session and attendance process reviewed",
  "Evidence SLA and escalation process reviewed",
];

function Badge({ value }: { value: string }) {
  const t = useT();
  const color = /Block|Ineligible|Needs|Withdrawn|Archived|Approval missing/.test(value)
    ? "red"
    : /Warn|Wait|Pending|Submitted|Reported/.test(value)
      ? "amber"
      : /Pass|Eligible|Admitted|Complete|Issued|Verified|Active|Closed/.test(
            value,
          )
        ? "green"
        : "neutral";
  return <span className={`badge ${color}`}>{t(value)}</span>;
}

function Empty({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="empty">
      <CheckCircle2 size={28} />
      <h3>{t("No records yet")}</h3>
      <p>{t(text)}</p>
    </div>
  );
}

export function ProgramFlow() {
  const t = useT();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});

  async function load() {
    try {
      setError("");
      const response = await fetch("/api/program");
      const value = await response.json();
      if (value.error) throw new Error(value.error);
      setData(value);
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function open(action: string, row: Row = {}) {
    setModal({ action, ...row });
    setForm({
      ...row,
      application_id: row.application_id || row.id || "",
      student_id: row.student_id || "",
      group_id: row.group_id || "",
      owner:
        action === "bulk_group_owner"
          ? ""
          : row.owner || data?.user?.id || "",
      decision:
        action === "screen_application"
          ? "Eligible"
          : action === "withdrawal_decision"
            ? "Approved"
            : "",
      type:
        action === "assessment"
          ? "Final"
          : action === "issue_certificate"
            ? "Completion"
            : action === "post_program_outcome"
              ? "Employment"
              : "",
      status:
        action === "post_program_outcome"
          ? "Reported"
          : action === "bulk_classification"
            ? "At Risk"
            : "",
      owner_type:
        action === "bulk_group_owner"
          ? allowed(["Project Operations", "Operations Systems / Admin", "Team Supervisor"])
            ? "Coordinator"
            : "Coach"
          : row.owner_type,
      max_score: 100,
      pass_score: 60,
      submitted_at: new Date().toISOString().slice(0, 16),
      decided_at: new Date().toISOString().slice(0, 10),
      due_at: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
      due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
      priority: "Normal",
      follow_up_at: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 16),
      criteria: [],
      checklist: [],
      columns: [
        "student_id",
        "name",
        "track",
        "group",
        "lifecycle",
        "graduation",
        "certificate_status",
      ],
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setBusy(true);
    try {
      const payload = { ...form };
      for (const key of ["student_ids", "group_ids"]) {
        if (typeof payload[key] === "string")
          payload[key] = payload[key].split(/[\s,;]+/).filter(Boolean);
      }
      const response = await fetch("/api/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          action: modal.action,
          request_id: crypto.randomUUID(),
        }),
      });
      const value = await response.json();
      if (value.error) throw new Error(value.error);
      toast.success(t("Program record saved"));
      setModal(null);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  const d = data || {};
  const applications: Row[] = d.applications || [];
  const tracks: Row[] = d.tracks || [];
  const groups: Row[] = d.groups || [];
  const students: Row[] = d.students || [];
  const staff: Row[] = d.staff || [];
  const userRoles: string[] = d.user?.roles || [];
  const allowed = (roles: string[]) => userRoles.some((role) => roles.includes(role));
  const coaches = staff.filter((u) => JSON.parse(u.roles).includes("Coach"));
  const outcomeGroupIds = new Set(
    (d.groupCoaches || [])
      .filter(
        (assignment: Row) =>
          assignment.user_id === d.user?.id &&
          assignment.coach_type === "Outcome Coach" &&
          assignment.status === "Active" &&
          assignment.onboarding_status === "Complete",
      )
      .map((assignment: Row) => assignment.group_id),
  );
  const canRecordOutcome =
    allowed(["Project Operations", "Operations Coordinator"]) ||
    outcomeGroupIds.size > 0;
  const sessionReports = new Set(
    (d.sessionReports || []).map((r: Row) => r.session_id),
  );
  const activeReport = (d.reportDefinitions || []).find(
    (r: Row) => r.status === "Active" && r.approved_by && r.approved_at,
  );
  const application = applications.find((a) => a.id === form.application_id);
  const availableGroups = application
    ? groups.filter(
        (g) => g.status === "Active" && g.track === application.preferred_track,
      )
    : groups.filter((g) => g.status === "Active");
  const selectedAssessment = (d.assessments || []).find(
    (a: Row) => a.id === form.assessment_id,
  );
  const assessmentStudents = selectedAssessment
    ? students.filter((s) => s.group_id === selectedAssessment.group_id)
    : students;
  const latestScreen = useMemo(() => {
    const out: Row = {};
    for (const s of d.screenings || [])
      if (!out[s.application_id]) out[s.application_id] = s;
    return out;
  }, [d.screenings]);

  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label className="field" key={key}>
      {t(label)}
      <input
        required={required}
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  const select = (
    key: string,
    label: string,
    options: Array<string | { value: string; label: string }>,
  ) => (
    <label className="field" key={key}>
      {t(label)}
      <select
        required
        value={form[key] || ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      >
        <option value="">{t("Choose…")}</option>
        {options.map((option) => {
          const item =
            typeof option === "string"
              ? { value: option, label: option }
              : option;
          return (
            <option value={item.value} key={item.value}>
              {t(item.label)}
            </option>
          );
        })}
      </select>
    </label>
  );
  const checklist = (key: string, options: string[]) => (
    <div className="review-checks">
      {options.map((option) => (
        <label className="check" key={option}>
          <Checkbox
            checked={(form[key] || []).includes(option)}
            onCheckedChange={(checked) =>
              setForm({
                ...form,
                [key]: checked
                  ? [...(form[key] || []), option]
                  : (form[key] || []).filter((x: string) => x !== option),
              })
            }
          />
          {t(option)}
        </label>
      ))}
    </div>
  );
  const textarea = (key: string, label: string, placeholder = "") => (
    <label className="field" key={key}>
      {t(label)}
      <textarea
        required
        rows={4}
        placeholder={t(placeholder)}
        value={form[key] ?? ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );

  if (!data && !error)
    return (
      <div className="panel prose">
        <p>{t("Loading the complete program flow…")}</p>
      </div>
    );
  if (error)
    return (
      <div className="error-panel" role="alert">
        <h2>{t("Program flow unavailable")}</h2>
        <p>{error}</p>
        <button className="primary" onClick={load}>
          {t("Try again")}
        </button>
      </div>
    );

  return (
    <>
      <div className="stats">
        {[
          ["Registered", d.counts.applications],
          ["Admitted", d.counts.admitted],
          ["Active learners", d.counts.activeStudents],
          ["Certificates", d.counts.certificates],
        ].map(([label, value]) => (
          <div className="stat" key={String(label)}>
            <span>{t(String(label))}</span>
            <strong>{value}</strong>
            <small>{t("Current authorized scope")}</small>
          </div>
        ))}
      </div>
      <Tabs defaultValue="intake">
        <TabsList className="detail-tabs">
          <TabsTrigger value="intake">{t("1 · Intake")}</TabsTrigger>
          <TabsTrigger value="coaching">{t("2 · Coaching team")}</TabsTrigger>
          <TabsTrigger value="assessment">{t("3 · Assessments")}</TabsTrigger>
          <TabsTrigger value="outcomes">
            {t("4 · Certificates & outcomes")}
          </TabsTrigger>
          <TabsTrigger value="closure">{t("5 · Closure")}</TabsTrigger>
          <TabsTrigger value="bulk">{t("Bulk control")}</TabsTrigger>
          <TabsTrigger value="readiness">{t("Launch readiness")}</TabsTrigger>
        </TabsList>

        <TabsContent value="intake">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Registration, screening and assignment")}</h2>
                <p>
                  {t("One application becomes one admitted learner only after an eligibility decision.")}
                </p>
              </div>
              <div className="detail-actions">
                {allowed(["Project Operations", "Operations Systems / Admin"]) && (
                  <button className="small-btn" onClick={() => open("track")}>
                    <Plus size={16} /> {t("Manage tracks")}
                  </button>
                )}
                {allowed(["Project Operations", "Operations Coordinator", "Operations Systems / Admin"]) && (
                  <button className="primary" disabled={!tracks.length} onClick={() => open("application")}>
                    <Plus size={16} /> {t("Register applicant")}
                  </button>
                )}
              </div>
            </div>
            <div className="lifecycle-track-strip">
              {tracks.map((track) => (
                <div className="info-box" key={track.id}>
                  <strong>{track.name}</strong>
                  <small>{track.provider || t("Shared provider")} {t("· capacity")}{" "}{track.capacity ?? t("not set")}</small>
                </div>
              ))}
              {!tracks.length && <p className="footnote">{t("Add the approved track structure before registration.")}</p>}
            </div>
            {!applications.length ? (
              <Empty text={t("Register the first applicant to begin screening.")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Applicant")}</TableHead>
                    <TableHead>{t("Track")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead>{t("Latest decision")}</TableHead>
                    <TableHead>{t("Action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {applications.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <strong>{a.name}</strong>
                        <small className="block">
                          {a.external_ref || a.id}
                        </small>
                      </TableCell>
                      <TableCell>{a.preferred_track}</TableCell>
                      <TableCell>
                        <Badge value={a.status} />
                      </TableCell>
                      <TableCell>
                        {latestScreen[a.id]?.reason || t("Awaiting screening")}
                      </TableCell>
                      <TableCell>
                        <div className="detail-actions">
                          {allowed(["Project Operations", "Team Supervisor"]) && ["Submitted", "Screening", "Waitlisted"].includes(
                            a.status,
                          ) && (
                            <button
                              className="small-btn"
                              onClick={() =>
                                open("screen_application", {
                                  application_id: a.id,
                                })
                              }
                            >
                              {t("Screen")}
                            </button>
                          )}
                          {allowed(["Project Operations"]) && a.status === "Eligible" && (
                            <button
                              className="small-btn"
                              onClick={() =>
                                open("admit_application", {
                                  application_id: a.id,
                                })
                              }
                            >
                              {t("Assign group")}
                            </button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="coaching">
          <div className="report-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>{t("Coach matching & onboarding")}</h2>
                {allowed(["Coach Operations", "Project Operations"]) && (
                  <button className="small-btn" onClick={() => open("assign_coach")}>
                    <Plus size={16} /> {t("Assign coach")}
                  </button>
                )}
              </div>
              {!groups.length ? (
                <Empty text={t("Create groups before matching coaches.")} />
              ) : (
                groups.map((g) => {
                  const assigned = (d.groupCoaches || []).filter(
                    (c: Row) => c.group_id === g.id && c.status === "Active",
                  );
                  return (
                    <div className="info-box" key={g.id}>
                      <strong>{g.name}</strong>
                      <span>
                        {g.track} · <Badge value={g.status} />
                      </span>
                      {assigned.map((c: Row) => (
                        <small key={c.id}>
                          {c.coach_type}: {c.coach_name} · {c.onboarding_status}
                        </small>
                      ))}
                      {!assigned.length && (
                        <small>{t("No functional coach assignment recorded.")}</small>
                      )}
                    </div>
                  );
                })
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>{t("Session delivery handoff")}</h2>
                <button className="small-btn" onClick={load}>
                  <RefreshCw size={15} />
                  {t("Refresh")}
                </button>
              </div>
              {(d.sessions || [])
                .filter(
                  (s: Row) =>
                    s.status !== "Cancelled" && !sessionReports.has(s.id),
                )
                .slice(0, 30)
                .map((s: Row) => (
                  <div className="info-box" key={s.id}>
                    <strong>{s.title}</strong>
                    <span>
                      {s.group_id} · {s.coach_name || t("Coach not assigned")} ·{" "}
                      {new Date(s.starts_at).toLocaleString()}
                    </span>
                    <Badge value={s.status} />
                    {allowed(["Coach", "Coach Operations", "Project Operations"]) && (
                      <button
                        className="small-btn"
                        disabled={
                          s.starts_at > new Date().toISOString() ||
                          s.status !== "Confirmed"
                        }
                        onClick={() => open("complete_session", { session_id: s.id })}
                      >
                        {t("Notes & reconciliation")}
                      </button>
                    )}
                  </div>
                ))}
              {(d.sessions || [])
                .filter((s: Row) => s.status !== "Cancelled")
                .every((s: Row) => sessionReports.has(s.id)) && (
                <Empty text={t("All started sessions have delivery notes and attendance reconciliation.")} />
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="assessment">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>{t("Assessment register")}</h2>
                <p>
                  {t("Results are calculated from the recorded score and the assessment pass mark.")}
                </p>
              </div>
              <div className="detail-actions">
                {allowed(["Coach Operations", "Project Operations"]) && (
                  <button className="small-btn" onClick={() => open("assessment")}>
                    <Plus size={16} /> {t("Create assessment")}
                  </button>
                )}
                {allowed(["Coach", "Coach Operations", "Project Operations", "Quality Member"]) && (
                  <button className="primary" onClick={() => open("assessment_result")}>
                    {t("Record result")}
                  </button>
                )}
              </div>
            </div>
            {!(d.assessments || []).length ? (
              <Empty text={t("Create the first technical, coaching or final assessment.")} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Assessment")}</TableHead>
                    <TableHead>{t("Group")}</TableHead>
                    <TableHead>{t("Pass mark")}</TableHead>
                    <TableHead>{t("Due")}</TableHead>
                    <TableHead>{t("Results")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.assessments.map((a: Row) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <strong>{a.title}</strong>
                        <small className="block">{a.type}</small>
                      </TableCell>
                      <TableCell>{a.group_id}</TableCell>
                      <TableCell>
                        {a.pass_score} / {a.max_score}
                      </TableCell>
                      <TableCell>
                        {new Date(a.due_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        {
                          (d.results || []).filter(
                            (r: Row) => r.assessment_id === a.id,
                          ).length
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </TabsContent>

        <TabsContent value="outcomes">
          <div className="report-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>{t("Certificate issue register")}</h2>
                {allowed(["Project Operations", "Quality Lead"]) && (
                  <button className="primary" onClick={() => open("issue_certificate")}>
                    <Plus size={16} /> {t("Issue certificate")}
                  </button>
                )}
              </div>
              {!(d.certificates || []).length ? (
                <Empty text={t("Certificates appear after computed graduation, final closure and any required final assessment.")} />
              ) : (
                d.certificates.map((c: Row) => (
                  <div className="info-box" key={c.id}>
                    <strong>
                      {students.find((s) => s.id === c.student_id)?.name}
                    </strong>
                    <span>
                      {c.type} · {c.external_ref}
                    </span>
                    <Badge value={c.status} />
                  </div>
                ))
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>{t("Post-program outcomes")}</h2>
                {canRecordOutcome && (
                  <button className="small-btn" onClick={() => open("post_program_outcome")}>
                    <Plus size={16} /> {t("Record outcome")}
                  </button>
                )}
              </div>
              {!(d.outcomes || []).length ? (
                <Empty text={t("Record verified employment, freelancing, internship or business outcomes after closure.")} />
              ) : (
                d.outcomes.map((o: Row) => (
                  <div className="info-box" key={o.id}>
                    <strong>
                      {students.find((s) => s.id === o.student_id)?.name}
                    </strong>
                    <span>
                      {o.type} · {o.title}
                    </span>
                    <Badge value={o.status} />
                    <small>
                      {t("Follow up")}{" "}{new Date(o.follow_up_at).toLocaleDateString()}
                    </small>
                  </div>
                ))
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="closure">
          <div className="report-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{t("Ministry withdrawal decisions")}</h2>
                  <p>
                    {t("The system records the decision and preserves the learner history.")}
                  </p>
                </div>
                {allowed(["Project Operations"]) && (
                  <button className="small-btn" onClick={() => open("withdrawal_decision")}>
                    <Plus size={16} /> {t("Record decision")}
                  </button>
                )}
              </div>
              {!(d.withdrawals || []).length ? (
                <Empty text={t("No Ministry withdrawal decisions recorded.")} />
              ) : (
                d.withdrawals.map((w: Row) => (
                  <div className="info-box" key={w.id}>
                    <strong>
                      {students.find((s) => s.id === w.student_id)?.name}
                    </strong>
                    <span>{w.ministry_reference}</span>
                    <Badge value={w.decision} />
                  </div>
                ))
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{t("Group closure & archive")}</h2>
                  <p>
                    {t("Closure reconciles learners, actions, cases, gigs and evidence. Archive makes the group read-only.")}
                  </p>
                </div>
              </div>
              {groups.map((g) => (
                <div className="info-box" key={g.id}>
                  <strong>{g.name}</strong>
                  <span>
                    {g.track} · <Badge value={g.status} />
                  </span>
                  {allowed(["Project Operations"]) && <div className="detail-actions">
                    {allowed(["Project Operations"]) && g.status === "Active" && (
                      <button
                        className="small-btn"
                        onClick={() => open("group_close", { group_id: g.id })}
                      >
                        {t("Run closure")}
                      </button>
                    )}
                    {allowed(["Project Operations"]) && g.status === "Closed" && (
                      <button
                        className="small-btn"
                        onClick={() =>
                          open("group_archive", { group_id: g.id })
                        }
                      >
                        {t("Archive read-only")}
                      </button>
                    )}
                  </div>}
                </div>
              ))}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="bulk">
          <div className="report-grid">
            <section className="panel prose">
              <h2>{t("Safe bulk operations")}</h2>
              <p>
                {t("Apply one validated change to up to 100 authorized records. Every batch is atomic and written to the audit history.")}
              </p>
              <div className="detail-actions">
                {allowed(["Project Operations", "Team Supervisor", "Coach Operations"]) && (
                  <button className="small-btn" onClick={() => open("bulk_group_owner")}>
                    {t("Assign group owners")}
                  </button>
                )}
                {allowed(["Project Operations", "Team Supervisor"]) && (
                  <button className="small-btn" onClick={() => open("bulk_classification")}>
                    {t("Update classifications")}
                  </button>
                )}
                {allowed(["Project Operations", "Operations Coordinator", "Team Supervisor", "Coach"]) && (
                  <button className="small-btn" onClick={() => open("bulk_tasks")}>
                    {t("Create learner tasks")}
                  </button>
                )}
              </div>
              <p className="footnote">
                {t("Quality approval, graduation and account allocation are deliberately excluded from bulk actions.")}
              </p>
            </section>
            {allowed(dataTransferRoles) && <section className="panel prose">
              <h2>{t("Controlled lifecycle exports")}</h2>
              <p>{t("Exports include only records within the current staff member’s authorized scope.")}</p>
              <div className="detail-actions">
                <a className="small-btn" href="/api/program?format=csv&dataset=lifecycle">
                  <Download size={16} /> {t("Lifecycle CSV")}
                </a>
                <a className="small-btn" href="/api/program?format=xlsx&dataset=lifecycle">
                  <Download size={16} /> {t("Lifecycle XLSX")}
                </a>
                {allowed(["Project Operations", "Operations Coordinator", "Team Supervisor", "Operations Systems / Admin"]) && (
                  <a className="small-btn" href="/api/program?format=xlsx&dataset=applications">
                    <Download size={16} /> {t("Applications XLSX")}
                  </a>
                )}
                <a className="small-btn" href="/api/program?format=xlsx&dataset=assessments">
                  <Download size={16} /> {t("Assessments XLSX")}
                </a>
                <a className="small-btn" href="/api/program?format=xlsx&dataset=outcomes">
                  <Download size={16} /> {t("Outcomes XLSX")}
                </a>
              </div>
            </section>}
          </div>
        </TabsContent>

        <TabsContent value="readiness">
          <div className="report-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{t("Launch readiness")}</h2>
                  <p>
                    {t("Policy-dependent gates stay blocked until an authorized rule is recorded.")}
                  </p>
                </div>
              </div>
              {d.readiness.map((r: Row) => (
                <div className="info-box" key={r.key}>
                  <strong>{r.label}</strong>
                  <Badge value={r.status} />
                  <small>{r.detail}</small>
                </div>
              ))}
            </section>
            <section className="panel prose">
              <h2>{t("Ministry reporting handoff")}</h2>
              {activeReport ? (
                <>
                  <div className="info-box">
                    <strong>{activeReport.name}</strong>
                    <Badge value={activeReport.status} />
                    <small>{JSON.parse(activeReport.columns).join(", ")}</small>
                  </div>
                  {allowed(["Project Operations", "Operations Systems / Admin"]) && <div className="detail-actions">
                    <a className="primary" href={`/api/program?format=ministry_csv&definition=${activeReport.id}`}>
                      <Download size={16} /> {t("Export CSV")}
                    </a>
                    <a className="small-btn" href={`/api/program?format=ministry_xlsx&definition=${activeReport.id}`}>
                      <Download size={16} /> {t("Export XLSX")}
                    </a>
                  </div>}
                </>
              ) : (
                <p>
                  {t("No format is active. Record only the columns supplied by the Ministry.")}
                </p>
              )}
              {allowed(["Project Operations", "Operations Systems / Admin"]) && (
                <button className="small-btn" onClick={() => open("report_definition")}>
                  <ShieldCheck size={16} /> {t("Create draft format")}
                </button>
              )}
              {(d.reportDefinitions || []).map((definition: Row) => (
                <div className="info-box" key={definition.id}>
                  <strong>{definition.name}</strong>
                  <Badge value={definition.status === "Active" && !definition.approved_by ? "Approval missing" : definition.status} />
                  <small>{JSON.parse(definition.columns).join(", ")}</small>
                  {definition.status === "Draft" && definition.created_by !== d.user.id && allowed(["Project Operations", "Operations Systems / Admin"]) && (
                    <button className="small-btn" onClick={() => open("approve_report_definition", { id: definition.id })}>
                      {t("Approve independently")}
                    </button>
                  )}
                </div>
              ))}
              {!!(d.reportRuns || []).length && (
                <div>
                  <h3>{t("Recent report runs")}</h3>
                  {(d.reportRuns || []).slice(0, 5).map((run: Row) => (
                    <p className="footnote" key={run.id}>
                      {new Date(run.created_at).toLocaleString()} · {run.count} {t("rows ·")}{" "}{run.actor}
                    </p>
                  ))}
                </div>
              )}
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!modal} onOpenChange={(value) => !value && setModal(null)}>
        <DialogContent className="action-dialog sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {modal &&
                t(
                  (
                  {
                    application: "Register applicant",
                    track: "Add or update technical track",
                    screen_application: "Record eligibility screening",
                    admit_application: "Admit and assign learner",
                    assign_coach: "Match and onboard coach",
                    complete_session: "Complete session handoff",
                    assessment: "Create assessment",
                    assessment_result: "Record assessment result",
                    issue_certificate: "Issue certificate",
                    post_program_outcome: "Record post-program outcome",
                    withdrawal_decision: "Record Ministry withdrawal decision",
                    group_close: "Close group",
                    group_archive: "Archive group",
                    report_definition: "Configure Ministry report",
                    approve_report_definition: "Approve Ministry report format",
                    bulk_group_owner: "Assign group owners in bulk",
                    bulk_classification: "Update learner classifications",
                    bulk_tasks: "Create learner tasks in bulk",
                  } as Row
                  )[modal.action] || "",
                )}
            </DialogTitle>
            <DialogDescription>
              {t("Required decisions and transitions are written to the audit history.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="action-form">
            {modal?.action === "application" && (
              <>
                {field(
                  "external_ref",
                  t("Ministry / source reference"),
                  "text",
                  false,
                )}
                {field("name", t("Applicant name"))}
                {field("email", t("Email"), "email", false)}
                {field("phone", t("Phone"), "tel", false)}
                {select("preferred_track", "Preferred technical track", tracks.map((track) => track.name))}
                {field("source", t("Registration source"))}
                {field(
                  "consent_ref",
                  t("Consent / privacy reference"),
                  "text",
                  false,
                )}
                {select(
                  "owner",
                  "Application owner",
                  staff
                    .filter((s) => JSON.parse(s.roles).some((role: string) => ["Project Operations", "Operations Coordinator"].includes(role)))
                    .map((s) => ({ value: s.id, label: s.name })),
                )}
                {field("submitted_at", t("Submitted at"), "datetime-local")}
              </>
            )}
            {modal?.action === "track" && (
              <>
                {field("name", t("Technical track name"))}
                {select("provider", "Primary provider", ["Career180", "Freelance Yard"])}
                {field("capacity", t("Approved learner capacity"), "number")}
                {field("reason", t("Track setup authority and reason"))}
              </>
            )}
            {modal?.action === "screen_application" && (
              <>
                {select("decision", "Eligibility decision", [
                  "Eligible",
                  "Ineligible",
                  "Waitlisted",
                ])}
                {checklist("criteria", screeningChecks)}
                {field("reason", t("Decision reason"))}
              </>
            )}
            {modal?.action === "admit_application" && (
              <>
                {field("student_id", t("Unique student ID"))}
                {select(
                  "group_id",
                  "Matched active group",
                  availableGroups.map((g) => ({
                    value: g.id,
                    label: `${g.name} · ${g.track}`,
                  })),
                )}
              </>
            )}
            {modal?.action === "assign_coach" && (
              <>
                {select(
                  "group_id",
                  "Active group",
                  groups
                    .filter((g) => g.status === "Active")
                    .map((g) => ({
                      value: g.id,
                      label: `${g.name} · ${g.track}`,
                    })),
                )}
                {select(
                  "user_id",
                  "Coach",
                  coaches.map((c) => ({ value: c.id, label: c.name })),
                )}
                {select("coach_type", "Coach function", [
                  "Outcome Coach",
                  "Support Coach",
                ])}
                {checklist("checklist", onboardingChecks)}
                <p className="footnote">
                  {t("All four checks complete onboarding. A partial checklist leaves the assignment pending.")}
                </p>
              </>
            )}
            {modal?.action === "complete_session" && (
              <>{field("notes", t("Delivery, engagement and follow-up notes"))}</>
            )}
            {modal?.action === "assessment" && (
              <>
                {select(
                  "group_id",
                  "Group",
                  groups
                    .filter((g) => g.status === "Active")
                    .map((g) => ({ value: g.id, label: g.name })),
                )}
                {field("title", t("Assessment title"))}
                {select("type", "Assessment type", [
                  "Technical",
                  "Coaching",
                  "Final",
                ])}
                {field("max_score", t("Maximum score"), "number")}
                {field("pass_score", t("Pass score"), "number")}
                {field("due_at", t("Due at"), "datetime-local")}
              </>
            )}
            {modal?.action === "assessment_result" && (
              <>
                {select(
                  "assessment_id",
                  "Open assessment",
                  (d.assessments || [])
                    .filter((a: Row) => a.status === "Open")
                    .map((a: Row) => ({
                      value: a.id,
                      label: `${a.title} · ${a.group_id}`,
                    })),
                )}
                {select(
                  "student_id",
                  "Learner",
                  assessmentStudents.map((s) => ({
                    value: s.id,
                    label: `${s.name} · ${s.id}`,
                  })),
                )}
                {field("score", t("Score"), "number")}
                {field("notes", t("Assessment notes"))}
              </>
            )}
            {modal?.action === "issue_certificate" && (
              <>
                {select(
                  "student_id",
                  "Graduate closed learner",
                  students
                    .filter(
                      (s) =>
                        s.lifecycle === "Graduate Closed" &&
                        !(d.certificates || []).some(
                          (c: Row) => c.student_id === s.id,
                        ),
                    )
                    .map((s) => ({
                      value: s.id,
                      label: `${s.name} · ${s.graduation || "Not calculated"}`,
                    })),
                )}
                {select("type", "Certificate type", [
                  "Completion",
                  "Achievement",
                  "$300 Graduate",
                ])}
                {field("external_ref", t("External certificate reference"))}
              </>
            )}
            {modal?.action === "post_program_outcome" && (
              <>
                {select(
                  "student_id",
                  "Closed learner",
                  students
                    .filter((s) =>
                      [
                        "Graduate Closed",
                        "Non-Graduate Closed",
                        "Withdrawn",
                        "Removed",
                      ].includes(s.lifecycle) &&
                      (allowed(["Project Operations", "Operations Coordinator"]) || outcomeGroupIds.has(s.group_id)),
                    )
                    .map((s) => ({
                      value: s.id,
                      label: `${s.name} · ${s.lifecycle}`,
                    })),
                )}
                {select("type", "Outcome type", [
                  "Employment",
                  "Freelancing",
                  "Internship",
                  "Business",
                  "Other",
                ])}
                {field("title", t("Role / outcome title"))}
                {field("organization", t("Organization / client"), "text", false)}
                {field("value", t("Value"), "number", false)}
                {field("currency", t("Currency"), "text", false)}
                {select("status", "Verification status", [
                  "Reported",
                  "Verified",
                  "Follow-up due",
                  "Closed",
                ])}
                {form.status === "Verified" &&
                  select(
                    "proof_id",
                    "Verification proof",
                    (d.attachments || [])
                      .filter((a: Row) => a.student_id === form.student_id)
                      .map((a: Row) => ({ value: a.id, label: a.name })),
                  )}
                {select(
                  "owner",
                  "Outcome owner",
                  staff.map((s) => ({ value: s.id, label: s.name })),
                )}
                {field("follow_up_at", t("Next follow-up"), "datetime-local")}
              </>
            )}
            {modal?.action === "withdrawal_decision" && (
              <>
                {select(
                  "student_id",
                  "Learner",
                  students
                    .filter(
                      (s) => !["Withdrawn", "Removed"].includes(s.lifecycle),
                    )
                    .map((s) => ({
                      value: s.id,
                      label: `${s.name} · ${s.lifecycle}`,
                    })),
                )}
                {field("ministry_reference", t("Ministry decision reference"))}
                {select("decision", "Ministry decision", [
                  "Approved",
                  "Declined",
                ])}
                {field("decided_at", t("Decision date"), "date")}
                {field("reason", t("Decision reason"))}
              </>
            )}
            {modal?.action === "group_close" && (
              <>
                {field("reason", t("Closure reason"))}
                <p className="footnote">
                  {t("The system will block closure until all learners, actions, cases, gigs and evidence are reconciled.")}
                </p>
              </>
            )}
            {modal?.action === "group_archive" && (
              <>
                {field("reason", t("Archive authority and reason"))}
                <p className="footnote">
                  {t("Archive is read-only. No retention period or deletion rule is assumed.")}
                </p>
              </>
            )}
            {modal?.action === "report_definition" && (
              <>
                {field("name", t("Ministry report format name"))}
                {checklist("columns", d.reportFields || [])}
                {field("reason", t("Authority / change reason"))}
              </>
            )}
            {modal?.action === "approve_report_definition" && (
              <>
                <div className="info-box">
                  <strong>{(d.reportDefinitions || []).find((r: Row) => r.id === form.id)?.name}</strong>
                  <span>{t("Independent approval activates this version and supersedes the previous format.")}</span>
                </div>
                {field("reason", t("Approval authority and reason"))}
              </>
            )}
            {modal?.action === "bulk_group_owner" && (
              <>
                {textarea("group_ids", "Group IDs", "G101, G102, G103")}
                {select(
                  "owner_type",
                  "Ownership field",
                  allowed(["Project Operations"])
                    ? ["Coordinator", "Supervisor", "Coach"]
                    : allowed(["Coach Operations"])
                      ? ["Coach"]
                      : ["Coordinator"],
                )}
                {select(
                  "owner",
                  "New owner",
                  staff
                    .filter((s) =>
                      JSON.parse(s.roles).includes(
                        form.owner_type === "Supervisor"
                          ? "Team Supervisor"
                          : form.owner_type === "Coach"
                            ? "Coach"
                            : "Operations Coordinator",
                      ),
                    )
                    .map((s) => ({ value: s.id, label: s.name })),
                )}
                {field("reason", t("Bulk ownership reason"))}
              </>
            )}
            {modal?.action === "bulk_classification" && (
              <>
                {textarea("student_ids", "Student IDs", "S10001, S10002, S10003")}
                {select("status", "Engagement classification", ["Active", "At Risk", "Critical"])}
                {field("reason", t("Classification reason"))}
              </>
            )}
            {modal?.action === "bulk_tasks" && (
              <>
                {textarea("student_ids", "Student IDs", "S10001, S10002, S10003")}
                {field("title", t("Task title"))}
                {select("owner", "Task owner", staff.map((s) => ({ value: s.id, label: s.name })))}
                {field("due", t("Due at"), "datetime-local")}
                {select("priority", "Priority", ["Normal", "High", "Critical"])}
                {field("reason", t("Bulk task reason"))}
              </>
            )}
            <div className="form-footer">
              <span>{t("Recorded in audit history")}</span>
              <button
                type="button"
                className="small-btn"
                onClick={() => setModal(null)}
              >
                {t("Cancel")}
              </button>
              <button className="primary" disabled={busy} type="submit">
                {busy ? t("Saving…") : t("Save record")}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
