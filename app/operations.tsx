"use client";
import {
  ControlCenter,
  ReportsPanel,
  CredentialPanel,
  NotificationCenter,
  GlobalSearch,
  RetentionPanel,
} from "./control-center";
import { ProgramFlow } from "./program-flow";
import { useState, useEffect } from "react";
import {
  Home,
  CheckCheck,
  Users,
  Layers,
  CalendarDays,
  WalletCards,
  BriefcaseBusiness,
  Files,
  ShieldCheck,
  Flag,
  ChartNoAxesCombined,
  Settings2,
  Search,
  Bell,
  Plus,
  ArrowUpRight,
  ArrowRight,
  ChevronRight,
  Clock3,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Download,
  Filter,
  MessageSquare,
  Paperclip,
  ExternalLink,
  RefreshCw,
  GraduationCap,
  LockKeyhole,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  roles,
  rejectionCodes,
  can,
  policy as baselinePolicy,
  controlledPlatforms,
} from "@/lib/domain/rules";
import { readSheet, toCSV, toXLSX } from "@/lib/spreadsheet";
type Row = Record<string, any>;
const nav = [
  ["home", "Overview", Home],
  ["program", "Program flow", Flag],
  ["work", "My work", CheckCheck],
  ["students", "Students", Users],
  ["groups", "Groups", Layers],
  ["sessions", "Sessions", CalendarDays],
  ["accounts", "Accounts", WalletCards],
  ["gigs", "Gigs & services", BriefcaseBusiness],
  ["evidence", "Evidence", Files],
  ["quality", "Quality review", ShieldCheck],
  ["cases", "Cases", Flag],
  ["reports", "Reports", ChartNoAxesCombined],
  ["administration", "Administration", Settings2],
] as const;
const moduleAction: Row = {
  students: "student",
  groups: "group",
  sessions: "session",
  accounts: "account_request",
  gigs: "gig",
  evidence: "evidence",
  cases: "case",
  work: "task",
  administration: "staff",
};
const titles: Row = {
  contact: "Log student contact",
  task: "Create next action",
  student: "Add student",
  group: "Create group",
  session: "Schedule session",
  session_reschedule: "Reschedule session",
  session_cancel: "Cancel session",
  account_request: "Request a client account",
  account: "Add client account",
  reserve_account: "Reserve eligible account",
  allocate: "Allocate account",
  gig: "Record external gig",
  gig_transition: "Record client activity",
  evidence: "Submit evidence",
  review: "Review evidence",
  case: "Open a case",
  case_transition: "Update case",
  engagement: "Review engagement status",
  lifecycle: "Update lifecycle status",
  staff: "Manage staff access",
  attendance: "Record attendance",
  milestone: "Update coaching milestone",
  transfer: "Transfer student",
  task_bank: "Add approved controlled task",
  group_gate: "Record weekly group gate",
  fx_rate: "Create FX rate draft",
  fx_rate_approve: "Approve FX rate",
  fx_apply: "Apply approved FX conversion",
  policy: "Create policy draft",
  policy_edit: "Edit policy draft",
  account_status: "Change account status",
  refund_credit: "Refund account credit",
  policy_transition: "Progress policy review",
  group_close: "Close group",
  service_qc_review: "Review student service link",
};
const actionCopy: Row = {
  contact: "Screenshot proof, an outcome and a next action are required.",
  allocate: "Eligibility and account reuse are checked before allocation.",
  review: "Record a decision and clear correction guidance.",
  gig_transition:
    "Attach a screenshot of this activity before progressing the gig.",
  staff: "Access changes take effect immediately and are audited.",
  evidence: "Only completed, paid gigs can enter the review pipeline.",
  session:
    "Sessions follow the group delivery model, approved duration and coach-assignment controls.",
  session_reschedule:
    "Changing the date or coach requires a reason and resets coach confirmation.",
  session_cancel:
    "Cancelled sessions remain in the operational history and require a reason.",
  service_qc_review:
    "Lock a correct link or leave a clear correction comment for the student.",
};
const fmt = (v: string) =>
  v
    ? new Date(v).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "Not recorded";
