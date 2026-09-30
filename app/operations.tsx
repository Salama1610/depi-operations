"use client";
import { LanguageToggle, useDir, useLocale, useT } from "@/lib/i18n/context";
import {
  ControlCenter,
  ReportsPanel,
  CredentialPanel,
  NotificationCenter,
  GlobalSearch,
  RetentionPanel,
} from "./control-center";
import { ProgramFlow } from "./program-flow";
import { WeeklyProgress } from "./weekly-progress";
import { acceptedServicePlatforms } from "@/lib/domain/service-links";
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
  LogOut,
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
  CalendarRange,
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
  dataTransferRoles,
} from "@/lib/domain/rules";
import { readSheet, toCSV, toXLSX } from "@/lib/spreadsheet";
import { guessKeyColumn, guessMapping } from "@/lib/domain/sheet-mapping";
type Row = Record<string, any>;
const nav = [
  ["home", "Overview", Home],
  ["program", "Program flow", Flag],
  ["work", "My work", CheckCheck],
  ["weekly", "Weekly progress", CalendarRange],
  ["students", "Students", Users],
  ["groups", "Groups", Layers],
  ["sessions", "Sessions", CalendarDays],
  ["accounts", "Accounts", WalletCards],
  ["gigs", "Gigs", BriefcaseBusiness],
  ["quality", "Quality review", ShieldCheck],
  ["cases", "Cases", Flag],
  ["reports", "Reports", ChartNoAxesCombined],
  ["administration", "Administration", Settings2],
] as const;
/** Where students take paid work. One spelling each, so an order number is unique per platform. */
const gigPlatforms = ["Khamsat", "Mostaql", "Kafeel", "Nafezly", "Upwork", "Fiverr", "Freelancer", "Freelance Yard", "Other"];
const moduleAction: Row = {
  students: "student",
  groups: "group",
  sessions: "session",
  accounts: "account_request",
  gigs: "gig",
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
  gig: "Record a paid gig",
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
  bulk_group_owner: "Change coordinator",
};
const actionCopy: Row = {
  contact: "Screenshot proof, an outcome and a next action are required.",
  allocate: "Eligibility and account reuse are checked before allocation.",
  review: "Record a decision and clear correction guidance.",
  gig_transition:
    "Attach a screenshot of this activity before progressing the gig.",
  staff: "Access changes take effect immediately and are audited.",
  evidence: "Only completed, paid gigs can enter the review pipeline.",
  gig: "Record the gig once it is paid. Its delivery and payment screenshots go straight into review.",
  session:
    "Sessions follow the group delivery model, approved duration and coach-assignment controls.",
  session_reschedule:
    "Changing the date or coach requires a reason and resets coach confirmation.",
  session_cancel:
    "Cancelled sessions remain in the operational history and require a reason.",
  service_qc_review:
    "One link at a time. Lock a correct link, or leave a clear correction comment for the student.",
  bulk_group_owner:
    "The group and its students move to the coordinator you choose. The change is audited.",
};
const formatDay = (v: string, locale = "en-GB") =>
  new Date(v).toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
  });
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
  const t = useT();
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
      {typeof value === "string" ? t(value) : value}
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
  const t = useT();
  // The name of the filter is always visible. With only the chosen value
  // shown, a row of filters all read "All" and nobody could tell which was
  // which.
  return (
    <span className="pick-field">
      <span className="pick-label">{label}</span>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="pick" aria-label={label}>
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => {
            const a = typeof o === "string" ? { value: o, label: o } : o;
            return (
              <SelectItem key={a.value} value={a.value}>
                {t(a.label)}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </span>
  );
}
function Empty({
  title = "Nothing waiting here",
  text = "Records will appear as your team progresses through the workflow.",
}) {
  const t = useT();
  return (
    <div className="empty">
      <CheckCircle2 size={30} />
      <h3>{t(title)}</h3>
      <p>{t(text)}</p>
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
/** The module a path points at: "/" is the overview, "/students" is students. */
/** Pages that were folded into another: evidence now lives on each gig. */
const movedModules: Record<string, string> = { evidence: "gigs" };
function moduleFromPath(pathname: string) {
  const raw = pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  const segment = movedModules[raw] || raw;
  return segment && nav.some(([id]) => id === segment) ? segment : "home";
}

/** Modules whose existing records a spreadsheet may modify (see /api/import). */
const updatableModules = ["students", "groups", "accounts"];

export default function Operations({ module: initialModule }: { module: string }) {
  const t = useT();
  const locale = useLocale();
  const dir = useDir();
  const fmt = (v: string) => (v ? formatDay(v, locale) : t("Not recorded"));
  // Which module is showing is client state, not a route. The sidebar used to
  // be plain links, so every click reloaded the page and re-fetched the whole
  // workspace. Now a click changes the address bar and this state; the data
  // already in memory is reused, and a fresh load happens only on a real
  // reload. Back and forward still work through popstate.
  const [module, setModule] = useState(movedModules[initialModule] || initialModule);
  useEffect(() => {
    const onPop = () => setModule(moduleFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function goTo(id: string, event?: React.MouseEvent) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
    event?.preventDefault();
    const href = id === "home" ? "/" : "/" + id;
    if (window.location.pathname !== href) window.history.pushState(null, "", href);
    setModule(id);
    window.scrollTo({ top: 0 });
  }
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
    [importMode, setImportMode] = useState<"create" | "update">("create"),
    [sheetHeaders, setSheetHeaders] = useState<string[]>([]),
    [importMapping, setImportMapping] = useState<Row>({}),
    [importKey, setImportKey] = useState("national_id"),
    [mappingFields, setMappingFields] = useState<string[]>([]),
    [mappingKeys, setMappingKeys] = useState<string[]>([]),
    [savedMappings, setSavedMappings] = useState<Row[]>([]),
    [mappingName, setMappingName] = useState(""),
    [importRows, setImportRows] = useState<Row[]>([]),
    [preview, setPreview] = useState<Row | null>(null),
    [importId, setImportId] = useState(""),
    [serviceFilters, setServiceFilters] = useState<Row>({ platform: "All", track: "All", group: "All", coordinator: "All", reviewer: "All", age: "All", automatic: "All", corrections: "All" }),
    [submissionFilters, setSubmissionFilters] = useState<Row>({ state: "All", track: "All", group: "All", coordinator: "All" }),
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
  // The server sends only per-student counts; identity fields come from the
  // student list already in memory, so the same facts are not shipped twice.
  const studentsById = new Map<string, Row>((d.students || []).map((s: Row) => [s.id, s]));
  const serviceSubmissionStatus: Row[] = (d.serviceSubmissionStatus || []).map((r: Row) => {
    const s = studentsById.get(r.student_id) || {};
    return { ...r, student_name: s.name, group_id: s.group_id, lifecycle: s.lifecycle, track: s.track, coordinator: s.coordinator, coordinator_name: s.coordinator_name };
  });
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
  // Published services are reviewed by the quality team. Everyone else with a
  // stake — the coordinator of the group, their supervisor, Project Operations
  // — watches the queue and the coverage without deciding on it.
  const canSeeServiceQueue = can(user.roles, [
    "Quality Member",
    "Quality Lead",
    "Operations Coordinator",
    "Team Supervisor",
    "Project Operations",
    "Operations Systems / Admin",
  ]);
  const isQualityLead = can(user.roles, ["Quality Lead", "Operations Systems / Admin"]);
  // A reviewer whose only authority is quality review acts on what is assigned to them.
  const assignedOnly =
    can(user.roles, ["Quality Member"]) &&
    !can(user.roles, ["Quality Lead", "Operations Systems / Admin", "Project Operations", "Operations Coordinator", "Team Supervisor", "Coach", "Coach Operations", "Higher Board"]);
  const canDecideServiceLinks = can(user.roles, ["Quality Member", "Quality Lead", "Operations Systems / Admin"]);
  const heldRoles = (s: Row) => {
    try { return (Array.isArray(s.roles) ? s.roles : JSON.parse(s.roles || "[]")) as string[]; } catch { return []; }
  };
  // The reviewing team: the leader hands the work out and carries none of it,
  // so they are not in the pool a student can be assigned to.
  const qualityReviewers: Row[] = staff.filter(
    (s: Row) =>
      !(s.active === 0 || s.active === false) &&
      heldRoles(s).includes("Quality Member") &&
      !heldRoles(s).includes("Quality Lead"),
  );
  // The quality team is here to review published services and nothing else, so
  // that is the whole of their workspace. Anyone who also holds an operations
  // role keeps the rest of it.
  const qualityOnly =
    heldRoles(user).length > 0 &&
    heldRoles(user).every((role) => role === "Quality Member" || role === "Quality Lead");
  // Spreadsheets in and out are for leaders, supervisors and administrators;
  // the server refuses everyone else, so the buttons are not offered either.
  const canTransfer = can(user.roles, dataTransferRoles);
  const shownNav = nav.filter(([m]) =>
    qualityOnly
      ? m === "quality"
      : m === "administration"
        ? can(user.roles, ["Operations Systems / Admin"])
        : m === "program"
          ? can(user.roles, ["Project Operations", "Coach Operations", "Operations Systems / Admin"])
        : m === "weekly"
          ? can(user.roles, [
              "Operations Coordinator",
              "Team Supervisor",
              "Project Operations",
              "Coach Operations",
              "Operations Systems / Admin",
              "Higher Board",
            ])
        : m === "reports"
          ? can(user.roles, [
              "Team Supervisor",
              "Project Operations",
              "Coach Operations",
              "Operations Systems / Admin",
              "Higher Board",
            ])
        : m === "quality"
          ? canSeeServiceQueue || can(user.roles, ["Higher Board"])
          : m === "accounts"
            ? can(user.roles, [
                "Higher Board",
                "Project Operations",
                "Operations Coordinator",
                "Operations Systems / Admin",
              ])
            : true,
  );
  // A module nobody showed them is not a module they can open by typing its
  // address either.
  const allowedModules = shownNav.map(([m]) => String(m));
  useEffect(() => {
    if (allowedModules.length && !allowedModules.includes(module)) goTo(allowedModules[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, allowedModules.join(",")]);
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
    const r = await fetch(action === "bulk_group_owner" ? "/api/program" : "/api/operations", {
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
      toast.success(t("Saved to the activity history"));
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
          ? result.summary.remaining
            ? t("{v0} policy actions processed · Run again for {v1} remaining", { v0: result.summary.processed, v1: result.summary.remaining })
            : t("{v0} policy actions processed", { v0: result.summary.processed })
          : action === "load_demo_data"
            ? t("Synthetic pilot loaded · {v0} students across {v1} groups", { v0: result.summary.students, v1: result.summary.groups })
          : t("Updated"),
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
        throw Error(t("Choose the student before uploading proof."));
      const f = new FormData();
      f.append("file", file);
      f.append("student_id", form.student_id);
      f.append(
        "activity_type",
        modal?.action === "gig_transition"
          ? form.status || "Client activity"
          : modal?.action === "contact"
            ? "Student contact"
            : modal?.action === "evidence" || modal?.action === "gig"
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
      toast.success(t("Screenshot uploaded securely"));
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function field(key: string, label: string, type = "text", required = true) {
    return (
      <label className="field" key={key}>
        {t(label)}
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
        {t(label)}
        {required ? " *" : ""}
        <Pick
          label={t(label)}
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
      t("Student"),
      students.map((s) => ({ value: s.id, label: s.name + " · " + s.id })),
    );
  // The action owner is whoever records it; the server enforces the same.
  const ownerLine = () => (
    <label className="field">
      {t("Action owner")}
      <input value={t("You ({v0})", { v0: user.name || user.email })} readOnly />
    </label>
  );
  const staffPick = (key: string, label: string) =>
    choice(
      key,
      label,
      staff.map((s: Row) => ({ value: s.id, label: s.name })),
    );
  const proofField = (key = "proof_id", label = "Screenshot proof") => (
    <div className="proof-field">
      <label className="field">{t(label)} *</label>
      {form.student_id &&
        (d.attachments || []).filter(
          (a: Row) => a.student_id === form.student_id,
        ).length > 0 &&
        choice(
          key,
          t("Existing {v0}", { v0: label.toLowerCase() }),
          (d.attachments || [])
            .filter((a: Row) => a.student_id === form.student_id)
            .map((a: Row) => ({ value: a.id, label: a.name })),
        )}
      <label className="upload">
        <Upload size={22} />
        <strong>
          {form[`${key}_name`] || t("Upload {v0}", { v0: label.toLowerCase() })}
        </strong>
        <span>{t("PNG or JPEG · up to 8 MB")}</span>
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
          <CheckCircle2 size={15} /> {t("Screenshot linked to this student")}
        </span>
      )}
    </div>
  );
  function routeQueue(q: string) {
    // Same in-page switch as the sidebar, carrying the queue as state.
    window.history.pushState(null, "", "/work?queue=" + encodeURIComponent(q));
    setFilter(q);
    setSearch("");
    setModule("work");
    window.scrollTo({ top: 0 });
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
                {s.provider ? <> <span>·</span> {s.provider}</> : null}
                {s.round_1 && s.round_1 !== "Current Round" ? (
                  <> <span className="badge muted">{t(s.round_1)}</span></>
                ) : null}
              </small>
            </span>
            <span className="student-next">
              <span>{s.next_task?.title || t("No next action")}</span>
              <small>
                {s.coordinator_name} ·{" "}
                {s.next_task ? fmt(s.next_task.due) : t("Assign an action")}
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
        {rows.map((task) => (
          <article className="task-row" key={task.id}>
            <button
              className="complete"
              aria-label={"Complete " + task.title}
              disabled={busy}
              onClick={() => quick("complete_task", { id: task.id })}
            >
              <CheckCheck size={17} />
            </button>
            <div className="task-main">
              <strong>{task.title}</strong>
              <button
                className="text-link muted"
                onClick={() =>
                  setSelected(
                    students.find((s) => s.id === task.student_id) || null,
                  )
                }
              >
                {name(task.student_id)} <span>· {task.category}</span>
              </button>
            </div>
            <span className="task-owner">{owner(task.owner)}</span>
            <span
              className={task.due < new Date().toISOString() ? "due late" : "due"}
            >
              <Clock3 size={14} />
              {fmt(task.due)}
            </span>
            {task.category === "Contact" ? (
              <button
                className="small-btn"
                onClick={() => open("contact", { student_id: task.student_id })}
              >
                {t("Log contact")}
              </button>
            ) : (
              <button
                className="icon-btn"
                aria-label={t("Open student")}
                onClick={() =>
                  setSelected(
                    students.find((s) => s.id === task.student_id) || null,
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
          <h2>{t(title)}</h2>
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
            {t("{v0} of {v1} records", {
              v0: rows.length ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, rows.length)}` : "0",
              v1: rows.length,
            })}
          </span>
          <div>
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              {t("Previous")}
            </button>
            <button
              disabled={page * 25 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              {t("Next")}
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
              <TableHead key={c.key}>{t(c.label)}</TableHead>
            ))}
            {action && (
              <TableHead>
                <span className="sr-only">{t("Actions")}</span>
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
    label: t("Student"),
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
    label: t("Status"),
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
        : module === "quality" || module === "gigs"
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
        label: t("Active students"),
        value: students.length,
        detail: t("{v0} assigned groups", { v0: groups.length }),
        icon: Users,
        q: "All",
      },
      {
        label: t("Contact compliance"),
        value: compliance + "%",
        detail: t("{v0} students need contact", { v0: noContact.length }),
        icon: MessageSquare,
        q: "No Contact",
      },
      {
        label: t("Evidence waiting"),
        value: reviews.length,
        detail: t("{v0} require correction", { v0: rejected.length }),
        icon: Files,
        q: "Evidence Blocker",
      },
      {
        label: t("Graduation progress"),
        value: graduates.length,
        detail: t("{v0}% achieved · 85% target", { v0: students.length ? Math.round((graduates.length / students.length) * 100) : 0 }),
        icon: GraduationCap,
        q: "All",
      },
    ];
    content = (
      <>
        <div className="greeting">
          <div>
            <div className="eyebrow">{t("ROUND 5 / OPERATIONS OVERVIEW")}</div>
            <h1>{t("Keep every student moving.")}</h1>
            <p>{t("Your team’s priorities, progress and exceptions in one place.")}</p>
          </div>
          <button className="primary" onClick={() => open("contact")}>
            <Plus size={18} /> {t("Log contact")}
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
                <span>{t(s.label)}</span>
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
                  <div className="eyebrow">{t("START HERE")}</div>
                  <h2>{t("Today needs your attention")}</h2>
                </div>
                <a className="text-link" href="/work">
                  {t("View my work")}{" "}<ArrowRight size={16} />
                </a>
              </div>
              <div className="priority-grid">
                {[
                  {
                    q: "Overdue",
                    n: overdue.length,
                    text: t("Overdue actions"),
                    icon: Clock3,
                    color: "red",
                  },
                  {
                    q: "Critical",
                    n: critical.length,
                    text: t("Critical students"),
                    icon: AlertTriangle,
                    color: "amber",
                  },
                  {
                    q: "Due Today",
                    n: dueToday.length,
                    text: t("Due today"),
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
              t("Next actions"),
              taskRows([...overdue, ...dueToday].slice(0, 5)),
              <a href="/work" className="text-link">
                {t("View all")}{" "}<ChevronRight size={16} />
              </a>,
            )}
            {panel(
              t("Students needing intervention"),
              studentRows(critical.slice(0, 4)),
              <span className="count">{critical.length}</span>,
            )}
          </div>
          <div className="side-column">
            <section className="journey-card">
              <div className="eyebrow">{t("COHORT JOURNEY")}</div>
              <h2>{t("Progress with proof.")}</h2>
              <p>{t("Only Quality-accepted gigs count toward graduation.")}</p>
              <div className="journey-total">
                <strong>{graduates.length}</strong>
                <span>
                  {t("of {v0} students", { v0: students.length })}
                  <br />
                  {t("graduated")}
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
                <span>{t("Current progress")}</span>
                <span>{t("Target 85%")}</span>
              </div>
              <div className="journey-stages">
                {["0/3", "1/3", "2/3", "Graduated"].map((v, i) => (
                  <div key={v}>
                    <span>
                      <i className={"stage-dot dot-" + i} />
                      {v === "Graduated" ? t("Graduated") : v + " qualifying gigs"}
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
                {t("Explore graduation report")}{" "}<ArrowRight size={16} />
              </a>
            </section>
            {panel(
              t("Upcoming sessions"),
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
                      <strong>{s.group_id} {t("· Delivery clinic")}</strong>
                      <small>
                        {new Date(s.starts_at).toLocaleTimeString("en", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        {t("· Week")}{" "}{s.week}
                      </small>
                    </span>
                  </a>
                ))}
              </div>,
            )}
            <div className="policy-note">
              <ShieldCheck size={20} />
              <div>
                <strong>{t("Every action has a trail")}</strong>
                <p>{t("Round 5 policy v1 · Staff access only")}</p>
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
      t("Student directory"),
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
          filter === "All" ? t("Open actions") : filter,
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
                {t("{v0} pathway · Week {v1}", { v0: t(g.pathway), v1: g.week })}
              </p>
              <p className="footnote">{g.trajectory_reason}</p>
              <div className="group-metrics">
                <span>
                  <strong>{ss.length}</strong> {t("Students")}
                </span>
                <span>
                  <strong>{cc}</strong> {t("Critical")}
                </span>
                <span>
                  <strong>
                    {ss.filter((s) => s.graduation.includes("Graduate")).length}
                  </strong>{" "}
                  {t("Graduated")}
                </span>
              </div>
              <div className="group-owners">
                <span>
                  {t("Coordinator")}{" "}<strong>{g.coordinator_name}</strong>
                </span>
                <span>
                  {t("Coach")}{" "}<strong>{g.coach_name}</strong>
                </span>
              </div>
              <div className="detail-actions">
                {(can(user.roles, ["Project Operations", "Operations Systems / Admin"]) ||
                  (can(user.roles, ["Team Supervisor"]) && g.supervisor === user.id)) && (
                  <button
                    className="small-btn"
                    onClick={() =>
                      open("bulk_group_owner", {
                        group_ids: [g.id],
                        owner_type: "Coordinator",
                        owner: g.coordinator,
                      })
                    }
                  >
                    {t("Change coordinator")}
                  </button>
                )}
                {g.session_link && (
                  <a className="small-btn" href={g.session_link} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> {t("Session link")}
                  </a>
                )}
                <button
                  className="group-link"
                  onClick={() => {
                    window.history.pushState(null, "", "/students?queue=All");
                    setFilter("All");
                    setSearch(g.id);
                    setModule("students");
                    window.scrollTo({ top: 0 });
                  }}
                >
                  {t("Open student group")}{" "}<ArrowRight size={16} />
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("group_gate", { group_id: g.id, week: g.week })
                  }
                >
                  {t("Weekly gate")}
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
            {t("Sessions today")}
          </span>
          <span>
            <strong>
              {sessions.filter((session) => session.status === "Scheduled").length}
            </strong>
            {t("Unconfirmed coaches")}
          </span>
          <span>
            <strong>{missingAttendance.length}</strong>
            {t("Missing attendance")}
          </span>
          <span>
            <strong>
              {sessions.filter((session) => session.status === "Cancelled").length}
            </strong>
            {t("Cancelled sessions")}
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
            {t("Coach evidence >24h")}
          </span>
          <span>
            <strong>{coverageGaps.length}</strong>
            {t("Coverage gaps")}
          </span>
        </div>
        {panel(
          t("Session schedule"),
          generic(
            sessionRows,
        [
          {
            key: "starts_at",
            label: t("Date & time"),
            render: (r) => (
              <>
                <strong>{fmt(r.starts_at)}</strong>
                <small className="block">
                  {new Date(r.starts_at).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Africa/Cairo",
                  })}
                </small>
              </>
            ),
          },
          { key: "title", label: t("Session") },
          { key: "group_id", label: t("Group") },
          {
            key: "coach_id",
            label: t("Coach"),
            render: (r) => owner(r.coach_id),
          },
          { key: "week", label: t("Week") },
          {
            key: "duration_minutes",
            label: t("Duration"),
            render: (r) => `${r.duration_minutes || 180} min`,
          },
          statusCol,
          {
            key: "link",
            label: t("Link"),
            render: (r) => {
              const link = groups.find((g) => g.id === r.group_id)?.session_link;
              return link ? (
                <a className="text-link" href={link} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> {t("Join")}
                </a>
              ) : (
                "—"
              );
            },
          },
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
                  {t("Confirm")}
                </button>
              )}
            {["Scheduled", "Confirmed"].includes(r.status) &&
              can(user.roles, ["Coach Operations", "Project Operations"]) && (
                <>
                  <button
                    className="small-btn"
                    onClick={() => open("session_reschedule", r)}
                  >
                    {t("Reschedule")}
                  </button>
                  <button
                    className="small-btn"
                    onClick={() => open("session_cancel", r)}
                  >
                    {t("Cancel")}
                  </button>
                </>
              )}
            {r.status !== "Cancelled" &&
              Date.parse(r.starts_at) <= Date.now() && (
              <button
                className="small-btn"
                onClick={() => open("attendance", { session_id: r.id })}
              >
                {t("Attendance")}
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
            {t("Account pool")}{" "}
            <span className="count">{(d.accounts || []).length}</span>
          </TabsTrigger>
          <TabsTrigger value="requests">
            {t("Requests")}{" "}<span className="count">{(d.requests || []).length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pool">
          {panel(
            t("Controlled client accounts"),
            generic(
              (d.accounts || []).filter(qMatch),
              [
                {
                  key: "label",
                  label: t("Account"),
                  render: (r) => (
                    <>
                      <strong>{r.label}</strong>
                      <small className="block">{r.id}</small>
                    </>
                  ),
                },
                { key: "platform", label: t("Platform") },
                statusCol,
                {
                  key: "credits",
                  label: t("Available credit"),
                  render: (r) => "$" + r.credits,
                },
              ],
              (r) => (
                <button
                  className="small-btn"
                  onClick={() => open("account_status", r)}
                >
                  {t("Manage")}
                </button>
              ),
            ),
            <div className="detail-actions">
              {can(user.roles, ["Higher Board"]) && (
                <button className="small-btn" onClick={() => open("account")}>
                  {t("Add account")}
                </button>
              )}
              {can(user.roles, [
                "Project Operations",
                "Operations Systems / Admin",
              ]) && (
                <button className="small-btn" onClick={() => open("task_bank")}>
                  {t("Add approved task")}
                </button>
              )}
            </div>,
          )}
        </TabsContent>
        <TabsContent value="requests">
          {panel(
            t("Account requests"),
            generic(
              (d.requests || []).filter(qMatch),
              [
                studentCol,
                { key: "task", label: t("Task") },
                { key: "platform", label: t("Platform") },
                { key: "value", label: t("Credit needed") },
                {
                  key: "status",
                  label: t("Status"),
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
                    {t("Approve allocation")}
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
                    {t("Reserve account")}
                  </button>
                );
              },
            ),
          )}
        </TabsContent>
      </Tabs>
    );
  } else if (module === "gigs") {
    // One row per gig: the paid job and the review of its proof together.
    const latestEvidence = new Map<string, Row>();
    for (const e of evidence)
      if (!latestEvidence.has(e.gig_id) || String(e.created_at) > String(latestEvidence.get(e.gig_id)!.created_at))
        latestEvidence.set(e.gig_id, e);
    const latestPackage = new Map<string, Row>();
    for (const p of d.evidencePackages || [])
      if (!latestPackage.has(p.evidence_id) || Number(p.revision) > Number(latestPackage.get(p.evidence_id)!.revision))
        latestPackage.set(p.evidence_id, p);
    const proofOf = (ev: Row | undefined, type: string) => {
      const pkg = ev && latestPackage.get(ev.id);
      const item = pkg && (d.evidencePackageItems || []).find((i: Row) => i.package_id === pkg.id && i.item_type === type);
      return item?.attachment_id || (type === "Delivery" ? ev?.proof_id : null);
    };
    const rows = gigs
      .map((g): Row => {
        const ev = latestEvidence.get(g.id);
        return { ...g, evidence: ev, stage: ev ? ev.status : g.status, stage_at: ev ? ev.stage_at : g.created_at };
      })
      .filter(qMatch)
      .filter((r) => filter === "All" || r.stage === filter)
      .sort((a, b) => String(a.stage_at).localeCompare(String(b.stage_at)));
    content = panel(
      t("Gigs and their review"),
      generic(
        rows,
        [
          studentCol,
          { key: "title", label: t("Gig") },
          { key: "platform", label: t("Platform") },
          {
            key: "value",
            label: t("Value"),
            render: (r) => {
              const fx = (d.fxApplications || []).find(
                (x: Row) => x.gig_id === r.id,
              );
              return (
                <>
                  {r.currency + " " + r.value}
                  {fx && (
                    <small className="block">{t("Approved USD")}{" "}{fx.usd_value}</small>
                  )}
                  {r.paid_on && (
                    <small className="block">{t("Paid {v0}", { v0: fmt(r.paid_on) })}</small>
                  )}
                </>
              );
            },
          },
          {
            key: "stage",
            label: t("Review stage"),
            render: (r) => (
              <span>
                <Badge value={r.stage} />
                <small className="table-subline">{t("since {v0}", { v0: fmt(r.stage_at) })}</small>
              </span>
            ),
          },
          {
            key: "proof",
            label: t("Proof"),
            render: (r) => {
              const delivery = proofOf(r.evidence, "Delivery"), payment = proofOf(r.evidence, "Payment");
              return delivery || payment ? (
                <span className="detail-actions">
                  {delivery && (
                    <a className="text-link" target="_blank" rel="noreferrer" href={"/api/files?id=" + delivery}>
                      <Paperclip size={15} /> {t("Delivery")}
                    </a>
                  )}
                  {payment && (
                    <a className="text-link" target="_blank" rel="noreferrer" href={"/api/files?id=" + payment}>
                      <Paperclip size={15} /> {t("Payment")}
                    </a>
                  )}
                </span>
              ) : (
                <span className="badge amber">{t("No proof yet")}</span>
              );
            },
          },
        ],
        (r) => (
          <div className="detail-actions">
            {r.evidence && (
              <button className="small-btn" onClick={() => open("review", r.evidence)}>
                {t("Open review")}
              </button>
            )}
            {/* A controlled-account gig still moves step by step until it is paid. */}
            {!r.evidence && !["Paid", "Cancelled", "Failed"].includes(r.status) && (
              <button
                className="small-btn"
                onClick={() =>
                  open("gig_transition", { ...r, student_id: r.student_id })
                }
              >
                {t("Record activity")}
              </button>
            )}
            {!r.evidence && r.status === "Paid" && (
              <button
                className="small-btn"
                onClick={() => open("evidence", { student_id: r.student_id, gig_id: r.id })}
              >
                {t("Add proof")}
              </button>
            )}
            {r.currency !== "USD" &&
              can(user.roles, ["Project Operations"]) && (
                <button
                  className="small-btn"
                  onClick={() =>
                    open("fx_apply", { gig_id: r.id, currency: r.currency })
                  }
                >
                  {t("Apply FX")}
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
                  {t("Refund credit")}
                </button>
              )}
          </div>
        ),
      ),
    );
  } else if (module === "quality") {
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
      .filter((r) =>
        serviceFilters.reviewer === "All"
          ? true
          : serviceFilters.reviewer === "None"
            ? !r.qc_actor
            : r.qc_actor === serviceFilters.reviewer,
      )
      .filter((r) => serviceFilters.automatic === "All" || r.auto_status === serviceFilters.automatic)
      .filter((r) => serviceFilters.corrections === "All" || (serviceFilters.corrections === "Repeated" ? Number(r.correction_count) > 1 : Number(r.correction_count) === Number(serviceFilters.corrections)))
      .filter((r) => serviceFilters.age === "All" || Date.now() - Date.parse(r.updated_at) >= Number(serviceFilters.age) * 3600000);
    // One student at a time: a student's links stay together and in slot order,
    // and the student waiting longest comes first so the SLA still drives the
    // queue. Each link keeps its own decision.
    const waitingSince = serviceQueue.reduce((out: Row, r: Row) => {
      const current = out[r.student_id];
      out[r.student_id] = !current || r.updated_at < current ? r.updated_at : current;
      return out;
    }, {} as Row);
    serviceQueue.sort(
      (a, b) =>
        String(waitingSince[a.student_id]).localeCompare(String(waitingSince[b.student_id])) ||
        String(a.student_id).localeCompare(String(b.student_id)) ||
        Number(a.slot) - Number(b.slot),
    );
    const reviewerStudents = new Map<string, number>();
    for (const [actor, students] of Object.entries(
      serviceLinks.reduce((out: Record<string, Set<string>>, link: Row) => {
        if (!link.qc_actor || link.qc_status === "Locked") return out;
        (out[link.qc_actor] ||= new Set()).add(link.student_id);
        return out;
      }, {}),
    ))
      reviewerStudents.set(actor, (students as Set<string>).size);
    const reviewerWorkload = Object.entries(serviceLinkReviews.reduce((out: Row, review: Row) => {
      const key = review.reviewer_name || owner(review.reviewed_by);
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {})).sort((a: any, b: any) => b[1] - a[1]);
    // One plain follow-up state per student, so a coordinator can see who has
    // not submitted at all and who is waiting on the student rather than on QC.
    const submissionState = (r: Row) =>
      Number(r.links_submitted) === 0
        ? "Not submitted"
        : Number(r.links_need_correction) > 0
          ? "Needs student correction"
          : Number(r.links_locked) === 3
            ? "Complete"
            : "Awaiting QC";
    const submissionRows = serviceSubmissionStatus
      .map((r): Row => ({ ...r, follow_up: submissionState(r) }))
      .filter(qMatch)
      .filter((r) => submissionFilters.state === "All" || r.follow_up === submissionFilters.state)
      .filter((r) => submissionFilters.track === "All" || r.track === submissionFilters.track)
      .filter((r) => submissionFilters.group === "All" || r.group_id === submissionFilters.group)
      .filter((r) => submissionFilters.coordinator === "All" || r.coordinator === submissionFilters.coordinator)
      .sort(
        (a, b) =>
          ["Not submitted", "Needs student correction", "Awaiting QC", "Complete"].indexOf(a.follow_up) -
            ["Not submitted", "Needs student correction", "Awaiting QC", "Complete"].indexOf(b.follow_up) ||
          String(a.student_name).localeCompare(String(b.student_name)),
      );
    const submissionCount = (state: string) =>
      serviceSubmissionStatus.filter((r) => submissionState(r) === state).length;
    const submissionPanel = serviceSubmissionStatus.length > 0 && (
      <>
        <div className="mini-stats service-qc-stats">
          <span><strong>{submissionCount("Not submitted")}</strong>{t("Not submitted")}</span>
          <span><strong>{submissionCount("Awaiting QC")}</strong>{t("Awaiting QC")}</span>
          <span><strong>{submissionCount("Needs student correction")}</strong>{t("Needs student correction")}</span>
          <span><strong>{submissionCount("Complete")}</strong>{t("Complete")}</span>
        </div>
        <div className="filter-row service-qc-filters">
          <Pick label={t("Follow-up")} value={submissionFilters.state} onChange={(state) => setSubmissionFilters({ ...submissionFilters, state })} options={["All", "Not submitted", "Needs student correction", "Awaiting QC", "Complete"]} />
          <Pick label={t("Track")} value={submissionFilters.track} onChange={(track) => setSubmissionFilters({ ...submissionFilters, track })} options={["All", ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.track).filter(Boolean)))]} />
          <Pick label={t("Group")} value={submissionFilters.group} onChange={(group) => setSubmissionFilters({ ...submissionFilters, group })} options={["All", ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.group_id).filter(Boolean)))]} />
          <Pick label={t("Coordinator")} value={submissionFilters.coordinator} onChange={(coordinator) => setSubmissionFilters({ ...submissionFilters, coordinator })} options={[{ value: "All", label: t("All coordinators") }, ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.coordinator).filter(Boolean))).map((id) => ({ value: id, label: owner(id) }))]} />
        </div>
        {panel(
          t("Service-link submission status · {v0} matching", { v0: submissionRows.length }),
          paginate(submissionRows, (pageRows) => generic(
            pageRows,
            [
              { key: "student_name", label: t("Student"), render: (r) => <span><strong>{r.student_name}</strong><small className="table-subline">{r.student_id}</small></span> },
              { key: "group_id", label: t("Group"), render: (r) => <span>{r.group_id}<small className="table-subline">{r.track}</small></span> },
              { key: "coordinator", label: t("Coordinator"), render: (r) => owner(r.coordinator) },
              { key: "follow_up", label: t("Follow-up"), render: (r) => <Badge value={r.follow_up} /> },
              { key: "links_submitted", label: t("Locked"), render: (r) => <span>{r.links_locked}/3<small className="table-subline">{r.submitted_at ? t("{v0} submitted {v1}", { v0: r.links_submitted, v1: new Date(r.submitted_at).toLocaleDateString() }) : t("never submitted")}</small></span> },
            ],
            (r) => <div className="detail-actions"><button className="small-btn" onClick={() => setSelected(students.find((x) => x.id === r.student_id) || null)}>{t("Open student")}</button></div>,
          )),
        )}
      </>
    );
    content = (
      <>
        {module === "quality" && (
          <>
            {canSeeServiceQueue && (
            <>
            <div className="mini-stats service-qc-stats">
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Pending").length}</strong>{t("Awaiting review")}</span>
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Needs Correction").length}</strong>{t("Need student correction")}</span>
              <span><strong>{serviceLinks.filter((r) => r.auto_status === "Failed").length}</strong>{t("Automatic check failed")}</span>
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Pending" && Date.now() - Date.parse(r.updated_at) > 48 * 3600000).length}</strong>{t("Past 48-hour SLA")}</span>
            </div>
            <div className="filter-row service-qc-filters">
              <Pick label={t("Platform")} value={serviceFilters.platform} onChange={(platform) => setServiceFilters({ ...serviceFilters, platform })} options={["All", ...acceptedServicePlatforms]} />
              <Pick label={t("Track")} value={serviceFilters.track} onChange={(track) => setServiceFilters({ ...serviceFilters, track })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.track).filter(Boolean)))]} />
              <Pick label={t("Group")} value={serviceFilters.group} onChange={(group) => setServiceFilters({ ...serviceFilters, group })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.group_id).filter(Boolean)))]} />
              {canDecideServiceLinks && (
                <Pick
                  label={t("Assigned to")}
                  value={serviceFilters.reviewer}
                  onChange={(reviewer) => setServiceFilters({ ...serviceFilters, reviewer })}
                  options={[
                    { value: "All", label: t("Anyone") },
                    { value: user.id, label: t("Me") },
                    { value: "None", label: t("Waiting for a reviewer") },
                    ...qualityReviewers.filter((q) => q.id !== user.id).map((q) => ({ value: q.id, label: q.name })),
                  ]}
                />
              )}
              <Pick label={t("Coordinator")} value={serviceFilters.coordinator} onChange={(coordinator) => setServiceFilters({ ...serviceFilters, coordinator })} options={[{ value: "All", label: t("All coordinators") }, ...Array.from(new Set(serviceLinks.map((r) => r.coordinator).filter(Boolean))).map((id) => ({ value: id, label: owner(id) }))]} />
              <Pick label={t("Submission age")} value={serviceFilters.age} onChange={(age) => setServiceFilters({ ...serviceFilters, age })} options={[{ value: "All", label: t("Any age") }, { value: "24", label: t("24+ hours") }, { value: "48", label: t("48+ hours") }, { value: "168", label: t("7+ days") }]} />
              <Pick label={t("Automatic check")} value={serviceFilters.automatic} onChange={(automatic) => setServiceFilters({ ...serviceFilters, automatic })} options={["All", "Needs Review", "Failed"]} />
              <Pick label={t("Corrections")} value={serviceFilters.corrections} onChange={(corrections) => setServiceFilters({ ...serviceFilters, corrections })} options={[{ value: "All", label: t("Any revision") }, { value: "0", label: t("No prior review") }, { value: "1", label: t("One review") }, { value: "Repeated", label: t("Repeated corrections") }]} />
            </div>
            {isQualityLead && (
              <div className="detail-actions qc-lead-actions">
                <button className="small-btn" disabled={busy} onClick={() => quick("service_qc_assign", {})}>
                  <Users size={15} /> {t("Distribute waiting students evenly")}
                </button>
                <button className="small-btn" disabled={busy} onClick={() => quick("evidence_qc_assign", {})}>
                  <Files size={15} /> {t("Distribute gig evidence evenly")}
                </button>
                <small className="qc-lead-note">
                  {t("A student’s three services stay together with one reviewer, and a student waiting for review goes to whoever currently holds the fewest. Reviewers:")}{" "}{qualityReviewers.map((r) => `${r.name} (${reviewerStudents.get(r.id) || 0})`).join(", ") || t("none active")}.
                </small>
              </div>
            )}
            {panel(
              t("Student service-link verification · {v0} matching", { v0: serviceQueue.length }),
              paginate(serviceQueue, (pageRows) => generic(
                pageRows,
                [
                  { key: "student_name", label: t("Student"), render: (r) => { const own = serviceLinks.filter((l) => l.student_id === r.student_id); const decided = own.filter((l) => l.qc_status !== "Pending").length; return <span><strong>{r.student_name}</strong><small className="table-subline">{r.student_id} · {decided}/{own.length} {t("reviewed")}</small></span>; } },
                  { key: "slot", label: t("Slot"), render: (r) => `Service ${r.slot}` },
                  { key: "url", label: t("Link"), render: (r) => <a className="text-link" href={r.url} target="_blank" rel="noreferrer">{r.platform} <ExternalLink size={14} /></a> },
                  { key: "auto_status", label: t("Automatic check"), render: (r) => <Badge value={r.auto_status} /> },
                  { key: "reviewer_name", label: t("Reviewer"), render: (r) => isQualityLead && r.qc_status !== "Locked"
                      ? <select className="pick-inline" aria-label={t("Assign this student to a reviewer")} value={r.qc_actor || ""} disabled={busy} onChange={(e) => e.target.value && quick("service_qc_assign", { student_id: r.student_id, reviewer_id: e.target.value })}>
                          <option value="">{t("Waiting for a reviewer")}</option>
                          {qualityReviewers.map((q) => <option key={q.id} value={q.id}>{q.name} ({reviewerStudents.get(q.id) || 0})</option>)}
                        </select>
                      : <span>{owner(r.qc_actor) === "Unassigned" ? t("Waiting for a reviewer") : owner(r.qc_actor)}<small className="table-subline">{owner(r.coordinator)}</small></span> },
                  { key: "qc_status", label: t("Review state"), render: (r) => <span><Badge value={r.qc_status} /><small className="table-subline">{Math.round((Date.now() - Date.parse(r.updated_at)) / 3600000)}{t("h · revision")}{" "}{r.revision}</small></span> },
                ],
                (r) => <div className="detail-actions">{canDecideServiceLinks && (r.qc_actor === user.id || isQualityLead) && <button className="small-btn" onClick={() => open("service_qc_review", { ...r, service_id: r.id, student_id: r.student_id, decision: r.qc_status === "Needs Correction" ? "Lock" : "" })}>{t("Review")}</button>}</div>,
              )),
            )}
            {panel(t("Reviewer activity"), reviewerWorkload.length ? <div className="mini-stats">{reviewerWorkload.map(([reviewer, count]: any) => <span key={reviewer}><strong>{count}</strong>{reviewer}</span>)}</div> : <Empty title={t("No service-link reviews yet")} />)}
            </>
            )}
            {submissionPanel}
          </>
        )}
        <div className="mini-stats">
          <span>
            <strong>{reviews.length}</strong> {t("Awaiting review")}
          </span>
          <span>
            <strong>{rejected.length}</strong> {t("Require correction")}
          </span>
          <span>
            <strong>{accepted.length}</strong> {t("Accepted")}
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
            {t("Past review SLA")}
          </span>
        </div>
        {panel(
          t("Quality review queue · oldest first"),
          generic(
            rows,
            [
              studentCol,
              { key: "gig_id", label: t("Gig") },
              { key: "source", label: t("External source") },
              statusCol,
              {
                key: "stage_at",
                label: t("In stage since"),
                render: (r) => fmt(r.stage_at),
              },
              {
                key: "proof_id",
                label: t("Proof"),
                render: (r) => (
                  <a
                    className="text-link"
                    target="_blank"
                    rel="noreferrer"
                    href={"/api/files?id=" + r.proof_id}
                  >
                    <Paperclip size={15} /> {t("Screenshot")}
                  </a>
                ),
              },
            ],
            (r) =>
              (!assignedOnly || r.qc_actor === user.id) && (
                <button className="small-btn" onClick={() => open("review", r)}>
                  {t("Open review")}
                </button>
              ),
          ),
        )}
      </>
    );
  } else if (module === "cases") {
    content = panel(
      t("Incident & intervention register"),
      generic(
        (d.cases || []).filter(qMatch),
        [
          { key: "title", label: t("Case") },
          studentCol,
          {
            key: "severity",
            label: t("Severity"),
            render: (r) => <Badge value={r.severity} />,
          },
          statusCol,
          { key: "owner", label: t("Owner"), render: (r) => owner(r.owner) },
          { key: "due", label: t("Due"), render: (r) => fmt(r.due) },
        ],
        (r) => (
          <button
            className="small-btn"
            onClick={() => open("case_transition", r)}
          >
            {t("Update")}
          </button>
        ),
      ),
    );
  } else if (module === "weekly") {
    content = (
      <WeeklyProgress
        data={d}
        onStudent={(id) => setSelected(students.find((s) => s.id === id) || null)}
      />
    );
  } else if (module === "reports") {
    content = (
      <>
        <ReportsPanel canExport={canTransfer} />
        <div className="stats">
          {[
            { label: t("Contact compliance"), n: compliance + "%" },
            {
              label: t("Graduation rate"),
              n:
                (students.length
                  ? Math.round((graduates.length / students.length) * 100)
                  : 0) + "%",
            },
            { label: t("Open actions"), n: openTasks.length },
            { label: t("Quality backlog"), n: reviews.length },
          ].map((s) => (
            <div className="stat" key={s.label}>
              <span>{t(s.label)}</span>
              <strong>{s.n}</strong>
              <small>{t("Current assigned student scope")}</small>
            </div>
          ))}
        </div>
        {panel(
          t("Coordinator performance"),
          generic(
            staff
              .filter((u: Row) => u.roles.includes("Operations Coordinator"))
              .map((u: Row) => {
                const s = students.filter((s) => s.coordinator === u.id);
                return {
                  id: u.id,
                  name: u.name,
                  title: u.title || "",
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
              { key: "name", label: t("Coordinator"), render: (r: Row) => <span className="table-name">{r.name}{r.title && <small>{t(r.title)}</small>}</span> },
              { key: "students", label: t("Students") },
              { key: "contact", label: t("Contact compliance") },
              { key: "overdue", label: t("Overdue") },
              { key: "critical", label: t("Critical") },
              { key: "graduates", label: t("Graduated") },
            ],
          ),
        )}
        <div className="report-grid">
          {panel(
            t("Graduation policy"),
            <div className="prose">
              <div className="rule-number">{t("3 gigs × $5 minimum")}</div>
              <p>
                {t("Total qualifying value of at least $15, or one qualifying gig of $300 or more.")}
              </p>
              <p>
                {t("Evidence must be Quality Accepted, and the gig must be paid. Non-USD gigs count only after a separately approved rate is applied and stored with the gig.")}
              </p>
              <Badge value="Round 5 · v1" />
            </div>,
          )}
          {panel(
            t("Metric definitions"),
            <div className="prose">
              <h3>{t("Contact compliance")}</h3>
              <p>
                {t("Active students with a complete, screenshot-backed contact within 7 days ÷ active students requiring contact.")}
              </p>
              <h3>{t("Graduation rate")}</h3>
              <p>
                {t("Students meeting the applicable graduation policy ÷ active students in the selected scope.")}
              </p>
              <h3>{t("Forecast")}</h3>
              <p>
                {t("No forecast published until approved weekly milestone and forecasting policies are configured.")}
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
          <TabsTrigger value="staff">{t("Staff & access")}</TabsTrigger>
          <TabsTrigger value="policy">{t("Policy versions")}</TabsTrigger>
          <TabsTrigger value="fx">{t("FX rates")}</TabsTrigger>
          <TabsTrigger value="retention">{t("Retention")}</TabsTrigger>
          <TabsTrigger value="audit">{t("Audit history")}</TabsTrigger>
          <TabsTrigger value="imports">{t("Data transfer")}</TabsTrigger>
          <TabsTrigger value="connections">{t("Connections & recovery")}</TabsTrigger>
        </TabsList>
        <TabsContent value="staff">
          {panel(
            t("Staff directory"),
            generic(
              staff,
              [
                { key: "name", label: t("Staff member"), render: (r) => <span>{r.name}{r.title && <small className="table-subline">{t(r.title)}</small>}{(r.active === 0 || r.active === false) && <small className="table-subline"><span className="badge muted">{String(r.id).startsWith("system-unassigned") ? t("Placeholder · cannot sign in") : t("Inactive")}</span></small>}</span> },
                { key: "email", label: t("Email"), render: (r) => <span>{r.email}<small className="table-subline">{r.phone || t("no phone number")}</small></span> },
                {
                  key: "national_id",
                  label: t("Sign-in"),
                  render: (r) =>
                    // Only a 14-digit ID can be a first password; anything
                    // else is kept as recorded but cannot open a sign-in.
                    /^[23]\d{13}$/.test(String(r.national_id || "")) ? (
                      <span>{t("Ready")}<small className="table-subline">{t("national ID on record")}</small></span>
                    ) : r.national_id ? (
                      <span className="badge amber">{t("ID cannot be used to sign in")}</span>
                    ) : (
                      <span className="badge muted">{t("No national ID")}</span>
                    ),
                },
                {
                  key: "roles",
                  label: t("Roles"),
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
                    open("staff", {
                      ...r,
                      roles: JSON.parse(r.roles),
                      active: r.active === 0 || r.active === false ? "Withdrawn" : "Active",
                    })
                  }
                >
                  {t("Edit access")}
                </button>
              ),
            ),
          )}
          <p className="footnote">
            {t("A person signs in with the email listed here and their national ID as the first password. Whole teams are added from a sheet: the import workspace has a staff template with name, email and roles. Groups are then handed over by naming the person — their email or their name is enough, and the coordinator of a group reviews that group’s students.")}
          </p>
        </TabsContent>
        <TabsContent value="policy">
          {panel(
            t("Versioned business policy"),
            generic(
              d.policies || [],
              [
                { key: "name", label: t("Policy") },
                statusCol,
                {
                  key: "created_at",
                  label: t("Created"),
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
                      {t("Edit draft")}
                    </button>
                  )}
                  <button
                    className="small-btn"
                    onClick={() => open("policy_transition", r)}
                  >
                    {t("Review")}
                  </button>
                </div>
              ),
            ),
            <button className="small-btn" onClick={() => open("policy")}>
              {t("New draft")}
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
            t("Approved currency conversion evidence"),
            generic(
              d.fxRates || [],
              [
                { key: "currency", label: t("Currency") },
                { key: "usd_rate", label: t("USD per unit") },
                { key: "effective_date", label: t("Effective date") },
                statusCol,
                { key: "source", label: t("Source") },
              ],
              (r) =>
                r.status === "Draft" &&
                can(user.roles, ["Project Operations"]) ? (
                  <button
                    className="small-btn"
                    onClick={() => open("fx_rate_approve", r)}
                  >
                    {t("Approve")}
                  </button>
                ) : null,
            ),
            can(user.roles, ["Operations Systems / Admin"]) && (
              <button className="small-btn" onClick={() => open("fx_rate")}>
                {t("New FX draft")}
              </button>
            ),
          )}
        </TabsContent>
        <TabsContent value="retention">
          <RetentionPanel />
        </TabsContent>
        <TabsContent value="audit">
          {panel(
            t("Immutable activity audit"),
            generic(d.audit || [], [
              {
                key: "created_at",
                label: t("When"),
                render: (r) => new Date(r.created_at).toLocaleString(),
              },
              { key: "actor", label: t("Actor"), render: (r) => owner(r.actor) },
              { key: "action", label: t("Action") },
              { key: "entity_id", label: t("Record") },
              { key: "reason", label: t("Reason") },
            ]),
          )}
        </TabsContent>
        <TabsContent value="connections">
          <ControlCenter />
        </TabsContent>
        <TabsContent value="imports">
          <div className="panel prose">
            <h2>{t("Move operational data safely")}</h2>
            <p>
              {t("Download a template, upload XLSX or CSV, review validation results, and confirm the import. Protected fields are rejected.")}
            </p>
            <div className="detail-actions">
              <button className="primary" onClick={() => setImportOpen(true)}>
                <Upload size={17} /> {t("Open import workspace")}
              </button>
              <a className="small-btn" href="/api/export?module=workbook">
                <Download size={16} /> {t("Download the whole workbook (Excel)")}
              </a>
            </div>
            <p className="footnote">
              {t("The workbook holds one tab per dataset. Edit a tab, then upload the file in update mode: the matching tab is read, only the columns present change, and empty cells keep the stored value.")}
            </p>
          </div>
        </TabsContent>
      </Tabs>
    );
  } else
    content = (
      <Empty
        title={t("Module not found")}
        text={t("Choose a workspace from the navigation.")}
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
      <Sidebar className="app-sidebar" side={dir === "rtl" ? "right" : "left"}>
        <SidebarHeader>
          <a className="brand" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
            <img className="brand-mark-img" src="/brand/mark.png" alt="" width={38} height={38} />
            <div>
              <strong>
                {t("DEPI")}<span>{t("operations")}</span>
              </strong>
              <small>{t("CAREER180 × FREELANCE YARD")}</small>
            </div>
          </a>
          <div className="cohort-switch">
            <span className="cohort-icon">
              <Layers size={17} />
            </span>
            <div>
              <strong>{t("Round 5")}</strong>
              <small>{t("Coaching & freelancing")}</small>
            </div>
            <LockKeyhole size={14} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("WORKSPACE")}</SidebarGroupLabel>
            <SidebarMenu>
              {shownNav.map(([id, label, Icon]) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton asChild isActive={module === id}>
                    <a href={id === "home" ? "/" : "/" + id} onClick={(event) => goTo(id, event)}>
                      <Icon />
                      <span>{t(label)}</span>
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
            <span>{t("Staff-only workspace")}</span>
          </div>
          <div className="profile">
            <span className="avatar navy">{user.name?.slice(0, 1) || "A"}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.title ? t(user.title) : user.roles?.[0] || t("Workspace setup")}</small>
            </div>
            <a className="profile-signout" href="/api/auth/logout" title={t("Sign out")} aria-label={t("Sign out")}>
              <LogOut size={17} />
            </a>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger />
            <span>{t("Workspace")}</span>
            <ChevronRight size={14} />
            <strong>
              {t(nav.find((n) => n[0] === module)?.[1] || "Overview")}
            </strong>
          </div>
          <div className="header-actions">
            <span className="round-tag">{t("ROUND 5")}</span>
            <LanguageToggle className="icon-btn" />
            <GlobalSearch
              onStudent={(id) =>
                setSelected(students.find((s) => s.id === id) || null)
              }
            />
            <button
              className="icon-btn"
              aria-label={t("Refresh data")}
              onClick={refresh}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="icon-btn notification-btn"
              aria-label={t("Open notifications")}
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
                  ? t("PILOT WORKSPACE")
                  : t("PRODUCTION WORKSPACE")}
              </span>
              <span>
                {d.workspaceMode === "demo"
                  ? t("Synthetic roster · No real student or client data")
                  : t("Live operational records · Staff access only")}
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
              <h2>{t("Workspace unavailable")}</h2>
              <p>{error}</p>
              <button className="primary" onClick={refresh}>
                {t("Try again")}
              </button>
              <a href="/login">
                {t("Sign in")}
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
              {/* eslint-disable-next-line @next/next/no-img-element -- a static local logo; the Worker build does not run the image optimizer */}
              <img className="brand-logo brand-logo-large" src="/brand/logo.png" alt={t("Freelance Yard")} width={232} height={80} />
              <h1>{t("Set up your operations workspace")}</h1>
              <p>
                {d.importedRoster
                  ? t("Initialize the imported Round 5 roster as the production workspace.")
                  : t("Choose a blank production workspace for real operations, or a separate synthetic pilot dataset for training and workflow testing.")}
              </p>
              <p>
                {t("You will receive Project Operations and Systems Admin access. Quality approval and account allocation remain separate, explicitly assigned roles.")}
              </p>
              <div className="detail-actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => quick("setup", { mode: "production" })}
                >
                  {busy
                    ? t("Preparing workspace…")
                    : d.importedRoster
                      ? t("Initialize imported production roster")
                      : t("Start blank production workspace")}
                </button>
                {!d.importedRoster && (
                  <button
                    className="small-btn"
                    disabled={busy}
                    onClick={() => quick("setup", { mode: "demo" })}
                  >
                    {t("Load synthetic pilot")}
                  </button>
                )}
              </div>
              <p className="footnote">
                {t("Initialization is permanent for this workspace. Production mode records your administrator account and preserves the imported roster and reconciliation history.")}
              </p>
            </div>
          ) : (
            <>
              {module !== "home" && (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">
                        {t("ROUND 5 /")}{" "}
                        {module === "quality" ? t("ASSURANCE") : t("OPERATIONS")}
                      </div>
                      <h1>{t(nav.find((n) => n[0] === module)?.[1] || "")}</h1>
                      <p>
                        {t(
                          (
                            {
                              work: "A clear next action for every student.",
                              weekly: "Coordinators and their students, Friday to Thursday.",
                              program:
                                "Registration through screening, delivery, graduation, outcomes and controlled closure.",
                              students:
                                "One student, one owner, a complete operational picture.",
                              groups: "Rolling journeys, accountable teams.",
                              sessions: "Coaching schedules and attendance.",
                              accounts:
                                "Controlled allocations with eligibility checks.",
                              gigs: "Track delivery, payment and the proof behind them.",
                              quality:
                                "Review the evidence. Protect the outcome.",
                              cases:
                                "Own the exception, record the resolution.",
                              reports:
                                "Progress grounded in operational records.",
                              administration:
                                "Staff access, versioned policies and audit history.",
                            } as Row
                          )[module] || "",
                        )}
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
                              {t("Load synthetic pilot")}
                            </button>
                          )}
                        <button
                          className="small-btn"
                          disabled={busy}
                          onClick={() => quick("policy_check", {})}
                        >
                          <RefreshCw size={16} />
                          {t("Run policy checks")}
                        </button>
                      </div>
                    )}
                    {moduleAction[module] && (
                      <button
                        className="primary"
                        onClick={() => open(moduleAction[module])}
                      >
                        <Plus size={17} />
                        {t(
                          (
                            {
                              students: "Add student",
                              groups: "Create group",
                              sessions: "Schedule session",
                              accounts: "Request account",
                              gigs: "Record gig",
                              cases: "Open case",
                              work: "Create action",
                              administration: "Add staff",
                            } as Row
                          )[module] || "",
                        )}
                      </button>
                    )}
                  </div>
                  {!["administration", "program", "weekly"].includes(module) && (
                    <div className="toolbar">
                      <label className="search-box">
                        <Search size={17} />
                        <input
                          placeholder={t("Search {v0}…", {
                            v0: t(module === "work" ? "actions" : module),
                          })}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          aria-label={t("Search records")}
                        />
                      </label>
                      {filterOpts.length > 1 && (
                        <Pick
                          label={t("Filter records")}
                          value={filter}
                          onChange={setFilter}
                          options={filterOpts}
                        />
                      )}{" "}
                      {(d.savedViews || []).some(
                        (v: Row) => v.module === module,
                      ) && (
                        <Pick
                          label={t("Saved views")}
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
                              toast.success(t("View saved to your staff profile"));
                            } catch (e: any) {
                              toast.error(e.message);
                            }
                          }}
                        >
                          <Filter size={15} /> {t("Save view")}
                        </button>
                        {canTransfer && (<>
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
                          <Upload size={15} /> {t("Import")}
                        </button>
                        <Pick
                          label={t("Export")}
                          value=""
                          options={["CSV", "XLSX", "Workbook (all)"]}
                          onChange={(v) => {
                            const m =
                              (
                                {
                                  work: "tasks",
                                  quality: "evidence",
                                  reports: "students",
                                } as Row
                              )[module] || module;
                            window.location.href = v.startsWith("Workbook")
                              ? "/api/export?module=workbook"
                              : "/api/export?module=" +
                                m +
                                "&format=" +
                                v.toLowerCase() +
                                "&search=" +
                                encodeURIComponent(search);
                          }}
                        />
                        </>)}
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
          <span>{t("DEPI Round 5 · Coaching & Freelancing Operations")}</span>
          <span>
            <LockKeyhole size={12} /> {t("Private staff workspace")}
          </span>
        </footer>
      </SidebarInset>
      <Toaster richColors position="bottom-right" />
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="student-sheet sm:max-w-[800px] overflow-y-auto" side={dir === "rtl" ? "left" : "right"}>
          <SheetHeader>
            <SheetTitle>{t("Student 360")}</SheetTitle>
            <SheetDescription>
              {t("Operational record and evidence history")}
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
                  <small>{t("Lifecycle")}</small>
                  <Badge value={selectedStudent.lifecycle} />
                </div>
                <div>
                  <small>{t("Engagement")}</small>
                  <Badge value={selectedStudent.engagement} />
                </div>
                <div>
                  <small>{t("Coaching")}</small>
                  <Badge value={selectedStudent.coaching} />
                </div>
                <div>
                  <small>{t("Graduation")}</small>
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
                  <MessageSquare size={16} /> {t("Log contact")}
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("task", { student_id: selectedStudent.id })
                  }
                >
                  {t("Next action")}
                </button>
                <button
                  className="small-btn"
                  onClick={() =>
                    open("engagement", { student_id: selectedStudent.id })
                  }
                >
                  {t("Review risk")}
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
                  ].map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {t(tab[0].toUpperCase() + tab.slice(1))}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="overview">
                  <div className="risk-box">
                    <AlertTriangle size={20} />
                    <div>
                      <strong>
                        {t("System recommendation:")}{" "}{selectedStudent.risk.status}
                      </strong>
                      <p>
                        {selectedStudent.risk.reasons.join(" · ") ||
                          t("No active risk triggers")}
                      </p>
                    </div>
                  </div>
                  <div className="detail-grid">
                    {[
                      ["Training provider", selectedStudent.provider || t("Not recorded")],
                      ["Round", selectedStudent.round_1 || t("Not recorded")],
                      ["Enrolment", selectedStudent.student_type || t("Not recorded")],
                      ["Coordinator", owner(selectedStudent.coordinator)],
                      ["Supervisor", owner(selectedStudent.supervisor)],
                      ["Coach", owner(selectedStudent.coach)],
                      ["Journey", t("Week {v0}", { v0: selectedStudent.week })],
                      ["Pathway", selectedStudent.pathway],
                      ["Last valid contact", fmt(selectedStudent.last_contact)],
                      [
                        "Attendance",
                        selectedStudent.attendance === null
                          ? t("Not recorded")
                          : selectedStudent.attendance + "%",
                      ],
                      ["Provider", selectedStudent.provider],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <small>{t(k)}</small>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="next-action-box">
                    <small>{t("NEXT ACTION")}</small>
                    <h3>
                      {selectedStudent.next_task?.title ||
                        t("No next action assigned")}
                    </h3>
                    <p>
                      {selectedStudent.next_task
                        ? owner(selectedStudent.next_task.owner) +
                          " · Due " +
                          fmt(selectedStudent.next_task.due)
                        : t("Create an action with an owner and due date.")}
                    </p>
                  </div>
                  <div className="detail-actions">
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("milestone", { student_id: selectedStudent.id })
                      }
                    >
                      {t("Update milestone")}
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("lifecycle", { student_id: selectedStudent.id })
                      }
                    >
                      {t("Lifecycle")}
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("transfer", { student_id: selectedStudent.id })
                      }
                    >
                      {t("Transfer student")}
                    </button>
                    <button
                      className="small-btn"
                      onClick={() =>
                        open("case", { student_id: selectedStudent.id })
                      }
                    >
                      {t("Open case")}
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
                            title={t("No contacts recorded")}
                            text={t("Log a contact with screenshot proof and a next action.")}
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
                                <small>{t("Recorded by")}{" "}{owner(c.recorder)}</small>
                                <a
                                  href={"/api/files?id=" + c.proof_id}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {t("View screenshot")}{" "}<ExternalLink size={14} />
                                </a>
                              </article>
                            ))
                        )}
                      </div>
                    ) : tab === "services" ? (
                      <div className="history">
                        {serviceLinks.filter((link) => link.student_id === selectedStudent.id).length === 0 ? (
                          <Empty title={t("No service links submitted")} text={t("The student has not submitted service links yet.")} />
                        ) : serviceLinks.filter((link) => link.student_id === selectedStudent.id).map((link) => (
                          <article key={link.id}>
                            <div className="detail-actions"><Badge value={t("Service {v0}", { v0: link.slot })} /><Badge value={link.qc_status} /><Badge value={link.auto_status} /></div>
                            <h3><a className="text-link" href={link.url} target="_blank" rel="noreferrer">{link.platform} <ExternalLink size={14} /></a></h3>
                            <p>{(() => { try { return JSON.parse(link.auto_result || "{}").message; } catch { return t("Automatic details unavailable."); } })()}</p>
                            <small>{t("Revision")}{" "}{link.revision} {t("· submitted")}{" "}{new Date(link.submitted_at).toLocaleString()}{link.qc_at ? t(" · reviewed {v0} by {v1}", { v0: new Date(link.qc_at).toLocaleString(), v1: link.reviewer_name || owner(link.qc_actor) }) : ""}</small>
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
                        [{ key: "id", label: t("Evidence") }, statusCol],
                        (r) =>
                          (!assignedOnly || r.qc_actor === user.id) && (
                            <button
                              className="small-btn"
                              onClick={() => open("review", r)}
                            >
                              {t("Review")}
                            </button>
                          ),
                      )
                    ) : tab === "gigs" ? (
                      generic(
                        gigs.filter((g) => g.student_id === selectedStudent.id),
                        [{ key: "title", label: t("Gig") }, statusCol],
                        (r) => (
                          <button
                            className="small-btn"
                            onClick={() => open("gig_transition", r)}
                          >
                            {t("Activity")}
                          </button>
                        ),
                      )
                    ) : tab === "cases" ? (
                      generic(
                        (d.cases || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "title", label: t("Case") }, statusCol],
                      )
                    ) : tab === "accounts" ? (
                      generic(
                        (d.requests || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "task", label: t("Request") }, statusCol],
                      )
                    ) : tab === "sessions" ? (
                      generic(
                        (d.attendance || []).filter(
                          (c: Row) => c.student_id === selectedStudent.id,
                        ),
                        [{ key: "session_id", label: t("Session") }, statusCol],
                      )
                    ) : (
                      generic(
                        (d.audit || []).filter(
                          (a: Row) =>
                            a.entity_id === selectedStudent.id ||
                            a.value.includes(selectedStudent.id),
                        ),
                        [
                          { key: "action", label: t("Action") },
                          {
                            key: "actor",
                            label: t("Staff recorder"),
                            render: (r) => owner(r.actor),
                          },
                          {
                            key: "created_at",
                            label: t("When"),
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
              {t(titles[modal?.action || ""] || "Update record")}
            </DialogTitle>
            <DialogDescription>
              {t(actionCopy[modal?.action || ""] ||
                "Changes are validated and recorded in the audit history.")}
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
                      {choice("channel", t("Channel"), [
                        "WhatsApp",
                        "Email",
                        "Phone",
                        "Form",
                        "Other",
                      ])}
                      {choice("outcome", t("Outcome"), [
                        "Responded",
                        "No Response",
                        "Follow-Up Required",
                        "Problem Identified",
                        "Escalated",
                      ])}
                      {field(
                        "occurred_at",
                        t("Contact date & time"),
                        "datetime-local",
                      )}
                    </div>
                    {proofField()}
                    {field("next_action", t("Next action"))}
                    {ownerLine()}
                    {field("due", t("Action due date"), "datetime-local")}
                    {field("notes", t("Notes"), "text", false)}
                  </>
                );
              if (a === "task")
                return (
                  <>
                    {studentPick()}
                    {field("title", t("Next action"))}
                    {ownerLine()}
                    {field("due", t("Due date"), "datetime-local")}
                    {choice("category", t("Category"), [
                      "Follow-up",
                      "Recovery",
                      "Contact",
                      "Evidence",
                      "Account",
                    ])}
                    {choice("priority", t("Priority"), [
                      "Normal",
                      "High",
                      "Urgent",
                    ])}
                  </>
                );
              if (a === "student")
                return (
                  <>
                    {field("id", t("Student ID (e.g. S20001)"))}
                    {field("name", t("Full name"))}
                    {choice(
                      "group_id",
                      t("Group"),
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("email", t("Supabase sign-in email"), "email")}
                    {field("phone", t("Phone"), "tel", false)}
                    {choice("lifecycle", t("Lifecycle"), ["Active", "Paused", "Transferred", "Withdrawn", "Removed", "Graduate Closed", "Non-Graduate Closed"], false)}
                    {choice("engagement", t("Engagement"), ["Active", "At Risk", "Critical", "Unresponsive"], false)}
                    {field("coaching", t("Coaching status"), "text", false)}
                  </>
                );
              if (a === "group")
                return (
                  <>
                    {field("id", t("Group ID"))}
                    {field("name", t("Group name"))}
                    {choice(
                      "track",
                      t("Track"),
                      (d.tracks || []).map((track: Row) => track.name),
                    )}
                    {choice("provider", t("Provider"), [
                      "Career180",
                      "Freelance Yard",
                    ])}
                    {staffPick("coordinator", t("Coordinator"))}
                    {staffPick("supervisor", t("Supervisor"))}
                    {staffPick("coach", t("Coach"))}
                    {choice("pathway", t("Pathway"), ["Outcome", "Support"])}
                    {field("start_date", t("Start date"), "date")}
                    {choice(
                      "policy_id",
                      t("Effective policy"),
                      (d.policies || [])
                        .filter((p: Row) => p.status === "Effective")
                        .map((p: Row) => ({ value: p.id, label: p.name })),
                    )}
                  </>
                );
              if (a === "session")
                return (
                  <>
                    {field("title", t("Session title"))}
                    {choice(
                      "group_id",
                      t("Group"),
                      groups
                        .filter((g) => g.status === "Active")
                        .map((g) => ({
                          value: g.id,
                          label: `${g.id} · ${g.name}`,
                        })),
                    )}
                    {choice(
                      "coach_id",
                      t("Assigned coach"),
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
                    {field("starts_at", t("Start date & time"), "datetime-local")}
                    {field("week", t("Journey week"), "number")}
                    {field(
                      "duration_minutes",
                      t("Duration in minutes"),
                      "number",
                    )}
                    <p className="footnote">
                      {t("Groups run 8 weekly sessions of 180 minutes.")}
                    </p>
                  </>
                );
              if (a === "session_reschedule")
                return (
                  <>
                    {choice(
                      "coach_id",
                      t("Assigned coach"),
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
                    {field("starts_at", t("New date & time"), "datetime-local")}
                    {field("reason", t("Reason for rescheduling"))}
                  </>
                );
              if (a === "session_cancel")
                return <>{field("reason", t("Reason for cancellation"))}</>;
              if (a === "attendance")
                {
                  const selectedSession = sessions.find(
                    (session) => session.id === form.session_id,
                  );
                  return (
                    <>
                    {choice(
                      "session_id",
                      t("Session"),
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
                      t("Student"),
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
                    {choice("status", t("Attendance"), [
                      "Present",
                      "Absent",
                      "Late",
                      "Excused",
                    ])}
                    {field("source", t("Source"), "text", false)}
                  </>
                );
                }
              if (a === "account_request")
                return (
                  <>
                    {studentPick()}
                    {choice(
                      "task_bank_id",
                      t("Approved task"),
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
                    {field("job_profile", t("Student job profile"))}
                    {field(
                      "gig_number",
                      t("Controlled gig number (1–3)"),
                      "number",
                    )}
                    {field("notes", t("Request notes"), "text", false)}
                    <p className="footnote">
                      {t("Controlled account requests are limited to Support-path students and tasks approved for their technical track.")}
                    </p>
                  </>
                );
              if (a === "account")
                return (
                  <>
                    {field("id", t("Account ID"))}
                    {field("label", t("Account label"))}
                    {choice(
                      "platform",
                      t("Controlled platform"),
                      controlledPlatforms,
                    )}
                    {field("credits", t("Available credit (USD)"), "number")}
                    <p className="footnote">
                      {t("Store credentials in your approved vault. Do not enter passwords here.")}
                    </p>
                  </>
                );
              if (a === "reserve_account")
                return (
                  <>
                    {choice(
                      "request",
                      t("Account request"),
                      (d.requests || [])
                        .filter((r: Row) => r.status === "Submitted")
                        .map((r: Row) => ({
                          value: r.id,
                          label: name(r.student_id) + " · " + r.task,
                        })),
                    )}
                    {choice(
                      "account",
                      t("Controlled account"),
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
                      {t("Reservations hold one eligible account for 15 minutes and prevent a concurrent allocation from using it.")}
                    </p>
                  </>
                );
              if (a === "allocate")
                return (
                  <>
                    <div className="info-box">
                      <strong>{t("Reserved account")}{" "}{form.account}</strong>
                      <span>{t("Request")}{" "}{form.request}</span>
                      <small>
                        {t("Complete the independent fit check before the reservation expires.")}
                      </small>
                    </div>
                    <label className="check">
                      <Checkbox
                        checked={!!form.task_fit}
                        onCheckedChange={(v) =>
                          setForm({ ...form, task_fit: v === true })
                        }
                      />
                      {t("I have reviewed and approved the task fit.")}
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
                        {t("Gig")}{" "}{modal!.id} {t("· account")}{" "}{modal!.account_id}
                      </small>
                    </div>
                    {field("reason", t("Approved refund reason"))}
                  </>
                );
              if (a === "bulk_group_owner")
                return (
                  <>
                    <div className="info-box">
                      <strong>{(form.group_ids || []).join(", ")}</strong>
                    </div>
                    {choice(
                      "owner",
                      t("New coordinator"),
                      staff
                        .filter((u: Row) => {
                          const held = Array.isArray(u.roles) ? u.roles : JSON.parse(u.roles || "[]");
                          return u.active !== false && u.active !== 0 && held.includes("Operations Coordinator");
                        })
                        .map((u: Row) => ({ value: u.id, label: u.name + (u.title ? " · " + t(u.title) : "") })),
                    )}
                    {field("reason", t("Reason for the change"))}
                  </>
                );
              if (a === "gig")
                return (
                  <>
                    {studentPick()}
                    {field("title", t("Gig title"))}
                    <div className="form-grid">
                      {choice("platform", t("Platform"), gigPlatforms)}
                      {field("order_ref", t("Order number"))}
                    </div>
                    <div className="form-grid">
                      {field("value", t("Value"), "number")}
                      {choice("currency", t("Currency"), [
                        "USD",
                        "EGP",
                        "EUR",
                        "GBP",
                      ])}
                    </div>
                    {field("paid_on", t("Paid on"), "date")}
                    {proofField("proof_id", t("Delivery proof"))}
                    {proofField("payment_proof_id", t("Payment proof"))}
                  </>
                );
              if (a === "fx_rate")
                return (
                  <>
                    {choice("currency", t("Currency"), ["EGP", "EUR", "GBP"])}
                    {field("usd_rate", t("USD per one currency unit"), "number")}
                    {field("effective_date", t("Effective date"), "date")}
                    {field("source", t("Approved reference / publication"))}
                    <p className="footnote">
                      {t("A separate Project Operations user must approve the rate before it can affect graduation.")}
                    </p>
                  </>
                );
              if (a === "fx_rate_approve")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.currency} {t("→ USD")}</strong>
                      <span>
                        {modal!.usd_rate} {t("· effective")}{" "}{modal!.effective_date}
                      </span>
                      <small>{modal!.source}</small>
                    </div>
                    {field("reason", t("Approval reason"))}
                  </>
                );
              if (a === "fx_apply")
                return (
                  <>
                    <div className="info-box">
                      <strong>{t("Gig")}{" "}{form.gig_id}</strong>
                      <span>{t("Currency:")}{" "}{form.currency}</span>
                    </div>
                    {choice(
                      "fx_rate_id",
                      t("Approved FX rate"),
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
                      {t("The applied USD value is calculated once from the original gig value and stored with the exact approved rate.")}
                    </p>
                  </>
                );
              if (a === "gig_transition")
                return (
                  <>
                    {studentPick()}
                    <div className="info-box">
                      {t("Current step:")}{" "}<Badge value={modal?.status} />
                    </div>
                    {choice("status", t("Record next step"), [
                      "Gig Opened",
                      "Work Submitted",
                      "Delivered",
                      "Paid",
                      "Cancelled",
                      "Failed",
                    ])}
                    {choice("performed_by", t("Who performed the activity?"), [
                      "STUDENT",
                      "CLIENT",
                      "STAFF",
                    ])}
                    {field(
                      "occurred_at",
                      t("Activity date & time"),
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
                      t("Paid gig"),
                      gigs
                        .filter(
                          (g) =>
                            g.student_id === form.student_id &&
                            g.status === "Paid" &&
                            !evidence.some((e) => e.gig_id === g.id),
                        )
                        .map((g) => ({
                          value: g.id,
                          label: g.title + " · " + g.currency + " " + g.value,
                        })),
                    )}
                    {choice("source", t("External source"), [
                      "WhatsApp",
                      "Email",
                      "Freelancing platform",
                      "Form",
                    ])}
                    {proofField("proof_id", t("Delivery proof"))}
                    {proofField("payment_proof_id", t("Payment proof"))}
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
                        {t("Open submitted screenshot")}{" "}<ExternalLink size={16} />
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
                          t("Decision"),
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
                        t("Rejection code"),
                        rejectionCodes.map((c) => ({
                          value: c.slice(0, 4),
                          label: c,
                        })),
                      )}
                    {modal!.status === "Accepted" &&
                      choice("decision", t("Controlled reopening"), ["Reopen"])}
                    {modal!.status === "Rejected" && (
                      <>
                        {proofField("proof_id", t("Corrected delivery proof"))}
                        {proofField(
                          "payment_proof_id",
                          t("Corrected payment proof"),
                        )}
                      </>
                    )}
                    {field("notes", t("Decision notes / correction requirements"))}
                  </>
                );
              if (a === "service_qc_review")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.student_name || name(modal!.student_id)}</strong>
                      <Badge value={t("Service {v0}", { v0: modal!.slot })} />
                      <a className="text-link" href={modal!.url} target="_blank" rel="noreferrer">
                        {t("Open submitted service")}{" "}<ExternalLink size={16} />
                      </a>
                    </div>
                    <div className="info-box">
                      <span>{t("Automatic check:")}{" "}<Badge value={modal!.auto_status} /></span>
                      <small>{modal!.platform} {t("· revision")}{" "}{modal!.revision}</small>
                    </div>
                    {(() => {
                      try {
                        const automatic = JSON.parse(modal!.auto_result || "{}");
                        return <div className="info-box"><strong>{automatic.message}</strong>{(automatic.checks || []).map((check: string) => <small key={check}>{check}</small>)}</div>;
                      } catch { return null; }
                    })()}
                    {choice("decision", t("Review decision"), ["Lock", "Needs Correction"])}
                    {form.decision === "Needs Correction" && (
                      <Pick
                        label={t("Correction template")}
                        value=""
                        onChange={(comment) => setForm({ ...form, comment })}
                        options={[
                          { value: "The link does not open the submitted service page. Send the direct public service URL.", label: t("Direct link required") },
                          { value: "The service owner could not be matched to your student record. Confirm the seller profile and resubmit.", label: t("Owner mismatch") },
                          { value: "The service is unavailable, paused or deleted. Submit an active public service.", label: t("Service unavailable") },
                          { value: "The service category or title does not match your assigned track. Submit a track-relevant service.", label: t("Track mismatch") },
                        ]}
                      />
                    )}
                    {field("comment", t("Comment / correction guidance"), "text", form.decision === "Needs Correction")}
                    <p className="footnote">
                      {t("Lock only when the service page is active, correct, track-relevant and belongs to the student. A locked link is final, and a link the automatic check failed can only be returned for correction.")}
                    </p>
                  </>
                );
              if (a === "case")
                return (
                  <>
                    {studentPick()}
                    {field("title", t("Case title"))}
                    {choice("type", t("Case type"), [
                      "Student",
                      "Account",
                      "Gig",
                      "Payment",
                      "Evidence",
                      "Quality",
                      "Technical",
                      "System",
                    ])}
                    {choice("severity", t("Severity"), [
                      "S1 Critical",
                      "S2 High",
                      "S3 Standard",
                      "S4 Low",
                    ])}
                    {ownerLine()}
                    {field("due", t("Due date"), "datetime-local")}
                  </>
                );
              if (a === "case_transition")
                return (
                  <>
                    <div className="info-box">
                      {modal!.title}
                      <Badge value={modal!.status} />
                    </div>
                    {choice("status", t("Next case stage"), [
                      "Triaged",
                      "Assigned",
                      "In Progress",
                      "Waiting",
                      "Resolved",
                      "Verified",
                      "Closed",
                    ])}
                    {field("resolution", t("Resolution"), "text", false)}
                    {field("root_cause", t("Root cause"), "text", false)}
                    {field("prevention", t("Preventive action"), "text", false)}
                  </>
                );
              if (a === "engagement")
                return (
                  <>
                    {studentPick()}
                    {choice("status", t("Operational engagement"), [
                      "Active",
                      "At Risk",
                      "Critical",
                      "Unresponsive",
                    ])}
                    {field("reason", t("Reason for confirmation or override"))}
                  </>
                );
              if (a === "lifecycle")
                return (
                  <>
                    {studentPick()}
                    {choice("status", t("Lifecycle status"), [
                      "Active",
                      "Paused",
                      "Transferred",
                      "Withdrawn",
                      "Removed",
                      "Graduate Closed",
                      "Non-Graduate Closed",
                    ])}
                    {field("reason", t("Lifecycle decision reason"))}
                    <p className="footnote">
                      {t("Closure is blocked while open actions or cases remain. Graduate closure also requires a calculated qualifying result.")}
                    </p>
                  </>
                );
              if (a === "staff")
                return (
                  <>
                    {field("name", t("Staff name"))}
                    {field("email", t("Staff email"), "email")}
                    {field("national_id", t("National ID (their first password)"), "text", false)}
                    {field("phone", t("Phone number"), "text", false)}
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
                    {choice("active", t("Access"), ["Active", "Withdrawn"])}
                    {choice("reset_sign_in", t("Sign-in"), ["Leave their password alone", "Reset to the national ID"], false)}
                    {field("reason", t("Access change reason"))}
                    <p className="footnote">
                      {t("A new person can sign in with their email address and their national ID as the first password, exactly as students do, and should change it on their first visit. Resetting puts somebody who has forgotten theirs back to that same national ID. Withdrawing access stops them signing in and takes them out of the list a group can be handed to. Their history stays.")}
                    </p>
                  </>
                );
              if (a === "milestone")
                return (
                  <>
                    {studentPick()}
                    {field(
                      "milestone",
                      t("Completed journey milestone (0–8)"),
                      "number",
                    )}
                  </>
                );
              if (a === "task_bank")
                return (
                  <>
                    {field("track", t("Technical track"))}
                    {field("title", t("Approved controlled task"))}
                    {choice(
                      "platform",
                      t("Controlled platform"),
                      controlledPlatforms,
                    )}
                    {field("value", t("Approved value (USD)"), "number")}
                  </>
                );
              if (a === "group_gate")
                return (
                  <>
                    {choice(
                      "group_id",
                      t("Group"),
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("week", t("Group-relative week"), "number")}
                    {choice("check_key", t("Checkpoint"), weeklyGateChecks)}
                    {choice("status", t("Checkpoint status"), [
                      "Pending",
                      "Complete",
                      "Exception",
                    ])}
                    {ownerLine()}
                    {field("due", t("Checkpoint due"), "datetime-local")}
                  </>
                );
              if (a === "transfer")
                return (
                  <>
                    {studentPick()}
                    {choice(
                      "group_id",
                      t("Destination group"),
                      groups.map((g) => ({
                        value: g.id,
                        label: g.id + " · " + g.name,
                      })),
                    )}
                    {field("reason", t("Transfer reason"))}
                  </>
                );
              if (a === "policy" || a === "policy_edit")
                return (
                  <>
                    {a === "policy" && field("name", t("Policy version name"))}
                    <div className="form-grid">
                      {Object.entries(baselinePolicy).filter(([key]) => key !== "industrySessionCount").map(
                        ([key, defaultValue]) => (
                          <label className="field" key={key}>
                            {t(
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
                              )[key] || key,
                            )}
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
                    {field("reason", t("Change reason"))}
                    <p className="footnote">
                      {t("Approval requires a separate Project Operations user. Existing groups keep their applied policy.")}
                    </p>
                  </>
                );
              if (a === "policy_transition")
                return (
                  <>
                    {choice("status", t("Next policy stage"), [
                      "Reviewed",
                      "Approved",
                      "Effective",
                      "Superseded",
                    ])}
                    {field("reason", t("Decision reason"))}
                  </>
                );
              if (a === "account_status")
                return (
                  <>
                    <CredentialPanel account={modal!.id} />
                    {choice("status", t("Next account state"), [
                      "Available",
                      "Cooldown",
                      "Blocked",
                      "Access Issue",
                      "Funding Block",
                      "Under Review",
                      "Retired",
                    ])}
                    {field("reason", t("Reason"))}
                  </>
                );
              return field("reason", t("Reason"));
            })()}
            {formError && (
              <div className="form-error" role="alert">
                {formError}
              </div>
            )}
            <div className="form-footer">
              <span>
                <LockKeyhole size={13} /> {t("Recorded in audit history")}
              </span>
              <button
                type="button"
                className="small-btn"
                onClick={() => setModal(null)}
              >
                {t("Cancel")}
              </button>
              <button className="primary" type="submit" disabled={busy}>
                {busy
                  ? t("Saving…")
                  : modal?.action === "review"
                    ? t("Save review")
                    : t("Save record")}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet open={notifications} onOpenChange={setNotifications}>
        <SheetContent className="notifications overflow-y-auto" side={dir === "rtl" ? "left" : "right"}>
          <SheetHeader>
            <SheetTitle>{t("Action notifications")}</SheetTitle>
            <SheetDescription>
              {t("Your assigned alerts, including read history.")}
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
            <DialogTitle>{t("Spreadsheet import")}</DialogTitle>
            <DialogDescription>
              {t("Template → upload → validation → confirm → reconciliation")}
            </DialogDescription>
          </DialogHeader>
          <div className="filter-row">
            <Pick
              label={t("What the sheet does")}
              value={importMode === "update" ? "Update existing records" : "Add new records"}
              onChange={(v) => {
                const mode = v.startsWith("Update") ? "update" : "create";
                setImportMode(mode);
                if (mode === "update" && !updatableModules.includes(importModule))
                  setImportModule("students");
                setPreview(null);
                setImportRows([]);
                setSheetHeaders([]);
              }}
              options={["Add new records", "Update existing records"]}
            />
          </div>
          <p className="footnote">
            {importMode === "update"
              ? t("Rows are matched on the national ID, or on another identifier you choose; up to 5,000 rows per upload. Only the columns you map change, empty cells keep the stored value, and the mapping can be remembered for the next time this sheet arrives. Group moves, lifecycle, engagement and account status stay with their own actions.")
              : t("Every row creates a record through the same workflow rules as the forms (up to 1,000 rows per upload). Rows whose ID already exists are rejected; use update mode to change them.")}
          </p>
          <Pick
            label={t("Import module")}
            value={importModule}
            onChange={(v) => {
              setImportModule(v);
              setPreview(null);
              setImportRows([]);
              setSheetHeaders([]);
            }}
            options={
              importMode === "update"
                ? updatableModules
                : [
                    "staff",
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
                  ]
            }
          />
          <div className="import-tools">
            <button
              className="small-btn"
              onClick={() => {
                if (importMode === "update") {
                  // The current data is the template: edit it and upload it back.
                  window.location.href = "/api/export?module=" + importModule + "&format=xlsx";
                  return;
                }
                const templates: Row = {
                  staff: {
                    name: "Example Coordinator",
                    email: "name@example.com",
                    roles: "Operations Coordinator",
                    national_id: "29001011234567",
                    phone: "01000000000",
                    active: "active",
                    reason: "Round 5 staffing",
                  },
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
                    title: t("Follow up"),
                    owner: staff[0]?.id,
                    due: new Date(Date.now() + 86400000).toISOString(),
                    category: "Follow-up",
                    priority: "Normal",
                  },
                  sessions: {
                    id: "SES-new",
                    group_id: "G101",
                    coach_id: "staff-coach",
                    title: t("Coaching session"),
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
                    title: t("Approved design service"),
                    platform: "Khamsat",
                    value: 5,
                  },
                  accounts: {
                    id: "ACC-new",
                    label: t("Client workspace"),
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
                    title: t("Banner design"),
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
                    title: t("Delivery blocker"),
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
                    title: t("Final readiness"),
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
                    title: t("Role title"),
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
              <Download size={16} />{" "}
              {importMode === "update" ? t("Download current data (Excel)") : t("Download XLSX template")}
            </button>
            <label className="small-btn">
              <Upload size={16} /> {t("Upload XLSX / CSV")}
              <input
                className="sr-only"
                type="file"
                accept=".csv,.xlsx"
                onChange={async (e) => {
                  try {
                    if (!e.target.files?.[0]) return;
                    setBusy(true);
                    const file = e.target.files[0];
                    const rows = await readSheet(file, importModule);
                    setImportRows(rows);
                    setImportId(crypto.randomUUID());
                    setPreview(null);
                    if (importMode !== "update") {
                      setSheetHeaders([]);
                      const r = await fetch("/api/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ module: importModule, rows, mode: importMode }),
                      });
                      const v = await r.json();
                      if (v.error) throw Error(v.error);
                      setPreview(v);
                      return;
                    }
                    // A sheet from another source keeps its own headings. The
                    // application proposes which heading fills which field and
                    // which one identifies the student; nothing is checked
                    // against the database until that is confirmed.
                    const meta = await (await fetch("/api/import?module=" + importModule, { cache: "no-store" })).json();
                    if (meta.error) throw Error(meta.error);
                    const headers = Array.from(new Set(rows.flatMap((row: Row) => Object.keys(row))));
                    const allowed = [...(meta.keys || []), ...(meta.fields || [])];
                    const guessed = guessMapping(headers, allowed);
                    const keyColumn = guessKeyColumn(headers, rows, guessed);
                    if (keyColumn && !guessed[keyColumn]) guessed[keyColumn] = "national_id";
                    setSheetHeaders(headers);
                    setMappingFields(meta.fields || []);
                    setMappingKeys(meta.keys || []);
                    setSavedMappings(meta.mappings || []);
                    setImportMapping(guessed);
                    setMappingName(file.name.replace(/\.[^.]+$/, ""));
                    const mappedFields = Object.values(guessed);
                    setImportKey(
                      (keyColumn && guessed[keyColumn]) ||
                        (meta.keys || []).find((k: string) => mappedFields.includes(k)) ||
                        "national_id",
                    );
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </div>
          {importMode === "update" && sheetHeaders.length > 0 && (
            <div className="mapping-step">
              <div className="info-box">
                <strong>{t("{v0} columns · {v1} rows read", { v0: sheetHeaders.length, v1: importRows.length })}</strong>
                <span>{t("Say which column fills which field. Unmapped columns are ignored.")}</span>
              </div>
              {savedMappings.length > 0 && (
                <Pick
                  label={t("Saved mapping")}
                  value=""
                  onChange={(name) => {
                    const saved = savedMappings.find((m: Row) => m.name === name);
                    if (!saved) return;
                    setImportMapping({ ...saved.mapping });
                    setImportKey(saved.key_field);
                    setMappingName(saved.name);
                    toast.success("Loaded the mapping saved for " + saved.name);
                  }}
                  options={savedMappings.map((m: Row) => ({ value: m.name, label: m.name }))}
                />
              )}
              <table className="mapping-table">
                <thead>
                  <tr><th>{t("Column in your sheet")}</th><th>{t("First value")}</th><th>{t("Fills this field")}</th></tr>
                </thead>
                <tbody>
                  {sheetHeaders.map((header) => (
                    <tr key={header}>
                      <th scope="row">{header}</th>
                      <td><small>{String(importRows.find((row: Row) => String(row[header] ?? "").trim())?.[header] ?? "—")}</small></td>
                      <td>
                        <select
                          className="pick-inline"
                          aria-label={t("Field filled by {v0}", { v0: header })}
                          value={importMapping[header] || ""}
                          onChange={(e) => {
                            const field = e.target.value;
                            const next: Row = { ...importMapping };
                            // One field cannot be filled from two columns.
                            for (const [other, value] of Object.entries(next))
                              if (value === field && other !== header) delete next[other];
                            if (field) next[header] = field;
                            else delete next[header];
                            setImportMapping(next);
                          }}
                        >
                          <option value="">{t("Ignore this column")}</option>
                          {[...mappingKeys, ...mappingFields.filter((f) => !mappingKeys.includes(f))].map((field) => (
                            <option key={field} value={field}>{field.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="filter-row">
                <Pick
                  label={t("Match rows on")}
                  value={importKey}
                  onChange={setImportKey}
                  options={mappingKeys.map((k) => ({ value: k, label: k.replace(/_/g, " ") }))}
                />
                <label className="pick-field">
                  <span className="pick-label">{t("Remember this sheet as")}</span>
                  <input value={mappingName} onChange={(e) => setMappingName(e.target.value)} placeholder={t("Ministry monthly list")} />
                </label>
              </div>
              <div className="detail-actions">
                <button
                  className="primary"
                  disabled={busy || !Object.values(importMapping).includes(importKey)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await fetch("/api/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          module: importModule,
                          rows: importRows,
                          mode: "update",
                          mapping: importMapping,
                          key_field: importKey,
                        }),
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
                >
                  {t("Check these rows")}
                </button>
                <button
                  className="small-btn"
                  disabled={busy || mappingName.trim().length < 2}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await fetch("/api/import", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          action: "save_mapping",
                          module: importModule,
                          name: mappingName.trim(),
                          key_field: importKey,
                          mapping: importMapping,
                        }),
                      });
                      const v = await r.json();
                      if (v.error) throw Error(v.error);
                      const meta = await (await fetch("/api/import?module=" + importModule, { cache: "no-store" })).json();
                      setSavedMappings(meta.mappings || []);
                      toast.success(t("Saved. The next upload of this sheet is mapped already."));
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("Remember this mapping")}
                </button>
              </div>
              {!Object.values(importMapping).includes(importKey) && (
                <p className="footnote">{t("Map one column to {v0} before checking the rows.", { v0: importKey.replace(/_/g, " ") })}</p>
              )}
            </div>
          )}
          {preview?.rows && (
            <>
              <div className="info-box">
                <strong>{t("{v0} rows reviewed", { v0: preview.rows.length })}</strong>
                <span>
                  {t("{v0} ready", { v0: preview.rows.filter((r: Row) => r.status === "Ready").length })}
                  {preview.mode === "update"
                    ? " · " + t("{v0} unchanged", { v0: preview.rows.filter((r: Row) => r.status === "Unchanged").length })
                    : ""}
                  {" · "}
                  {t("{v0} rejected", { v0: preview.rows.filter((r: Row) => r.status === "Rejected").length })}
                </span>
              </div>
              {generic(preview.rows.slice(0, 50), [
                { key: "row", label: t("Row") },
                ...(preview.mode === "update" ? [{ key: "id", label: t("Record") }] : []),
                statusCol,
                ...(preview.mode === "update"
                  ? [
                      {
                        key: "changes",
                        label: t("Changes"),
                        render: (r: Row) =>
                          r.changes?.length
                            ? r.changes.map((c: Row) => (
                                <span className="table-subline" key={c.field}>
                                  <strong>{c.field}</strong>: {String(c.from || "—")} → {String(c.to)}
                                </span>
                              ))
                            : r.status === "Unchanged"
                              ? t("Matches the stored record")
                              : "",
                      },
                    ]
                  : []),
                {
                  key: "errors",
                  label: t("Validation"),
                  render: (r) =>
                    r.errors.map((e: Row) => (e.field ? e.field + ": " : "") + e.error).join("; ") ||
                    (preview.mode === "update" ? "" : t("Ready for workflow validation")),
                },
              ])}
              {preview.rows.length > 50 && (
                <p className="footnote">{t("Showing the first 50 of {v0} rows; every row is validated.", { v0: preview.rows.length })}</p>
              )}
              {preview.ignored?.length > 0 && (
                <p className="footnote">
                  {t("Columns ignored (not editable through this sheet):")}{" "}{preview.ignored.join(", ")}
                </p>
              )}
              <p className="footnote">{preview.notice}</p>
              <button
                className="primary"
                disabled={busy || !preview.rows.some((r: Row) => r.status === "Ready")}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch("/api/import", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        module: importModule,
                        rows: importRows,
                        mode: importMode,
                        ...(importMode === "update" && sheetHeaders.length
                          ? { mapping: importMapping, key_field: importKey }
                          : {}),
                        confirm: true,
                        batch_id: importId,
                      }),
                    });
                    const v = await r.json();
                    if (v.error) throw Error(v.error);
                    setPreview(v);
                    await refresh();
                    toast.success(t("Import reconciliation ready"));
                  } catch (e: any) {
                    toast.error(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? t("Importing…")
                  : importMode === "update"
                    ? t("Apply {v0} changes", { v0: preview.rows.filter((r: Row) => r.status === "Ready").length })
                    : t("Confirm import")}
              </button>
            </>
          )}
          {preview && "created" in preview && (
            <div className="prose">
              <h3>{t("Import complete")}</h3>
              <p>
                {t("{v0} created · {v1} updated · {v2} skipped · {v3} conflicted · {v4} rejected", {
                  v0: preview.created, v1: preview.updated, v2: preview.skipped, v3: preview.conflicted, v4: preview.rejected,
                })}
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
              {t("Download error report")}
            </button>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
