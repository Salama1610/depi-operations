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
import { PortalView } from "./portal-view";
// The dashboard and its charts load only when someone opens it.
const Dashboard = lazy(() => import("./dashboard").then((m) => ({ default: m.Dashboard })));
import { SearchableSelect } from "@/components/searchable-select";
import { Progress } from "@/components/ui/progress";
import { GraduationDots } from "./today";
import { FeedbackAlertCard, FeedbackScore, FeedbackView } from "./feedback-view";
import { CoachProgress } from "./coach-progress";
import { Opportunities } from "./opportunities";
import { scoreOf } from "@/lib/domain/feedback";
import { coachPayout, coachRates } from "@/lib/domain/payouts";
import { checklistState, sessionChecklist, type ChecklistItem } from "@/lib/domain/session-checklist";
import { Suspense, lazy, useState, useEffect } from "react";
import {
  Home,
  CheckCheck,
  Users,
  Layers,
  CalendarDays,
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
  ChevronLeft,
  Phone,
  Mail,
  MessageCircle,
  CalendarRange,
  WalletCards,
  GraduationCap,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  X,
  AlertTriangle,
  Upload,
  Download,
  Filter,
  MessageSquare,
  Paperclip,
  ExternalLink,
  RefreshCw,
  LockKeyhole,
  Check,
  LayoutDashboard,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
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
import { readSheet, toCSV, toWorkbook, toXLSX } from "@/lib/spreadsheet";
import { guessKeyColumn, guessMapping } from "@/lib/domain/sheet-mapping";
type Row = Record<string, any>;
const nav = [
  ["home", "Overview", Home],
  ["dashboard", "Dashboard", LayoutDashboard],
  ["program", "Program flow", Flag],
  ["work", "My work", CheckCheck],
  ["weekly", "Weekly progress", CalendarRange],
  ["students", "Students", Users],
  ["progress", "Student progress", GraduationCap],
  ["groups", "Groups", Layers],
  ["sessions", "Sessions", CalendarDays],
  ["accounts", "Accounts", WalletCards],
  ["gigs", "Services", BriefcaseBusiness],
  ["opportunities", "Opportunities", ExternalLink],
  ["portal", "Gigs portal view", Files],
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
  session_unavailable: "I can't attend this session",
  account_request: "Request a client account",
  account: "Add client account",
  reserve_account: "Reserve eligible account",
  allocate: "Allocate account",
  gig: "Record a paid service",
  gig_transition: "Record client activity",
  evidence: "Submit evidence",
  review: "Review evidence",
  case: "Open a case",
  case_transition: "Update case",
  engagement: "Review engagement status",
  lifecycle: "Update lifecycle status",
  staff: "Manage staff access",
  account_topup: "Record a top-up",
  account_coordinator: "Assign to a coordinator",
  session_coach: "Change the coach for one session",
  group_contact: "Log a group message",
  session_attendance: "Take attendance",
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
  group_whatsapp: "WhatsApp group link",
};
const actionCopy: Row = {
  contact: "Record a conversation that already happened, with a screenshot as proof, its outcome and the next step.",
  task: "A follow-up step you commit to do for this student, with an owner and a due date. Nothing has happened yet.",
  allocate: "Eligibility and account reuse are checked before allocation. Once assigned, the group's coordinator gets a task to place the order within two days, and the student's page shows that a client will order the service.",
  task_bank: "An approved task is a ready-made service order (platform, what to order and its value) that coordinators pick when they request a client account, so every request matches something Project Operations approved.",
  review: "Record a decision and clear correction guidance.",
  gig_transition:
    "Attach a screenshot of this activity before progressing the service.",
  staff: "Access changes take effect immediately and are audited.",
  evidence: "Only completed, paid services can enter the review pipeline.",
  gig: "Record the service once it is paid. Its delivery and payment screenshots go straight into review.",
  session:
    "Sessions follow the group delivery model, approved duration and coach-assignment controls.",
  session_reschedule:
    "Rescheduling moves the whole group from this session on. It needs a reason, and the coordinator and coach confirm the new times again.",
  session_cancel:
    "Cancelled sessions remain in the operational history and require a reason.",
  session_unavailable:
    "Project Operations, Coach Operations and the group's supervisor are notified at once so the session can be covered or moved.",
  service_qc_review:
    "One link at a time. Approve a correct link, or reject it with a clear comment for the student.",
  bulk_group_owner:
    "The group and its students move to the coordinator you choose. The change is audited.",
  group_whatsapp:
    "Paste the group's WhatsApp invite link (WhatsApp → group info → Invite via link). It then opens in one tap from the group, its sessions and each student's profile.",
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
/** The end of the programme week (Friday to Thursday, Cairo): the coming Thursday, end of day. */
/** An instant as the browser's wall time, which is what a datetime-local field shows and sends back. */
const localInput = (value?: string | number | Date) => {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const weekDue = () => {
  const day = new Date(programDay() + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() + ((4 - day.getUTCDay() + 7) % 7));
  return day.toISOString().slice(0, 10) + "T23:59";
};
const weeklyGateChecks = [
  "Current statuses recorded",
  "Next action and due date",
  "Valid contact within 7 days",
  "Account duplicate controls passed",
  "Rejected evidence has correction owner",
  "At Risk and Critical intervention owner",
  "Supervisor exception review complete",
];
// Stored review states keep their names; people always read Approved or Rejected.
const shownStatus: Record<string, string> = { Locked: "Approved", Lock: "Approved", "Needs Correction": "Rejected", "Coordinator L1": "Coordinator check" };

/**
 * A coloured status pill, all the same size: green when good, amber to watch,
 * red when something is wrong, grey for no data. Confirmations, attendance and
 * feedback all use it, so the same colour means the same thing everywhere.
 */
function Cue({ tone, children, title }: { tone: "ok" | "warn" | "bad" | "info"; children: React.ReactNode; title?: string }) {
  return <span className={"cue is-" + tone} title={title}>{children}</span>;
}
/** A percentage: 80% and up is good, 60-79% to watch, below 60% a problem. */
const rateTone = (pct: number | null) => (pct === null ? "info" : pct >= 80 ? "ok" : pct >= 60 ? "warn" : "bad");
/** A 1-5 rating average: 4 and up is good, 3 to 3.9 to watch, below 3 a problem. */
const pctOf = (a: number, b: number) => (b ? Math.round((100 * a) / b) : null);

function Badge({ value }: { value: any }) {
  const t = useT();
  return (
    <span
      className={
        "badge " +
        (/Critical|Rejected|Overdue|Blocked|S1|S2|Unresponsive|Access Issue/.test(value)
          ? "red"
          : /Risk|Pending|Submitted|Review|Waiting|Delayed|Funding|Cooldown|Reserved/.test(value)
            ? "amber"
            : /Accepted|Graduat|Complete|Available|Present|On Track/.test(value)
              ? "green"
              : "neutral")
      }
    >
      {typeof value === "string" ? t(shownStatus[value] || value) : value}
    </span>
  );
}
// Filters on the Services page. "Uploaded" is when the student last sent the
// link (a corrected link counts from its new upload).
const serviceFilterDefaults: Row = { state: "Pending", platform: "All", track: "All", group: "All", coordinator: "All", supervisor: "All", reviewer: "All", age: "All", automatic: "All", corrections: "All", uploaded: "All", from: "", to: "", sort: "waiting" };
const submissionFilterDefaults: Row = { state: "All", track: "All", group: "All", coordinator: "All", supervisor: "All", approved: "All", platform: "All", lifecycle: "All", uploaded: "All", from: "", to: "", sort: "follow-up" };
/** How many filters narrow the list, for the "Clear filters" button. */
const narrowing = (value: Row, defaults: Row) =>
  Object.keys(defaults).filter((k) => !["sort", "from", "to"].includes(k) && value[k] !== defaults[k]).length;
/** The viewer's calendar day for a time, as YYYY-MM-DD. */
const localDay = (at: string | number) => {
  const d = new Date(at);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
/** Whether an upload falls in the chosen period. Nothing uploaded never matches a period. */
function uploadedIn(at: string | undefined, f: Row) {
  if (f.uploaded === "All") return true;
  if (!at || Number.isNaN(Date.parse(at))) return false;
  const day = localDay(at);
  if (f.uploaded === "custom") return (!f.from || day >= f.from) && (!f.to || day <= f.to);
  return day >= localDay(Date.now() - Number(f.uploaded) * 86400000);
}
const uploadedOptions = [
  { value: "All", label: "Any time" },
  { value: "0", label: "Today" },
  { value: "6", label: "Last 7 days" },
  { value: "29", label: "Last 30 days" },
  { value: "custom", label: "Choose dates" },
];
function Pick({
  value,
  onChange,
  options,
  label,
  bare = false,
}: {
  value: string;
  onChange: (s: string) => void;
  options: (string | { value: string; label: string })[];
  label: string;
  /** Inside a form field that already shows the label. */
  bare?: boolean;
}) {
  const t = useT();
  // The name of the filter is always visible. With only the chosen value
  // shown, a row of filters all read "All" and nobody could tell which was
  // which. A form field has its own label, so it shows none here.
  return (
    <span className="pick-field">
      {!bare && <span className="pick-label">{label}</span>}
      <SearchableSelect
        value={value}
        onChange={onChange}
        label={label}
        placeholder={bare ? t("Choose") : label}
        className="pick"
        options={options.map((o) => {
          const a = typeof o === "string" ? { value: o, label: o } : o;
          return { value: a.value, label: t(a.label) };
        })}
      />
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

/** Readable names for the policy settings. */
const policyLabels: Record<string, string> = {
  contactDays: "Contact interval (days)",
  coachHours: "Coach review SLA (hours)",
  l1Hours: "Coordinator L1 SLA (hours)",
  qualityHours: "Quality review SLA (hours)",
  correctionDays: "Correction window (days)",
  failedAttempts: "Failed contact attempts",
  failedWindowDays: "Attempt window (days)",
  target: "Graduation target (%)",
  minGig: "Minimum service value (USD)",
  gigCount: "Qualifying service count",
  minTotal: "Minimum total (USD)",
  largeGig: "Large-service threshold (USD)",
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
};
/** Modules whose existing records a spreadsheet may modify (see /api/import). */
const updatableModules = ["students", "groups", "accounts"];
/** The sheets the import takes, by name a person reads. */
const importKinds: Record<string, string> = {
  staff: "Staff", students: "Students", groups: "Groups", contacts: "Contacts", tasks: "Tasks", sessions: "Sessions",
  attendance: "Attendance", task_bank: "Approved tasks", accounts: "Client accounts", requests: "Client account requests",
  gigs: "Paid services", evidence: "Service proof", cases: "Cases", applications: "Applications", assessments: "Assessments",
  assessment_results: "Assessment results", withdrawals: "Withdrawals", post_program_outcomes: "Post-programme outcomes",
};

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
    // A filter or search belongs to the page it was set on.
    setFilter("All");
    setSearch("");
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
    [serviceFilters, setServiceFilters] = useState<Row>(serviceFilterDefaults),
    [submissionFilters, setSubmissionFilters] = useState<Row>(submissionFilterDefaults),
    [moreFilters, setMoreFilters] = useState<Row>({}),
    [saved, setSaved] = useState<string[]>([]),
    [checklistFor, setChecklistFor] = useState<string | null>(null),
    [signinFor, setSigninFor] = useState<Row | null>(null),
    // A ready message for the group's WhatsApp: the session confirmation or
    // the feedback request. The app cannot post to WhatsApp, so the
    // coordinator copies it and opens the group.
    [groupMessage, setGroupMessage] = useState<Row | null>(null),
    [feedbackFor, setFeedbackFor] = useState<string | null>(null),
    [sessionTab, setSessionTab] = useState("schedule"),
    [accountFilters, setAccountFilters] = useState<Row>({ platform: "All", status: "All", request: "Open", ledger: "All", coordinator: "All", owner: "All" }),
    [insightFilters, setInsightFilters] = useState<Row>({
      group: "All", coach: "All", from: "", to: "", absentOnly: false,
      month: new Date().toISOString().slice(0, 7), payee: "Coaches",
    }),
    [sessionFilters, setSessionFilters] = useState<Row>({ day: "All", time: "All" }),
    // The schedule shows one programme week at a time: 0 is this week.
    [sessionWeek, setSessionWeek] = useState(0),
    [joinLogin, setJoinLogin] = useState<Row | null>(null),
    [joinLeft, setJoinLeft] = useState(0),
    [joinShowPassword, setJoinShowPassword] = useState(false),
    [joinEdit, setJoinEdit] = useState<Row | null>(null);
  // A join login is shown for a minute, then forgotten.
  useEffect(() => {
    if (!joinLogin) return;
    setJoinLeft(60);
    setJoinShowPassword(false);
    const tick = setInterval(() => setJoinLeft((n) => Math.max(0, n - 1)), 1000);
    const timer = setTimeout(() => setJoinLogin(null), 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [joinLogin]);
  async function showJoinLogin(r: Row, kind: "coach" | "coordinator") {
    setBusy(true);
    try {
      const res = await fetch("/api/join-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reveal", kind, group_id: r.group_id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || t("Request failed"));
      setJoinLogin({ ...body, kind, group_id: r.group_id, provider: groups.find((g) => g.id === r.group_id)?.provider, link: groups.find((g) => g.id === r.group_id)?.session_link, title: r.title, starts_at: r.starts_at });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
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
    return { ...r, student_name: s.name, group_id: s.group_id, lifecycle: s.lifecycle, track: s.track, coordinator: s.coordinator, coordinator_name: s.coordinator_name, supervisor: s.supervisor };
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
    ["Coordinator L1", "Quality Review", "L3 Review"].includes(
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
    staff.find((s: Row) => s.id === id)?.name || t("Unassigned");
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
  // A demo sign-in (see lib/demo.ts) works on made-up groups and can reset them.
  const demoAccount = String(user.id || "").startsWith("DEMO-");
  const qualityOnly =
    heldRoles(user).length > 0 &&
    heldRoles(user).every((role) => role === "Quality Member" || role === "Quality Lead");
  // Spreadsheets in and out are for leaders, supervisors and administrators;
  // the server refuses everyone else, so the buttons are not offered either.
  const canTransfer = can(user.roles, dataTransferRoles);
  // Coach Operations follows every student, group and coach, but not how the
  // coordinators, supervisors or quality reviewers themselves are performing.
  // Someone whose only role is Coach: services are not theirs to see.
  const onlyCoach = heldRoles(user).length > 0 && heldRoles(user).every((role) => role === "Coach");
  // Students' feedback after their sessions: Coach Operations follows it and
  // handles the red flags; the group's coordinator, its supervisor and Project
  // Operations read their own groups'. Coaches and the quality team do not see
  // it (the server applies the same list in /api/feedback and loadData).
  const readsFeedback = can(user.roles, ["Coach Operations", "Operations Coordinator", "Team Supervisor", "Project Operations", "Operations Systems / Admin"]);
  const coachesOnly =
    can(user.roles, ["Coach Operations"]) &&
    !can(user.roles, ["Project Operations", "Operations Systems / Admin", "Higher Board", "Team Supervisor"]);
  // The people who keep the client accounts (top-ups and status changes): the
  // Service Team's supervisor, Project Operations, Higher Board and
  // administrators (the server checks the same).
  const keepsAccounts =
    can(user.roles, ["Higher Board", "Project Operations", "Operations Systems / Admin"]) ||
    (can(user.roles, ["Team Supervisor"]) && user.team === "Service Team");
  const shownNav = nav.filter(([m]) =>
    qualityOnly
      ? m === "quality" || (m === "portal" && !demoAccount)
      : m === "dashboard"
        ? // Every tracker and what everyone did: the administrator's view.
          can(user.roles, ["Operations Systems / Admin"]) && !demoAccount
      : m === "administration"
        ? can(user.roles, ["Operations Systems / Admin"])
        : m === "gigs" && onlyCoach
          ? false
        : m === "portal"
          ? // The portal sheets hold real students, so demo sign-ins do not open them.
            !demoAccount && can(user.roles, [
              "Team Supervisor",
              "Project Operations",
              "Coach Operations",
              "Quality Lead",
              "Quality Member",
              "Higher Board",
              "Operations Systems / Admin",
              "Operations Coordinator",
            ])
        : m === "opportunities"
          ? // Jobs the Target Team finds for a track's students: its coordinators
            // and supervisors and Project Operations post and read them.
            can(user.roles, ["Project Operations", "Operations Systems / Admin"]) ||
            (can(user.roles, ["Team Supervisor", "Operations Coordinator"]) && user.team === "Target Team")
        : m === "progress"
          ? // A coach's read-only view of their own students' gigs.
            can(user.roles, ["Coach"])
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
            ? // Freelance client accounts only, for the Service Team's coordinators,
              // the people who keep the accounts, and the leaders. A session's
              // sign-in accounts stay on the session.
              can(user.roles, ["Higher Board", "Project Operations", "Operations Systems / Admin", "Team Supervisor"]) ||
              keepsAccounts ||
              (can(user.roles, ["Operations Coordinator"]) &&
                (groups.some((g) => g.coordinator === user.id && g.supervisor_team === "Service Team") ||
                  (d.accounts || []).some((a: Row) => a.coordinator_id === user.id)))
            : true,
  );
  // The service-link list lives on the quality page. Its reviewers call it
  // Quality review; for everyone else following their students' links
  // (coordinators, supervisors, Project Operations) it is "Service links".
  const reviewsQuality = can(user.roles, ["Quality Member", "Quality Lead"]);
  const pageName = (id: string) =>
    id === "quality" && !reviewsQuality ? "Service links" : String(nav.find((n) => n[0] === id)?.[1] || "");
  // A module nobody showed them is not a module they can open by typing its
  // address either.
  const allowedModules = shownNav.map(([m]) => String(m));
  useEffect(() => {
    // Only once the person is known: before that every role-limited page looks
    // forbidden, and a refresh or a shared link would bounce to Overview.
    // The quality team starts on their review queue.
    if (!data?.user) return;
    if (allowedModules.length && !allowedModules.includes(module)) goTo(qualityOnly ? "quality" : allowedModules[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module, allowedModules.join(","), Boolean(data?.user)]);
  function open(action: string, row: Row = {}) {
    setModal({ action, ...row });
    setForm({
      ...row,
      student_id: row.student_id || selected?.id || "",
      owner: row.owner || user.id,
      due: row.due ? localInput(row.due) : weekDue(),
      occurred_at: localInput(),
      channel: "WhatsApp",
      outcome: "Responded",
      pathway: "Outcome",
      delivery_model: row.delivery_model || "Regular",
      currency: "USD",
      coach_id: row.coach_id || "",
      duration_minutes:
        row.duration_minutes || baselinePolicy.sessionMinutes,
      starts_at: row.starts_at ? localInput(row.starts_at) : "",
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
          : action === "demo_refresh"
            ? t("The demo is back to its starting point, timed around now.")
          : action === "load_demo_data"
            ? t("Synthetic pilot loaded · {v0} students across {v1} groups", { v0: result.summary.students, v1: result.summary.groups })
          : t("Updated"),
      );
      await refresh();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
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
          bare
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
    <div
      className="proof-field"
      tabIndex={0}
      onPaste={(e) => {
        const file = Array.from(e.clipboardData.files || []).find((f) => f.type.startsWith("image/"));
        if (file) {
          e.preventDefault();
          upload(file, key);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith("image/"));
        if (file) upload(file, key);
      }}
    >
      <label className="field">{t(label)} *</label>
      {form.student_id &&
        (d.attachments || []).filter(
          (a: Row) => a.student_id === form.student_id,
        ).length > 0 &&
        choice(
          key,
          t("Existing {v0}", { v0: t(label) }),
          (d.attachments || [])
            .filter((a: Row) => a.student_id === form.student_id)
            .map((a: Row) => ({ value: a.id, label: a.name })),
        )}
      <label className="upload">
        <Upload size={22} />
        <strong>
          {form[`${key}_name`] || t("Upload {v0}", { v0: t(label) })}
        </strong>
        <span>{t("PNG or JPEG · up to 8 MB · paste with Ctrl+V or drop it here")}</span>
        <input
          type="file"
          accept="image/png,image/jpeg"
          disabled={busy}
          onChange={(e) =>
            e.target.files?.[0] && upload(e.target.files[0], key)
          }
        />
      </label>
      <label className="small-btn camera-btn">
        <Upload size={15} /> {t("Take a photo")}
        <input type="file" accept="image/jpeg,image/png" capture="environment" hidden disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], key)} />
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
              aria-label={t("Complete {v0}", { v0: task.title })}
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
                {name(task.student_id)} <span>· {t(task.category)}</span>
              </button>
            </div>
            <span className="task-owner">{owner(task.owner)}</span>
            <span
              className={task.due < new Date().toISOString() ? "due late" : "due"}
            >
              <Clock3 size={14} />
              {fmt(task.due)}
            </span>
            {task.category === "Contact" && may("contact") ? (
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
  const sessionGroupOf = (r: Row) => groups.find((g) => g.id === r.group_id);
  // The page's main "add" button is offered only to people the server lets
  // add that kind of record: supervisors add no students, sessions or groups.
  // The roles the server accepts for each action a button opens, so nobody is
  // offered a button that would be refused. Administrators pass every permit.
  const opsRoles = ["Project Operations", "Operations Coordinator"];
  const actionRoles: Record<string, string[]> = {
    contact: opsRoles,
    engagement: ["Team Supervisor", "Project Operations"],
    milestone: ["Coach"],
    lifecycle: ["Project Operations"],
    transfer: ["Project Operations", "Team Supervisor"],
    gig_transition: opsRoles,
    evidence: opsRoles,
    task: [...opsRoles, "Team Supervisor", "Coach", "Coach Operations"],
  };
  // The risk reasons and group trajectory sentences the server writes in English.
  const riskReason = (text: string) => {
    let m = text.match(/^Attendance (\d+)%$/);
    if (m) return t("Attendance {v0}%", { v0: m[1] });
    m = text.match(/^No valid contact in (\d+) days$/);
    if (m) return t("No valid contact in {v0} days", { v0: m[1] });
    m = text.match(/^(\d+) milestones? behind$/);
    if (m) return t("{v0} milestones behind", { v0: m[1] });
    m = text.match(/^(\d+) failed attempts in (\d+) days$/);
    if (m) return t("{v0} failed attempts in {v1} days", { v0: m[1], v1: m[2] });
    return t(text);
  };
  const trajectoryReason = (text: any) => {
    const s = String(text || "");
    let m = s.match(/^([\d.]+) milestones behind the Week (\d+) expectation$/);
    if (m) return t("{v0} milestones behind the Week {v1} expectation", { v0: m[1], v1: m[2] });
    m = s.match(/^([\d.]+) milestones ahead of expectation$/);
    if (m) return t("{v0} milestones ahead of expectation", { v0: m[1] });
    m = s.match(/^At the Week (\d+) expected milestone$/);
    if (m) return t("At the Week {v0} expected milestone", { v0: m[1] });
    return t(s);
  };
  // "Session 2 of 8", in the reader's language.
  const sessionName = (title: any) => {
    const m = String(title || "").match(/^Session (\d+) of (\d+)$/);
    return m ? t("Session {v0} of {v1}", { v0: m[1], v1: m[2] }) : String(title || "");
  };
  // The automatic link check's sentences, in the reader's language.
  const checkText = (text: any) => {
    const s = String(text || "");
    let m = s.match(/^Numeric service ID (\d+) and slug detected$/);
    if (m) return t("Numeric service ID {v0} and slug detected", { v0: m[1] });
    m = s.match(/^(\w+) is accepted$/);
    if (m) return t("{v0} is accepted", { v0: t(m[1]) });
    m = s.match(/^Only (.+) service links are accepted$/);
    if (m) return t("Only {v0} service links are accepted", { v0: m[1] });
    return t(s);
  };
  const may = (action: string) => can(user.roles, ["Operations Systems / Admin", ...(actionRoles[action] || [])]);
  // A service's proof, at its current step: the coordinator check for the
  // group's coordinator, supervisor or Project Operations (never whoever
  // recorded it); the Quality decision for the assigned reviewer or the Quality
  // Lead; the final review for Project Operations or the Quality Lead.
  const mayReviewEvidence = (e: Row) => {
    if (!e) return false;
    if (can(user.roles, ["Operations Systems / Admin"])) return true;
    if (e.recorder === user.id && e.status !== "Rejected") return false;
    const g = groups.find((x) => x.id === students.find((s) => s.id === e.student_id)?.group_id);
    if (e.status === "Coordinator L1") return g?.coordinator === user.id || g?.supervisor === user.id || can(user.roles, ["Project Operations"]);
    if (e.status === "Quality Review") return can(user.roles, ["Quality Lead"]) || (can(user.roles, ["Quality Member"]) && e.qc_actor === user.id);
    if (e.status === "L3 Review" || e.status === "Accepted") return can(user.roles, ["Project Operations", "Quality Lead"]);
    if (e.status === "Rejected") return can(user.roles, opsRoles);
    return false;
  };
  const createRoles: Record<string, string[]> = {
    students: ["Project Operations", "Operations Coordinator", "Operations Systems / Admin"],
    sessions: ["Coach Operations", "Project Operations", "Operations Systems / Admin"],
    groups: ["Operations Systems / Admin"],
    work: ["Operations Systems / Admin", ...actionRoles.task],
    accounts: ["Operations Systems / Admin", ...opsRoles],
  };
  // Services are recorded by the coordinators of the Service Team's groups,
  // and by Project Operations and administrators.
  const recordsServices =
    can(user.roles, ["Project Operations", "Operations Systems / Admin"]) ||
    (can(user.roles, ["Operations Coordinator"]) &&
      groups.some((g) => g.coordinator === user.id && g.supervisor_team === "Service Team"));
  const canCreate = (m: string) =>
    m === "gigs" ? recordsServices : !createRoles[m] || can(user.roles, createRoles[m]);
  // Only the leaders set the schedule; the row argument is kept for callers.
  const plansSession = (_r: Row) =>
    can(user.roles, ["Coach Operations", "Project Operations", "Operations Systems / Admin"]);
  // The two people who answer for a session: its coach and the group's coordinator.
  // Who may see a session's join logins: the coach's is the group's coach's and
  // Coach Operations'; the coordinators' is the coordinator's, their
  // supervisor's and Project Operations'. The server checks the same.
  const seesCoachLogin = (r: Row) =>
    sessionGroupOf(r)?.provider === "YAT" &&
    (can(user.roles, ["Coach Operations", "Operations Systems / Admin"]) ||
      (can(user.roles, ["Coach"]) &&
        (sessionGroupOf(r)?.coach === user.id ||
          (d.groupCoaches || []).some(
            (c: Row) => c.group_id === r.group_id && c.user_id === user.id && c.status === "Active",
          ))));
  // Which logins are stored, so a button says "missing" instead of failing.
  const storedLogin = (kind: "coach" | "coordinator", r: Row) => {
    const g = sessionGroupOf(r);
    const id = kind === "coach" ? `coach:${r.group_id}` : `coordinator:${g?.provider || ""}`;
    return (d.joinLogins || []).some((x: Row) => x.id === id);
  };
  // The coach's side of a session on a provider where coaches use their own email.
  const coachOfSession = (r: Row) =>
    can(user.roles, ["Coach Operations", "Operations Systems / Admin"]) ||
    (can(user.roles, ["Coach"]) &&
      (sessionGroupOf(r)?.coach === user.id ||
        (d.groupCoaches || []).some((c: Row) => c.group_id === r.group_id && c.user_id === user.id && c.status === "Active")));
  const seesCoordinatorLogin = (r: Row) => {
    const g = sessionGroupOf(r);
    return (
      can(user.roles, ["Project Operations", "Operations Systems / Admin"]) ||
      (can(user.roles, ["Operations Coordinator"]) && g?.coordinator === user.id) ||
      (can(user.roles, ["Team Supervisor"]) && g?.supervisor === user.id)
    );
  };
  const answersAsCoach = (r: Row) =>
    can(user.roles, ["Coach"]) &&
    (r.coach_id
      ? r.coach_id === user.id
      : (d.groupCoaches || []).some(
          (c: Row) => c.group_id === r.group_id && c.user_id === user.id && c.status === "Active",
        ));
  const answersAsCoordinator = (r: Row) =>
    can(user.roles, ["Operations Coordinator"]) && sessionGroupOf(r)?.coordinator === user.id;
  // What a credit change was, from its sign and how it was recorded.
  const creditKind = (e: Row) =>
    /^Top-up/.test(e.reason || "")
      ? "Top-up"
      : /^Opening/.test(e.reason || "")
        ? "Opening balance"
        : Number(e.delta) < 0
          ? "Service charged"
          : e.gig_id
            ? "Refund"
            : "Top-up";
  // A staff member's phone as a call link and a WhatsApp link (Egyptian
  // mobile numbers; anything else is offered as a call only).
  const reachOf = (personId?: string | null) => {
    const raw = String(staff.find((s: Row) => s.id === personId)?.phone || "").split("/")[0].trim();
    const digits = raw.replace(/D/g, "");
    if (!digits) return null;
    const local = /^01d{9}$/.test(digits) ? digits : /^201d{9}$/.test(digits) ? digits.slice(1) : "";
    return { shown: raw, tel: "tel:" + raw.replace(/[^d+]/g, ""), wa: local ? "https://wa.me/2" + local : null };
  };
  // Ready messages for a session's WhatsApp group, in the reader's language.
  const sessionWhen = (r: Row) =>
    new Date(r.starts_at).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
      timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
  const confirmMessage = (r: Row): Row => {
    const g = sessionGroupOf(r);
    const name = sessionName(r.title);
    const link = g?.session_link || "";
    return {
      kind: "confirm",
      session: r,
      link: g?.whatsapp_link || "",
      text:
        locale === "ar"
          ? `أهلاً بالجميع 👋
نؤكد جلسة ${name} يوم ${sessionWhen(r)} (بتوقيت القاهرة).${link ? `
رابط الدخول: ${link}` : ""}
نراكم هناك!`
          : `Hello everyone 👋
Confirming ${name} on ${sessionWhen(r)} (Cairo time).${link ? `
Join here: ${link}` : ""}
See you there!`,
    };
  };
  const feedbackMessage = (r: Row): Row => {
    const g = sessionGroupOf(r);
    const portal = (typeof window !== "undefined" ? window.location.origin : "") + "/student#feedback";
    return {
      kind: "feedback",
      session: r,
      link: g?.whatsapp_link || "",
      text:
        locale === "ar"
          ? `شكراً لحضوركم جلسة اليوم 🙏
من فضلكم قيّموا الجلسة من صفحتكم على بوابة ديبي، تأخذ دقيقة واحدة:
${portal}`
          : `Thank you for joining today's session 🙏
Please rate it on your DEPI page, it takes a minute:
${portal}`,
    };
  };
  // A WhatsApp link to a student with a ready message, in the reader's language.
  const whatsapp = (phone: string, template: "reminder" | "absence" | "congratulations", v: Row) => {
    const digits = String(phone || "").split(" / ")[0].replace(/\D/g, "");
    if (!/^01\d{9}$/.test(digits)) return null;
    const first = String(v.name || "").split(" ")[0];
    const text =
      locale === "ar"
        ? template === "reminder"
          ? `أهلًا ${first}، تذكير بجلسة ديبي ${v.title || ""} ${v.when || ""}. رابط الدخول: ${v.link || ""}`
          : template === "absence"
            ? `أهلًا ${first}، افتقدناك في الجلسة الأخيرة. هل كل شيء على ما يرام؟ نحن هنا للمساعدة.`
            : `مبروك يا ${first} على أول عمل لك! خطوة رائعة، استمر.`
        : template === "reminder"
          ? `Hi ${first}, a reminder of your DEPI session ${v.title || ""} ${v.when || ""}. Join: ${v.link || ""}`
          : template === "absence"
            ? `Hi ${first}, we missed you at the last session. Is everything all right? We're here to help.`
            : `Congratulations ${first} on your first gig! A great step, keep going.`;
    return `https://wa.me/2${digits}?text=${encodeURIComponent(text)}`;
  };
  // Students' feedback on a session, and an average of one of its ratings.
  const feedbackOf = (sessionId: string) => (d.sessionFeedback || []).filter((f: Row) => f.session_id === sessionId);
  const average = (rows: Row[], key: string) =>
    rows.length ? (rows.reduce((n, r) => n + Number(r[key] || 0), 0) / rows.length).toFixed(1) : "—";
  // A session's register: its group's active students, by name.
  const rosterOf = (r: Row) =>
    (d.students || [])
      .filter((s: Row) => s.group_id === r.group_id && s.lifecycle === "Active")
      .sort((a: Row, b: Row) => String(a.name).localeCompare(String(b.name)));
  // Attendance is taken from the session itself once it has started, by its
  // group's coordinator, its coach or a leader.
  const takesAttendance = (r: Row) =>
    r.status !== "Cancelled" &&
    Date.parse(r.starts_at) <= Date.now() &&
    (plansSession(r) || answersAsCoordinator(r) || answersAsCoach(r));
  // Everyone starts Present; the person taking the register taps the absent ones.
  const openAttendance = (r: Row) => {
    const marks: Row = {};
    for (const st of rosterOf(r)) marks[st.id] = "Present";
    for (const a of attendance.filter((a) => a.session_id === r.id))
      marks[a.student_id] = a.status === "Absent" ? "Absent" : "Present";
    open("session_attendance", { ...r, marks, teams: "" });
  };
  // A Microsoft Teams attendance report: whoever appears in it attended.
  // Teams saves it as UTF-16 text with tabs, so the bytes are read directly;
  // students are matched by email, then by name.
  const readTeamsFile = async (file: File, r: Row) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? new TextDecoder("utf-16le").decode(bytes)
        : file.name.toLowerCase().endsWith(".xlsx")
          ? (await readSheet(file)).map((row: Row) => Object.values(row).join("\t")).join("\n")
          : new TextDecoder("utf-8").decode(bytes);
    const lower = text.toLowerCase();
    const plain = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const names = new Set(text.split(/\r?\n/).map((line) => plain(line.split(/\t|,/)[0] || "")).filter((v) => v.length > 3));
    const roster = rosterOf(r);
    const marks: Row = {};
    let found = 0;
    for (const st of roster) {
      const here = (st.email && lower.includes(String(st.email).toLowerCase())) || names.has(plain(st.name || ""));
      marks[st.id] = here ? "Present" : "Absent";
      if (here) found += 1;
    }
    setForm((current: Row) => ({
      ...current,
      marks,
      teams: t("Teams file: {v0} of {v1} students found and marked Present; the rest Absent. Check before saving.", { v0: found, v1: roster.length }),
    }));
  };
  // The coordinator's checklist: coach confirmed, coach entered, and
  // attendance taken, which the app works out from the register.
  const checklistOf = (r: Row) => {
    const active = (d.students || [])
      .filter((s: Row) => s.group_id === r.group_id && s.lifecycle === "Active")
      .map((s: Row) => s.id);
    const marked = new Set<string>(
      (d.attendance || []).filter((a: Row) => a.session_id === r.id).map((a: Row) => a.student_id),
    );
    return checklistState(
      r,
      (d.sessionChecks || []).filter((c: Row) => c.session_id === r.id),
      active,
      marked,
    );
  };
  const ticksStep = (r: Row, item: ChecklistItem) =>
    r.status !== "Cancelled" &&
    item.owner !== "auto" &&
    (plansSession(r) || (item.owner === "coordinator" ? answersAsCoordinator(r) : item.owner === "coach" ? answersAsCoach(r) : false));
  const canAttend = (r: Row) =>
    r.status === "Scheduled" &&
    ((answersAsCoach(r) && !r.coach_confirmed_at) || (answersAsCoordinator(r) && !r.coordinator_confirmed_at));
  const canDecline = (r: Row) =>
    ["Scheduled", "Confirmed"].includes(r.status) &&
    ((answersAsCoach(r) && !r.coach_unavailable) || (answersAsCoordinator(r) && !r.coordinator_unavailable));
  // One response pill per person, the same size for the coordinator and the
  // coach: green with a tick when attending, red with a cross when not, amber
  // with a clock while waiting.
  const answer = (who: string, confirmedAt: any, away: any) => {
    const [tone, Icon, word] = confirmedAt
      ? ["is-ok", CheckCircle2, t("Attending")]
      : away
        ? ["is-away", XCircle, t("Unavailable")]
        : ["is-wait", Clock3, t("Waiting")];
    return (
      <span className={"confirm-pill " + tone} title={away ? `${t("Unavailable")}: ${away}` : undefined}>
        <Icon size={15} aria-hidden />
        <b>{who}</b>
        <span>{word}</span>
      </span>
    );
  };
  // A service link's review, in the words QC decides in: approved or rejected.
  const qcState = (status?: string) =>
    status === "Locked" ? "Approved" : status === "Needs Correction" ? "Rejected" : status === "Pending" ? "Waiting for review" : status || "";
  // A service link named by the marketplace it is on.
  const serviceLabel = (platform?: string) =>
    !platform ? t("Service") : platform === "External service" ? t("Other site") : t("{v0} service", { v0: platform });
  const statusCol = {
    key: "status",
    label: t("Status"),
    render: (r: Row) => <Badge value={r.status} />,
  };
  const filterOpts =
    module === "students"
      ? ["All", "At risk in my groups", "No contact in 7 days", "Active", "At Risk", "Critical", "No Contact", "Graduated"]
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
        label: t("Services waiting for review"),
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
        {/* Sessions students rated below 3 of 5, until someone handles each one. */}
        {can(user.roles, ["Coach Operations"]) && (
          <FeedbackAlertCard
            onOpen={() => {
              setSessionTab("feedback");
              goTo("sessions");
            }}
          />
        )}
        <div className="greeting">
          <div>
            <div className="eyebrow">{t("ROUND 5 / OPERATIONS OVERVIEW")}</div>
            <h1>{t("Keep every student moving.")}</h1>
            <p>{t("Your team’s priorities, progress and exceptions in one place.")}</p>
          </div>
          {may("contact") && (
            <button className="primary" onClick={() => open("contact")}>
              <Plus size={18} /> {t("Log contact")}
            </button>
          )}
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
            {(() => {
              // Session follow-ups that are someone's turn now: the coordinator
              // asks the group for feedback once a session has ended, and Coach
              // Operations checks the day's sessions in the morning.
              const over = (s: Row) => Date.parse(s.starts_at) + Number(s.duration_minutes || 180) * 60000 <= Date.now();
              const feedbackDue = sessions
                .filter((s) => s.status !== "Cancelled" && over(s) && Date.now() - Date.parse(s.starts_at) < 3 * 86400000)
                .filter((s) => answersAsCoordinator(s) && !checklistOf(s).feedback_requested?.done)
                .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
              const morningChecks = can(user.roles, ["Coach Operations"])
                ? sessions
                    .filter((s) => s.status !== "Cancelled" && programDay(new Date(s.starts_at)) === programDay() && !checklistOf(s).coach_ops_checked?.done)
                    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                : [];
              if (!feedbackDue.length && !morningChecks.length) return null;
              const line = (s: Row) => `${s.group_id} · ${t("Week {v0}", { v0: s.week })} · ${new Date(s.starts_at).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}`;
              return panel(
                t("Session follow-ups"),
                <div className="followup-list">
                  {feedbackDue.map((s) => (
                    <div className="task-row" key={"fb-" + s.id}>
                      <MessageCircle size={16} />
                      <div className="task-main">
                        <strong>{t("Ask the group for feedback")}</strong>
                        <small>{line(s)}</small>
                      </div>
                      <button className="small-btn" onClick={() => setGroupMessage(feedbackMessage(s))}>{t("Message")}</button>
                    </div>
                  ))}
                  {morningChecks.map((s) => (
                    <div className="task-row" key={"co-" + s.id}>
                      <CheckCheck size={16} />
                      <div className="task-main">
                        <strong>{t("Check today's session")}</strong>
                        <small>{line(s)} · {owner(s.coach_id)}</small>
                      </div>
                      <button className="small-btn" disabled={busy} onClick={() => quick("session_check", { id: s.id, item: "coach_ops_checked", done: true })}>{t("Mark done")}</button>
                    </div>
                  ))}
                </div>,
                <span className="count">{feedbackDue.length + morningChecks.length}</span>,
              );
            })()}
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
              <p>{t("Only Quality-accepted services count toward graduation.")}</p>
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
                      {v === "Graduated" ? t("Graduated") : v + " " + t("qualifying services")}
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
          (filter === "At risk in my groups" && ["At Risk", "Critical"].includes(s.risk.status)) ||
          (filter === "No contact in 7 days" && s.lifecycle === "Active" && (!s.last_contact || Date.now() - Date.parse(s.last_contact) > 7 * 86400000)) ||
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
              {t(q)}
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
          filter === "All" ? t("Open actions") : t(filter),
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
              <p className="footnote">{trajectoryReason(g.trajectory_reason)}</p>
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
                {g.whatsapp_link && (
                  <a className="small-btn wa-btn" href={g.whatsapp_link} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} /> {t("WhatsApp group")}
                  </a>
                )}
                {(can(user.roles, ["Project Operations", "Operations Systems / Admin"]) || g.coordinator === user.id || g.supervisor === user.id) && (
                  <button className="small-btn" onClick={() => open("group_whatsapp", { id: g.id, whatsapp_link: g.whatsapp_link || "" })}>
                    {g.whatsapp_link ? t("Change WhatsApp link") : t("Add WhatsApp group link")}
                  </button>
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
                {can(user.roles, ["Operations Systems / Admin"]) && (
                  <button
                    className="small-btn"
                    onClick={() =>
                      open("group_gate", { group_id: g.id, week: g.week })
                    }
                  >
                    {t("Weekly gate")}
                  </button>
                )}
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
    // Day of the week and start time, in Cairo, for the filters.
    const sessionDay = (s: Row) =>
      new Date(s.starts_at).toLocaleDateString("en-US", { weekday: "long", timeZone: "Africa/Cairo" });
    const sessionTime = (s: Row) =>
      new Date(s.starts_at).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" });
    const weekdays = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const times = Array.from(new Set(sessions.map(sessionTime))).sort();
    // One week at a time, Saturday to Friday in Cairo (the programme's week),
    // with arrows to step back and forward.
    const weekStart = (() => {
      const today = new Date(programDay() + "T00:00:00Z");
      const back = (today.getUTCDay() + 1) % 7; // days since Saturday
      return new Date(today.getTime() - back * 86400000 + sessionWeek * 7 * 86400000);
    })();
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
    const inShownWeek = (s: Row) => {
      const day = programDay(new Date(s.starts_at));
      return day >= weekStart.toISOString().slice(0, 10) && day < weekEnd.toISOString().slice(0, 10);
    };
    const weekLabel = (() => {
      const f = (d: Date) => d.toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return `${f(weekStart)} – ${f(new Date(weekEnd.getTime() - 86400000))}`;
    })();
    const sessionRows = sessions
      .filter(qMatch)
      .filter(inShownWeek)
      .filter((session) => filter === "All" || session.status === filter)
      .filter((session) => sessionFilters.day === "All" || sessionDay(session) === sessionFilters.day)
      .filter((session) => sessionFilters.time === "All" || sessionTime(session) === sessionFilters.time)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    // What happened in the sessions: attendance, feedback and who held them.
    const ended = (x: Row) => x.status !== "Cancelled" && Date.parse(x.starts_at) + Number(x.duration_minutes || 180) * 60000 <= Date.now();
    const inRange = (iso: string) =>
      (!insightFilters.from || iso.slice(0, 10) >= insightFilters.from) && (!insightFilters.to || iso.slice(0, 10) <= insightFilters.to);
    const insightSessions = sessions
      .filter((x) => insightFilters.group === "All" || x.group_id === insightFilters.group)
      .filter((x) => insightFilters.coach === "All" || x.coach_id === insightFilters.coach)
      .filter((x) => inRange(x.starts_at));
    const coachesSeen = Array.from(new Set(sessions.map((x) => x.coach_id).filter(Boolean))) as string[];
    const insightFilterRow = (
      <div className="filter-row">
        <Pick label={t("Group")} value={insightFilters.group} onChange={(group) => setInsightFilters({ ...insightFilters, group })} options={[{ value: "All", label: t("Every group") }, ...groups.map((g) => ({ value: g.id, label: g.id }))]} />
        <Pick label={t("Coach")} value={insightFilters.coach} onChange={(coach) => setInsightFilters({ ...insightFilters, coach })} options={[{ value: "All", label: t("Every coach") }, ...coachesSeen.map((id) => ({ value: id, label: owner(id) }))]} />
        <label className="field date-filter">{t("From")}<input type="date" value={insightFilters.from} onChange={(e) => setInsightFilters({ ...insightFilters, from: e.target.value })} /></label>
        <label className="field date-filter">{t("To")}<input type="date" value={insightFilters.to} onChange={(e) => setInsightFilters({ ...insightFilters, to: e.target.value })} /></label>
      </div>
    );

    // Attendance: each held session's register, and the students missing sessions.
    const heldSessions = insightSessions.filter(ended).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    const registerOf = (x: Row) => {
      const roster = rosterOf(x);
      const marks = attendance.filter((a) => a.session_id === x.id);
      const present = marks.filter((a) => a.status !== "Absent").length;
      return { roster: roster.length, present, absent: marks.length - present, unmarked: Math.max(0, roster.length - marks.length) };
    };
    const registers = heldSessions.map((x) => ({ ...x, register: registerOf(x) }));
    const marked = registers.reduce((n, x) => n + x.register.present + x.register.absent, 0);
    const presentTotal = registers.reduce((n, x) => n + x.register.present, 0);
    const studentAttendance = (() => {
      const byStudent = new Map<string, Row>();
      for (const x of heldSessions)
        for (const st of rosterOf(x)) {
          const row = byStudent.get(st.id) || { id: st.id, name: st.name, group_id: st.group_id, held: 0, present: 0, absent: 0, last: "" };
          row.held += 1;
          const mark = attendance.find((a) => a.session_id === x.id && a.student_id === st.id);
          if (mark?.status === "Absent") row.absent += 1;
          else if (mark) {
            row.present += 1;
            if (x.starts_at > row.last) row.last = x.starts_at;
          }
          byStudent.set(st.id, row);
        }
      return Array.from(byStudent.values())
        .filter((r) => !insightFilters.absentOnly || r.absent > 0)
        .sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name));
    })();

    // Sessions held, for paying coaches and coordinators: each session counts
    // for the coach and coordinator it had when it was held.
    const payMonth = insightFilters.month;
    const paySessions = sessions.filter(ended).filter((x) => payMonth === "All" || x.starts_at.slice(0, 7) === payMonth);
    const verified = (x: Row) => {
      const st = checklistOf(x);
      return Boolean(st.attendance_taken?.done || st.instructor_entered?.done);
    };
    // Coach payout: an Outcome coach is paid 300 a session and 250 for each of
    // their graduates who did not use a purchased service; a Support coach 500
    // a session. A session is paid at the coach's type in that group; a
    // backup coach at their own title.
    const coachTypeFor = (coachId: string, groupId: string) => {
      const row = groupCoaches.find((c) => c.user_id === coachId && c.group_id === groupId && ["Outcome Coach", "Support Coach"].includes(c.coach_type));
      if (row) return row.coach_type;
      const title = staff.find((x: Row) => x.id === coachId)?.title || "";
      return ["Outcome Coach", "Support Coach"].includes(title) ? title : title || "Coach";
    };
    const coachPay = (r: Row) => {
      const types = r.sessions.map((x: Row) => coachTypeFor(r.person, x.group_id));
      const type = types.includes("Outcome Coach") ? "Outcome Coach" : types.includes("Support Coach") ? "Support Coach" : types[0];

      const outcomeGroups = new Set(groupCoaches.filter((c) => c.user_id === r.person && c.coach_type === "Outcome Coach" && c.status === "Active").map((c) => c.group_id));
      const purchased = new Set(gigs.filter((g) => g.account_id).map((g) => g.student_id));
      const graduates = students.filter((x) => outcomeGroups.has(x.group_id) && /Graduat/.test(x.graduation || "") && !purchased.has(x.id)).length;
      const pay = coachPayout(types, graduates);
      return { type, rate: (coachRates as Row)[type] || 0, graduates, ...pay };
    };
    // Coordinators and supervisors: the students of their groups and how many graduated.
    const peoplePay = (r: Row) => {
      const theirGroups = new Set(
        groups.filter((g) => (insightFilters.payee === "Supervisors" ? g.supervisor : g.coordinator) === r.person).map((g) => g.id),
      );
      const theirs = students.filter((x) => theirGroups.has(x.group_id));
      return { students: theirs.length, graduated: theirs.filter((x) => /Graduat/.test(x.graduation || "")).length };
    };
    // Supervisors are paid on the sessions of their groups.
    const supervisorOf = (x: Row) => groups.find((g) => g.id === x.group_id)?.supervisor;
    const payRows = Object.values(
      paySessions.reduce((out: Row, x: Row) => {
        const id =
          (insightFilters.payee === "Coordinators" ? x.coordinator_id : insightFilters.payee === "Supervisors" ? supervisorOf(x) : x.coach_id) || "none";
        const row = (out[id] ||= { person: id, sessions: [] as Row[] });
        row.sessions.push(x);
        return out;
      }, {} as Row),
    )
      .map((r: Row) => ({
        ...r,
        held: r.sessions.length,
        verified: r.sessions.filter(verified).length,
        hours: r.sessions.reduce((n: number, x: Row) => n + Number(x.duration_minutes || 180) / 60, 0),
        groups: new Set(r.sessions.map((x: Row) => x.group_id)).size,
      }))
      .map((r: Row) => (insightFilters.payee === "Coaches" ? { ...r, ...coachPay(r) } : { ...r, ...peoplePay(r) }))
      .sort((a: Row, b: Row) => b.held - a.held) as Row[];
    const months = Array.from(new Set(sessions.filter(ended).map((x) => x.starts_at.slice(0, 7)))).sort().reverse();
    const downloadPay = () => {
      const coaches = insightFilters.payee === "Coaches";
      const lines = [
        ["Person", "Role", "Sessions held", "Verified", "Hours", "Groups", ...(coaches ? ["Coach type", "Rate (EGP)", "Sessions pay (EGP)", "Graduates without purchased services", "Graduate bonus (EGP)", "Payout (EGP)"] : ["Students", "Graduated"]), "Session dates"].join(","),
      ];
      for (const r of payRows)
        lines.push(
          [
            owner(r.person),
            insightFilters.payee === "Coordinators" ? "Coordinator" : insightFilters.payee === "Supervisors" ? "Supervisor" : "Coach",
            r.held,
            r.verified,
            r.hours,
            r.groups,
            ...(coaches ? [r.type, r.rate, r.sessionsPay, r.graduates, r.bonus, r.total] : [r.students, r.graduated]),
            r.sessions.map((x: Row) => `${x.starts_at.slice(0, 10)} ${x.group_id} W${x.week}`).join("; "),
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `sessions-held-${insightFilters.payee.toLowerCase()}-${payMonth}.csv`;
      a.click();
    };
    // Payment calculations are Coach Operations' (and the administrators').
    const paysPeople = can(user.roles, ["Coach Operations", "Operations Systems / Admin"]);
    const egp = (v: number) => "EGP " + Math.round(v).toLocaleString("en-US");

    content = (
      <Tabs value={sessionTab} onValueChange={setSessionTab}>
        <TabsList>
          <TabsTrigger value="schedule">{t("Schedule")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("Attendance")}</TabsTrigger>
          {readsFeedback && <TabsTrigger value="feedback">{t("Feedback")} <span className="count">{(d.sessionFeedback || []).length}</span></TabsTrigger>}
          {paysPeople && <TabsTrigger value="pay">{t("Sessions held")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="schedule">
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
                    item.status === "Coordinator L1" &&
                    Date.now() - Date.parse(item.stage_at) > 24 * 3600000,
                ).length
              }
            </strong>
            {t("Coordinator checks >24h")}
          </span>
          <span>
            <strong>{coverageGaps.length}</strong>
            {t("Coverage gaps")}
          </span>
        </div>
        <div className="filter-row">
          <div className="week-nav" role="group" aria-label={t("Week")}>
            <button type="button" className="small-btn" onClick={() => setSessionWeek(sessionWeek - 1)} aria-label={t("Previous week")}>
              {dir === "rtl" ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <span className="week-nav-label">
              <strong>{weekLabel}</strong>
              <small>{sessionWeek === 0 ? t("This week") : sessionWeek === -1 ? t("Last week") : sessionWeek === 1 ? t("Next week") : sessionWeek > 0 ? t("In {v0} weeks", { v0: sessionWeek }) : t("{v0} weeks ago", { v0: -sessionWeek })}</small>
            </span>
            <button type="button" className="small-btn" onClick={() => setSessionWeek(sessionWeek + 1)} aria-label={t("Next week")}>
              {dir === "rtl" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
            {sessionWeek !== 0 && (
              <button type="button" className="small-btn" onClick={() => setSessionWeek(0)}>{t("This week")}</button>
            )}
          </div>
          <Pick
            label={t("Day")}
            value={sessionFilters.day}
            onChange={(day) => setSessionFilters({ ...sessionFilters, day })}
            options={[{ value: "All", label: t("Every day") }, ...weekdays.map((d) => ({ value: d, label: t(d) }))]}
          />
          <Pick
            label={t("Time")}
            value={sessionFilters.time}
            onChange={(time) => setSessionFilters({ ...sessionFilters, time })}
            options={[{ value: "All", label: t("Any time") }, ...times.map((v) => ({ value: v, label: v }))]}
          />
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
          {
            key: "title",
            label: t("Session"),
            render: (r) =>
              takesAttendance(r) ? (
                <button className="text-link session-open" onClick={() => openAttendance(r)} title={t("Take attendance")}>
                  <strong>{sessionName(r.title)}</strong>
                  <small className="table-subline">{t("Attendance: {v0}/{v1}", { v0: attendance.filter((a) => a.session_id === r.id).length, v1: rosterOf(r).length })}</small>
                </button>
              ) : (
                <strong>{sessionName(r.title)}</strong>
              ),
          },
          { key: "group_id", label: t("Group") },
          // Supervisors and the leaders follow up with the coordinator directly.
          ...(can(user.roles, ["Team Supervisor", "Project Operations", "Coach Operations", "Operations Systems / Admin", "Higher Board"])
            ? [
                {
                  key: "coordinator_id",
                  label: t("Coordinator"),
                  render: (r: Row) => {
                    const id = r.coordinator_id || groups.find((g) => g.id === r.group_id)?.coordinator;
                    const reach = reachOf(id);
                    return (
                      <span>
                        {owner(id)}
                        {reach && (
                          <small className="table-subline reach-links">
                            <a href={reach.tel} dir="ltr" title={t("Call")}><Phone size={12} /> {reach.shown}</a>
                            {reach.wa && <a href={reach.wa} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={12} /></a>}
                          </small>
                        )}
                      </span>
                    );
                  },
                },
              ]
            : []),
          {
            key: "coach_id",
            label: t("Coach"),
            // The coach's phone and WhatsApp, to reach them fast before or during the session.
            render: (r) => {
              const id = r.coach_id || groups.find((g) => g.id === r.group_id)?.coach;
              const reach = id && id !== user.id ? reachOf(id) : null;
              return (
                <span>
                  {owner(r.coach_id || id)}
                  {reach && (
                    <small className="table-subline reach-links">
                      <a href={reach.tel} dir="ltr" title={t("Call the coach")}><Phone size={12} /> {reach.shown}</a>
                      {reach.wa && <a href={reach.wa} target="_blank" rel="noreferrer" title={t("WhatsApp the coach")}><MessageCircle size={12} /></a>}
                    </small>
                  )}
                </span>
              );
            },
          },
          { key: "week", label: t("Week") },
          {
            key: "duration_minutes",
            label: t("Duration"),
            render: (r) => t("{v0} min", { v0: r.duration_minutes || 180 }),
          },
          statusCol,
          {
            key: "confirmations",
            label: t("Responses"),
            render: (r) =>
              r.status === "Cancelled" ? (
                "—"
              ) : (
                <span className="confirm-pills">
                  {answer(t("Coordinator"), r.coordinator_confirmed_at, r.coordinator_unavailable)}
                  {answer(t("Coach"), r.coach_confirmed_at, r.coach_unavailable)}
                </span>
              ),
          },
          {
            key: "checklist",
            label: t("Checklist"),
            render: (r) => {
              if (r.status === "Cancelled") return "—";
              const state = checklistOf(r);
              const next = sessionChecklist.find((item) => state[item.key] && !state[item.key].done);
              return (
                <button className="checklist-track" onClick={() => setChecklistFor(r.id)} title={t("Open the checklist")}>
                  <span className="checklist-dots">
                    {sessionChecklist.filter((item) => state[item.key]).map((item) => {
                      const st = state[item.key];
                      return (
                        <i key={item.key} className={st.flagged ? "is-flagged" : st.done ? "is-done" : ""} title={`${t(item.stage === "Before" ? "Before" : item.stage === "During" ? "During" : "After")} · ${t(item.label)}`}>
                          {st.flagged ? "!" : st.done ? <Check size={11} /> : null}
                        </i>
                      );
                    })}
                  </span>
                  <small>{next ? t(next.label) : t("All done")}</small>
                </button>
              );
            },
          },
          ...(readsFeedback
            ? [
                {
                  key: "feedback",
                  label: t("Feedback"),
                  render: (r: Row) => {
                    const given = feedbackOf(r.id);
                    if (!given.length) return Date.parse(r.starts_at) <= Date.now() && r.status !== "Cancelled" ? <small>{t("None yet")}</small> : "—";
                    return (
                      <button className="text-link" onClick={() => setFeedbackFor(r.id)}>
                        <FeedbackScore score={scoreOf(given)} />
                        <small className="table-subline">{t("{v0} responses", { v0: given.length })}</small>
                      </button>
                    );
                  },
                },
              ]
            : []),
          {
            key: "link",
            label: t("Link"),
            render: (r) => {
              const link = groups.find((g) => g.id === r.group_id)?.session_link;
              return (
                <span className="join-cell session-access">
                  {link ? (
                    <a className="access-btn is-join" href={link} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> {t("Join")}
                    </a>
                  ) : (
                    <span className="access-btn is-missing">{t("No link yet")}</span>
                  )}
                  {sessionGroupOf(r)?.whatsapp_link && !onlyCoach && (
                    <a className="access-btn is-whatsapp" href={sessionGroupOf(r)!.whatsapp_link} target="_blank" rel="noreferrer">
                      <MessageCircle size={14} /> {t("WhatsApp group")}
                    </a>
                  )}
                  {!demoAccount && seesCoachLogin(r) &&
                    (storedLogin("coach", r) ? (
                      <button type="button" className="access-btn is-coach" disabled={busy} onClick={() => showJoinLogin(r, "coach")}>
                        <LockKeyhole size={14} /> {t("Coach login")}
                      </button>
                    ) : (
                      <span className="access-btn is-missing-login" title={t("Ask an administrator to add it under Administration → Session logins.")}>
                        <AlertTriangle size={14} /> {t("No coach login yet")}
                      </span>
                    ))}
                  {!demoAccount && !seesCoachLogin(r) && coachOfSession(r) && (
                    <span className="access-btn is-missing">{t("Coach joins with their own email")}</span>
                  )}
                  {!demoAccount && seesCoordinatorLogin(r) &&
                    (storedLogin("coordinator", r) ? (
                      <button type="button" className="access-btn is-coordinator" disabled={busy} onClick={() => showJoinLogin(r, "coordinator")}>
                        <LockKeyhole size={14} /> {t("Coordinator login")}
                      </button>
                    ) : (
                      <span className="access-btn is-missing-login" title={t("Ask an administrator to add it under Administration → Session logins.")}>
                        <AlertTriangle size={14} /> {t("No coordinator login yet")}
                      </span>
                    ))}
                </span>
              );
            },
          },
        ],
            (r) => (
          <div className="detail-actions">
            {canAttend(r) && (
              <button
                className="small-btn"
                disabled={busy}
                title={
                  answersAsCoordinator(r) && !r.coordinator_confirmed_at
                    ? t("Recorded in the app. You then get a ready message to paste in the group's WhatsApp.")
                    : t("Recorded in the app for the coordinator and Coach Operations. Nobody is messaged.")
                }
                onClick={async () => {
                  const asCoordinator = answersAsCoordinator(r) && !r.coordinator_confirmed_at;
                  if ((await quick("session_confirm", { id: r.id })) && asCoordinator) setGroupMessage(confirmMessage(r));
                }}
              >
                {answersAsCoordinator(r) && !r.coordinator_confirmed_at ? t("Confirm · then message the group") : t("Attending")}
              </button>
            )}
            {/* The coordinator can send the group its confirmation again, or ask for feedback once it ended. */}
            {answersAsCoordinator(r) && r.status === "Confirmed" && Date.parse(r.starts_at) > Date.now() && (
              <button className="small-btn" onClick={() => setGroupMessage(confirmMessage(r))}>
                <MessageCircle size={14} /> {t("Message the group")}
              </button>
            )}
            {(answersAsCoordinator(r) || plansSession(r)) &&
              r.status !== "Cancelled" &&
              Date.parse(r.starts_at) + Number(r.duration_minutes || 180) * 60000 <= Date.now() &&
              Date.now() - Date.parse(r.starts_at) < 7 * 86400000 &&
              !checklistOf(r).feedback_requested?.done && (
                <button className="small-btn" onClick={() => setGroupMessage(feedbackMessage(r))}>
                  <MessageCircle size={14} /> {t("Ask for feedback")}
                </button>
              )}
            {canDecline(r) && (
              <button
                className="small-btn"
                disabled={busy}
                onClick={() => open("session_unavailable", r)}
              >
                {t("Unavailable")}
              </button>
            )}
            {["Scheduled", "Confirmed"].includes(r.status) &&
              plansSession(r) && (
                <>
                  {can(user.roles, ["Coach Operations", "Operations Systems / Admin"]) && (
                    <button
                      className="small-btn"
                      onClick={() => open("session_reschedule", r)}
                    >
                      {t("Reschedule")}
                    </button>
                  )}
                  <button
                    className="small-btn"
                    onClick={() => open("session_cancel", r)}
                  >
                    {t("Cancel")}
                  </button>
                </>
              )}
            {takesAttendance(r) && (
              <button className="small-btn" onClick={() => openAttendance(r)}>
                {t("Attendance")}
              </button>
            )}
            {can(user.roles, ["Coach Operations", "Operations Systems / Admin"]) &&
              ["Scheduled", "Confirmed"].includes(r.status) &&
              Date.parse(r.starts_at) > Date.now() && (
                <button className="small-btn" onClick={() => open("session_coach", { ...r, mode: "existing", coach_id: "" })}>
                  {t("Change coach")}
                </button>
              )}
          </div>
            ),
          ),
        )}
        </TabsContent>
        <TabsContent value="attendance">
          {insightFilterRow}
          <div className="filter-row">
            <label className="check"><Checkbox checked={insightFilters.absentOnly} onCheckedChange={(v) => setInsightFilters({ ...insightFilters, absentOnly: v === true })} />{t("Only students who missed a session")}</label>
          </div>
          <div className="mini-stats">
            <span className={"cue-stat is-" + rateTone(pctOf(presentTotal, marked))}><strong>{marked ? Math.round((100 * presentTotal) / marked) : 0}%</strong>{t("Attendance rate")}</span>
            <span><strong>{heldSessions.length}</strong>{t("Sessions held")}</span>
            <span className={registers.some((x) => x.register.unmarked > 0) ? "is-warning" : ""}><strong>{registers.filter((x) => x.register.unmarked > 0).length}</strong>{t("Registers not complete")}</span>
            <span><strong>{studentAttendance.filter((r) => r.absent >= 2).length}</strong>{t("Students absent twice or more")}</span>
          </div>
          {panel(
            t("Session registers"),
            registers.length
              ? generic(
                  registers,
                  [
                    { key: "starts_at", label: t("Date"), render: (x) => <span>{fmt(x.starts_at)}<small className="table-subline">{t("Week {v0}", { v0: x.week })}</small></span> },
                    { key: "group_id", label: t("Group") },
                    { key: "coach_id", label: t("Coach"), render: (x) => owner(x.coach_id) },
                    { key: "present", label: t("Attended"), render: (x) => <Cue tone="ok">{x.register.present}</Cue> },
                    { key: "absent", label: t("Absent"), render: (x) => <Cue tone={x.register.absent ? "bad" : "info"}>{x.register.absent}</Cue> },
                    { key: "unmarked", label: t("Not marked"), render: (x) => <Cue tone={x.register.unmarked ? "warn" : "ok"}>{x.register.unmarked}</Cue> },
                    { key: "rate", label: t("Rate"), render: (x) => { const pct = pctOf(x.register.present, x.register.present + x.register.absent); return <Cue tone={rateTone(pct)}>{pct === null ? "—" : pct + "%"}</Cue>; } },
                  ],
                  (x) => (takesAttendance(x) ? <button className="small-btn" onClick={() => openAttendance(x)}>{x.register.unmarked ? t("Take attendance") : t("Edit")}</button> : null),
                )
              : <Empty title={t("No session has been held in this period")} />,
          )}
          {panel(
            t("Students' attendance"),
            studentAttendance.length
              ? generic(
                  studentAttendance.slice(0, 300),
                  [
                    { key: "name", label: t("Student"), render: (r) => <span><strong>{r.name}</strong><small className="table-subline">{r.group_id}</small></span> },
                    { key: "present", label: t("Attended"), render: (r) => <Cue tone="ok">{`${r.present}/${r.held}`}</Cue> },
                    { key: "absent", label: t("Absent"), render: (r) => <Cue tone={r.absent >= 2 ? "bad" : r.absent ? "warn" : "info"} title={r.absent >= 2 ? t("{v0} absences", { v0: r.absent }) : undefined}>{r.absent}</Cue> },
                    { key: "rate", label: t("Rate"), render: (r) => { const pct = pctOf(r.present, r.present + r.absent); return <Cue tone={rateTone(pct)}>{pct === null ? "—" : pct + "%"}</Cue>; } },
                    { key: "last", label: t("Last attended"), render: (r) => (r.last ? fmt(r.last) : "—") },
                  ],
                  (r) => <button className="small-btn" onClick={() => setSelected(students.find((x) => x.id === r.id) || null)}>{t("Open student")}</button>,
                )
              : <Empty title={t("No attendance to show")} />,
          )}
        </TabsContent>
        {readsFeedback && (
          <TabsContent value="feedback">
            <FeedbackView />
          </TabsContent>
        )}
        {paysPeople && (
          <TabsContent value="pay">
            <div className="filter-row">
              <Pick label={t("Month")} value={payMonth} onChange={(month) => setInsightFilters({ ...insightFilters, month })} options={[{ value: "All", label: t("All time") }, ...months.map((m) => ({ value: m, label: m }))]} />
              <Pick label={t("Paying")} value={insightFilters.payee} onChange={(payee) => setInsightFilters({ ...insightFilters, payee })} options={[{ value: "Coaches", label: t("Coaches") }, { value: "Coordinators", label: t("Coordinators") }, { value: "Supervisors", label: t("Supervisors") }]} />
              <button className="small-btn" disabled={!payRows.length} onClick={downloadPay}>{t("Download CSV")}</button>
            </div>
            <p className="footnote">
              {t("A session counts once it has ended and was not cancelled, for the coach and coordinator it had at the time; changing a group's coach or coordinator later does not move it. Verified means its attendance was taken or the instructor was marked as entered.")}
            </p>
            <div className="mini-stats">
              <span><strong>{paySessions.length}</strong>{t("Sessions held")}</span>
              <span><strong>{paySessions.filter(verified).length}</strong>{t("Verified")}</span>
              <span><strong>{payRows.length}</strong>{insightFilters.payee === "Coordinators" ? t("Coordinators") : insightFilters.payee === "Supervisors" ? t("Supervisors") : t("Coaches")}</span>
              {insightFilters.payee === "Coaches" && <span><strong>{egp(payRows.reduce((n, r) => n + (r.total || 0), 0))}</strong>{t("Total payout")}</span>}
            </div>
            {panel(
              insightFilters.payee === "Coordinators" ? t("Sessions held per coordinator") : insightFilters.payee === "Supervisors" ? t("Sessions held per supervisor") : t("Sessions held per coach"),
              payRows.length
                ? generic(
                    payRows,
                    [
                      { key: "person", label: insightFilters.payee === "Coordinators" ? t("Coordinator") : insightFilters.payee === "Supervisors" ? t("Supervisor") : t("Coach"), render: (r) => <strong>{r.person === "none" ? t("Not assigned") : owner(r.person)}</strong> },
                      { key: "held", label: t("Sessions held"), render: (r) => <strong>{r.held}</strong> },
                      { key: "verified", label: t("Verified"), render: (r) => (r.verified < r.held ? <span>{r.verified}<small className="table-subline credit-out">{t("{v0} not verified", { v0: r.held - r.verified })}</small></span> : r.verified) },
                      { key: "hours", label: t("Hours"), render: (r) => r.hours },
                      { key: "groups", label: t("Groups"), render: (r) => r.groups },
                      ...(insightFilters.payee === "Coaches"
                        ? [
                            { key: "type", label: t("Coach type"), render: (r: Row) => (r.rate ? t(r.type) : <span className="credit-out">{t(r.type || "Coach")} · {t("No rate")}</span>) },
                            { key: "sessionsPay", label: t("Sessions pay"), render: (r: Row) => <span className="money">{egp(r.sessionsPay)}<small className="table-subline">{r.held} × {r.rate}</small></span> },
                            { key: "bonus", label: t("Graduate bonus"), render: (r: Row) => (r.type === "Outcome Coach" ? <span className="money">{egp(r.bonus)}<small className="table-subline">{t("{v0} graduates without purchased services", { v0: r.graduates })}</small></span> : "—") },
                            { key: "total", label: t("Payout"), render: (r: Row) => <strong className="money">{egp(r.total)}</strong> },
                          ]
                        : [
                            { key: "students", label: t("Students"), render: (r: Row) => r.students },
                            { key: "graduated", label: t("Graduated"), render: (r: Row) => r.graduated },
                            { key: "commission", label: t("Commission"), render: () => <small>{t("Commission rules are not set yet")}</small> },
                          ]),
                      {
                        key: "dates",
                        label: t("Sessions"),
                        render: (r) => (
                          <details className="pay-sessions">
                            <summary>{t("{v0} sessions", { v0: r.held })}</summary>
                            <ul>
                              {r.sessions
                                .sort((a: Row, b: Row) => a.starts_at.localeCompare(b.starts_at))
                                .map((x: Row) => (
                                  <li key={x.id}>{fmt(x.starts_at)} · {x.group_id} · {t("Week {v0}", { v0: x.week })}{verified(x) ? " ✓" : ""}</li>
                                ))}
                            </ul>
                          </details>
                        ),
                      },
                    ],
                  )
                : <Empty title={t("No session has been held in this period")} />,
            )}
          </TabsContent>
        )}
      </Tabs>
    );
  } else if (module === "dashboard") {
    content = (
      <Suspense fallback={<div className="dash-loading">{t("Loading the dashboard…")}</div>}>
        <Dashboard />
      </Suspense>
    );
  } else if (module === "opportunities") {
    content = <Opportunities />;
  } else if (module === "progress") {
    content = <CoachProgress />;
  } else if (module === "portal") {
    content = <PortalView staffName={owner} />;
  } else if (module === "accounts") {
    const accounts: Row[] = d.accounts || [];
    const requests: Row[] = d.requests || [];
    const money = (v: any) => "$" + Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const attention = ["Blocked", "Access Issue", "Funding Block", "Under Review"];
    const activeReservation = (requestId: string) =>
      (d.reservations || []).find(
        (z: Row) => z.request_id === requestId && z.status === "Active" && z.expires_at > new Date().toISOString(),
      );
    const requestStage = (r: Row) => (r.status === "Submitted" && activeReservation(r.id) ? "Reserved" : r.status);
    // Status changes, unblocking included, belong to the people who keep the accounts.
    const managesAccounts = keepsAccounts;
    // Supervisors (Taha among them) assign accounts to coordinators.
    const assignsAccounts = can(user.roles, ["Team Supervisor", "Operations Systems / Admin"]);
    // The owner written in the accounts sheet reaches only its keeper and administrators.
    const seesOwner = accounts.some((a) => "owner_name" in a);
    const ownerNames = [...new Set(accounts.map((a) => a.owner_name).filter(Boolean))].sort();
    // Every change to an account's credit, newest first: opening balances,
    // top-ups, services charged and refunds.
    const ledger: Row[] = (d.creditLedger || [])
      .filter((e: Row) => accountFilters.platform === "All" || accounts.find((a) => a.id === e.account_id)?.platform === accountFilters.platform)
      .filter((e: Row) => accountFilters.ledger === "All" || creditKind(e) === accountFilters.ledger);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const toppedUp = (d.creditLedger || []).filter((e: Row) => creditKind(e) === "Top-up" && String(e.created_at).startsWith(thisMonth));
    const spent = (d.creditLedger || []).filter((e: Row) => creditKind(e) === "Service charged" && String(e.created_at).startsWith(thisMonth));
    const pool = accounts
      .filter(qMatch)
      .filter((r) => accountFilters.platform === "All" || r.platform === accountFilters.platform)
      .filter((r) =>
        accountFilters.coordinator === "All"
          ? true
          : accountFilters.coordinator === "None"
            ? !r.coordinator_id
            : r.coordinator_id === accountFilters.coordinator || r.coordinator_2_id === accountFilters.coordinator,
      )
      .filter((r) => !seesOwner || accountFilters.owner === "All" || (accountFilters.owner === "None" ? !r.owner_name : r.owner_name === accountFilters.owner))
      .filter((r) =>
        accountFilters.status === "All"
          ? true
          : accountFilters.status === "Attention"
            ? attention.includes(r.status)
            : r.status === accountFilters.status,
      )
      .sort((x, y) => String(x.platform).localeCompare(String(y.platform)) || Number(y.credits) - Number(x.credits));
    const requestRows = requests
      .filter(qMatch)
      .filter((r) => accountFilters.platform === "All" || r.platform === accountFilters.platform)
      .filter((r) =>
        accountFilters.request === "All"
          ? true
          : accountFilters.request === "Open"
            ? r.status === "Submitted"
            : requestStage(r) === accountFilters.request,
      );
    const openRequests = requests.filter((r) => r.status === "Submitted");
    content = (
      <>
        <div className="mini-stats account-stats">
          <span><strong>{accounts.filter((a) => a.status === "Available").length}</strong>{t("Available accounts")}</span>
          <span><strong>{money(accounts.filter((a) => a.status === "Available").reduce((n, a) => n + Number(a.credits || 0), 0))}</strong>{t("Credit available")}</span>
          <span><strong>{accounts.filter((a) => a.status === "Assigned").length}</strong>{t("Assigned to students")}</span>
          <span className={accounts.some((a) => attention.includes(a.status)) ? "is-warning" : ""}><strong>{accounts.filter((a) => attention.includes(a.status)).length}</strong>{t("Need attention")}</span>
          <span><strong>{openRequests.length}</strong>{t("Requests waiting")}</span>
        </div>
        <div className="account-capacity">
          {controlledPlatforms.map((platform) => {
            const mine = accounts.filter((a) => a.platform === platform);
            const ready = mine.filter((a) => a.status === "Available");
            const credit = ready.reduce((n, a) => n + Number(a.credits || 0), 0);
            const waiting = openRequests.filter((r) => r.platform === platform);
            const needed = waiting.reduce((n, r) => n + Number(r.value || 0), 0);
            return (
              <button
                key={platform}
                className={"capacity-card" + (accountFilters.platform === platform ? " is-selected" : "") + (needed > credit ? " is-short" : "")}
                onClick={() => setAccountFilters({ ...accountFilters, platform: accountFilters.platform === platform ? "All" : platform })}
              >
                <strong>{platform}</strong>
                <span>{t("{v0} of {v1} accounts ready", { v0: ready.length, v1: mine.length })}</span>
                <span>{t("{v0} credit · {v1} needed by {v2} requests", { v0: money(credit), v1: money(needed), v2: waiting.length })}</span>
              </button>
            );
          })}
        </div>
        <Tabs defaultValue={openRequests.length ? "requests" : "pool"}>
          <TabsList>
            <TabsTrigger value="pool">
              {t("Account pool")}{" "}<span className="count">{accounts.length}</span>
            </TabsTrigger>
            <TabsTrigger value="requests">
              {t("Requests")}{" "}<span className="count">{openRequests.length}</span>
            </TabsTrigger>
            {(keepsAccounts || can(user.roles, ["Project Operations"])) && (
              <TabsTrigger value="credit">
                {t("Credit tracker")}{" "}<span className="count">{(d.creditLedger || []).length}</span>
              </TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="credit">
            <div className="mini-stats">
              <span><strong>{money(toppedUp.reduce((n: number, e: Row) => n + Number(e.delta), 0))}</strong>{t("Topped up this month")}</span>
              <span><strong>{money(-spent.reduce((n: number, e: Row) => n + Number(e.delta), 0))}</strong>{t("Spent on services this month")}</span>
              <span><strong>{money(accounts.reduce((n, a) => n + Number(a.credits || 0), 0))}</strong>{t("Credit left in all accounts")}</span>
            </div>
            <div className="filter-row">
              <Pick label={t("Marketplace")} value={accountFilters.platform} onChange={(platform) => setAccountFilters({ ...accountFilters, platform })} options={["All", ...controlledPlatforms]} />
              <Pick
                label={t("Showing")}
                value={accountFilters.ledger}
                onChange={(ledger) => setAccountFilters({ ...accountFilters, ledger })}
                options={[
                  { value: "All", label: t("Every change") },
                  { value: "Top-up", label: t("Top-ups") },
                  { value: "Service charged", label: t("Services charged") },
                  { value: "Refund", label: t("Refunds") },
                  { value: "Opening balance", label: t("Opening balances") },
                ]}
              />
            </div>
            {panel(
              t("Credit history"),
              ledger.length ? (
                generic(
                  ledger,
                  [
                    {
                      key: "created_at",
                      label: t("Date"),
                      render: (e) => <span>{fmt(e.created_at)}<small className="table-subline">{new Date(e.created_at).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" })}</small></span>,
                    },
                    {
                      key: "account_id",
                      label: t("Account"),
                      render: (e) => {
                        const acc = accounts.find((a) => a.id === e.account_id);
                        return <span><strong>{acc?.label || e.account_id}</strong><small className="table-subline">{acc?.platform}</small></span>;
                      },
                    },
                    { key: "kind", label: t("Change"), render: (e) => <Badge value={creditKind(e)} /> },
                    {
                      key: "delta",
                      label: t("Amount"),
                      render: (e) => <strong className={Number(e.delta) >= 0 ? "credit-in" : "credit-out"}>{Number(e.delta) >= 0 ? "+" : "−"}{money(Math.abs(Number(e.delta)))}</strong>,
                    },
                    { key: "balance_after", label: t("Balance after"), render: (e) => money(e.balance_after) },
                    { key: "actor", label: t("Recorded by"), render: (e) => owner(e.actor) },
                    {
                      key: "reason",
                      label: t("Details"),
                      render: (e) => {
                        const gig = e.gig_id ? (d.gigs || []).find((g: Row) => g.id === e.gig_id) : null;
                        const detail = String(e.reason || "").replace(/^(Top-up|Service charged) · /, "");
                        return <span>{detail}{gig ? <small className="table-subline">{name(gig.student_id)}</small> : null}</span>;
                      },
                    },
                  ],
                )
              ) : (
                <Empty title={(d.creditLedger || []).length ? t("No credit change matches these filters") : t("No credit recorded yet. Add the client accounts with their opening credit, then record top-ups here.")} />
              ),
              keepsAccounts && accounts.length ? (
                <div className="detail-actions">
                  <button className="primary small" onClick={() => open("account_topup", { id: "" })}>
                    <Plus size={15} /> {t("Record a top-up")}
                  </button>
                </div>
              ) : null,
            )}
          </TabsContent>
          <TabsContent value="pool">
            <div className="filter-row">
              <Pick label={t("Marketplace")} value={accountFilters.platform} onChange={(platform) => setAccountFilters({ ...accountFilters, platform })} options={["All", ...controlledPlatforms]} />
              <Pick
                label={t("State")}
                value={accountFilters.status}
                onChange={(status) => setAccountFilters({ ...accountFilters, status })}
                options={[
                  { value: "All", label: t("Every state") },
                  { value: "Available", label: t("Available") },
                  { value: "Assigned", label: t("Assigned") },
                  { value: "Attention", label: t("Need attention") },
                  { value: "Cooldown", label: t("Cooldown") },
                  { value: "Retired", label: t("Retired") },
                ]}
              />
              <Pick
                label={t("Coordinator")}
                value={accountFilters.coordinator}
                onChange={(coordinator) => setAccountFilters({ ...accountFilters, coordinator })}
                options={[
                  { value: "All", label: t("Every coordinator") },
                  { value: "None", label: t("Not assigned yet") },
                  ...[...new Set(accounts.flatMap((a) => [a.coordinator_id, a.coordinator_2_id]).filter(Boolean))].map((id) => ({ value: String(id), label: owner(String(id)) })),
                ]}
              />
              {seesOwner && (
                <Pick
                  label={t("Owner")}
                  value={accountFilters.owner}
                  onChange={(o) => setAccountFilters({ ...accountFilters, owner: o })}
                  options={[{ value: "All", label: t("Every owner") }, { value: "None", label: t("No owner") }, ...ownerNames.map((n) => ({ value: String(n), label: String(n) }))]}
                />
              )}
              {assignsAccounts && pool.length > 0 && (
                <button className="small-btn" onClick={() => open("account_coordinator", { id: "", account_ids: pool.map((a) => a.id), coordinator_id: "" })}>
                  {t("Assign the {v0} shown", { v0: pool.length })}
                </button>
              )}
            </div>
            {panel(
              t("Controlled client accounts"),
              pool.length ? (
                generic(
                  pool,
                  [
                    {
                      key: "label",
                      label: t("Account"),
                      render: (r) => (
                        <span><strong>{r.label}</strong><small className="table-subline">{r.comments || r.id}</small></span>
                      ),
                    },
                    { key: "platform", label: t("Marketplace") },
                    {
                      key: "coordinator_id",
                      label: t("Coordinator"),
                      render: (r) =>
                        r.coordinator_id ? (
                          <span>{owner(r.coordinator_id)}{r.coordinator_2_id && <small className="table-subline">{t("with {v0}", { v0: owner(r.coordinator_2_id) })}</small>}</span>
                        ) : (
                          <Cue tone="info">{t("Not assigned yet")}</Cue>
                        ),
                    },
                    ...(seesOwner ? [{ key: "owner_name", label: t("Owner"), render: (r: Row) => r.owner_name || "—" }] : []),
                    { key: "status", label: t("State"), render: (r) => <Badge value={r.status} /> },
                    {
                      key: "credits",
                      label: t("Available credit"),
                      render: (r) => (
                        <span>
                          <strong className={Number(r.credits) <= 0 ? "credit-empty" : ""}>{money(r.credits)}</strong>
                          {Number(r.pending_credits) > 0 && <small className="table-subline">{t("{v0} pending", { v0: money(r.pending_credits) })}</small>}
                        </span>
                      ),
                    },
                    {
                      key: "active_assignment",
                      label: t("With"),
                      render: (r) => {
                        const request = r.active_assignment ? requests.find((q) => q.status === "Assigned" && (d.reservations || []).some((z: Row) => z.account_id === r.id && z.request_id === q.id)) : null;
                        return request ? <span>{name(request.student_id)}<small className="table-subline">{request.task}</small></span> : "—";
                      },
                    },
                  ],
                  (r) =>
                    r.status === "Retired" ? null : (
                      <div className="detail-actions">
                        {keepsAccounts && (
                          <button className="small-btn" onClick={() => open("account_topup", { id: r.id })}>{t("Top up")}</button>
                        )}
                        {!demoAccount && (
                          <button className="small-btn" onClick={() => setSigninFor(r)} title={t("Show the account's email and password")}>
                            <LockKeyhole size={14} /> {t("Sign-in")}
                          </button>
                        )}
                        {assignsAccounts && (
                          <button className="small-btn" onClick={() => open("account_coordinator", { id: r.id, account_ids: [r.id], coordinator_id: r.coordinator_id || "", slot: "first" })}>
                            {r.coordinator_id ? t("Reassign") : t("Assign")}
                          </button>
                        )}
                        {assignsAccounts && r.coordinator_id && (
                          <button className="small-btn" onClick={() => open("account_coordinator", { id: r.id, account_ids: [r.id], coordinator_id: r.coordinator_2_id || "", slot: "second" })}>
                            {r.coordinator_2_id ? t("Change second coordinator") : t("Add a second coordinator")}
                          </button>
                        )}
                        {managesAccounts && (
                          <button className="small-btn" onClick={() => open("account_status", r)}>{t("Manage")}</button>
                        )}
                      </div>
                    ),
                )
              ) : (
                <Empty title={accounts.length ? t("No account matches these filters") : t("No client accounts yet. Higher Board adds each account with its opening credit; top-ups are then recorded on the Credit tracker.")} />
              ),
              <div className="detail-actions">
                {keepsAccounts && (
                  <button className="primary small" onClick={() => open("account")}>
                    <Plus size={15} /> {t("Add account")}
                  </button>
                )}
                {keepsAccounts && canTransfer && (
                  <>
                    <button
                      className="small-btn"
                      onClick={() =>
                        saveBlob(
                          toXLSX([
                            { id: "ACC-0001", label: "client.account@example.com", platform: "Khamsat", credits: 50 },
                            { id: "ACC-0002", label: "second.account@example.com", platform: "Kafeel", credits: 0 },
                          ]),
                          "depi-accounts-template.xlsx",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        )
                      }
                      title={t("One row per account: id, label (the account's email), platform and opening credit in USD. Passwords are saved per account from Sign-in, never in a sheet.")}
                    >
                      <Download size={15} /> {t("Download import template")}
                    </button>
                    <button
                      className="small-btn"
                      onClick={() => {
                        setImportMode("create");
                        setImportModule("accounts");
                        setImportOpen(true);
                      }}
                    >
                      <Upload size={15} /> {t("Import accounts")}
                    </button>
                  </>
                )}
                {can(user.roles, ["Project Operations", "Operations Systems / Admin"]) && (
                  <button className="small-btn" onClick={() => open("task_bank")} title={t("A ready-made service order coordinators pick when they request a client account")}>{t("Add approved task")}</button>
                )}
              </div>,
            )}
          </TabsContent>
          <TabsContent value="requests">
            <div className="filter-row">
              <Pick label={t("Marketplace")} value={accountFilters.platform} onChange={(platform) => setAccountFilters({ ...accountFilters, platform })} options={["All", ...controlledPlatforms]} />
              <Pick
                label={t("Showing")}
                value={accountFilters.request}
                onChange={(request) => setAccountFilters({ ...accountFilters, request })}
                options={[
                  { value: "Open", label: t("Waiting for an account") },
                  { value: "Reserved", label: t("Reserved") },
                  { value: "Assigned", label: t("Assigned") },
                  { value: "All", label: t("Every request") },
                ]}
              />
            </div>
            {panel(
              t("Account requests"),
              requestRows.length ? (
                generic(
                  requestRows,
                  [
                    studentCol,
                    {
                      key: "task",
                      label: t("Service"),
                      render: (r) => <span><strong>{r.task}</strong><small className="table-subline">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}</small></span>,
                    },
                    { key: "platform", label: t("Marketplace") },
                    { key: "value", label: t("Credit needed"), render: (r) => money(r.value) },
                    {
                      key: "status",
                      label: t("Progress"),
                      render: (r) => {
                        const stage = requestStage(r);
                        const steps = ["Submitted", "Reserved", "Assigned"];
                        const at = steps.indexOf(stage);
                        const hold = activeReservation(r.id);
                        return (
                          <span className="request-flow">
                            {at < 0 ? (
                              <Badge value={stage} />
                            ) : (
                              steps.map((step, i) => (
                                <i key={step} className={i < at ? "is-past" : i === at ? "is-now" : ""}>{t(step)}</i>
                              ))
                            )}
                            {hold && stage === "Reserved" && (
                              <small className="table-subline">
                                {t("Held until {v0}", { v0: new Date(hold.expires_at).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }) })}
                              </small>
                            )}
                          </span>
                        );
                      },
                    },
                  ],
                  (r) => {
                    if (r.status !== "Submitted" || !can(user.roles, ["Higher Board"])) return null;
                    const reservation = activeReservation(r.id);
                    return reservation ? (
                      <button
                        className="primary small"
                        onClick={() => open("allocate", { request: r.id, student_id: r.student_id, reservation_id: reservation.id, account: reservation.account_id })}
                      >
                        {t("Approve allocation")}
                      </button>
                    ) : (
                      <button className="small-btn" onClick={() => open("reserve_account", { request: r.id, student_id: r.student_id })}>
                        {t("Reserve account")}
                      </button>
                    );
                  },
                )
              ) : (
                <Empty title={requests.length ? t("No request matches these filters") : t("No account requests yet")} />
              ),
            )}
          </TabsContent>
        </Tabs>
      </>
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
      t("Services and their review"),
      generic(
        rows,
        [
          studentCol,
          { key: "title", label: t("Service") },
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
            {r.evidence && mayReviewEvidence(r.evidence) && (
              <button className="small-btn" onClick={() => open("review", r.evidence)}>
                {t("Open review")}
              </button>
            )}
            {/* A controlled-account gig still moves step by step until it is paid. */}
            {!r.evidence && !["Paid", "Cancelled", "Failed"].includes(r.status) && may("gig_transition") && (
              <button
                className="small-btn"
                onClick={() =>
                  open("gig_transition", { ...r, student_id: r.student_id })
                }
              >
                {t("Record activity")}
              </button>
            )}
            {!r.evidence && r.status === "Paid" && may("evidence") && (
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
    // "All" is everything still open; "Every" adds the approved links, so the
    // people following a group can also see what has already passed.
    const serviceQueue = serviceLinks
      .filter((r) =>
        serviceFilters.state === "Every"
          ? true
          : serviceFilters.state === "All"
            ? r.qc_status !== "Locked"
            : r.qc_status === serviceFilters.state,
      )
      .filter(qMatch)
      .filter((r) => serviceFilters.platform === "All" || r.platform === serviceFilters.platform)
      .filter((r) => serviceFilters.track === "All" || r.track === serviceFilters.track)
      .filter((r) => serviceFilters.group === "All" || r.group_id === serviceFilters.group)
      .filter((r) => serviceFilters.coordinator === "All" || r.coordinator === serviceFilters.coordinator)
      .filter((r) => serviceFilters.supervisor === "All" || r.supervisor === serviceFilters.supervisor)
      .filter((r) => uploadedIn(r.submitted_at, serviceFilters))
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
    // A link the student corrected is new work for its reviewer, so it comes first.
    const resubmitted = (r: Row) => r.qc_status === "Pending" && Number(r.revision) > 1;
    const studentResubmitted = new Set(serviceQueue.filter(resubmitted).map((r) => r.student_id));
    // Other orders keep a student's links together too.
    const bySlot = (a: Row, b: Row) => String(a.student_id).localeCompare(String(b.student_id)) || Number(a.slot) - Number(b.slot);
    const latestUpload = serviceQueue.reduce((out: Row, r: Row) => {
      out[r.student_id] = String(r.submitted_at) > String(out[r.student_id] || "") ? r.submitted_at : out[r.student_id];
      return out;
    }, {} as Row);
    if (serviceFilters.sort === "newest" || serviceFilters.sort === "oldest")
      serviceQueue.sort((a, b) => (serviceFilters.sort === "newest" ? -1 : 1) * String(latestUpload[a.student_id]).localeCompare(String(latestUpload[b.student_id])) || bySlot(a, b));
    else if (serviceFilters.sort === "name")
      serviceQueue.sort((a, b) => String(a.student_name).localeCompare(String(b.student_name)) || bySlot(a, b));
    else if (serviceFilters.sort === "group")
      serviceQueue.sort((a, b) => String(a.group_id).localeCompare(String(b.group_id)) || String(a.student_name).localeCompare(String(b.student_name)) || bySlot(a, b));
    else serviceQueue.sort(
      (a, b) =>
        Number(studentResubmitted.has(b.student_id)) - Number(studentResubmitted.has(a.student_id)) ||
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
          ? "Rejected, waiting on the student"
          : Number(r.links_pending) > 0
            ? "Awaiting QC"
            : Number(r.links_kafiil) + Number(r.links_nafezly) >= 3
              ? "Complete"
              : "Incomplete";
    const submissionRows = serviceSubmissionStatus
      .map((r): Row => ({ ...r, follow_up: submissionState(r) }))
      .filter(qMatch)
      .filter((r) => submissionFilters.state === "All" || r.follow_up === submissionFilters.state)
      .filter((r) => submissionFilters.track === "All" || r.track === submissionFilters.track)
      .filter((r) => submissionFilters.group === "All" || r.group_id === submissionFilters.group)
      .filter((r) => submissionFilters.coordinator === "All" || r.coordinator === submissionFilters.coordinator)
      .filter((r) => submissionFilters.supervisor === "All" || r.supervisor === submissionFilters.supervisor)
      .filter((r) => submissionFilters.lifecycle === "All" || r.lifecycle === submissionFilters.lifecycle)
      .filter((r) => submissionFilters.approved === "All" || Math.min(3, Number(r.links_locked)) === Number(submissionFilters.approved))
      .filter((r) => submissionFilters.platform === "All" || Number(r["links_" + submissionFilters.platform.toLowerCase()]) > 0)
      .filter((r) => uploadedIn(r.submitted_at, submissionFilters))
      .sort((a, b) => {
        const byName = String(a.student_name).localeCompare(String(b.student_name));
        const order = ["Not submitted", "Incomplete", "Rejected, waiting on the student", "Awaiting QC", "Complete"];
        // Students who never uploaded have no date and go last in a date order.
        const when = (r: Row) => String(r.submitted_at || "");
        switch (submissionFilters.sort) {
          case "newest": return (when(a) ? 0 : 1) - (when(b) ? 0 : 1) || when(b).localeCompare(when(a)) || byName;
          case "oldest": return (when(a) ? 0 : 1) - (when(b) ? 0 : 1) || when(a).localeCompare(when(b)) || byName;
          case "name": return byName;
          case "group": return String(a.group_id).localeCompare(String(b.group_id)) || byName;
          default: return order.indexOf(a.follow_up) - order.indexOf(b.follow_up) || byName;
        }
      });
    const exportRows = (rows: Row[], file: string, shape: (r: Row) => Row) => {
      const data = toWorkbook([{ name: "Services", rows: rows.length ? rows.map(shape) : [{ Note: "Nothing matches these filters" }] }]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      a.download = `${file}-${today()}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    // The period filter offers two dates when "Choose dates" is picked.
    const periodFields = (f: Row, set: (f: Row) => void) =>
      f.uploaded === "custom" && (
        <>
          <label className="pick-field">
            <span className="pick-label">{t("From")}</span>
            <input type="date" className="filter-date" value={f.from} max={f.to || undefined} onChange={(e) => set({ ...f, from: e.target.value })} />
          </label>
          <label className="pick-field">
            <span className="pick-label">{t("To")}</span>
            <input type="date" className="filter-date" value={f.to} min={f.from || undefined} onChange={(e) => set({ ...f, to: e.target.value })} />
          </label>
        </>
      );
    // A filter that is set always stays visible, even with the extra filters folded away.
    const filterTools = (key: string, f: Row, defaults: Row, set: (f: Row) => void, download?: () => void) => {
      const count = narrowing(f, defaults);
      return (
        <div className="filter-tools">
          <button type="button" className="small-btn" aria-expanded={!!moreFilters[key]} onClick={() => setMoreFilters((m) => ({ ...m, [key]: !m[key] }))}>
            <Filter size={14} /> {moreFilters[key] ? t("Fewer filters") : t("More filters")}
          </button>
          {count > 0 && (
            <button type="button" className="small-btn" onClick={() => { set({ ...defaults }); setPage(1); }}>
              <X size={14} /> {t("Clear filters ({v0})", { v0: count })}
            </button>
          )}
          {download && canTransfer && (
            <button type="button" className="small-btn" onClick={download}>
              <Download size={14} /> {t("Download this list (Excel)")}
            </button>
          )}
        </div>
      );
    };
    const setService = (f: Row) => { setServiceFilters(f); setPage(1); };
    const setSubmission = (f: Row) => { setSubmissionFilters(f); setPage(1); };
    const supervisorOptions = (rows: Row[]) => [{ value: "All", label: t("All supervisors") }, ...Array.from(new Set(rows.map((r) => r.supervisor).filter(Boolean))).map((id) => ({ value: id, label: owner(id) })).sort((a, b) => a.label.localeCompare(b.label))];
    const submissionCount = (state: string) =>
      serviceSubmissionStatus.filter((r) => submissionState(r) === state).length;
    const submissionPanel = serviceSubmissionStatus.length > 0 && (
      <>
        <div className="mini-stats service-qc-stats">
          {["Not submitted", "Awaiting QC", "Rejected, waiting on the student", "Incomplete", "Complete"].map((state) => (
            <button
              key={state}
              type="button"
              className="mini-stat-btn"
              aria-pressed={submissionFilters.state === state}
              title={t("Show only these students")}
              onClick={() => setSubmission({ ...submissionFilters, state: submissionFilters.state === state ? "All" : state })}
            >
              <strong>{submissionCount(state)}</strong>{t(state)}
            </button>
          ))}
        </div>
        <div className="filter-row service-qc-filters">
          <Pick label={t("Follow-up")} value={submissionFilters.state} onChange={(state) => setSubmission({ ...submissionFilters, state })} options={["All", "Not submitted", "Incomplete", "Rejected, waiting on the student", "Awaiting QC", "Complete"]} />
          <Pick label={t("Track")} value={submissionFilters.track} onChange={(track) => setSubmission({ ...submissionFilters, track })} options={["All", ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.track).filter(Boolean)))]} />
          <Pick label={t("Group")} value={submissionFilters.group} onChange={(group) => setSubmission({ ...submissionFilters, group })} options={["All", ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.group_id).filter(Boolean))).sort()]} />
          <Pick label={t("Coordinator")} value={submissionFilters.coordinator} onChange={(coordinator) => setSubmission({ ...submissionFilters, coordinator })} options={[{ value: "All", label: t("All coordinators") }, ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.coordinator).filter(Boolean))).map((id) => ({ value: id, label: owner(id) }))]} />
          <Pick label={t("Uploaded")} value={submissionFilters.uploaded} onChange={(uploaded) => setSubmission({ ...submissionFilters, uploaded })} options={uploadedOptions} />
          {periodFields(submissionFilters, setSubmission)}
          <Pick label={t("Sort by")} value={submissionFilters.sort} onChange={(sort) => setSubmission({ ...submissionFilters, sort })} options={[{ value: "follow-up", label: "Who needs follow-up first" }, { value: "newest", label: "Latest upload first" }, { value: "oldest", label: "Earliest upload first" }, { value: "name", label: "Student name" }, { value: "group", label: "Group" }]} />
          {(moreFilters.submission || submissionFilters.supervisor !== "All") && <Pick label={t("Supervisor")} value={submissionFilters.supervisor} onChange={(supervisor) => setSubmission({ ...submissionFilters, supervisor })} options={supervisorOptions(serviceSubmissionStatus)} />}
          {(moreFilters.submission || submissionFilters.approved !== "All") && <Pick label={t("Approved links")} value={submissionFilters.approved} onChange={(approved) => setSubmission({ ...submissionFilters, approved })} options={[{ value: "All", label: "Any number" }, { value: "0", label: "None approved" }, { value: "1", label: "1 of 3" }, { value: "2", label: "2 of 3" }, { value: "3", label: "All 3" }]} />}
          {(moreFilters.submission || submissionFilters.platform !== "All") && <Pick label={t("Has a link on")} value={submissionFilters.platform} onChange={(platform) => setSubmission({ ...submissionFilters, platform })} options={[{ value: "All", label: "Any platform" }, ...acceptedServicePlatforms.map((p) => ({ value: p, label: p }))]} />}
          {(moreFilters.submission || submissionFilters.lifecycle !== "All") && <Pick label={t("Student status")} value={submissionFilters.lifecycle} onChange={(lifecycle) => setSubmission({ ...submissionFilters, lifecycle })} options={["All", ...Array.from(new Set(serviceSubmissionStatus.map((r) => r.lifecycle).filter(Boolean))).sort()]} />}
          {filterTools("submission", submissionFilters, submissionFilterDefaults, setSubmission, () =>
            exportRows(submissionRows, "service-uploads-by-student", (r) => ({
              Student: r.student_name,
              "Student ID": r.student_id,
              Group: r.group_id,
              Track: r.track,
              Coordinator: owner(r.coordinator),
              Supervisor: r.supervisor ? owner(r.supervisor) : "",
              "Student status": r.lifecycle,
              "Follow-up": r.follow_up,
              "Links uploaded": Number(r.links_submitted),
              Approved: Number(r.links_locked),
              "Awaiting QC": Number(r.links_pending),
              Rejected: Number(r.links_need_correction),
              Khamsat: Number(r.links_khamsat),
              Kafiil: Number(r.links_kafiil),
              Nafezly: Number(r.links_nafezly),
              "Last upload": r.submitted_at || "",
            })),
          )}
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
              { key: "links_submitted", label: t("Approved"), render: (r) => <span>{r.links_locked}/3<small className="table-subline">{r.submitted_at ? t("{v0} submitted {v1}", { v0: r.links_submitted, v1: new Date(r.submitted_at).toLocaleDateString() }) : t("never submitted")}</small></span> },
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
              <button type="button" className="mini-stat-btn" aria-pressed={serviceFilters.state === "Pending"} title={t("Show only these links")} onClick={() => setService({ ...serviceFilters, state: "Pending" })}><strong>{serviceLinks.filter((r) => r.qc_status === "Pending").length}</strong>{t("Awaiting review")}</button>
              <button type="button" className="mini-stat-btn" aria-pressed={serviceFilters.state === "Needs Correction"} title={t("Show only these links")} onClick={() => setService({ ...serviceFilters, state: "Needs Correction" })}><strong>{serviceLinks.filter((r) => r.qc_status === "Needs Correction").length}</strong>{t("Rejected, waiting on the student")}</button>
              <button type="button" className="mini-stat-btn" aria-pressed={serviceFilters.state === "Locked"} title={t("Show only these links")} onClick={() => setService({ ...serviceFilters, state: "Locked" })}><strong>{serviceLinks.filter((r) => r.qc_status === "Locked").length}</strong>{t("Approved")}</button>
              <span><strong>{serviceLinks.filter((r) => r.auto_status === "Failed").length}</strong>{t("Automatic check failed")}</span>
              <span><strong>{serviceLinks.filter((r) => r.qc_status === "Pending" && Date.now() - Date.parse(r.updated_at) > 48 * 3600000).length}</strong>{t("Past 48-hour SLA")}</span>
            </div>
            <div className="filter-row service-qc-filters">
              <Pick
                label={t("Showing")}
                value={serviceFilters.state}
                onChange={(state) => setService({ ...serviceFilters, state })}
                options={[
                  { value: "Pending", label: t("Waiting for review") },
                  { value: "Needs Correction", label: t("Rejected, waiting on the student") },
                  { value: "All", label: t("Both") },
                  { value: "Locked", label: t("Approved") },
                  { value: "Every", label: t("Every upload") },
                ]}
              />
              <Pick label={t("Track")} value={serviceFilters.track} onChange={(track) => setService({ ...serviceFilters, track })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.track).filter(Boolean)))]} />
              <Pick label={t("Group")} value={serviceFilters.group} onChange={(group) => setService({ ...serviceFilters, group })} options={["All", ...Array.from(new Set(serviceLinks.map((r) => r.group_id).filter(Boolean))).sort()]} />
              <Pick label={t("Coordinator")} value={serviceFilters.coordinator} onChange={(coordinator) => setService({ ...serviceFilters, coordinator })} options={[{ value: "All", label: t("All coordinators") }, ...Array.from(new Set(serviceLinks.map((r) => r.coordinator).filter(Boolean))).map((id) => ({ value: id, label: owner(id) }))]} />
              {canDecideServiceLinks && (
                <Pick
                  label={t("Assigned to")}
                  value={serviceFilters.reviewer}
                  onChange={(reviewer) => setService({ ...serviceFilters, reviewer })}
                  options={[
                    { value: "All", label: t("Anyone") },
                    { value: user.id, label: t("Me") },
                    { value: "None", label: t("Waiting for a reviewer") },
                    ...qualityReviewers.filter((q) => q.id !== user.id).map((q) => ({ value: q.id, label: q.name })),
                  ]}
                />
              )}
              <Pick label={t("Uploaded")} value={serviceFilters.uploaded} onChange={(uploaded) => setService({ ...serviceFilters, uploaded })} options={uploadedOptions} />
              {periodFields(serviceFilters, setService)}
              <Pick label={t("Sort by")} value={serviceFilters.sort} onChange={(sort) => setService({ ...serviceFilters, sort })} options={[{ value: "waiting", label: "Waiting longest first" }, { value: "newest", label: "Latest upload first" }, { value: "oldest", label: "Earliest upload first" }, { value: "name", label: "Student name" }, { value: "group", label: "Group" }]} />
              {(moreFilters.service || serviceFilters.platform !== "All") && <Pick label={t("Platform")} value={serviceFilters.platform} onChange={(platform) => setService({ ...serviceFilters, platform })} options={["All", ...acceptedServicePlatforms, "External service"]} />}
              {(moreFilters.service || serviceFilters.supervisor !== "All") && <Pick label={t("Supervisor")} value={serviceFilters.supervisor} onChange={(supervisor) => setService({ ...serviceFilters, supervisor })} options={supervisorOptions(serviceLinks)} />}
              {(moreFilters.service || serviceFilters.age !== "All") && <Pick label={t("Submission age")} value={serviceFilters.age} onChange={(age) => setService({ ...serviceFilters, age })} options={[{ value: "All", label: t("Any age") }, { value: "24", label: t("24+ hours") }, { value: "48", label: t("48+ hours") }, { value: "168", label: t("7+ days") }]} />}
              {(moreFilters.service || serviceFilters.automatic !== "All") && <Pick label={t("Automatic check")} value={serviceFilters.automatic} onChange={(automatic) => setService({ ...serviceFilters, automatic })} options={["All", "Needs Review", "Failed"]} />}
              {(moreFilters.service || serviceFilters.corrections !== "All") && <Pick label={t("Corrections")} value={serviceFilters.corrections} onChange={(corrections) => setService({ ...serviceFilters, corrections })} options={[{ value: "All", label: t("Any revision") }, { value: "0", label: t("No prior review") }, { value: "1", label: t("One review") }, { value: "Repeated", label: t("Repeated corrections") }]} />}
              {filterTools("service", serviceFilters, serviceFilterDefaults, setService, () =>
                exportRows(serviceQueue, "service-uploads", (r) => ({
                  Student: r.student_name,
                  "Student ID": r.student_id,
                  Group: r.group_id,
                  Track: r.track,
                  Coordinator: owner(r.coordinator),
                  Supervisor: r.supervisor ? owner(r.supervisor) : "",
                  Platform: r.platform,
                  Link: r.url,
                  "Uploaded at": r.submitted_at,
                  Revision: Number(r.revision),
                  "Review state": r.qc_status === "Locked" ? "Approved" : r.qc_status === "Needs Correction" ? "Rejected" : "Waiting for review",
                  Reviewer: r.qc_actor ? owner(r.qc_actor) : "",
                  "Automatic check": r.auto_status,
                })),
              )}
            </div>
            {isQualityLead && (
              <div className="detail-actions qc-lead-actions">
                <button className="small-btn" disabled={busy} onClick={() => quick("service_qc_assign", {})}>
                  <Users size={15} /> {t("Distribute waiting students evenly")}
                </button>
                <button
                  className="small-btn"
                  onClick={() => {
                    const linkOf = (id: string) => serviceLinks.find((l) => l.id === id) || {};
                    const serviceRows = serviceLinkReviews.map((r: Row) => {
                      const l: Row = linkOf(r.service_link_id);
                      return {
                        "Reviewed at": r.reviewed_at,
                        Reviewer: r.reviewer_name || owner(r.reviewed_by),
                        Student: l.student_name || name(l.student_id),
                        "Student ID": l.student_id,
                        Group: l.group_id,
                        Platform: l.platform,
                        Link: l.url,
                        Revision: r.revision,
                        Decision: r.decision === "Lock" || r.decision === "Locked" ? "Approved" : r.decision === "Needs Correction" ? "Rejected" : r.decision,
                        Comment: r.comment,
                      };
                    });
                    const evidenceRows = (d.reviews || []).map((r: Row) => {
                      const e: Row = evidence.find((x) => x.id === r.evidence_id) || {};
                      return {
                        "Reviewed at": r.created_at,
                        Reviewer: owner(r.actor),
                        Student: name(e.student_id),
                        "Student ID": e.student_id,
                        Service: e.gig_id,
                        Decision: r.decision,
                        Code: r.code,
                        Notes: r.notes,
                      };
                    });
                    const file = toWorkbook([
                      { name: "Service link decisions", rows: serviceRows.length ? serviceRows : [{ Note: "No decisions yet" }] },
                      { name: "Service review decisions", rows: evidenceRows.length ? evidenceRows : [{ Note: "No decisions yet" }] },
                    ]);
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([file as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
                    a.download = `review-decisions-${new Date().toISOString().slice(0, 10)}.xlsx`;
                    a.click();
                  }}
                >
                  <Download size={15} /> {t("Export review decisions (Excel)")}
                </button>
                <button className="small-btn" disabled={busy} onClick={() => quick("evidence_qc_assign", {})}>
                  <Files size={15} /> {t("Distribute service evidence evenly")}
                </button>
                <small className="qc-lead-note">
                  {t("A student’s services stay together with one reviewer, and a student waiting for review goes to whoever currently holds the fewest. Reviewers:")}{" "}{qualityReviewers.map((r) => `${r.name} (${reviewerStudents.get(r.id) || 0})`).join(", ") || t("none active")}.
                </small>
              </div>
            )}
            {panel(
              t("Student service-link verification · {v0} matching", { v0: serviceQueue.length }),
              paginate(serviceQueue, (pageRows) => generic(
                pageRows,
                [
                  { key: "student_name", label: t("Student"), render: (r) => { const own = serviceLinks.filter((l) => l.student_id === r.student_id); const decided = own.filter((l) => l.qc_status !== "Pending").length; return <span><strong>{r.student_name}</strong><small className="table-subline">{r.student_id} · <bdi>{r.group_id}</bdi> · {decided}/{own.length} {t("reviewed")}</small></span>; } },
                  { key: "slot", label: t("Service"), render: (r) => (
                      <a className="text-link service-open" href={r.url} target="_blank" rel="noreferrer" title={t("Open the student's service")}>
                        <strong>{serviceLabel(r.platform)}</strong> <ExternalLink size={14} />
                        <small className="table-subline service-url">{r.url}</small>
                        {r.submitted_at && <small className="table-subline">{t("Uploaded {v0}", { v0: new Date(r.submitted_at).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</small>}
                      </a>
                    ) },
                  { key: "auto_status", label: t("Automatic check"), render: (r) => <Badge value={r.auto_status} /> },
                  { key: "reviewer_name", label: t("Reviewer"), render: (r) => isQualityLead && r.qc_status !== "Locked"
                      ? <SearchableSelect className="pick-inline" label={t("Assign this student to a reviewer")} placeholder={t("Waiting for a reviewer")} value={r.qc_actor || ""} onChange={(v) => !busy && v && quick("service_qc_assign", { student_id: r.student_id, reviewer_id: v })} options={qualityReviewers.map((q) => ({ value: q.id, label: `${q.name} (${reviewerStudents.get(q.id) || 0})` }))} />
                      : <span>{!r.qc_actor || !staff.some((s: Row) => s.id === r.qc_actor) ? t("Waiting for a reviewer") : owner(r.qc_actor)}<small className="table-subline">{owner(r.coordinator)}</small></span> },
                  { key: "qc_status", label: t("Review state"), render: (r) => <span><Badge value={qcState(r.qc_status)} />{resubmitted(r) && <Badge value={t("Resubmitted")} />}<small className="table-subline">{Math.round((Date.now() - Date.parse(r.updated_at)) / 3600000)}{t("h · revision")}{" "}{r.revision}</small></span> },
                ],
                (r) => <div className="detail-actions">{canDecideServiceLinks && r.qc_status !== "Locked" && (r.qc_actor === user.id || isQualityLead) && <button className="small-btn" onClick={() => open("service_qc_review", { ...r, service_id: r.id, student_id: r.student_id, decision: r.qc_status === "Needs Correction" ? "Lock" : "" })}>{t("Review")}</button>}</div>,
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
            <strong>{rejected.length}</strong> {t("Rejected")}
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
              { key: "gig_id", label: t("Service") },
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
              (!assignedOnly || r.qc_actor === user.id) && mayReviewEvidence(r) && (
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
        (r) =>
          // The server lets the owner or a leader move a case; a quality case only the Quality Lead.
          (r.type === "Quality"
            ? can(user.roles, ["Quality Lead", "Operations Systems / Admin"])
            : r.owner === user.id || can(user.roles, ["Project Operations", "Team Supervisor", "Quality Lead", "Operations Systems / Admin"])) && (
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
        <ReportsPanel canExport={canTransfer} showStaff={!coachesOnly} />
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
        {!coachesOnly && panel(
          t("Coordinator performance"),
          generic(
            staff
              .filter((u: Row) => u.roles.includes("Operations Coordinator"))
              // A supervisor's report covers their own groups, so only the
              // coordinators of those groups; the programme-wide roles see all.
              .filter(
                (u: Row) =>
                  can(user.roles, ["Project Operations", "Operations Systems / Admin", "Higher Board"]) ||
                  groups.some((g) => g.coordinator === u.id),
              )
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
              <div className="rule-number">{t("3 services × $5 minimum")}</div>
              <p>
                {t("Total qualifying value of at least $15, or one qualifying service of $300 or more.")}
              </p>
              <p>
                {t("Evidence must be Quality Accepted, and the service must be paid. Non-USD services count only after a separately approved rate is applied and stored with the service.")}
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
          <TabsTrigger value="logins">{t("Session logins")}</TabsTrigger>
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
                  {t(policyLabels[k] || k)}
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
                render: (r) => new Date(r.created_at).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB"),
              },
              { key: "actor", label: t("Actor"), render: (r) => owner(r.actor) },
              { key: "action", label: t("Action"), render: (r) => t(r.action) },
              { key: "entity_id", label: t("Record") },
              { key: "reason", label: t("Reason") },
            ]),
          )}
        </TabsContent>
        <TabsContent value="connections">
          <ControlCenter />
        </TabsContent>
        <TabsContent value="logins">
          {(() => {
            const stored = new Map((d.joinLogins || []).map((x: Row) => [x.id, x]));
            const active = groups.filter((g) => g.status !== "Archived" && g.status !== "Closed");
            const providers = [...new Set(active.map((g) => g.provider).filter(Boolean))].sort();
            const yat = active.filter((g) => g.provider === "YAT").sort((a, b) => a.id.localeCompare(b.id));
            const missingCoach = yat.filter((g) => !stored.has(`coach:${g.id}`)).length;
            const state = (id: string) => {
              const x: Row | undefined = stored.get(id) as Row | undefined;
              return x ? (
                <span><Cue tone="ok">{t("Stored")}</Cue><small className="table-subline">{fmt(x.updated_at)} · {owner(x.updated_by)}</small></span>
              ) : (
                <Cue tone="warn">{t("Missing")}</Cue>
              );
            };
            return (
              <>
                <p className="footnote">{t("Coordinators share one login per training provider. On YAT each group also has its own coach login; on other providers coaches join with their own email. Logins are stored encrypted and shown for one minute to the people of that group.")}</p>
                {panel(
                  t("Coordinator logins (one per provider)"),
                  generic(
                    providers.map((provider) => ({ id: `coordinator:${provider}`, provider })),
                    [
                      { key: "provider", label: t("Provider") },
                      { key: "state", label: t("Login"), render: (r) => state(r.id) },
                    ],
                    (r) => (
                      <button className="small-btn" onClick={() => setJoinEdit({ kind: "coordinator", provider: r.provider, username: "", password: "" })}>
                        {stored.has(r.id) ? t("Replace") : t("Add login")}
                      </button>
                    ),
                  ),
                )}
                {panel(
                  t("Coach logins on YAT ({v0} missing)", { v0: missingCoach }),
                  generic(
                    [...yat.filter((g) => !stored.has(`coach:${g.id}`)), ...yat.filter((g) => stored.has(`coach:${g.id}`))].map((g) => ({ id: `coach:${g.id}`, group_id: g.id, coach: g.coach })),
                    [
                      { key: "group_id", label: t("Group") },
                      { key: "coach", label: t("Coach"), render: (r) => owner(r.coach) },
                      { key: "state", label: t("Login"), render: (r) => state(r.id) },
                    ],
                    (r) => (
                      <button className="small-btn" onClick={() => setJoinEdit({ kind: "coach", provider: "YAT", group_id: r.group_id, username: "", password: "" })}>
                        {stored.has(r.id) ? t("Replace") : t("Add login")}
                      </button>
                    ),
                  ),
                )}
              </>
            );
          })()}
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
                      <span>{t(id === "quality" ? pageName(id) : label)}</span>
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
          {/* Bugs, access problems and error messages; how-to questions go to the team leader. */}
          <a className="report-problem" href={"/support?from=" + encodeURIComponent(module)}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{t("Report a technical problem")}</span>
          </a>
          <div className="staff-only">
            <ShieldCheck size={17} />
            <span>{t("Staff-only workspace")}</span>
          </div>
          <div className="profile">
            <span className="avatar navy">{user.name?.slice(0, 1) || "A"}</span>
            <div>
              <strong>{user.name}</strong>
              <small>{user.title ? String(user.title).split(" · ").map((part: string) => t(part)).join(" · ") : user.roles?.[0] ? t(user.roles[0]) : t("Workspace setup")}</small>
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
              {t(pageName(module) || "Overview")}
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
                {demoAccount
                  ? t("DEMO ACCOUNT")
                  : d.workspaceMode === "demo"
                    ? t("PILOT WORKSPACE")
                    : t("PRODUCTION WORKSPACE")}
              </span>
              <span>
                {demoAccount
                  ? t("Made-up groups and students for trying things out. Nothing here touches real records.")
                  : d.workspaceMode === "demo"
                    ? t("Synthetic roster · No real student or client data")
                    : t("Live operational records · Staff access only")}
              </span>
              {demoAccount && (
                <button className="small-btn" disabled={busy} onClick={() => quick("demo_refresh", {})}>
                  <RefreshCw size={15} /> {t("Reset the demo")}
                </button>
              )}
              <span className="banner-date">
                {new Date().toLocaleDateString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", {
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
                      <h1>{t(pageName(module))}</h1>
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
                    {moduleAction[module] && canCreate(module) && (
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
                              gigs: "Record a paid service",
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
                            v0: t(module === "work" ? "actions" : pageName(module) || module),
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
      <Toaster richColors position="bottom-right" containerAriaLabel={t("Notifications")} />
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
                  <h2>{selectedStudent.name} <GraduationDots graduation={selectedStudent.graduation} /></h2>
                  <p>
                    {selectedStudent.id} · {selectedStudent.group_id} ·{" "}
                    {selectedStudent.track}
                  </p>
                  {/* How to reach the student directly: their phone (tap to call) and email. */}
                  {!onlyCoach && (selectedStudent.phone || selectedStudent.email) && (
                    <p className="contact-line">
                      {String(selectedStudent.phone || "")
                        .split("/")
                        .map((n: string) => n.trim())
                        .filter(Boolean)
                        .map((n: string) => (
                          <a key={n} className="text-link" href={`tel:${n.replace(/[^\d+]/g, "")}`} dir="ltr">
                            <Phone size={13} /> {n}
                          </a>
                        ))}
                      {selectedStudent.email && (
                        <a className="text-link" href={`mailto:${selectedStudent.email}`} dir="ltr">
                          <Mail size={13} /> {selectedStudent.email}
                        </a>
                      )}
                    </p>
                  )}
                  <p className="next-action-line">
                    <strong>{t("Next action")}:</strong>{" "}
                    {selectedStudent.next_task
                      ? `${selectedStudent.next_task.title} · ${fmt(selectedStudent.next_task.due)}`
                      : t("None yet")}
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
                {may("contact") && (
                  <button
                    className="primary"
                    title={t("Record a conversation that already happened, with proof")}
                    onClick={() =>
                      open("contact", { student_id: selectedStudent.id })
                    }
                  >
                    <MessageSquare size={16} /> {t("Log contact")}
                  </button>
                )}
                <button
                  className="small-btn"
                  title={t("Plan the follow-up step you commit to do")}
                  onClick={() =>
                    open("task", { student_id: selectedStudent.id })
                  }
                >
                  {t("Next action")}
                </button>
                {(() => {
                  const next = sessions
                    .filter((x) => x.group_id === selectedStudent.group_id && x.status !== "Cancelled" && Date.parse(x.starts_at) > Date.now())
                    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
                  const link = groups.find((g) => g.id === selectedStudent.group_id)?.session_link;
                  const options: [string, "reminder" | "absence" | "congratulations", Row][] = [
                    [t("Session reminder"), "reminder", { name: selectedStudent.name, title: next?.title || "", when: next ? fmt(next.starts_at) + " " + new Date(next.starts_at).toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }) : "", link: link || "" }],
                    [t("Absence follow-up"), "absence", { name: selectedStudent.name }],
                    [t("First-service congratulations"), "congratulations", { name: selectedStudent.name }],
                  ];
                  const any = whatsapp(selectedStudent.phone, "absence", {});
                  return any ? (
                    <details className="wa-menu">
                      <summary className="small-btn wa-btn">WhatsApp</summary>
                      <div>
                        {options.map(([label, template, values]) => (
                          <a key={template} href={whatsapp(selectedStudent.phone, template, values) || "#"} target="_blank" rel="noreferrer">{label}</a>
                        ))}
                      </div>
                    </details>
                  ) : null;
                })()}
                {!onlyCoach && groups.find((g) => g.id === selectedStudent.group_id)?.whatsapp_link && (
                  <a className="small-btn wa-btn" href={groups.find((g) => g.id === selectedStudent.group_id)!.whatsapp_link} target="_blank" rel="noreferrer">
                    <MessageCircle size={14} /> {t("WhatsApp group")}
                  </a>
                )}
                {may("engagement") && (
                  <button
                    className="small-btn"
                    onClick={() =>
                      open("engagement", { student_id: selectedStudent.id })
                    }
                  >
                    {t("Review risk")}
                  </button>
                )}
              </div>
              <p className="action-help">
                <strong>{t("Log contact")}</strong>: {t("a conversation that already happened, with a screenshot as proof.")}{" "}
                <strong>{t("Next action")}</strong>: {t("the follow-up step you commit to do next, with a due date.")}
              </p>
              <Tabs defaultValue="overview">
                <TabsList className="detail-tabs">
                  {[
                    "overview",
                    "contacts",
                    "tasks",
                    "sessions",
                    // Services are not a coach's to see.
                    ...(onlyCoach ? [] : ["gigs", "services"]),
                    ...(!onlyCoach && groups.find((g) => g.id === selectedStudent.group_id)?.supervisor_team === "Service Team" ? ["accounts"] : []),
                    "cases",
                    "timeline",
                    "audit",
                  ].map((tab) => (
                    <TabsTrigger key={tab} value={tab}>
                      {t(({ gigs: "Paid services", services: "Service links" } as Row)[tab] || tab[0].toUpperCase() + tab.slice(1))}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value="overview">
                  <div className="risk-box">
                    <AlertTriangle size={20} />
                    <div>
                      <strong>
                        {t("System recommendation:")}{" "}{t(selectedStudent.risk.status)}
                      </strong>
                      <p>
                        {selectedStudent.risk.reasons.map(riskReason).join(" · ") ||
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
                      ["Pathway", t(selectedStudent.pathway || "Not recorded")],
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
                          " · " +
                          t("Due {v0}", { v0: fmt(selectedStudent.next_task.due) })
                        : t("Create an action with an owner and due date.")}
                    </p>
                  </div>
                  <div className="detail-actions">
                    {may("milestone") && (
                      <button
                        className="small-btn"
                        onClick={() =>
                          open("milestone", { student_id: selectedStudent.id })
                        }
                      >
                        {t("Update milestone")}
                      </button>
                    )}
                    {may("lifecycle") && (
                      <button
                        className="small-btn"
                        onClick={() =>
                          open("lifecycle", { student_id: selectedStudent.id })
                        }
                      >
                        {t("Lifecycle")}
                      </button>
                    )}
                    {may("transfer") && (
                      <button
                        className="small-btn"
                        onClick={() =>
                          open("transfer", { student_id: selectedStudent.id })
                        }
                      >
                        {t("Transfer student")}
                      </button>
                    )}
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
                            <div className="detail-actions"><Badge value={serviceLabel(link.platform)} /><Badge value={qcState(link.qc_status)} /><Badge value={link.auto_status} /></div>
                            <h3><a className="text-link" href={link.url} target="_blank" rel="noreferrer">{link.platform} <ExternalLink size={14} /></a></h3>
                            <p>{(() => { try { return checkText(JSON.parse(link.auto_result || "{}").message); } catch { return t("Automatic details unavailable."); } })()}</p>
                            <small>{t("Revision")}{" "}{link.revision} {t("· submitted")}{" "}{new Date(link.submitted_at).toLocaleString()}{link.qc_at ? t(" · reviewed {v0} by {v1}", { v0: new Date(link.qc_at).toLocaleString(), v1: link.reviewer_name || owner(link.qc_actor) }) : ""}</small>
                            {serviceLinkReviews.filter((review) => review.service_link_id === link.id).map((review) => (
                              <div className="info-box" key={review.id}><Badge value={review.decision} /><span>{review.comment}</span><small>{new Date(review.reviewed_at).toLocaleString()} · {review.reviewer_name}</small></div>
                            ))}
                          </article>
                        ))}
                      </div>

                    ) : tab === "gigs" ? (
                      generic(
                        gigs
                          .filter((g) => g.student_id === selectedStudent.id)
                          .map((g): Row => {
                            const review = evidence
                              .filter((e) => e.gig_id === g.id)
                              .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
                            return { ...g, review, stage: review ? review.status : g.status };
                          }),
                        [
                          { key: "title", label: t("Service") },
                          { key: "value", label: t("Value"), render: (r) => r.currency + " " + r.value },
                          { key: "stage", label: t("Review stage"), render: (r) => <Badge value={r.stage} /> },
                        ],
                        (r) =>
                          r.review ? (
                            (!assignedOnly || r.review.qc_actor === user.id) && mayReviewEvidence(r.review) && (
                              <button className="small-btn" onClick={() => open("review", r.review)}>
                                {t("Review")}
                              </button>
                            )
                          ) : !["Paid", "Cancelled", "Failed"].includes(r.status) && may("gig_transition") ? (
                            <button className="small-btn" onClick={() => open("gig_transition", r)}>
                              {t("Activity")}
                            </button>
                          ) : null,
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
      <Dialog open={!!joinEdit} onOpenChange={(v) => !v && setJoinEdit(null)}>
        <DialogContent className="action-dialog sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{joinEdit?.kind === "coach" ? t("Coach login") : t("Coordinator login")}</DialogTitle>
            <DialogDescription>
              {joinEdit?.kind === "coach" ? joinEdit?.group_id : joinEdit?.provider} · {t("Stored encrypted. Replacing it takes effect at once.")}
            </DialogDescription>
          </DialogHeader>
          {joinEdit && (
            <form
              className="action-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const res = await fetch("/api/join-accounts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "set", kind: joinEdit.kind, provider: joinEdit.provider, group_id: joinEdit.group_id, username: joinEdit.username, password: joinEdit.password }),
                  });
                  const body = await res.json();
                  if (!res.ok) throw new Error(body.error || t("Request failed"));
                  toast.success(t("Login saved"));
                  setJoinEdit(null);
                  await refresh();
                } catch (error: any) {
                  toast.error(error.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                {t("Email or username")} *
                <input required autoComplete="off" value={joinEdit.username} onChange={(e) => setJoinEdit({ ...joinEdit, username: e.target.value })} />
              </label>
              <label className="field">
                {t("Password")} *
                <input required type="password" autoComplete="new-password" value={joinEdit.password} onChange={(e) => setJoinEdit({ ...joinEdit, password: e.target.value })} />
              </label>
              <div className="form-footer">
                <button type="submit" className="primary" disabled={busy}>{t("Save login")}</button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!joinLogin} onOpenChange={(v) => !v && setJoinLogin(null)}>
        <DialogContent className="action-dialog sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{joinLogin?.kind === "coach" ? t("Coach login") : t("Coordinator login")}</DialogTitle>
            <DialogDescription>
              {joinLogin?.group_id} · {t("Shown for one minute. Do not share it.")}
            </DialogDescription>
          </DialogHeader>
          {joinLogin && (
            <div className="join-login">
              <ol className="join-steps">
                <li>{t("Copy the email and the password below.")}</li>
                <li>{t("Open the session and sign in to {v0} with them.", { v0: joinLogin.provider || t("the platform") })}</li>
              </ol>
              <label>{t("Email or username")}</label>
              <div className="join-secret">
                <code>{joinLogin.username}</code>
                <button type="button" className="small-btn" onClick={() => { navigator.clipboard?.writeText(joinLogin.username); toast.success(t("Copied")); }}>
                  <Copy size={14} /> {t("Copy")}
                </button>
              </div>
              <label>{t("Password")}</label>
              <div className="join-secret">
                <code>{joinShowPassword ? joinLogin.password : "•".repeat(Math.min(12, String(joinLogin.password || "").length || 8))}</code>
                <button type="button" className="icon-btn" aria-label={joinShowPassword ? t("Hide password") : t("Show password")} onClick={() => setJoinShowPassword(!joinShowPassword)}>
                  {joinShowPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button type="button" className="small-btn" onClick={() => { navigator.clipboard?.writeText(joinLogin.password); toast.success(t("Copied")); }}>
                  <Copy size={14} /> {t("Copy")}
                </button>
              </div>
              <div className="join-footer">
                <Cue tone={joinLeft > 15 ? "info" : "warn"}>{t("Hides in {v0}s", { v0: joinLeft })}</Cue>
                {joinLogin.link ? (
                  <a className="primary" href={joinLogin.link} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} /> {t("Open the session")}
                  </a>
                ) : (
                  <span className="footnote">{t("This group has no meeting link yet.")}</span>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* A ready message for the group's WhatsApp chat: copy it, open the group, paste. */}
      <Dialog open={!!groupMessage} onOpenChange={(v) => !v && setGroupMessage(null)}>
        <DialogContent className="action-dialog sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{groupMessage?.kind === "feedback" ? t("Ask the group for feedback") : t("Tell the group the session is confirmed")}</DialogTitle>
            <DialogDescription>
              {groupMessage?.kind === "feedback"
                ? t("Students rate the session on their own DEPI page. Send them this message in the group's WhatsApp.")
                : t("Your confirmation is recorded in the app. The app cannot post into WhatsApp, so copy this message into the group's chat.")}
            </DialogDescription>
          </DialogHeader>
          {groupMessage && (
            <div className="group-message">
              <textarea
                rows={6}
                value={groupMessage.text}
                onChange={(e) => setGroupMessage({ ...groupMessage, text: e.target.value })}
                aria-label={t("Message")}
              />
              <div className="detail-actions">
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(groupMessage.text);
                      toast.success(t("Copied. Paste it in the group's chat."));
                    } catch {
                      toast.error(t("Copy did not work. Select the text and copy it."));
                    }
                  }}
                >
                  <Copy size={15} /> {t("Copy message")}
                </button>
                {groupMessage.link ? (
                  <a className="small-btn wa-btn" href={groupMessage.link} target="_blank" rel="noreferrer">
                    <MessageCircle size={15} /> {t("Open the WhatsApp group")}
                  </a>
                ) : (
                  <small className="footnote">{t("This group has no WhatsApp link yet. Add it from the Groups page so it opens in one tap.")}</small>
                )}
                {groupMessage.kind === "feedback" && ticksStep(groupMessage.session, sessionChecklist.find((i) => i.key === "feedback_requested")!) && (
                  <button
                    type="button"
                    className="small-btn"
                    disabled={busy}
                    onClick={async () => {
                      if (await quick("session_check", { id: groupMessage.session.id, item: "feedback_requested", done: true })) setGroupMessage(null);
                    }}
                  >
                    <Check size={15} /> {t("Mark as sent")}
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* A client account's email and password, one tap from its row. */}
      <Dialog open={!!signinFor} onOpenChange={(v) => !v && setSigninFor(null)}>
        <DialogContent className="action-dialog sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Account sign-in")}</DialogTitle>
            <DialogDescription>{signinFor ? `${signinFor.label} · ${signinFor.platform}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="info-box">
            <LockKeyhole size={16} />
            <span>{t("Passwords are kept encrypted in the app's credential vault, never in a sheet or the account list. They open here for the people who keep the accounts (the Service Team's supervisor, Project Operations, Higher Board, administrators), the account's coordinators, and the coordinator and supervisor of a group using it. Each opening is recorded with its purpose.")}</span>
          </div>
          {signinFor && <CredentialPanel account={signinFor.id} canStore={keepsAccounts} showReference={can(user.roles, ["Operations Systems / Admin"])} />}
        </DialogContent>
      </Dialog>
      {(() => {
        const r = checklistFor ? (d.sessions || []).find((x: Row) => x.id === checklistFor) : null;
        const state = r ? checklistOf(r) : {};
        return (
          <Dialog open={!!r} onOpenChange={(v) => !v && setChecklistFor(null)}>
            <DialogContent className="action-dialog sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("Session checklist")}</DialogTitle>
                <DialogDescription>
                  {r ? `${r.group_id} · ${t("Week {v0}", { v0: r.week })} · ${new Date(r.starts_at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                </DialogDescription>
              </DialogHeader>
              {r && (() => {
                const steps = sessionChecklist.filter((item) => state[item.key]);
                const done = steps.filter((item) => state[item.key].done).length;
                const when = (at?: string | null) =>
                  at ? new Date(at).toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                return (
                  <>
                    <div className="checklist-summary">
                      <span><strong>{done}/{steps.length}</strong> {t("steps done")}</span>
                      <span>{t("Coach")}: {owner(r.coach_id)}</span>
                    </div>
                    {r.status !== "Cancelled" && (
                      <div className="confirm-pills is-row">
                        {answer(t("Coordinator"), r.coordinator_confirmed_at, r.coordinator_unavailable)}
                        {answer(t("Coach"), r.coach_confirmed_at, r.coach_unavailable)}
                      </div>
                    )}
                    <div className="student-progress-bar checklist-progress"><span style={{ width: `${steps.length ? (100 * done) / steps.length : 0}%` }} /></div>
                    <ol className="checklist-stepper">
                      {steps.map((item, index) => {
                        const st = state[item.key];
                        const editable = ticksStep(r, item);
                        const stage = item.stage === "Before" ? t("Before the session") : item.stage === "During" ? t("During the session") : t("After the session");
                        // Whose step it is and when it comes, so each party sees what is theirs.
                        const whose = item.owner === "coach_ops" ? t("Coach Operations' step") : item.owner === "coordinator" ? t("Coordinator's step") : item.owner === "coach" ? t("Coach's step") : t("Automatic");
                        return (
                          <li key={item.key} className={st.flagged ? "is-flagged" : st.done ? "is-done" : ""}>
                            <span className="checklist-marker">{st.flagged ? "!" : st.done ? <Check size={14} /> : index + 1}</span>
                            <div className="checklist-body">
                              <small className="checklist-stage-name">{stage} · <span className={"checklist-owner is-" + item.owner}>{whose}</span>{item.when ? " · " + t(item.when) : ""}</small>
                              <strong>{t(item.label)}</strong>
                              <small className="table-subline">
                                {st.flagged
                                  ? `⚠ ${t("Unavailable")}: ${st.flagged}`
                                  : st.done
                                    ? item.owner === "auto"
                                      ? t("Done automatically from the register")
                                      : `${st.by ? owner(st.by) : t("The coach confirmed")}${st.at ? " · " + when(st.at) : ""}`
                                    : item.owner === "auto"
                                      ? t("Ticks itself once every student is marked")
                                      : item.owner === "coach_ops"
                                        ? t("Coach Operations ticks this after checking the day's sessions")
                                        : item.key === "feedback_requested"
                                          ? t("Send the group the feedback message, then mark it done")
                                          : t("The group's coordinator ticks this")}
                              </small>
                            </div>
                            <div className="checklist-action">
                              {item.owner === "auto" ? (
                                takesAttendance(r) && !st.done ? (
                                  <button type="button" className="small-btn" onClick={() => { setChecklistFor(null); openAttendance(r); }}>{t("Take attendance")}</button>
                                ) : null
                              ) : editable ? (
                                <span className="checklist-buttons">
                                  {item.key === "feedback_requested" && !st.done && (
                                    <button type="button" className="small-btn" onClick={() => { setChecklistFor(null); setGroupMessage(feedbackMessage(r)); }}>
                                      <MessageCircle size={14} /> {t("Message")}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={st.done ? "small-btn" : "primary small"}
                                    disabled={busy}
                                    onClick={() => quick("session_check", { id: r.id, item: item.key, done: !st.done })}
                                  >
                                    {st.done ? t("Undo") : t("Mark done")}
                                  </button>
                                </span>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>
        );
      })()}
      {(() => {
        const r = feedbackFor ? (d.sessions || []).find((x: Row) => x.id === feedbackFor) : null;
        const rows: Row[] = r ? feedbackOf(r.id) : [];
        const searched = rows.filter((f) => Number(f.searched_gig) === 1 || f.searched_gig === true).length;
        return (
          <Dialog open={!!r} onOpenChange={(v) => !v && setFeedbackFor(null)}>
            <DialogContent className="action-dialog sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("Session feedback")}</DialogTitle>
                <DialogDescription>
                  {r ? `${sessionName(r.title)} · ${r.group_id} · ${owner(r.coach_id)} · ${t("{v0} responses", { v0: rows.length })}` : ""}
                </DialogDescription>
              </DialogHeader>
              {r && (
                <>
                  <div className="mini-stats">
                    <span><strong>{average(rows, "satisfaction")}</strong>{t("Satisfaction")}</span>
                    <span><strong>{average(rows, "clarity")}</strong>{t("Coach's clarity")}</span>
                    <span><strong>{average(rows, "usefulness")}</strong>{t("Mentorship usefulness")}</span>
                    <span><strong>{rows.length ? Math.round((100 * searched) / rows.length) : 0}%</strong>{t("Searched for work on the platforms")}</span>
                  </div>
                  <div className="feedback-comments">
                    {rows.filter((f) => f.liked || f.comments).map((f) => (
                      <div className="info-box" key={f.id}>
                        <strong>{name(f.student_id)}</strong>
                        {f.liked && <span><small>{t("Liked most:")}</small> {f.liked}</span>}
                        {f.comments && <span><small>{t("Comments or support needed:")}</small> {f.comments}</span>}
                      </div>
                    ))}
                    {!rows.some((f) => f.liked || f.comments) && <Empty title={t("No written comments")} />}
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
        );
      })()}
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
                    <button type="button" className="text-link group-message-link" onClick={() => open("group_contact", { channel: "WhatsApp", outcome: "Responded" })}>
                      {t("Messaged the whole group? Log one group message instead")}
                    </button>
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
                      false,
                    )}
                    {field("starts_at", t("Start date & time"), "datetime-local")}
                    {field("week", t("Journey week"), "number")}
                    {field(
                      "duration_minutes",
                      t("Duration in minutes"),
                      "number",
                    )}
                    <p className="footnote">
                      {t("Groups run 8 weekly sessions of 180 minutes.")}{" "}
                      {t("The group's coordinator and its coach both confirm the session; until they do it is followed as a case.")}
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
                      false,
                    )}
                    {field("starts_at", t("New date & time"), "datetime-local")}
                    {field("reason", t("Reason for rescheduling"))}
                    {(() => {
                      const later = sessions.filter(
                        (s) => s.group_id === modal!.group_id && s.starts_at >= modal!.starts_at && ["Scheduled", "Confirmed"].includes(s.status),
                      ).length;
                      return (
                        <p className="footnote">
                          {t("This moves the group: this session and the {v0} later ones shift by the same amount. Earlier sessions stay as they were.", { v0: Math.max(0, later - 1) })}
                        </p>
                      );
                    })()}
                  </>
                );
              if (a === "session_unavailable")
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.title}</strong> · {modal!.group_id} · {fmt(modal!.starts_at)}
                    </div>
                    {field("reason", t("Why you can't attend"))}
                  </>
                );
              if (a === "session_cancel")
                return <>{field("reason", t("Reason for cancellation"))}</>;
              if (a === "group_contact") {
                const mine = groups.filter((g) => can(user.roles, ["Project Operations", "Operations Systems / Admin"]) || g.coordinator === user.id);
                return (
                  <>
                    <p className="footnote">{t("One screenshot of a message sent to the whole group logs a contact for every active student in it.")}</p>
                    <label className="field">
                      {t("Group")} *
                      <SearchableSelect
                        className="pick-inline"
                        label={t("Group")}
                        placeholder={t("Choose a group")}
                        required
                        value={form.group_id || ""}
                        onChange={(groupId) => {
                          const anchor = students.find((x) => x.group_id === groupId && x.lifecycle === "Active");
                          setForm({ ...form, group_id: groupId, student_id: anchor?.id || "" });
                        }}
                        options={mine.map((g) => ({ value: g.id, label: `${g.id} · ${students.filter((x) => x.group_id === g.id && x.lifecycle === "Active").length} ${t("students")}` }))}
                      />
                    </label>
                    <div className="form-grid">
                      {choice("channel", t("Channel"), ["WhatsApp", "Phone", "Email", "Teams", "In person"])}
                      {choice("outcome", t("Outcome"), ["Responded", "No response", "Wrong number", "Unreachable"])}
                    </div>
                    {field("occurred_at", t("Sent at"), "datetime-local")}
                    {form.group_id ? proofField() : null}
                    {field("notes", t("Notes"), "text", false)}
                  </>
                );
              }
              if (a === "session_coach") {
                const coaches = staff
                  .filter((u: Row) => {
                    const held = Array.isArray(u.roles) ? u.roles : JSON.parse(u.roles || "[]");
                    return held.includes("Coach") && u.active !== false && u.active !== 0 && u.id !== modal!.coach_id;
                  })
                  .sort((a: Row, b: Row) => String(a.name).localeCompare(String(b.name)));
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.title}</strong>
                      <small>{modal!.group_id} · {fmt(modal!.starts_at)} · {t("now")}: {owner(modal!.coach_id)}</small>
                    </div>
                    <p className="footnote">{t("Only this session changes coach. The sessions before and after it keep theirs, so each session is paid to the coach who held it.")}</p>
                    {choice("mode", t("Coach for this session"), [
                      { value: "existing", label: t("A coach already in the system") },
                      { value: "new", label: t("A new coach") },
                    ])}
                    {form.mode === "new" ? (
                      <>
                        {field("new_name", t("Full name"))}
                        {field("new_email", t("Email"), "email")}
                        <div className="form-grid">
                          {field("new_national_id", t("National ID (their first password)"))}
                          {field("new_phone", t("Phone"), "text", false)}
                        </div>
                      </>
                    ) : (
                      choice("coach_id", t("Coach"), coaches.map((c: Row) => ({ value: c.id, label: c.name + (c.title ? " · " + c.title : "") })))
                    )}
                    {field("reason", t("Why this session needs another coach"))}
                  </>
                );
              }
              if (a === "session_attendance") {
                const roster = rosterOf(modal!);
                const marks: Row = form.marks || {};
                const mark = (id: string, status: string) => setForm({ ...form, marks: { ...marks, [id]: status } });
                return (
                  <>
                    <div className="info-box">
                      <strong>{modal!.title}</strong>
                      <small>{modal!.group_id} · {fmt(modal!.starts_at)}</small>
                    </div>
                    {roster.length === 0 ? (
                      <Empty title={t("No active students in this group")} />
                    ) : (
                      <>
                        <div className="detail-actions">
                          <button type="button" className="small-btn" onClick={() => setForm({ ...form, marks: Object.fromEntries(roster.map((s: Row) => [s.id, "Present"])), teams: "" })}>
                            {t("Mark all present")}
                          </button>
                          <label className="small-btn attendance-upload">
                            <Upload size={14} /> {t("Upload Teams attendance file")}
                            <input type="file" accept=".csv,.txt,.xlsx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) readTeamsFile(f, modal!); e.target.value = ""; }} />
                          </label>
                          <small>{t("{v0} present · {v1} absent · {v2} not marked", {
                            v0: roster.filter((s: Row) => marks[s.id] === "Present").length,
                            v1: roster.filter((s: Row) => marks[s.id] === "Absent").length,
                            v2: roster.filter((s: Row) => !marks[s.id]).length,
                          })}</small>
                        </div>
                        {form.teams && <div className="info-box">{form.teams}</div>}
                        <p className="footnote">{t("Everyone starts as Present. Tap the students who were absent, then save. The group's coordinator has the final word: a coach cannot change a mark the coordinator saved.")}</p>
                        <div className="attendance-list">
                          {roster.map((s: Row) => (
                            <div className="attendance-row" key={s.id}>
                              <span><strong>{s.name}</strong><small>{s.id}</small></span>
                              <span className="attendance-toggle">
                                <button type="button" className={marks[s.id] === "Present" ? "is-on present" : ""} onClick={() => mark(s.id, "Present")}>{t("Present")}</button>
                                <button type="button" className={marks[s.id] === "Absent" ? "is-on absent" : ""} onClick={() => mark(s.id, "Absent")}>{t("Absent")}</button>
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                );
              }
              if (a === "account_request")
                return (
                  <>
                    {studentPick()}
                    {choice("platform", t("Marketplace"), controlledPlatforms)}
                    {field("title", t("Service the client account will order"))}
                    {field("value", t("Credit needed (USD)"), "number")}
                    {field("notes", t("Request notes"), "text", false)}
                    <p className="footnote">
                      {t("The programme's client account on this marketplace orders the student's service. Up to three requests per student.")}
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
                    {(() => {
                      const request = (d.requests || []).find((r: Row) => r.id === form.request);
                      const fits = (d.accounts || []).filter(
                        (c: Row) =>
                          c.status === "Available" &&
                          !c.active_assignment &&
                          (!request || (c.platform === request.platform && Number(c.credits) >= Number(request.value))),
                      );
                      return (
                        <>
                          {request && (
                            <div className="info-box">
                              <strong>{name(request.student_id)}</strong>
                              <small>{request.task} · {request.platform} · {t("needs")} ${request.value}</small>
                            </div>
                          )}
                          {fits.length ? (
                            choice(
                              "account",
                              t("Account that fits"),
                              fits.map((c: Row) => ({ value: c.id, label: `${c.label} · $${c.credits}` })),
                            )
                          ) : (
                            <div className="form-error">{t("No available account on this marketplace has enough credit. Add or top up an account first.")}</div>
                          )}
                        </>
                      );
                    })()}
                    <p className="footnote">
                      {t("Reservations hold one eligible account for 15 minutes and prevent a concurrent allocation from using it.")}
                    </p>
                  </>
                );
              if (a === "allocate")
                return (
                  <>
                    <div className="info-box">
                      <strong>{name(form.student_id)}</strong>
                      <span>
                        {(d.requests || []).find((r: Row) => r.id === form.request)?.task} ·{" "}
                        {(d.accounts || []).find((c: Row) => c.id === form.account)?.label || form.account}
                      </span>
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
                        {t("Service")}{" "}{modal!.id} {t("· account")}{" "}{modal!.account_id}
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
                          // A supervisor chooses within their own team.
                          const team: string[] | null = d.teamCoordinators ?? null;
                          return u.active !== false && u.active !== 0 && held.includes("Operations Coordinator") && (!team || team.includes(u.id));
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
                    {field("paid_by_account", t("Account used to pay"))}
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
                      <strong>{t("Service")}{" "}{form.gig_id}</strong>
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
                      {t("The applied USD value is calculated once from the original service value and stored with the exact approved rate.")}
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
                      t("Paid service"),
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
                                {t(c)}
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
                      <Badge value={serviceLabel(modal!.platform)} />
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
                        return <div className="info-box"><strong>{checkText(automatic.message)}</strong>{(automatic.checks || []).map((check: string) => <small key={check}>{checkText(check)}</small>)}</div>;
                      } catch { return null; }
                    })()}
                    {choice("decision", t("Review decision"), [
                      { value: "Lock", label: t("Approve") },
                      { value: "Needs Correction", label: t("Reject") },
                    ])}
                    {form.decision === "Needs Correction" && (
                      <Pick
                        label={t("Correction template")}
                        value=""
                        onChange={(comment) => setForm({ ...form, comment })}
                        options={[
                          { value: t("The link does not open the submitted service page. Send the direct public service URL."), label: t("Direct link required") },
                          { value: t("The service owner could not be matched to your student record. Confirm the seller profile and resubmit."), label: t("Owner mismatch") },
                          { value: t("The service is unavailable, paused or deleted. Submit an active public service."), label: t("Service unavailable") },
                          { value: t("The service category or title does not match your assigned track. Submit a track-relevant service."), label: t("Track mismatch") },
                        ]}
                      />
                    )}
                    {field("comment", form.decision === "Needs Correction" ? t("Why it is rejected (the student sees this)") : t("Comment"), "text", form.decision === "Needs Correction")}
                    <p className="footnote">
                      {t("Approve only when the service page is active, correct, track-relevant and belongs to the student. An approved link is final. A rejected link goes back to the student with your comment, and the updated link returns to you for review.")}
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
                    <div className="form-grid">
                      {field("title", t("Title"), "text", false)}
                      {choice("team", t("Team"), [
                        { value: "", label: t("No team") },
                        { value: "Target Team", label: t("Target Team") },
                        { value: "Service Team", label: t("Service Team") },
                      ], false)}
                    </div>
                    <div className="review-checks">
                      {roles.map((r) => (
                        <label className="check" key={r} title={r}>
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
                              policyLabels[key] || key,
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
              if (a === "account_coordinator") {
                const chosen: string[] = form.account_ids || [];
                return (
                  <>
                    <p className="footnote">
                      {chosen.length === 1
                        ? (d.accounts || []).find((c: Row) => c.id === chosen[0])?.label
                        : t("{v0} accounts", { v0: chosen.length })}
                    </p>
                    {form.slot === "second" && (
                      <p className="footnote">{t("A second coordinator shares the account with the first: both see it and can open its sign-in.")}</p>
                    )}
                    {choice(
                      "coordinator_id",
                      form.slot === "second" ? t("Second coordinator") : t("Coordinator"),
                      [
                        { value: "", label: form.slot === "second" ? t("No second coordinator") : t("Nobody (unassign)") },
                        ...staff
                          .filter((u: Row) => {
                            const held = Array.isArray(u.roles) ? u.roles : JSON.parse(u.roles || "[]");
                            // A supervisor chooses within their own team.
                            const team: string[] | null = d.teamCoordinators ?? null;
                            return u.active !== false && u.active !== 0 && held.includes("Operations Coordinator") && (!team || team.includes(u.id));
                          })
                          .map((u: Row) => ({ value: u.id, label: u.name })),
                      ],
                      false,
                    )}
                  </>
                );
              }
              if (a === "account_topup") {
                const acc = (d.accounts || []).find((c: Row) => c.id === form.id);
                return (
                  <>
                    {modal!.id ? (
                      <div className="account-summary">
                        <div>
                          <strong>{acc?.label}</strong>
                          <small>{acc?.id} · {acc?.platform}</small>
                        </div>
                        <Badge value={acc?.status} />
                        <span className="account-credit">{"$" + Number(acc?.credits || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}<small>{t("credit now")}</small></span>
                      </div>
                    ) : (
                      choice(
                        "id",
                        t("Account"),
                        (d.accounts || [])
                          .filter((c: Row) => c.status !== "Retired")
                          .map((c: Row) => ({ value: c.id, label: `${c.label} · ${c.platform} · $${c.credits}` })),
                      )
                    )}
                    {field("amount", t("Top-up amount (USD)"), "number")}
                    {field("reference", t("Receipt or transfer reference"))}
                    {field("note", t("Note"), "text", false)}
                    {acc && Number(form.amount) > 0 && (
                      <p className="footnote">
                        {t("Credit after this top-up: {v0}", { v0: "$" + (Number(acc.credits || 0) + Number(form.amount)).toLocaleString("en-US", { maximumFractionDigits: 2 }) })}
                      </p>
                    )}
                  </>
                );
              }
              if (a === "group_whatsapp")
                return field("whatsapp_link", t("WhatsApp group link"), "url", false);
              if (a === "account_status") {
                // The same moves the server allows from each state.
                const flow: Record<string, string[]> = {
                  Available: ["Blocked", "Access Issue", "Funding Block", "Under Review", "Retired"],
                  Assigned: ["Cooldown", "Blocked", "Access Issue", "Under Review"],
                  Cooldown: ["Available", "Blocked", "Retired"],
                  Blocked: ["Available", "Under Review", "Retired"],
                  "Access Issue": ["Available", "Under Review", "Retired"],
                  "Funding Block": ["Available", "Under Review", "Retired"],
                  "Under Review": ["Available", "Blocked", "Retired"],
                };
                const moves = flow[modal!.status] || [];
                return (
                  <>
                    <div className="account-summary">
                      <div>
                        <strong>{modal!.label}</strong>
                        <small>{modal!.id} · {modal!.platform}</small>
                      </div>
                      <Badge value={modal!.status} />
                      <span className="account-credit">{"$" + Number(modal!.credits || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}<small>{t("available credit")}</small></span>
                    </div>
                    {moves.length ? (
                      <>
                        {choice("status", t("Move the account to"), moves.map((m) => ({ value: m, label: m === "Available" && ["Blocked", "Access Issue", "Funding Block"].includes(modal!.status) ? t("Available (unblock)") : t(m) })))}
                        {field("reason", t("Reason"))}
                      </>
                    ) : (
                      <p className="footnote">{t("This account cannot change state.")}</p>
                    )}
                    <details className="account-credentials">
                      <summary>{t("Sign-in details")}</summary>
                      <CredentialPanel account={modal!.id} canStore={keepsAccounts} showReference={can(user.roles, ["Operations Systems / Admin"])} />
                    </details>
                  </>
                );
              }
              return field("reason", t("Reason"));
            })()}
            {formError && (
              <div className="form-error" role="alert">
                {t(formError)}
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
            options={(importMode === "update"
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
                  ]).map((m) => ({ value: m, label: t(importKinds[m] || m) }))
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
                    title: "Operations Coordinator",
                    team: "Service Team",
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
                    platform: "Khamsat",
                    title: t("Logo design order"),
                    value: 25,
                    task_bank_id: "",
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
                        <SearchableSelect
                          className="pick-inline"
                          label={t("Field filled by {v0}", { v0: header })}
                          value={importMapping[header] || ""}
                          onChange={(field) => {
                            const next: Row = { ...importMapping };
                            // One field cannot be filled from two columns.
                            for (const [other, value] of Object.entries(next))
                              if (value === field && other !== header) delete next[other];
                            if (field) next[header] = field;
                            else delete next[header];
                            setImportMapping(next);
                          }}
                          options={[{ value: "", label: t("Ignore this column") }, ...[...mappingKeys, ...mappingFields.filter((f) => !mappingKeys.includes(f))].map((field) => ({ value: field, label: field.replace(/_/g, " ") }))]}
                        />
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