const today = () => new Date().toISOString().slice(0, 10);
const programDay = (value: Date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const future = () => new Date(Date.now() + 86400000).toISOString().slice(0, 16);
const weeklyGateChecks = [
  "Current statuses recorded",
  "Next action and due date",
  "Valid contact within 7 days",
  "Account duplicate controls passed",
  "Rejected evidence has correction owner",
  "At Risk and Critical intervention owner",
  "Supervisor exception review complete",
];
function Badge({ value }: { value: any }) {
  return (
    <span
      className={
        "badge " +
        (/Critical|Rejected|Overdue|Blocked|S1|S2|Unresponsive/.test(value)
          ? "red"
          : /Risk|Pending|Submitted|Review|Waiting|Delayed|Funding/.test(value)
            ? "amber"
            : /Accepted|Graduat|Complete|Available|Present|On Track/.test(value)
              ? "green"
              : "neutral")
      }
    >
      {value}
    </span>
  );
}
function Pick({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  options: (string | { value: string; label: string })[];
  label: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="pick" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => {
          const a = typeof o === "string" ? { value: o, label: o } : o;
          return (
            <SelectItem key={a.value} value={a.value}>
              {a.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
function Empty({
  title = "Nothing waiting here",
  text = "Records will appear as your team progresses through the workflow.",
}) {
  return (
    <div className="empty">
      <CheckCircle2 size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function saveBlob(bytes: any, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export default function Operations({ module }: { module: string }) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Row | null>(null),
    [modal, setModal] = useState<Row | null>(null),
    [form, setForm] = useState<Row>({}),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [notifications, setNotifications] = useState(false),
    [importOpen, setImportOpen] = useState(false),
    [importModule, setImportModule] = useState("students"),
    [importRows, setImportRows] = useState<Row[]>([]),
    [preview, setPreview] = useState<Row | null>(null),
    [importId, setImportId] = useState(""),
    [serviceFilters, setServiceFilters] = useState<Row>({ platform: "All", track: "All", group: "All", coordinator: "All", age: "All", automatic: "All", corrections: "All" }),
    [saved, setSaved] = useState<string[]>([]);
  async function refresh() {
    try {
      setError("");
      const r = await fetch("/api/operations");
      const d = await r.json();
      if (d.error) throw Error(d.error);
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    setSaved(JSON.parse(localStorage.getItem("depi-saved-filters") || "[]"));
  }, []);
  useEffect(() => setPage(1), [search, filter, module]);
  const d = data || {};
  const staff = d.staff || [];
  const user = d.user || { roles: [], name: "Staff member" };
  const students: Row[] = d.students || [];
  const groups: Row[] = d.groups || [];
  const tasks: Row[] = d.tasks || [];
  const evidence: Row[] = d.evidence || [];
  const gigs: Row[] = d.gigs || [];
  const sessions: Row[] = d.sessions || [];
  const attendance: Row[] = d.attendance || [];
  const groupCoaches: Row[] = d.groupCoaches || [];
  const serviceLinks: Row[] = d.serviceLinks || [];
  const serviceLinkReviews: Row[] = d.serviceLinkReviews || [];
  const openTasks = tasks.filter((t) => t.status === "Open");
  const overdue = openTasks.filter((t) => t.due < new Date().toISOString());
  const dueToday = openTasks.filter((t) => t.due.slice(0, 10) === today());
  const noContact = students.filter((s) => s.contact_due);
  const critical = students.filter((s) => s.risk.status === "Critical");
  const atRisk = students.filter((s) => s.risk.status === "At Risk");
  const graduates = students.filter((s) => s.graduation.includes("Graduate"));
  const accepted = evidence.filter((e) => e.status === "Accepted");
  const reviews = evidence.filter((e) =>
    ["Coach Review", "Coordinator L1", "Quality Review", "L3 Review"].includes(
      e.status,
    ),
  );
  const rejected = evidence.filter((e) => e.status === "Rejected");
  const activeCount = students.filter((s) => s.lifecycle === "Active").length;
  const compliance = activeCount
    ? Math.round(((activeCount - noContact.length) / activeCount) * 100)
    : 0;
  const name = (id: string) =>
    students.find((s) => s.id === id)?.name || id || "—";
  const owner = (id: string) =>
    staff.find((s: Row) => s.id === id)?.name || "Unassigned";
  const shownNav = nav.filter(([m]) =>
    m === "administration"
      ? can(user.roles, ["Operations Systems / Admin"])
      : m === "quality"
        ? can(user.roles, [
            "Quality Member",
            "Quality Lead",
            "Project Operations",
          ])
        : m === "accounts"
          ? can(user.roles, [
              "Higher Board",
              "Project Operations",
              "Operations Coordinator",
              "Operations Systems / Admin",
            ])
          : true,
  );
  function open(action: string, row: Row = {}) {
    setModal({ action, ...row });
    setForm({
      ...row,
      student_id: row.student_id || selected?.id || "",
      owner: row.owner || user.id,
      due: row.due?.slice(0, 16) || future(),
      occurred_at: new Date().toISOString().slice(0, 16),
      channel: "WhatsApp",
      outcome: "Responded",
      pathway: "Outcome",
      delivery_model: row.delivery_model || "Regular",
      currency: "USD",
      coach_id: row.coach_id || "",
      duration_minutes:
        row.duration_minutes || baselinePolicy.sessionMinutes,
      starts_at: row.starts_at?.slice(0, 16) || "",
      reason: "",
      status: row.status || "",
      checklist: [],
      config: row.config ? JSON.parse(row.config) : { ...baselinePolicy },
    });
    setFormError("");
  }
  async function mutate(action: string, values: Row) {
    const r = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...values,
        action,
        request_id: crypto.randomUUID(),
      }),
    });
    const v = await r.json();
    if (v.error) throw Error(v.error);
    return v;
  }
  async function submit(e: any) {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const f = { ...form };
      for (const k of ["due", "occurred_at", "starts_at"])
        if (f[k]) f[k] = new Date(f[k]).toISOString();
      await mutate(modal!.action, f);
      toast.success("Saved to the activity history");
      setModal(null);
      await refresh();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function quick(action: string, row: Row) {
    setBusy(true);
    try {
      const result = await mutate(action, row);
      toast.success(
        action === "policy_check"
          ? `${result.summary.processed} policy actions processed${result.summary.remaining ? " · Run again for " + result.summary.remaining + " remaining" : ""}`
          : action === "load_demo_data"
            ? `Synthetic pilot loaded · ${result.summary.students} students across ${result.summary.groups} groups`
          : "Updated",
      );
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File, target = "proof_id") {
    setBusy(true);
    setFormError("");
    try {
      if (!form.student_id)
        throw Error("Choose the student before uploading proof.");
      const f = new FormData();
      f.append("file", file);
      f.append("student_id", form.student_id);
      f.append(
        "activity_type",
        modal?.action === "gig_transition"
          ? form.status || "Client activity"
          : modal?.action === "contact"
            ? "Student contact"
            : modal?.action === "evidence"
              ? "Evidence submission"
              : "Supporting evidence",
      );
      f.append(
        "occurred_at",
        form.occurred_at
          ? new Date(form.occurred_at).toISOString()
          : new Date().toISOString(),
      );
      f.append(
        "source",
        form.channel || form.source || form.platform || "Staff upload",
      );
      f.append("performed_by_type", form.performed_by || "STUDENT");
      if (modal?.action === "gig_transition") {
        f.append("gig_id", modal.id);
        if (modal.account_id) f.append("account_id", modal.account_id);
        if (modal.platform) f.append("platform", modal.platform);
      } else if (form.gig_id) f.append("gig_id", form.gig_id);
      const r = await fetch("/api/files", { method: "POST", body: f });
      const x = await r.json();
      if (x.error) throw Error(x.error);
      setForm((v) => ({
        ...v,
        [target]: x.id,
        [`${target}_name`]: x.name,
      }));
      toast.success("Screenshot uploaded securely");
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function field(key: string, label: string, type = "text", required = true) {
    return (
      <label className="field" key={key}>
        {label}
        <input
          type={type}
          value={form[key] ?? ""}
          required={required}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      </label>
    );
  }
  function choice(key: string, label: string, opts: any[], required = true) {
    return (
      <label className="field" key={key}>
        {label}
        {required ? " *" : ""}
        <Pick
          label={label}
          value={form[key] || ""}
          onChange={(v) => setForm({ ...form, [key]: v })}
          options={opts}
        />
      </label>
    );
  }
  const studentPick = () =>
    choice(
      "student_id",
      "Student",
      students.map((s) => ({ value: s.id, label: s.name + " · " + s.id })),
    );
  const staffPick = (key = "owner", label = "Action owner") =>
    choice(
      key,
      label,
      staff.map((s: Row) => ({ value: s.id, label: s.name })),
    );
  const proofField = (key = "proof_id", label = "Screenshot proof") => (
    <div className="proof-field">
      <label className="field">{label} *</label>
      {form.student_id &&
        (d.attachments || []).filter(
          (a: Row) => a.student_id === form.student_id,
        ).length > 0 &&
        choice(
          key,
          `Existing ${label.toLowerCase()}`,
          (d.attachments || [])
            .filter((a: Row) => a.student_id === form.student_id)
            .map((a: Row) => ({ value: a.id, label: a.name })),
        )}
      <label className="upload">
        <Upload size={22} />
        <strong>
          {form[`${key}_name`] || `Upload ${label.toLowerCase()}`}
        </strong>
        <span>PNG or JPEG · up to 8 MB</span>
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(e) =>
            e.target.files?.[0] && upload(e.target.files[0], key)
          }
        />
      </label>
      {form[key] && (
        <span className="proof-ready">
          <CheckCircle2 size={15} /> Screenshot linked to this student
        </span>
      )}
    </div>
  );
  function routeQueue(q: string) {
    window.location.assign("/work?queue=" + encodeURIComponent(q));
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search),
      q = p.get("queue"),
      s = p.get("q");
    if (q) setFilter(q);
    if (s) setSearch(s);
  }, []);
  const qMatch = (r: Row) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
  const selectedStudent = selected
    ? students.find((s) => s.id === selected.id) || selected
    : null;
  function studentRows(rows: Row[]) {
    return (
      <div className="student-list">
        {rows.map((s) => (
          <button
            className="student-row"
            key={s.id}
            onClick={() => setSelected(s)}
          >
            <span
              className={
                "avatar " + (s.risk.status === "Critical" ? "rose" : "")
              }
            >
              {s.name
                .split(" ")
                .slice(0, 2)
                .map((v: string) => v[0])
                .join("")}
            </span>
            <span className="student-identity">
              <strong>{s.name}</strong>
              <small>
                {s.id} <span>·</span> {s.track}
              </small>
            </span>
            <span className="student-next">
              <span>{s.next_task?.title || "No next action"}</span>
              <small>
                {s.coordinator_name} ·{" "}
                {s.next_task ? fmt(s.next_task.due) : "Assign an action"}
              </small>
            </span>
            <Badge value={s.risk.status} />
            <ChevronRight size={17} />
          </button>
        ))}
      </div>
    );
  }
  function taskRows(rows: Row[]) {
    return rows.length ? (
      <div className="task-list">
        {rows.map((t) => (
          <article className="task-row" key={t.id}>
            <button
              className="complete"
              aria-label={"Complete " + t.title}
              disabled={busy}
              onClick={() => quick("complete_task", { id: t.id })}
            >
              <CheckCheck size={17} />
            </button>
            <div className="task-main">
              <strong>{t.title}</strong>
              <button
                className="text-link muted"
                onClick={() =>
                  setSelected(
                    students.find((s) => s.id === t.student_id) || null,
                  )
                }
              >
                {name(t.student_id)} <span>· {t.category}</span>
              </button>
            </div>
            <span className="task-owner">{owner(t.owner)}</span>
            <span
              className={t.due < new Date().toISOString() ? "due late" : "due"}
            >
              <Clock3 size={14} />
              {fmt(t.due)}
            </span>
            {t.category === "Contact" ? (
              <button
                className="small-btn"
                onClick={() => open("contact", { student_id: t.student_id })}
              >
                Log contact
              </button>
            ) : (
              <button
                className="icon-btn"
                aria-label="Open student"
                onClick={() =>
                  setSelected(
                    students.find((s) => s.id === t.student_id) || null,
                  )
                }
              >
                <ArrowUpRight size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
    ) : (
      <Empty />
    );
  }
  function panel(title: string, content: any, extra?: any) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h2>{title}</h2>
          {extra}
        </div>
        {content}
      </section>
    );
  }
  function paginate(rows: Row[], render: (r: Row[]) => any) {
    return (
      <>
        {render(rows.slice((page - 1) * 25, page * 25))}
        <div className="pagination">
          <span>
            {rows.length
              ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, rows.length)}`
              : "0"}{" "}
            of {rows.length} records
          </span>
          <div>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button
              disabled={page * 25 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </>
    );
  }
  function generic(
    rows: Row[],
    cols: { key: string; label: string; render?: (r: Row) => any }[],
    action?: (r: Row) => any,
  ) {
    return rows.length ? (
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c.key}>{c.label}</TableHead>
            ))}
            {action && (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.id || i}>
              {cols.map((c) => (
                <TableCell key={c.key}>
                  {c.render ? c.render(r) : String(r[c.key] ?? "—")}
                </TableCell>
              ))}
              {action && <TableCell>{action(r)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : (
      <Empty />
    );
  }
  const studentCol = {
    key: "student_id",
    label: "Student",
    render: (r: Row) => (
      <button
        className="table-name"
        onClick={() =>
          setSelected(students.find((s) => s.id === r.student_id) || null)
        }
      >
        {name(r.student_id)}
        <small>{r.student_id}</small>
      </button>
    ),
  };
  const statusCol = {
    key: "status",
    label: "Status",
    render: (r: Row) => <Badge value={r.status} />,
  };
  const filterOpts =
    module === "students"
      ? ["All", "Active", "At Risk", "Critical", "No Contact", "Graduated"]
      : module === "work"
        ? [
            "All",
            "Due Today",
            "Overdue",
            "No Contact",
            "At Risk",
            "Critical",
            "Rejected Evidence",
            "Evidence Blocker",
            "Account Requests Pending",
            "Open Escalations",
          ]
        : module === "quality" || module === "evidence"
          ? [
              "All",
              "Coach Review",
              "Coordinator L1",
              "Quality Review",
              "Rejected",
              "L3 Review",
              "Accepted",
            ]
          : module === "sessions"
            ? ["All", "Scheduled", "Confirmed", "Completed", "Cancelled"]
          : ["All"];
  let content: any;
  if (module === "home") {
    const stats = [
      {
        label: "Active students",
        value: students.length,
        detail: `${groups.length} assigned groups`,
        icon: Users,
        q: "All",
      },
      {
        label: "Contact compliance",
        value: compliance + "%",
        detail: `${noContact.length} students need contact`,
        icon: MessageSquare,
        q: "No Contact",
      },
      {
        label: "Evidence waiting",
        value: reviews.length,
        detail: `${rejected.length} require correction`,
        icon: Files,
        q: "Evidence Blocker",
      },
      {
        label: "Graduation progress",
        value: graduates.length,
        detail: `${students.length ? Math.round((graduates.length / students.length) * 100) : 0}% achieved · 85% target`,
        icon: GraduationCap,
        q: "All",
      },
    ];
    content = (
      <>
        <div className="greeting">
          <div>
            <div className="eyebrow">ROUND 5 / OPERATIONS OVERVIEW</div>
            <h1>Keep every student moving.</h1>
            <p>Your team’s priorities, progress and exceptions in one place.</p>
          </div>
          <button className="primary" onClick={() => open("contact")}>
            <Plus size={18} /> Log contact
          </button>
        </div>
        <div className="stats">
          {stats.map((s) => (
            <button
              className="stat"
              key={s.label}
              onClick={() => routeQueue(s.q)}
            >
              <div>
                <span>{s.label}</span>
                <s.icon size={19} />
              </div>
              <strong>{s.value}</strong>
              <small>{s.detail}</small>
            </button>
          ))}
        </div>
        <div className="home-grid">
          <div className="main-column">
            <section className="priorities">
              <div className="panel-heading">
                <div>
                  <div className="eyebrow">START HERE</div>
                  <h2>Today needs your attention</h2>
                </div>
                <a className="text-link" href="/work">
                  View my work <ArrowRight size={16} />
                </a>
              </div>
              <div className="priority-grid">
                {[
                  {
                    q: "Overdue",
                    n: overdue.length,
                    text: "Overdue actions",
                    icon: Clock3,
                    color: "red",
                  },
                  {
                    q: "Critical",
                    n: critical.length,
                    text: "Critical students",
                    icon: AlertTriangle,
                    color: "amber",
                  },
                  {
                    q: "Due Today",
                    n: dueToday.length,
                    text: "Due today",
                    icon: CheckCheck,
                    color: "blue",
                  },
                ].map((c) => (
                  <button
                    key={c.q}
                    className={"priority " + c.color}
                    onClick={() => routeQueue(c.q)}
                  >
                    <c.icon size={19} />
                    <strong>{c.n}</strong>
                    <span>{c.text}</span>
                    <ArrowUpRight size={16} />
                  </button>
                ))}
              </div>
            </section>
            {panel(
              "Next actions",
              taskRows([...overdue, ...dueToday].slice(0, 5)),
              <a href="/work" className="text-link">
                View all <ChevronRight size={16} />
              </a>,
            )}
            {panel(
              "Students needing intervention",
              studentRows(critical.slice(0, 4)),
              <span className="count">{critical.length}</span>,
            )}
          </div>
          <div className="side-column">
            <section className="journey-card">
              <div className="eyebrow">COHORT JOURNEY</div>
              <h2>Progress with proof.</h2>
              <p>Only Quality-accepted gigs count toward graduation.</p>
              <div className="journey-total">
                <strong>{graduates.length}</strong>
                <span>
                  of {students.length} students
                  <br />
                  graduated
                </span>
              </div>
              <Progress
                value={
                  students.length
                    ? (graduates.length / students.length) * 100
                    : 0
                }
              />
              <div className="target-line">
                <span>Current progress</span>
                <span>Target 85%</span>
              </div>
              <div className="journey-stages">
                {["0/3", "1/3", "2/3", "Graduated"].map((v, i) => (
                  <div key={v}>
                    <span>
                      <i className={"stage-dot dot-" + i} />
                      {v === "Graduated" ? "Graduated" : v + " qualifying gigs"}
                    </span>
                    <strong>
                      {v === "Graduated"
                        ? graduates.length
                        : students.filter((s) => s.graduation === v).length}
                    </strong>
                  </div>
                ))}
              </div>
              <a href="/reports">
                Explore graduation report <ArrowRight size={16} />
              </a>
            </section>
            {panel(
              "Upcoming sessions",
              <div className="session-mini">
                {(d.sessions || []).slice(0, 3).map((s: Row) => (
                  <a key={s.id} href="/sessions">
                    <span className="calendar-stamp">
                      <strong>{new Date(s.starts_at).getDate()}</strong>
                      <small>
                        {new Date(s.starts_at).toLocaleDateString("en", {
                          month: "short",
                        })}
                      </small>
                    </span>
                    <span>
                      <strong>{s.group_id} · Delivery clinic</strong>
                      <small>
                        {new Date(s.starts_at).toLocaleTimeString("en", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · Week {s.week}
                      </small>
                    </span>
                  </a>
                ))}
              </div>,
            )}
            <div className="policy-note">
              <ShieldCheck size={20} />
              <div>
                <strong>Every action has a trail</strong>
                <p>Round 5 policy v1 · Staff access only</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  } else if (module === "program") {
    content = <ProgramFlow />;
  } else if (module === "students") {
    const rows = students
      .filter(qMatch)
      .filter(
        (s) =>
          filter === "All" ||
          (filter === "No Contact" && noContact.includes(s)) ||
          (filter === "Graduated" && s.graduation.includes("Graduate")) ||
          s.risk.status === filter,
      );
    content = panel(
      "Student directory",
      paginate(rows, studentRows),
      <span className="count">{rows.length}</span>,
    );
  } else if (module === "work") {
    let rows = openTasks.filter(qMatch);
    if (filter === "Overdue")
      rows = rows.filter((t) => t.due < new Date().toISOString());
    if (filter === "Due Today")
      rows = rows.filter((t) => t.due.slice(0, 10) === today());
    if (["No Contact", "At Risk", "Critical"].includes(filter)) {
      const ids = new Set(
        (filter === "No Contact"
          ? noContact
          : filter === "Critical"
            ? critical
            : atRisk
        ).map((s) => s.id),
      );
      rows = rows.filter((t) => ids.has(t.student_id));
    }
    if (filter === "Rejected Evidence")
      rows = rows.filter((t) => t.category === "Correction");
    if (filter === "Evidence Blocker")
      rows = rows.filter((t) =>
        evidence.some(
          (e) =>
            e.student_id === t.student_id &&
            !["Accepted", "Closed L3"].includes(e.status),
        ),
      );
    if (filter === "Account Requests Pending")
      rows = rows.filter((t) =>
        (d.requests || []).some(
          (r: Row) => r.student_id === t.student_id && r.status === "Submitted",
        ),
      );
    if (filter === "Open Escalations")
      rows = rows.filter((t) =>
        (d.cases || []).some(
          (c: Row) => c.student_id === t.student_id && c.status !== "Closed",
        ),
      );
    content = (
      <>
        <div className="queue-tabs">
          {["All", "Overdue", "Due Today", "No Contact"].map((q) => (
            <button
              className={filter === q ? "active" : ""}
              key={q}
              onClick={() => setFilter(q)}
            >
              {q}
              <span>
                {q === "All"
                  ? openTasks.length
                  : q === "Overdue"
                    ? overdue.length
                    : q === "Due Today"
                      ? dueToday.length
                      : noContact.length}
              </span>
            </button>
          ))}
        </div>
        {panel(
          filter === "All" ? "Open actions" : filter,
          paginate(
            rows.sort((a, b) => a.due.localeCompare(b.due)),
            taskRows,
          ),
        )}
      </>
    );
  } else if (module === "groups") {
    content = (
      <div className="group-grid">
        {groups.filter(qMatch).map((g) => {
          const ss = students.filter((s) => s.group_id === g.id);
          const cc = ss.filter((s) => s.risk.status === "Critical").length;
          return (
            <section className="panel group-card" key={g.id}>
              <div className="group-top">
                <span className="group-icon">
                  <Layers size={22} />
                </span>
                <Badge value={g.trajectory} />
              </div>
              <small>
                {g.id} · {g.provider}
              </small>
              <h2>{g.name}</h2>
              <p>
                {g.pathway} pathway · {g.delivery_model || "Regular"} delivery · Week {g.week}
              </p>
              <p className="footnote">{g.trajectory_reason}</p>
              <div className="group-metrics">
                <span>
                  <strong>{ss.length}</strong> Students
                </span>
                <span>
                  <strong>{cc}</strong> Critical
                </span>
                <span>
                  <strong>
                    {ss.filter((s) => s.graduation.includes("Graduate")).length}
                  </strong>{" "}
                  Graduated
                </span>
              </div>
              <div className="group-owners">
                <span>
                  Coordinator <strong>{g.coordinator_name}</strong>
                </span>
                <span>
                  Coach <strong>{g.coach_name}</strong>
                </span>
              </div>
              <div className="detail-actions">
                <button
                  className="group-link"
                  onClick={() => {
                    window.location.href = "/students?queue=All";
                    sessionStorage.setItem("depi-group-search", g.id);
                  }}
                >
                  Open student group <ArrowRight size={16} />
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("group_gate", { group_id: g.id, week: g.week })
                  }
                >
                  Weekly gate
                </button>
              </div>
            </section>
          );
        })}
      </div>
    );
  } else if (module === "sessions") {
    const activeSessions = sessions.filter((s) => s.status !== "Cancelled");
    const missingAttendance = activeSessions.filter((session) => {
      if (Date.parse(session.starts_at) > Date.now()) return false;
      const expected = students.filter(
        (student) =>
          student.group_id === session.group_id &&
          student.lifecycle === "Active",
      ).length;
      const recorded = new Set(
        attendance
          .filter((row) => row.session_id === session.id)
          .map((row) => row.student_id),
      ).size;
      return expected > recorded;
    });
    const coverageGaps = groups.filter(
      (group) =>
        group.status === "Active" &&
        !groupCoaches.some(
          (coach) =>
            coach.group_id === group.id &&
            coach.status === "Active" &&
            coach.onboarding_status === "Complete",
        ),
    );
    const sessionRows = sessions
      .filter(qMatch)
      .filter((session) => filter === "All" || session.status === filter)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    content = (
      <>
        <div className="mini-stats session-stats">
          <span>
            <strong>
              {
                activeSessions.filter(
                  (session) =>
                    (session.session_day ||
                      programDay(new Date(session.starts_at))) === programDay(),
                ).length
              }
            </strong>
            Sessions today
          </span>
          <span>
            <strong>
              {sessions.filter((session) => session.status === "Scheduled").length}
            </strong>
            Unconfirmed coaches
          </span>
          <span>
            <strong>{missingAttendance.length}</strong>
            Missing attendance
          </span>
          <span>
            <strong>
              {sessions.filter((session) => session.status === "Cancelled").length}
            </strong>
            Cancelled sessions
          </span>
          <span>
            <strong>
              {
                evidence.filter(
                  (item) =>
                    item.status === "Coach Review" &&
                    Date.now() - Date.parse(item.stage_at) > 24 * 3600000,
                ).length
              }
            </strong>
            Coach evidence &gt;24h
          </span>
          <span>
            <strong>{coverageGaps.length}</strong>
            Coverage gaps
          </span>
        </div>
        {panel(
          "Session schedule",
          generic(
            sessionRows,
        [
          {
            key: "starts_at",
            label: "Date & time",
            render: (r) => (
              <>
                <strong>{fmt(r.starts_at)}</strong>
                <small className="block">
                  {new Date(r.starts_at).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </small>
              </>
            ),
          },
          { key: "title", label: "Session" },
          { key: "group_id", label: "Group" },
          {
            key: "coach_id",
            label: "Coach",
            render: (r) => owner(r.coach_id),
          },
          { key: "week", label: "Week" },
          {
            key: "duration_minutes",
            label: "Duration",
            render: (r) => `${r.duration_minutes || 180} min`,
          },
          statusCol,
        ],
            (r) => (
          <div className="detail-actions">
            {r.status === "Scheduled" &&
              r.coach_id === user.id &&
              can(user.roles, ["Coach"]) && (
                <button
                  className="small-btn"
                  disabled={busy}
                  onClick={() => quick("session_confirm", { id: r.id })}
                >
                  Confirm
                </button>
              )}
            {["Scheduled", "Confirmed"].includes(r.status) &&
              can(user.roles, ["Coach Operations", "Project Operations"]) && (
                <>
                  <button
                    className="small-btn"
                    onClick={() => open("session_reschedule", r)}
                  >
                    Reschedule
                  </button>
                  <button
                    className="small-btn"
                    onClick={() => open("session_cancel", r)}
                  >
                    Cancel
                  </button>
                </>
              )}
            {r.status !== "Cancelled" &&
              Date.parse(r.starts_at) <= Date.now() && (
              <button
                className="small-btn"
                onClick={() => open("attendance", { session_id: r.id })}
              >
                Attendance
              </button>
            )}
          </div>
            ),
          ),
        )}
      </>
    );
  } else if (module === "accounts") {
    content = (
      <Tabs defaultValue="pool">
        <TabsList>
          <TabsTrigger value="pool">
            Account pool{" "}
            <span className="count">{(d.accounts || []).length}</span>
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests <span className="count">{(d.requests || []).length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pool">
          {panel(
            "Controlled client accounts",
            generic(
              (d.accounts || []).filter(qMatch),
              [
                {
                  key: "label",
                  label: "Account",
                  render: (r) => (
                    <>
                      <strong>{r.label}</strong>
                      <small className="block">{r.id}</small>
                    </>
                  ),
                },
                { key: "platform", label: "Platform" },
                statusCol,
                {
                  key: "credits",
                  label: "Available credit",
                  render: (r) => "$" + r.credits,
                },
              ],
              (r) => (
                <button
                  className="small-btn"
                  onClick={() => open("account_status", r)}
                >
                  Manage
                </button>
              ),
            ),
            <div className="detail-actions">
              {can(user.roles, ["Higher Board"]) && (
                <button className="small-btn" onClick={() => open("account")}>
                  Add account
                </button>
              )}
              {can(user.roles, [
                "Project Operations",
                "Operations Systems / Admin",
              ]) && (
                <button className="small-btn" onClick={() => open("task_bank")}>
                  Add approved task
                </button>
              )}
            </div>,
          )}
        </TabsContent>
        <TabsContent value="requests">
          {panel(
            "Account requests",
            generic(
              (d.requests || []).filter(qMatch),
              [
                studentCol,
                { key: "task", label: "Task" },
                { key: "platform", label: "Platform" },
                { key: "value", label: "Credit needed" },
                {
                  key: "status",
                  label: "Status",
                  render: (r) => {
                    const reservation = (d.reservations || []).find(
                      (z: Row) =>
                        z.request_id === r.id &&
                        z.status === "Active" &&
                        z.expires_at > new Date().toISOString(),
                    );
                    return (
                      <Badge value={reservation ? "Reserved" : r.status} />
                    );
                  },
                },
              ],
              (r) => {
                if (r.status !== "Submitted") return null;
                const reservation = (d.reservations || []).find(
                  (z: Row) =>
                    z.request_id === r.id &&
                    z.status === "Active" &&
                    z.expires_at > new Date().toISOString(),
                );
                return reservation ? (
                  <button
                    className="small-btn"
                    onClick={() =>
                      open("allocate", {
                        request: r.id,
                        student_id: r.student_id,
                        reservation_id: reservation.id,
                        account: reservation.account_id,
                      })
                    }
                  >
                    Approve allocation
                  </button>
                ) : (
                  <button
                    className="small-btn"
                    onClick={() =>
                      open("reserve_account", {
                        request: r.id,
                        student_id: r.student_id,
                      })
                    }
                  >
                    Reserve account
                  </button>
                );
              },
            ),
          )}
        </TabsContent>
      </Tabs>
    );
  } else if (module === "gigs") {
    content = panel(
      "Freelancing activity",
      generic(
        gigs.filter(qMatch),
        [
          studentCol,
          { key: "title", label: "Gig / service" },
          { key: "platform", label: "Platform" },
          {
            key: "value",
            label: "Value",
            render: (r) => {
              const fx = (d.fxApplications || []).find(
                (x: Row) => x.gig_id === r.id,
              );
              return (
                <>
                  {r.currency + " " + r.value}
                  {fx && (
                    <small className="block">Approved USD {fx.usd_value}</small>
                  )}
                </>
              );
            },
          },
          statusCol,
        ],
        (r) => (
          <div className="detail-actions">
            <button
              className="small-btn"
              onClick={() =>
                open("gig_transition", { ...r, student_id: r.student_id })
              }
            >
              Record activity
            </button>
            {r.currency !== "USD" &&
              can(user.roles, ["Project Operations"]) && (
                <button
                  className="small-btn"
                  onClick={() =>
                    open("fx_apply", { gig_id: r.id, currency: r.currency })
                  }
                >
                  Apply FX
                </button>
              )}
            {["Cancelled", "Failed"].includes(r.status) &&
              r.account_id &&
              can(user.roles, ["Higher Board"]) &&
              !(d.creditLedger || []).some(
                (x: Row) => x.gig_id === r.id && Number(x.delta) > 0,
              ) && (
                <button
                  className="small-btn"
                  onClick={() => open("refund_credit", r)}
                >
                  Refund credit
                </button>
              )}
          </div>
        ),
      ),
    );
  } else if (module === "evidence" || module === "quality") {
    const rows = evidence
      .filter(qMatch)
      .filter((e) => filter === "All" || e.status === filter)
      .sort((a, b) => a.stage_at.localeCompare(b.stage_at));
    const serviceQueue = serviceLinks
      .filter((r) => r.qc_status !== "Locked")
      .filter(qMatch)
      .filter((r) => serviceFilters.platform === "All" || r.platform === serviceFilters.platform)
      .filter((r) => serviceFilters.track === "All" || r.track === serviceFilters.track)
      .filter((r) => serviceFilters.group === "All" || r.group_id === serviceFilters.group)
      .filter((r) => serviceFilters.coordinator === "All" || r.coordinator === serviceFilters.coordinator)
      .filter((r) => serviceFilters.automatic === "All" || r.auto_status === serviceFilters.automatic)
      .filter((r) => serviceFilters.corrections === "All" || (serviceFilters.corrections === "Repeated" ? Number(r.correction_count) > 1 : Number(r.correction_count) === Number(serviceFilters.corrections)))
      .filter((r) => serviceFilters.age === "All" || Date.now() - Date.parse(r.updated_at) >= Number(serviceFilters.age) * 3600000);
    const reviewerWorkload = Object.entries(serviceLinkReviews.reduce((out: Row, review: Row) => {
      const key = review.reviewer_name || owner(review.reviewed_by);
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {})).sort((a: any, b: any) => b[1] - a[1]);
    content = (
      <>
        {module === "quality" && (
          <>
            <div className="mini-stats service-qc-stats">
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Pending").length}</strong>Awaiting QC</span>
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Needs Correction").length}</strong>Need student correction</span>
              <span><strong>{serviceLinks.filter((r) => r.auto_status === "Failed").length}</strong>Automatic check failed</span>
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Pending" && Date.now() - Date.parse(r.updated_at) > 48 * 3600000).length}</strong>Past 48-hour SLA</span>
            </div>
            <div className="filter-row service-qc-filters">
              <Pick label="Platform" value={serviceFilters.platform} onChange={(platform) => setServiceFilters({ ...serviceFilters, platform })} options={["All", "Kafiil", "Khamsat"]} />
              <Pick label="Track" value={serviceFilters.track} onChange={(track) => setServiceFilters({ ...serviceFilters, track })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.track).filter(Boolean)))]} />
              <Pick label="Group" value={serviceFilters.group} onChange={(group) => setServiceFilters({ ...serviceFilters, group })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.group_id).filter(Boolean)))]} />
              <Pick label="Coordinator" value={serviceFilters.coordinator} onChange={(coordinator) => setServiceFilters({ ...serviceFilters, coordinator })} options={[{ value: "All", label: "All coordinators" }, ...Array.from(new Set(serviceLinks.map((r) => r.coordinator).filter(Boolean))).map((id) => ({ value: id, label: owner(id) }))]} />
              <Pick label="Submission age" value={serviceFilters.age} onChange={(age) => setServiceFilters({ ...serviceFilters, age })} options={[{ value: "All", label: "Any age" }, { value: "24", label: "24+ hours" }, { value: "48", label: "48+ hours" }, { value: "168", label: "7+ days" }]} />
              <Pick label="Automatic check" value={serviceFilters.automatic} onChange={(automatic) => setServiceFilters({ ...serviceFilters, automatic })} options={["All", "Needs Review", "Failed"]} />
              <Pick label="Corrections" value={serviceFilters.corrections} onChange={(corrections) => setServiceFilters({ ...serviceFilters, corrections })} options={[{ value: "All", label: "Any revision" }, { value: "0", label: "No prior review" }, { value: "1", label: "One review" }, { value: "Repeated", label: "Repeated corrections" }]} />
            </div>
            {panel(
              `Student service-link verification · ${serviceQueue.length} matching`,
              paginate(serviceQueue, (pageRows) => generic(
                pageRows,
                [
                  { key: "student_name", label: "Student", render: (r) => <span><strong>{r.student_name}</strong><small className="table-subline">{r.student_id}</small></span> },
                  { key: "slot", label: "Slot", render: (r) => `Service ${r.slot}` },
                  { key: "url", label: "Link", render: (r) => <a className="text-link" href={r.url} target="_blank" rel="noreferrer">{r.platform} <ExternalLink size={14} /></a> },
                  { key: "auto_status", label: "Automatic check", render: (r) => <Badge value={r.auto_status} /> },
                  { key: "reviewer_name", label: "Assigned", render: (r) => r.reviewer_name || "Unassigned" },
                  { key: "qc_status", label: "QC state", render: (r) => <span><Badge value={r.qc_status} /><small className="table-subline">{Math.round((Date.now() - Date.parse(r.updated_at)) / 3600000)}h · revision {r.revision}</small></span> },
                ],
                (r) => <div className="detail-actions">{!r.qc_actor && can(user.roles, ["Quality Member", "Quality Lead"]) && <button className="small-btn" onClick={() => quick("service_qc_claim", { service_id: r.id })}>Claim</button>}<button className="small-btn" onClick={() => open("service_qc_review", { ...r, service_id: r.id, student_id: r.student_id, decision: r.qc_status === "Needs Correction" ? "Lock" : "" })}>Review</button>{r.qc_status === "Pending" && r.auto_status !== "Failed" && <button className="small-btn" onClick={() => window.confirm("Lock every format-passing pending link for this student after you have checked each page?") && quick("service_qc_lock_student", { student_id: r.student_id })}>Lock passing links</button>}</div>,
              )),
            )}
            {panel("QC reviewer activity", reviewerWorkload.length ? <div className="mini-stats">{reviewerWorkload.map(([reviewer, count]: any) => <span key={reviewer}><strong>{count}</strong>{reviewer}</span>)}</div> : <Empty title="No service-link reviews yet" />)}
          </>
        )}
        <div className="mini-stats">
          <span>
            <strong>{reviews.length}</strong> Awaiting review
          </span>
          <span>
            <strong>{rejected.length}</strong> Require correction
          </span>
          <span>
            <strong>{accepted.length}</strong> Accepted
          </span>
          <span>
            <strong>
              {
                reviews.filter(
                  (e) =>
                    Date.now() - Date.parse(e.stage_at) >
                    (e.status === "Quality Review" ? 48 : 24) * 3600000,
                ).length
              }
            </strong>{" "}
            Past review SLA
          </span>
        </div>
        {panel(
          module === "quality"
            ? "Quality review queue · oldest first"
            : "Evidence pipeline",
          generic(
            rows,
            [
              studentCol,
              { key: "gig_id", label: "Gig" },
              { key: "source", label: "External source" },
              statusCol,
              {
                key: "stage_at",
                label: "In stage since",
                render: (r) => fmt(r.stage_at),
              },
              {
                key: "proof_id",
                label: "Proof",
                render: (r) => (
                  <a
                    className="text-link"
                    target="_blank"
                    rel="noreferrer"
                    href={"/api/files?id=" + r.proof_id}
                  >
                    <Paperclip size={15} /> Screenshot
                  </a>
                ),
              },
            ],
            (r) => (
              <button className="small-btn" onClick={() => open("review", r)}>
                Open review
              </button>
            ),
          ),
        )}
      </>
    );
  } else if (module === "cases") {
    content = panel(
      "Incident & intervention register",
      generic(
        (d.cases || []).filter(qMatch),
        [
          { key: "title", label: "Case" },
          studentCol,
          {
            key: "severity",
            label: "Severity",
            render: (r) => <Badge value={r.severity} />,
          },
          statusCol,
          { key: "owner", label: "Owner", render: (r) => owner(r.owner) },
          { key: "due", label: "Due", render: (r) => fmt(r.due) },
        ],
        (r) => (
          <button
            className="small-btn"
            onClick={() => open("case_transition", r)}
          >
            Update
          </button>
        ),
      ),
    );
  } else if (module === "reports") {
    content = (
      <>
        <ReportsPanel />
        <div className="stats">
          {[
            { label: "Contact compliance", n: compliance + "%" },
            {
              label: "Graduation rate",
              n:
                (students.length
                  ? Math.round((graduates.length / students.length) * 100)
                  : 0) + "%",
            },
            { label: "Open actions", n: openTasks.length },
            { label: "Quality backlog", n: reviews.length },
          ].map((s) => (
            <div className="stat" key={s.label}>
              <span>{s.label}</span>
              <strong>{s.n}</strong>
              <small>Current assigned student scope</small>
            </div>
          ))}
        </div>
        {panel(
          "Coordinator performance",
          generic(
            staff
              .filter((u: Row) => u.roles.includes("Operations Coordinator"))
              .map((u: Row) => {
                const s = students.filter((s) => s.coordinator === u.id);
                return {
                  id: u.id,
                  name: u.name,
                  students: s.length,
                  contact: s.length
                    ? Math.round(
                        (s.filter((s) => s.last_contact && !s.contact_due)
                          .length /
                          s.length) *
                          100,
                      ) + "%"
                    : "—",
                  overdue: overdue.filter((t) => t.owner === u.id).length,
                  critical: s.filter((s) => s.risk.status === "Critical")
                    .length,
                  graduates: s.filter((s) => s.graduation.includes("Graduate"))
                    .length,
                };
              }),
            [
              { key: "name", label: "Coordinator" },
              { key: "students", label: "Students" },
              { key: "contact", label: "Contact compliance" },
              { key: "overdue", label: "Overdue" },
              { key: "critical", label: "Critical" },
              { key: "graduates", label: "Graduated" },
            ],
          ),
        )}
        <div className="report-grid">
          {panel(
            "Graduation policy",
            <div className="prose">
              <div className="rule-number">3 gigs × $5 minimum</div>
              <p>
                Total qualifying value of at least $15, or one qualifying gig of
                $300 or more.
              </p>
              <p>
                Evidence must be Quality Accepted, and the gig must be paid.
                Non-USD gigs count only after a separately approved rate is
                applied and stored with the gig.
              </p>
              <Badge value="Round 5 · v1" />
            </div>,
          )}
          {panel(
            "Metric definitions",
            <div className="prose">
              <h3>Contact compliance</h3>
              <p>
                Active students with a complete, screenshot-backed contact
                within 7 days ÷ active students requiring contact.
              </p>
              <h3>Graduation rate</h3>
              <p>
                Students meeting the applicable graduation policy ÷ active
                students in the selected scope.
              </p>
              <h3>Forecast</h3>
              <p>
                No forecast published until approved weekly milestone and
                forecasting policies are configured.
              </p>
            </div>,
          )}
        </div>
      </>
    );
  } else if (module === "administration") {
    content = (
      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Staff & access</TabsTrigger>
          <TabsTrigger value="policy">Policy versions</TabsTrigger>
          <TabsTrigger value="fx">FX rates</TabsTrigger>
          <TabsTrigger value="retention">Retention</TabsTrigger>
          <TabsTrigger value="audit">Audit history</TabsTrigger>
          <TabsTrigger value="imports">Data transfer</TabsTrigger>
          <TabsTrigger value="connections">Connections & recovery</TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          {panel(
            "Staff directory",
            generic(
              staff,
              [
                { key: "name", label: "Staff member" },
                { key: "email", label: "Email" },
                {
                  key: "roles",
                  label: "Roles",
                  render: (r) => (
                    <div className="role-tags">
                      {JSON.parse(r.roles).map((v: string) => (
                        <Badge key={v} value={v} />
                      ))}
                    </div>
                  ),
                },
              ],
              (r) => (
                <button
                  className="small-btn"
                  onClick={() =>
                    open("staff", { ...r, roles: JSON.parse(r.roles) })
                  }
                >
                  Edit access
                </button>
              ),
            ),
          )}
          <p className="footnote">
            Synthetic staff use example.invalid addresses. Add a real staff
            email to authorize access. No student accounts are supported.
          </p>
        </TabsContent>
        <TabsContent value="policy">
          {panel(
            "Versioned business policy",
            generic(
              d.policies || [],
              [
                { key: "name", label: "Policy" },
                statusCol,
                {
                  key: "created_at",
                  label: "Created",
                  render: (r) => fmt(r.created_at),
                },
              ],
              (r) => (
                <div className="detail-actions">
                  {r.status === "Draft" && (
                    <button
                      className="small-btn"
                      onClick={() => open("policy_edit", r)}
                    >
                      Edit draft
                    </button>
                  )}
                  <button
                    className="small-btn"
                    onClick={() => open("policy_transition", r)}
                  >
                    Review
                  </button>
                </div>
              ),
            ),
            <button className="small-btn" onClick={() => open("policy")}>
              New draft
            </button>,
          )}
          <div className="prose policy-values">
            {Object.entries(JSON.parse(d.policies?.[0]?.config || "{}")).map(
              ([k, v]) => (
                <span key={k}>
                  {k}
                  <strong>{String(v)}</strong>
                </span>
              ),
            )}
          </div>
        </TabsContent>
        <TabsContent value="fx">
          {panel(
            "Approved currency conversion evidence",
            generic(
              d.fxRates || [],
              [
                { key: "currency", label: "Currency" },
                { key: "usd_rate", label: "USD per unit" },
                { key: "effective_date", label: "Effective date" },
                statusCol,
                { key: "source", label: "Source" },
              ],
              (r) =>
                r.status === "Draft" &&
                can(user.roles, ["Project Operations"]) ? (
                  <button
                    className="small-btn"
                    onClick={() => open("fx_rate_approve", r)}
                  >
                    Approve
                  </button>
                ) : null,
            ),
            can(user.roles, ["Operations Systems / Admin"]) && (
              <button className="small-btn" onClick={() => open("fx_rate")}>
                New FX draft
              </button>
            ),
          )}
        </TabsContent>
        <TabsContent value="retention">
          <RetentionPanel />
        </TabsContent>
        <TabsContent value="audit">
          {panel(
            "Immutable activity audit",
            generic(d.audit || [], [
              {
                key: "created_at",
                label: "When",
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
              { key: "actor", label: "Actor", render: (r) => owner(r.actor) },
              { key: "action", label: "Action" },
              { key: "entity_id", label: "Record" },
              { key: "reason", label: "Reason" },
            ]),
          )}
        </TabsContent>
        <TabsContent value="connections">
          <ControlCenter />
        </TabsContent>
        <TabsContent value="imports">
          <div className="panel prose">
            <h2>Move operational data safely</h2>
            <p>
              Download a template, upload XLSX or CSV, review validation
              results, and confirm the import. Protected fields are rejected.
            </p>
            <button className="primary" onClick={() => setImportOpen(true)}>
              <Upload size={17} /> Open import workspace
            </button>
          </div>
        </TabsContent>
      </Tabs>
    );
  } else
    content = (
      <Empty
        title="Module not found"
        text="Choose a workspace from the navigation."
      />
    );
  useEffect(() => {
    if (module === "students") {
      const g = sessionStorage.getItem("depi-group-search");
      if (g) {
        setSearch(g);
        sessionStorage.removeItem("depi-group-search");
      }
    }
  }, [module]);
  return (
    <SidebarProvider style={{ "--sidebar-width": "238px" } as any}>
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <a className="brand" href="/">
            <span className="brand-mark">
              D<span>↗</span>
            </span>
            <div>
              <strong>
                DEPI<span>operations</span>
              </strong>
              <small>CAREER180 × FREELANCE YARD</small>
            </div>
          </a>
          <div className="cohort-switch">
            <span className="cohort-icon">
              <Layers size={17} />
            </span>
            <div>
              <strong>Round 5</strong>
              <small>Coaching & freelancing</small>
            </div>
            <LockKeyhole size={14} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>WORKSPACE</SidebarGroupLabel>
            <SidebarMenu>
              {shownNav.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton asChild isActive={module === id}>
                    <a href={id === "home" ? "/" : "/" + id}>
                      <Icon />
                      <span>{label}</span>
                      {id === "work" && overdue.length > 0 && (
                        <b className="nav-count">{overdue.length}</b>
                      )}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="staff-only">
            <ShieldCheck size={17} />
            <span>Staff-only workspace</span>
          </div>
          <div className="profile">
            <span className="avatar navy">{user.name?.slice(0, 1) || "A"}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.roles?.[0] || "Workspace setup"}</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {nav.find((n) => n[0] === module)?.[1] || "Overview"}
            </strong>
          </div>
          <div className="header-actions">
            <span className="round-tag">ROUND 5</span>
            <GlobalSearch
              onStudent={(id) =>
                setSelected(students.find((s) => s.id === id) || null)
              }
            />
            <button
              className="icon-btn"
              aria-label="Refresh data"
              onClick={refresh}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="icon-btn notification-btn"
              aria-label="Open notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
              {overdue.length > 0 && <i />}
            </button>
            <span className="avatar navy small">{user.name?.[0] || "A"}</span>
          </div>
        </header>
        <main className="workspace">
          {!d.setup && (
            <div className="demo-banner">
              <span className="demo-label">
                {d.workspaceMode === "demo"
                  ? "PILOT WORKSPACE"
                  : "PRODUCTION WORKSPACE"}
              </span>
              <span>
                {d.workspaceMode === "demo"
                  ? "Synthetic roster · No real student or client data"
                  : "Live operational records · Staff access only"}
              </span>
              <span className="banner-date">
                {new Date().toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>
          )}
          {error ? (
            <div className="error-panel" role="alert">
              <AlertTriangle />
              <h2>Workspace unavailable</h2>
              <p>{error}</p>
              <button className="primary" onClick={refresh}>
                Try again
              </button>
              <a href="/login">
                Sign in
              </a>
            </div>
          ) : loading ? (
            <div className="loading">
              <Skeleton className="h-10 w-80" />
              <div className="stats">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-36" />
                ))}
              </div>
              <Skeleton className="h-96" />
            </div>
          ) : d.setup ? (
            <div className="setup panel">
              <span className="brand-mark">D↗</span>
              <h1>Set up your operations workspace</h1>
              <p>
                Choose a blank production workspace for real operations, or a
                separate synthetic pilot dataset for training and workflow
                testing.
              </p>
              <p>
                You will receive Project Operations and Systems Admin access.
                Quality approval and account allocation remain separate,
                explicitly assigned roles.
              </p>
              <div className="detail-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => quick("setup", { mode: "production" })}
                >
                  {busy
                    ? "Preparing workspace…"
                    : "Start blank production workspace"}
                </button>
                <button
                  className="small-btn"
                  disabled={busy}
                  onClick={() => quick("setup", { mode: "demo" })}
                >
                  Load synthetic pilot
                </button>
              </div>
              <p className="footnote">
                Initialization is permanent for this workspace. Production mode
                creates only the controlled policy and your administrator
                account.
              </p>
            </div>
          ) : (
            <>
              {module !== "home" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        ROUND 5 /{" "}
                        {module === "quality" ? "ASSURANCE" : "OPERATIONS"}
                      </div>
                      <h1>{nav.find((n) => n[0] === module)?.[1]}</h1>
                      <p>
                        {
                          (
                            {
                              work: "A clear next action for every student.",
                              program:
                                "Registration through screening, delivery, graduation, outcomes and controlled closure.",
                              students:
                                "One student, one owner, a complete operational picture.",
                              groups: "Rolling journeys, accountable teams.",
                              sessions: "Coaching schedules and attendance.",
                              accounts:
                                "Controlled allocations with eligibility checks.",
                              gigs: "Track delivery, payment and the proof behind them.",
                              evidence:
                                "From external submission to verified outcome.",
                              quality:
                                "Review the evidence. Protect the outcome.",
                              cases:
                                "Own the exception, record the resolution.",
                              reports:
                                "Progress grounded in operational records.",
                              administration:
                                "Staff access, versioned policies and audit history.",
                            } as Row
                          )[module]
                        }
                      </p>
                    </div>
                    {module === "administration" && (
                      <div className="detail-actions">
                        {d.workspaceMode === "production" &&
                          students.length === 0 && (
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() => quick("load_demo_data", {})}
                            >
                              <Plus size={16} />
                              Load synthetic pilot
                            </button>
                          )}
                        <button
                          className="small-btn"
                          disabled={busy}
                          onClick={() => quick("policy_check", {})}
                        >
                          <RefreshCw size={16} />
                          Run policy checks
                        </button>
                      </div>
                    )}
                    {moduleAction[module] && (
                      <button
                        className="primary"
                        onClick={() => open(moduleAction[module])}
                      >
                        <Plus size={17} />
                        {
                          (
                            {
                              students: "Add student",
                              groups: "Create group",
                              sessions: "Schedule session",
                              accounts: "Request account",
                              gigs: "Record gig",
                              evidence: "Submit evidence",
                              cases: "Open case",
                              work: "Create action",
                              administration: "Add staff",
                            } as Row
                          )[module]
                        }
                      </button>
                    )}
                  </div>
                  {!["administration", "program"].includes(module) && (
                    <div className="toolbar">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder={
                            "Search " +
                            (module === "work" ? "actions" : module) +
                            "…"
                          }
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          aria-label="Search records"
                        />
                      </label>
                      {filterOpts.length > 1 && (
                        <Pick
                          label="Filter records"
                          value={filter}
                          onChange={setFilter}
                          options={filterOpts}
                        />
                      )}{" "}
                      {(d.savedViews || []).some(
                        (v: Row) => v.module === module,
                      ) && (
                        <Pick
                          label="Saved views"
                          value=""
                          options={(d.savedViews || [])
                            .filter((v: Row) => v.module === module)
                            .map((v: Row) => ({ value: v.id, label: v.name }))}
                          onChange={(id) => {
                            const v = (d.savedViews || []).find(
                              (x: Row) => x.id === id,
                            );
                            if (v) {
                              const f = JSON.parse(v.filters);
                              setFilter(f.filter || "All");
                              setSearch(f.search || "");
                            }
                          }}
                        />
                      )}
                      <div className="toolbar-right">
                        <button
                          className="small-btn"
                          onClick={async () => {
                            try {
                              await mutate("saved_view", {
                                module,
                                name:
                                  (filter === "All" ? "Custom" : filter) +
                                  " view",
                                filters: { filter, search },
                              });
                              setSaved([...new Set([...saved, filter])]);
                              toast.success("View saved to your staff profile");
                            } catch (e: any) {
                              toast.error(e.message);
                            }
                          }}
                        >
                          <Filter size={15} /> Save view
                        </button>
                        <button
                          className="small-btn"
                          onClick={() => {
                            setImportModule(
                              ["quality", "reports", "work"].includes(module)
                                ? "students"
                                : module,
                            );
                            setImportOpen(true);
                          }}
                        >
                          <Upload size={15} /> Import
                        </button>
                        <Pick
                          label="Export"
                          value=""
                          options={["CSV", "XLSX"]}
                          onChange={(v) => {
                            const m =
                              (
                                {
                                  work: "tasks",
                                  quality: "evidence",
                                  reports: "students",
                                } as Row
                              )[module] || module;
                            window.location.href =
                              "/api/export?module=" +
                              m +
                              "&format=" +
                              v.toLowerCase() +
                              "&search=" +
                              encodeURIComponent(search);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              {content}
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>DEPI Round 5 · Coaching & Freelancing Operations</span>
          <span>
            <LockKeyhole size={12} /> Private staff workspace
          </span>
        </footer>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="student-sheet sm:max-w-[800px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Student 360</SheetTitle>
            <SheetDescription>
              Operational record and evidence history
            </SheetDescription>
          </SheetHeader>
          {selectedStudent && (
            <div className="student-detail">
              <div className="detail-header">
                <span className="avatar large">
                  {selectedStudent.name
                    .split(" ")
                    .slice(0, 2)
                    .map((v: string) => v[0])
                    .join("")}
                </span>
                <div>
                  <h2>{selectedStudent.name}</h2>
                  <p>
                    {selectedStudent.id} · {selectedStudent.group_id} ·{" "}
                    {selectedStudent.track}
                  </p>
                </div>
              </div>
              <div className="status-strip">
                <div>
                  <small>Lifecycle</small>
                  <Badge value={selectedStudent.lifecycle} />
                </div>
                <div>
                  <small>Engagement</small>
                  <Badge value={selectedStudent.engagement} />
                </div>
                <div>
                  <small>Coaching</small>
                  <Badge value={selectedStudent.coaching} />
                </div>
                <div>
                  <small>Graduation</small>
                  <Badge value={selectedStudent.graduation} />
                </div>
              </div>
              <div className="detail-actions">
                <button
                  className="primary"
                  onClick={() =>
                    open("contact", { student_id: selectedStudent.id })
                  }
                >
                  <MessageSquare size={16} /> Log contact
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("task", { student_id: selectedStudent.id })
                  }
                >
                  Next action
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("engagement", { student_id: selectedStudent.id })
                  }
                >
                  Review risk
                </button>
              </div>
              <Tabs defaultValue="overview">
                <TabsList className="detail-tabs">
                  {[
                    "overview",
                    "contacts",
                    "tasks",
                    "sessions",
                    "gigs",
                    "services",
                    "evidence",
                    "accounts",
                    "cases",
                    "timeline",
                    "audit",
                  ].map((t) => (
                    <TabsTrigger key={t} value={t}>
                      {t[0].toUpperCase() + t.slice(1)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="overview">
                  <div className="risk-box">
                    <AlertTriangle size={20} />
                    <div>
                      <strong>
                        System recommendation: {selectedStudent.risk.status}
                      </strong>
                      <p>
                        {selectedStudent.risk.reasons.join(" · ") ||
                          "No active risk triggers"}
                      </p>
                    </div>
                  </div>
                  <div className="detail-grid">
                    {[
                      ["Coordinator", owner(selectedStudent.coordinator)],
                      ["Supervisor", owner(selectedStudent.supervisor)],
                      ["Coach", owner(selectedStudent.coach)],
                      ["Journey", "Week " + selectedStudent.week],
                      ["Pathway", selectedStudent.pathway],
                      ["Last valid contact", fmt(selectedStudent.last_contact)],
                      [
                        "Attendance",
                        selectedStudent.attendance === null
                          ? "Not recorded"
                          : selectedStudent.attendance + "%",
                      ],
                      ["Provider", selectedStudent.provider],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <small>{k}</small>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="next-action-box">
                    <small>NEXT ACTION</small>
                    <h3>
                      {selectedStudent.next_task?.title ||
                        "No next action assigned"}
                    </h3>
                    <p>
                      {selectedStudent.next_task
                        ? owner(selectedStudent.next_task.owner) +
                          " · Due " +
                          fmt(selectedStudent.next_task.due)
                        : "Create an action with an owner and due date."}
                    </p>
                  </div>
                  <div className="detail-actions">
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("milestone", { student_id: selectedStudent.id })
                      }
                    >
                      Update milestone
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("lifecycle", { student_id: selectedStudent.id })
                      }
                    >
                      Lifecycle
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("transfer", { student_id: selectedStudent.id })
                      }
                    >
                      Transfer student
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("case", { student_id: selectedStudent.id })
                      }
                    >
                      Open case
                    </button>
                  </div>
                </TabsContent>
                {[
                  "contacts",
                  "tasks",
                  "sessions",
                  "gigs",
                  "services",
                  "evidence",
                  "accounts",
                  "cases",
                  "timeline",
                  "audit",
                ].map((tab) => (
                  <TabsContent key={tab} value={tab}>
                    {tab === "tasks" ? (
                      taskRows(
                        tasks.filter(
                          (t) => t.student_id === selectedStudent.id,
                        ),
                      )
                    ) : tab === "contacts" ? (
                      <div className="history">
                        {(d.contacts || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ).length === 0 ? (
                          <Empty
                            title="No contacts recorded"
                            text="Log a contact with screenshot proof and a next action."
                          />
                        ) : (
                          (d.contacts || [])
                            .filter(
                              (c: Row) => c.student_id === selectedStudent.id,
                            )
                            .map((c: Row) => (
                              <article key={c.id}>
                                <Badge value={c.outcome} />
                                <h3>
                                  {c.channel} · {fmt(c.occurred_at)}
                                </h3>
                                <p>{c.next_action}</p>
                                <small>Recorded by {owner(c.recorder)}</small>
                                <a
                                  href={"/api/files?id=" + c.proof_id}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View screenshot <ExternalLink size={14} />
                                </a>
                              </article>
                            ))
                        )}
                      </div>
                    ) : tab === "services" ? (
                      <div className="history">
                        {serviceLinks.filter((link) => link.student_id === selectedStudent.id).length === 0 ? (
                          <Empty title="No service links submitted" text="The student has not submitted service links yet." />
                        ) : serviceLinks.filter((link) => link.student_id === selectedStudent.id).map((link) => (
                          <article key={link.id}>
                            <div className="detail-actions"><Badge value={`Service ${link.slot}`} /><Badge value={link.qc_status} /><Badge value={link.auto_status} /></div>
                            <h3><a className="text-link" href={link.url} target="_blank" rel="noreferrer">{link.platform} <ExternalLink size={14} /></a></h3>
                            <p>{(() => { try { return JSON.parse(link.auto_result || "{}").message; } catch { return "Automatic details unavailable."; } })()}</p>
                            <small>Revision {link.revision} · submitted {new Date(link.submitted_at).toLocaleString()}{link.qc_at ? ` · reviewed ${new Date(link.qc_at).toLocaleString()} by ${link.reviewer_name || owner(link.qc_actor)}` : ""}</small>
                            {serviceLinkReviews.filter((review) => review.service_link_id === link.id).map((review) => (
                              <div className="info-box" key={review.id}><Badge value={review.decision} /><span>{review.comment}</span><small>{new Date(review.reviewed_at).toLocaleString()} · {review.reviewer_name}</small></div>
                            ))}
                          </article>
                        ))}
                      </div>
                    ) : tab === "evidence" ? (
                      generic(
                        evidence.filter(
                          (e) => e.student_id === selectedStudent.id,
                        ),
                        [{ key: "id", label: "Evidence" }, statusCol],
                        (r) => (
                          <button
                            className="small-btn"
                            onClick={() => open("review", r)}
                          >
                            Review
                          </button>
                        ),
                      )
                    ) : tab === "gigs" ? (
                      generic(
                        gigs.filter((g) => g.student_id === selectedStudent.id),
                        [{ key: "title", label: "Gig" }, statusCol],
                        (r) => (
                          <button
                            className="small-btn"
                            onClick={() => open("gig_transition", r)}
                          >
                            Activity
                          </button>
                        ),
                      )
                    ) : tab === "cases" ? (
                      generic(
                        (d.cases || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "title", label: "Case" }, statusCol],
                      )
                    ) : tab === "accounts" ? (
                      generic(
                        (d.requests || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "task", label: "Request" }, statusCol],
                      )
                    ) : tab === "sessions" ? (
                      generic(
                        (d.attendance || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "session_id", label: "Session" }, statusCol],
                      )
                    ) : (
                      generic(
                        (d.audit || []).filter(
                          (a: Row) =>
                            a.entity_id === selectedStudent.id ||
                            a.value.includes(selectedStudent.id),
                        ),
                        [
                          { key: "action", label: "Action" },
                          {
                            key: "actor",
                            label: "Staff recorder",
                            render: (r) => owner(r.actor),
                          },
                          {
                            key: "created_at",
                            label: "When",
                            render: (r) => fmt(r.created_at),
                          },
                        ],
                      )
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={!!modal} onOpenChange={(v) => !v && setModal(null)}>
        <DialogContent className="action-dialog sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {titles[modal?.action || ""] || "Update record"}
            </DialogTitle>
            <DialogDescription>
              {actionCopy[modal?.action || ""] ||
                "Changes are validated and recorded in the audit history."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="action-form">
            {(() => {
              const a = modal?.action;
              if (a === "contact")
                return (
                  <>
                    {studentPick()}
                    <div className="form-grid">
                      {choice("channel", "Channel", [
                        "WhatsApp",
                        "Email",
                        "Phone",
                        "Form",
                        "Other",
                      ])}
                      {choice("outcome", "Outcome", [
                        "Responded",
                        "No Response",
                        "Follow-Up Required",
                        "Problem Identified",
                        "Escalated",
                      ])}
                      {field(
                        "occurred_at",
                        "Contact date & time",
                        "datetime-local",
                      )}
                    </div>
                    {proofField()}
                    {field("next_action", "Next action")}
                    {staffPick()}
                    {field("due", "Action due date", "datetime-local")}
                    {field("notes", "Notes", "text", false)}
                  </>
                );
              if (a === "task")
                return (
                  <>
                    {studentPick()}
                    {field("title", "Next action")}
                    {staffPick()}
                    {field("due", "Due date", "datetime-local")}
                    {choice("category", "Category", [
                      "Follow-up",
                      "Recovery",
                      "Contact",
                      "Evidence",
                      "Account",
                    ])}
                    {choice("priority", "Priority", [
                      "Normal",
                      "High",
                      "Urgent",
                    ])}
                  </>
                );
              if (a === "student")
                return (
                  <>
                    {field("id", "Student ID (e.g. S20001)")}
                    {field("name", "Full name")}
                    {choice(
                      "group_id",
                      "Group",
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("email", "Supabase sign-in email", "email")}
                    {field("phone", "Phone", "tel", false)}
                    {choice("lifecycle", "Lifecycle", ["Active", "Paused", "Transferred", "Withdrawn", "Removed", "Graduate Closed", "Non-Graduate Closed"], false)}
                    {choice("engagement", "Engagement", ["Active", "At Risk", "Critical", "Unresponsive"], false)}
                    {field("coaching", "Coaching status", "text", false)}
                  </>
                );
              if (a === "group")
                return (
                  <>
                    {field("id", "Group ID")}
                    {field("name", "Group name")}
                    {choice(
                      "track",
                      "Track",
                      (d.tracks || []).map((track: Row) => track.name),
                    )}
                    {choice("provider", "Provider", [
                      "Career180",
                      "Freelance Yard",
                    ])}
                    {staffPick("coordinator", "Coordinator")}
                    {staffPick("supervisor", "Supervisor")}
                    {staffPick("coach", "Coach")}
                    {choice("pathway", "Pathway", ["Outcome", "Support"])}
                    {choice("delivery_model", "Delivery model", [
                      "Regular",
                      "Industry",
                    ])}
                    {field("start_date", "Start date", "date")}
                    {choice(
                      "policy_id",
                      "Effective policy",
                      (d.policies || [])
                        .filter((p: Row) => p.status === "Effective")
                        .map((p: Row) => ({ value: p.id, label: p.name })),
                    )}
                  </>
                );
              if (a === "session")
                return (
                  <>
                    {field("title", "Session title")}
                    {choice(
                      "group_id",
                      "Group",
                      groups
                        .filter((g) => g.status === "Active")
                        .map((g) => ({
                          value: g.id,
                          label: `${g.id} · ${g.delivery_model || "Regular"}`,
                        })),
                    )}
                    {choice(
                      "coach_id",
                      "Assigned coach",
                      (d.groupCoaches || [])
                        .filter(
                          (coach: Row) =>
                            coach.group_id === form.group_id &&
                            coach.status === "Active" &&
                            coach.onboarding_status === "Complete",
                        )
                        .map((coach: Row) => ({
                          value: coach.user_id,
                          label: `${coach.coach_name} · ${coach.coach_type}`,
                        })),
                    )}
                    {field("starts_at", "Start date & time", "datetime-local")}
                    {field("week", "Journey week", "number")}
                    {field(
                      "duration_minutes",
                      "Duration in minutes",
                      "number",
                    )}
                    <p className="footnote">
                      Regular delivery supports 8 weekly sessions; Industry
                      delivery supports 5. The Round 5 duration is 180 minutes.
                    </p>
                  </>
                );
              if (a === "session_reschedule")
                return (
                  <>
                    {choice(
                      "coach_id",
                      "Assigned coach",
                      (d.groupCoaches || [])
                        .filter(
                          (coach: Row) =>
                            coach.group_id === form.group_id &&
                            coach.status === "Active" &&
                            coach.onboarding_status === "Complete",
                        )
                        .map((coach: Row) => ({
                          value: coach.user_id,
                          label: `${coach.coach_name} · ${coach.coach_type}`,
                        })),
                    )}
                    {field("starts_at", "New date & time", "datetime-local")}
                    {field("reason", "Reason for rescheduling")}
                  </>
                );
              if (a === "session_cancel")
                return <>{field("reason", "Reason for cancellation")}</>;
              if (a === "attendance")
                {
                  const selectedSession = sessions.find(
                    (session) => session.id === form.session_id,
                  );
                  return (
                    <>
                    {choice(
                      "session_id",
                      "Session",
                      sessions
                        .filter(
                          (session) =>
                            session.status !== "Cancelled" &&
                            Date.parse(session.starts_at) <= Date.now(),
                        )
                        .map((session) => ({
                          value: session.id,
                          label: session.group_id + " · " + session.title,
                        })),
                    )}
                    {choice(
                      "student_id",
                      "Student",
                      students
                        .filter(
                          (student) =>
                            !selectedSession ||
                            student.group_id === selectedSession.group_id,
                        )
                        .map((student) => ({
                          value: student.id,
                          label: student.name + " · " + student.id,
                        })),
                    )}
                    {choice("status", "Attendance", [
                      "Present",
                      "Absent",
                      "Late",
                      "Excused",
                    ])}
                    {field("source", "Source", "text", false)}
                  </>
                );
                }
              if (a === "account_request")
                return (
                  <>
                    {studentPick()}
                    {choice(
                      "task_bank_id",
                      "Approved task",
                      (d.taskBank || [])
                        .filter(
                          (task: Row) =>
                            task.track ===
                            students.find((s) => s.id === form.student_id)
                              ?.track,
                        )
                        .map((task: Row) => ({
                          value: task.id,
                          label:
                            task.title +
                            " · " +
                            task.platform +
                            " · $" +
                            task.value,
                        })),
                    )}
                    {field("job_profile", "Student job profile")}
                    {field(
                      "gig_number",
                      "Controlled gig number (1–3)",
                      "number",
                    )}
                    {field("notes", "Request notes", "text", false)}
                    <p className="footnote">
                      Controlled account requests are limited to Support-path
                      students and tasks approved for their technical track.
                    </p>
                  </>
                );
              if (a === "account")
                return (
                  <>
                    {field("id", "Account ID")}
                    {field("label", "Account label")}
                    {choice(
                      "platform",
                      "Controlled platform",
                      controlledPlatforms,
                    )}
                    {field("credits", "Available credit (USD)", "number")}
                    <p className="footnote">
                      Store credentials in your approved vault. Do not enter
                      passwords here.
                    </p>
                  </>
                );
              if (a === "reserve_account")
                return (
                  <>
                    {choice(
                      "request",
                      "Account request",
                      (d.requests || [])
                        .filter((r: Row) => r.status === "Submitted")
                        .map((r: Row) => ({
                          value: r.id,
                          label: name(r.student_id) + " · " + r.task,
                        })),
                    )}
                    {choice(
                      "account",
                      "Controlled account",
                      (d.accounts || []).map((c: Row) => ({
                        value: c.id,
                        label:
                          c.label +
                          " · " +
                          c.platform +
                          " · " +
                          c.status +
                          " · $" +
                          c.credits,
                      })),
                    )}
                    <p className="footnote">
                      Reservations hold one eligible account for 15 minutes and
                      prevent a concurrent allocation from using it.
                    </p>
                  </>
                );
              if (a === "allocate")
                return (
                  <>
                    <div className="info-box">
                      <strong>Reserved account {form.account}</strong>
                      <span>Request {form.request}</span>
                      <small>
                        Complete the independent fit check before the
                        reservation expires.
                      </small>
                    </div>
                    <label className="check">
                      <Checkbox
                        checked={!!form.task_fit}
                        onCheckedChange={(v) =>
                          setForm({ ...form, task_fit: v === true })
                        }
                      />
                      I have reviewed and approved the task fit.
                    </label>
                  </>
                );
              if (a === "refund_credit")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.title}</strong>
                      <Badge value={modal!.status} />
                      <small>
                        Gig {modal!.id} · account {modal!.account_id}
                      </small>
                    </div>
                    {field("reason", "Approved refund reason")}
                  </>
                );
              if (a === "gig")
                return (
                  <>
                    {studentPick()}
                    {field("title", "Task / service")}
                    {field("platform", "Platform / source")}
                    {field("order_ref", "Unique order reference")}
                    <div className="form-grid">
                      {field("value", "Value", "number")}
                      {choice("currency", "Currency", [
                        "USD",
                        "EGP",
                        "EUR",
                        "GBP",
                      ])}
                    </div>
                    {field("due", "Due date", "datetime-local")}
                  </>
                );
              if (a === "fx_rate")
                return (
                  <>
                    {choice("currency", "Currency", ["EGP", "EUR", "GBP"])}
                    {field("usd_rate", "USD per one currency unit", "number")}
                    {field("effective_date", "Effective date", "date")}
                    {field("source", "Approved reference / publication")}
                    <p className="footnote">
                      A separate Project Operations user must approve the rate
                      before it can affect graduation.
                    </p>
                  </>
                );
              if (a === "fx_rate_approve")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.currency} → USD</strong>
                      <span>
                        {modal!.usd_rate} · effective {modal!.effective_date}
                      </span>
                      <small>{modal!.source}</small>
                    </div>
                    {field("reason", "Approval reason")}
                  </>
                );
              if (a === "fx_apply")
                return (
                  <>
                    <div className="info-box">
                      <strong>Gig {form.gig_id}</strong>
                      <span>Currency: {form.currency}</span>
                    </div>
                    {choice(
                      "fx_rate_id",
                      "Approved FX rate",
                      (d.fxRates || [])
                        .filter(
                          (r: Row) =>
                            r.currency === form.currency &&
                            r.status === "Approved",
                        )
                        .map((r: Row) => ({
                          value: r.id,
                          label:
                            r.usd_rate +
                            " USD · " +
                            r.effective_date +
                            " · " +
                            r.source,
                        })),
                    )}
                    <p className="footnote">
                      The applied USD value is calculated once from the original
                      gig value and stored with the exact approved rate.
                    </p>
                  </>
                );
              if (a === "gig_transition")
                return (
                  <>
                    {studentPick()}
                    <div className="info-box">
                      Current step: <Badge value={modal?.status} />
                    </div>
                    {choice("status", "Record next step", [
                      "Gig Opened",
                      "Work Submitted",
                      "Delivered",
                      "Paid",
                      "Cancelled",
                      "Failed",
                    ])}
                    {choice("performed_by", "Who performed the activity?", [
                      "STUDENT",
                      "CLIENT",
                      "STAFF",
                    ])}
                    {field(
                      "occurred_at",
                      "Activity date & time",
                      "datetime-local",
                    )}
                    {proofField()}
                  </>
                );
              if (a === "evidence")
                return (
                  <>
                    {studentPick()}
                    {choice(
                      "gig_id",
                      "Paid gig",
                      gigs
                        .filter(
                          (g) =>
                            g.student_id === form.student_id &&
                            g.status === "Paid",
                        )
                        .map((g) => ({
                          value: g.id,
                          label: g.title + " · " + g.currency + " " + g.value,
                        })),
                    )}
                    {choice("source", "External source", [
                      "WhatsApp",
                      "Email",
                      "Freelancing platform",
                      "Form",
                    ])}
                    {proofField("proof_id", "Delivery proof")}
                    {proofField("payment_proof_id", "Payment proof")}
                  </>
                );
              if (a === "review")
                return (
                  <>
                    <div className="info-box">
                      <strong>{name(modal!.student_id)}</strong>
                      <Badge value={modal!.status} />
                      <a
                        className="text-link"
                        target="_blank"
                        rel="noreferrer"
                        href={"/api/files?id=" + modal!.proof_id}
                      >
                        Open submitted screenshot <ExternalLink size={16} />
                      </a>
                    </div>
                    {modal!.code && (
                      <div className="risk-box">
                        <div>
                          <strong>{modal!.code}</strong>
                          <p>{modal!.requirements}</p>
                        </div>
                      </div>
                    )}
                    {["Quality Review", "L3 Review"].includes(
                      modal!.status,
                    ) && (
                      <>
                        {choice(
                          "decision",
                          "Decision",
                          modal!.status === "L3 Review"
                            ? ["Accept", "Reject", "Final resolution"]
                            : ["Accept", "Reject", "Escalate L3"],
                        )}
                        {form.decision === "Accept" && (
                          <div className="review-checks">
                            {[
                              "Completeness",
                              "Identity",
                              "Delivery",
                              "Payment/value",
                              "Authenticity",
                              "Source consistency",
                              "Duplicate checks",
                            ].map((c) => (
                              <label className="check" key={c}>
                                <Checkbox
                                  checked={form.checklist?.includes(c)}
                                  onCheckedChange={(v) =>
                                    setForm({
                                      ...form,
                                      checklist: v
                                        ? [...(form.checklist || []), c]
                                        : form.checklist.filter(
                                            (s: string) => s !== c,
                                          ),
                                    })
                                  }
                                />
                                {c}
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {form.decision === "Reject" &&
                      choice(
                        "code",
                        "Rejection code",
                        rejectionCodes.map((c) => ({
                          value: c.slice(0, 4),
                          label: c,
                        })),
                      )}
                    {modal!.status === "Accepted" &&
                      choice("decision", "Controlled reopening", ["Reopen"])}
                    {modal!.status === "Rejected" && (
                      <>
                        {proofField("proof_id", "Corrected delivery proof")}
                        {proofField(
                          "payment_proof_id",
                          "Corrected payment proof",
                        )}
                      </>
                    )}
                    {field("notes", "Decision notes / correction requirements")}
                  </>
                );
              if (a === "service_qc_review")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.student_name || name(modal!.student_id)}</strong>
                      <Badge value={`Service ${modal!.slot}`} />
                      <a className="text-link" href={modal!.url} target="_blank" rel="noreferrer">
                        Open submitted service <ExternalLink size={16} />
                      </a>
                    </div>
                    <div className="info-box">
                      <span>Automatic check: <Badge value={modal!.auto_status} /></span>
                      <small>{modal!.platform} · revision {modal!.revision}</small>
                    </div>
                    {(() => {
                      try {
                        const automatic = JSON.parse(modal!.auto_result || "{}");
                        return <div className="info-box"><strong>{automatic.message}</strong>{(automatic.checks || []).map((check: string) => <small key={check}>{check}</small>)}</div>;
                      } catch { return null; }
                    })()}
                    {choice("decision", "QC decision", ["Lock", "Needs Correction"])}
                    {form.decision === "Needs Correction" && (
                      <Pick
                        label="Correction template"
                        value=""
                        onChange={(comment) => setForm({ ...form, comment })}
                        options={[
                          { value: "The link does not open the submitted service page. Send the direct public service URL.", label: "Direct link required" },
                          { value: "The service owner could not be matched to your student record. Confirm the seller profile and resubmit.", label: "Owner mismatch" },
                          { value: "The service is unavailable, paused or deleted. Submit an active public service.", label: "Service unavailable" },
                          { value: "The service category or title does not match your assigned track. Submit a track-relevant service.", label: "Track mismatch" },
                        ]}
                      />
                    )}
                    {field("comment", "QC comment / correction guidance", "text", form.decision === "Needs Correction")}
                    {form.decision === "Lock" && modal!.auto_status === "Failed" && field("override_reason", "Quality Lead override reason")}
                    <p className="footnote">
                      Lock only when the service page is active, correct, track-relevant and belongs to the student. Automatic failures require a Quality Lead override with a recorded reason.
                    </p>
                  </>
                );
              if (a === "case")
                return (
                  <>
                    {studentPick()}
                    {field("title", "Case title")}
                    {choice("type", "Case type", [
                      "Student",
                      "Account",
                      "Gig",
                      "Payment",
                      "Evidence",
                      "Quality",
                      "Technical",
                      "System",
                    ])}
                    {choice("severity", "Severity", [
                      "S1 Critical",
                      "S2 High",
                      "S3 Standard",
                      "S4 Low",
                    ])}
                    {staffPick()}
                    {field("due", "Due date", "datetime-local")}
                  </>
                );
              if (a === "case_transition")
                return (
                  <>
                    <div className="info-box">
                      {modal!.title}
                      <Badge value={modal!.status} />
                    </div>
                    {choice("status", "Next case stage", [
                      "Triaged",
                      "Assigned",
                      "In Progress",
                      "Waiting",
                      "Resolved",
                      "Verified",
                      "Closed",
                    ])}
                    {field("resolution", "Resolution", "text", false)}
                    {field("root_cause", "Root cause", "text", false)}
                    {field("prevention", "Preventive action", "text", false)}
                  </>
                );
              if (a === "engagement")
                return (
                  <>
                    {studentPick()}
                    {choice("status", "Operational engagement", [
                      "Active",
                      "At Risk",
                      "Critical",
                      "Unresponsive",
                    ])}
                    {field("reason", "Reason for confirmation or override")}
                  </>
                );
              if (a === "lifecycle")
                return (
                  <>
                    {studentPick()}
                    {choice("status", "Lifecycle status", [
                      "Active",
                      "Paused",
                      "Transferred",
                      "Withdrawn",
                      "Removed",
                      "Graduate Closed",
                      "Non-Graduate Closed",
                    ])}
                    {field("reason", "Lifecycle decision reason")}
                    <p className="footnote">
                      Closure is blocked while open actions or cases remain.
                      Graduate closure also requires a calculated qualifying
                      result.
                    </p>
                  </>
                );
              if (a === "staff")
                return (
                  <>
                    {field("name", "Staff name")}
                    {field("email", "Staff email", "email")}
                    <div className="review-checks">
                      {roles.map((r) => (
                        <label className="check" key={r}>
                          <Checkbox
                            checked={form.roles?.includes(r) || false}
                            onCheckedChange={(v) =>
                              setForm({
                                ...form,
                                roles: v
                                  ? [...(form.roles || []), r]
                                  : (form.roles || []).filter(
                                      (k: string) => k !== r,
                                    ),
                              })
                            }
                          />
                          {r}
                        </label>
                      ))}
                    </div>
                    {field("reason", "Access change reason")}
                  </>
                );
              if (a === "milestone")
                return (
                  <>
                    {studentPick()}
                    {field(
                      "milestone",
                      "Completed journey milestone (0–8)",
                      "number",
                    )}
                  </>
                );
              if (a === "task_bank")
                return (
                  <>
                    {field("track", "Technical track")}
                    {field("title", "Approved controlled task")}
                    {choice(
                      "platform",
                      "Controlled platform",
                      controlledPlatforms,
                    )}
                    {field("value", "Approved value (USD)", "number")}
                  </>
                );
              if (a === "group_gate")
                return (
                  <>
                    {choice(
                      "group_id",
                      "Group",
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("week", "Group-relative week", "number")}
                    {choice("check_key", "Checkpoint", weeklyGateChecks)}
                    {choice("status", "Checkpoint status", [
                      "Pending",
                      "Complete",
                      "Exception",
                    ])}
                    {staffPick()}
                    {field("due", "Checkpoint due", "datetime-local")}
                  </>
                );
              if (a === "transfer")
                return (
                  <>
                    {studentPick()}
                    {choice(
                      "group_id",
                      "Destination group",
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("reason", "Transfer reason")}
                  </>
                );
              if (a === "policy" || a === "policy_edit")
                return (
                  <>
                    {a === "policy" && field("name", "Policy version name")}
                    <div className="form-grid">
                      {Object.entries(baselinePolicy).map(
                        ([key, defaultValue]) => (
                          <label className="field" key={key}>
                            {
                              (
                                {
                                  contactDays: "Contact interval (days)",
                                  coachHours: "Coach review SLA (hours)",
                                  l1Hours: "Coordinator L1 SLA (hours)",
                                  qualityHours: "Quality review SLA (hours)",
                                  correctionDays: "Correction window (days)",
                                  failedAttempts: "Failed contact attempts",
                                  failedWindowDays: "Attempt window (days)",
                                  target: "Graduation target (%)",
                                  minGig: "Minimum gig value (USD)",
                                  gigCount: "Qualifying gig count",
                                  minTotal: "Minimum total (USD)",
                                  largeGig: "Large-gig threshold (USD)",
                                  riskAttendance: "At Risk attendance (%)",
                                  criticalAttendance: "Critical attendance (%)",
                                  journeyDelayedLag: "Delayed journey lag",
                                  journeyCriticalLag: "Critical journey lag",
                                  milestoneWeek1: "Week 1 milestone",
                                  milestoneWeek2: "Week 2 milestone",
                                  milestoneWeek3: "Week 3 milestone",
                                  milestoneWeek4: "Week 4 milestone",
                                  milestoneWeek5: "Week 5 milestone",
                                  milestoneWeek6: "Week 6 milestone",
                                  milestoneWeek7: "Week 7 milestone",
                                  milestoneWeek8: "Week 8 milestone",
                                  regularSessionCount:
                                    "Regular session count",
                                  industrySessionCount:
                                    "Industry session count",
                                  sessionMinutes:
                                    "Session duration (minutes)",
                                } as Row
                              )[key]
                            }
                            <input
                              required
                              type="number"
                              min="0.01"
                              step={
                                key.startsWith("milestoneWeek") ||
                                [
                                  "failedAttempts",
                                  "failedWindowDays",
                                  "gigCount",
                                  "journeyDelayedLag",
                                  "journeyCriticalLag",
                                  "regularSessionCount",
                                  "industrySessionCount",
                                  "sessionMinutes",
                                ].includes(key)
                                  ? "1"
                                  : "any"
                              }
                              value={form.config?.[key] ?? defaultValue}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  config: {
                                    ...form.config,
                                    [key]: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ),
                      )}
                    </div>
                    {field("reason", "Change reason")}
                    <p className="footnote">
                      Approval requires a separate Project Operations user.
                      Existing groups keep their applied policy.
                    </p>
                  </>
                );
              if (a === "policy_transition")
                return (
                  <>
                    {choice("status", "Next policy stage", [
                      "Reviewed",
                      "Approved",
                      "Effective",
                      "Superseded",
                    ])}
                    {field("reason", "Decision reason")}
                  </>
                );
              if (a === "account_status")
                return (
                  <>
                    <CredentialPanel account={modal!.id} />
                    {choice("status", "Next account state", [
                      "Available",
                      "Cooldown",
                      "Blocked",
                      "Access Issue",
                      "Funding Block",
                      "Under Review",
                      "Retired",
                    ])}
                    {field("reason", "Reason")}
                  </>
                );
              return field("reason", "Reason");
            })()}
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-footer">
              <span>
                <LockKeyhole size={13} /> Recorded in audit history
              </span>
              <button
                type="button"
                className="small-btn"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button className="primary" type="submit" disabled={busy}>
                {busy
                  ? "Saving…"
                  : modal?.action === "review"
                    ? "Save review"
                    : "Save record"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet open={notifications} onOpenChange={setNotifications}>
        <SheetContent className="notifications overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Action notifications</SheetTitle>
            <SheetDescription>
              Your assigned alerts, including read history.
            </SheetDescription>
          </SheetHeader>
          <NotificationCenter
            onStudent={(id) => {
              setNotifications(false);
              setSelected(students.find((s) => s.id === id) || null);
            }}
          />
        </SheetContent>
      </Sheet>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[780px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Spreadsheet import</DialogTitle>
            <DialogDescription>
              Template → upload → validation → confirm → reconciliation
            </DialogDescription>
          </DialogHeader>
          <Pick
            label="Import module"
            value={importModule}
            onChange={(v) => {
              setImportModule(v);
              setPreview(null);
              setImportRows([]);
            }}
            options={[
              "students",
              "groups",
              "contacts",
              "tasks",
              "sessions",
              "attendance",
              "task_bank",
              "accounts",
              "requests",
              "gigs",
              "evidence",
              "cases",
              "applications",
              "assessments",
              "assessment_results",
              "withdrawals",
              "post_program_outcomes",
            ]}
          />
          <div className="import-tools">
            <button
              className="small-btn"
              onClick={() => {
                const templates: Row = {
                  students: {
                    id: "S20001",
                    name: "Example student",
                    group_id: "G101",
                    email: "",
                    phone: "",
                  },
                  groups: {
                    id: "G201",
                    name: "Example group",
                    track: "Web Development",
                    provider: "Career180",
                    coordinator: staff[0]?.id,
                    supervisor: staff[0]?.id,
                    coach: staff[0]?.id,
                    pathway: "Outcome",
                    delivery_model: "Regular",
                    start_date: today(),
                  },
                  contacts: {
                    student_id: "S10001",
                    channel: "WhatsApp",
                    outcome: "Responded",
                    occurred_at: new Date().toISOString(),
                    proof_id: "",
                    next_action: "Follow up",
                    owner: staff[0]?.id,
                    due: new Date(Date.now() + 86400000).toISOString(),
                    notes: "",
                  },
                  tasks: {
                    student_id: "S10001",
                    title: "Follow up",
                    owner: staff[0]?.id,
                    due: new Date(Date.now() + 86400000).toISOString(),
                    category: "Follow-up",
                    priority: "Normal",
                  },
                  sessions: {
                    id: "SES-new",
                    group_id: "G101",
                    coach_id: "staff-coach",
                    title: "Coaching session",
                    starts_at: new Date().toISOString(),
                    week: 1,
                    duration_minutes: 180,
                  },
                  attendance: {
                    session_id: d.sessions?.[0]?.id,
                    student_id: "S10001",
                    status: "Present",
                    source: "Spreadsheet",
                  },
                  task_bank: {
                    id: "TB-new",
                    track: "Graphic Design",
                    title: "Approved design service",
                    platform: "Khamsat",
                    value: 5,
                  },
                  accounts: {
                    id: "ACC-new",
                    label: "Client workspace",
                    platform: "Khamsat",
                    credits: 50,
                  },
                  requests: {
                    student_id: "S10001",
                    task_bank_id: "TB-DM-1",
                    job_profile: "Digital marketing specialist",
                    gig_number: 1,
                    notes: "",
                  },
                  gigs: {
                    id: "GIG-new",
                    student_id: "S10001",
                    platform: "Fiverr",
                    title: "Banner design",
                    value: 5,
                    currency: "USD",
                    order_ref: "unique-order",
                    due: new Date(Date.now() + 86400000).toISOString(),
                  },
                  evidence: {
                    student_id: "S10001",
                    gig_id: "",
                    proof_id: "",
                    payment_proof_id: "",
                    source: "WhatsApp",
                  },
                  cases: {
                    student_id: "S10001",
                    title: "Delivery blocker",
                    type: "Student",
                    severity: "S3 Standard",
                    owner: staff[0]?.id,
                    due: new Date(Date.now() + 86400000).toISOString(),
                  },
                  applications: {
                    id: "APP-new",
                    external_ref: "MIN-R5-new",
                    name: "Example applicant",
                    email: "",
                    phone: "",
                    preferred_track: "Web Development",
                    source: "Ministry intake",
                    consent_ref: "",
                    owner: staff[0]?.id,
                    submitted_at: new Date().toISOString(),
                  },
                  assessments: {
                    id: "ASM-new",
                    group_id: "G101",
                    title: "Final readiness",
                    type: "Final",
                    max_score: 100,
                    pass_score: 60,
                    due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
                  },
                  assessment_results: {
                    id: "ASR-new",
                    assessment_id: "ASM-new",
                    student_id: "S10001",
                    score: 80,
                    evidence_id: "",
                    notes: "",
                  },
                  withdrawals: {
                    id: "WD-new",
                    student_id: "S10001",
                    ministry_reference: "MIN-WD-new",
                    decision: "Approved",
                    decided_at: today(),
                    reason: "",
                  },
                  post_program_outcomes: {
                    id: "OUT-new",
                    student_id: "S10001",
                    type: "Employment",
                    organization: "",
                    title: "Role title",
                    value: "",
                    currency: "",
                    status: "Reported",
                    proof_id: "",
                    follow_up_at: new Date(
                      Date.now() + 30 * 86400000,
                    ).toISOString(),
                    owner: staff[0]?.id,
                  },
                };
                saveBlob(
                  toXLSX([templates[importModule]]),
                  "depi-" + importModule + "-template.xlsx",
                  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                );
              }}
            >
              <Download size={16} /> Download XLSX template
            </button>
            <label className="small-btn">
              <Upload size={16} /> Upload XLSX / CSV
              <input
                className="sr-only"
                type="file"
                accept=".csv,.xlsx"
                onChange={async (e) => {
                  try {
                    if (!e.target.files?.[0]) return;
                    setBusy(true);
                    const rows = await readSheet(e.target.files[0]);
                    setImportRows(rows);
                    setImportId(crypto.randomUUID());
                    const r = await fetch("/api/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ module: importModule, rows }),
                    });
                    const v = await r.json();
                    if (v.error) throw Error(v.error);
                    setPreview(v);
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </div>
          {preview?.rows && (
            <>
              <div className="info-box">
                <strong>{preview.rows.length} rows reviewed</strong>
                <span>
                  {preview.rows.filter((r: Row) => r.status === "Ready").length}{" "}
                  ready ·{" "}
                  {
                    preview.rows.filter((r: Row) => r.status === "Rejected")
                      .length
                  }{" "}
                  rejected
                </span>
              </div>
              {generic(preview.rows.slice(0, 20), [
                { key: "row", label: "Row" },
                statusCol,
                {
                  key: "errors",
                  label: "Validation",
                  render: (r) =>
                    r.errors.map((e: Row) => e.error).join("; ") ||
                    "Ready for workflow validation",
                },
              ])}
              <p className="footnote">{preview.notice}</p>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch("/api/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        module: importModule,
                        rows: importRows,
                        confirm: true,
                        batch_id: importId,
                      }),
                    });
                    const v = await r.json();
                    if (v.error) throw Error(v.error);
                    setPreview(v);
                    await refresh();
                    toast.success("Import reconciliation ready");
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Importing…" : "Confirm import"}
              </button>
            </>
          )}
          {preview && "created" in preview && (
            <div className="prose">
              <h3>Import complete</h3>
              <p>
                {preview.created} created · {preview.updated} updated ·{" "}
                {preview.skipped} skipped · {preview.conflicted} conflicted ·{" "}
                {preview.rejected} rejected
              </p>
            </div>
          )}
          {preview && (
            <button
              className="small-btn"
              onClick={() =>
                saveBlob(
                  toCSV(
                    preview.errors ||
                      preview.rows.flatMap((r: Row) => r.errors),
                  ),
                  "depi-import-errors.csv",
                  "text/csv",
                )
              }
            >
              Download error report
            </button>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
