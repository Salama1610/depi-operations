"use client";
import { useLocale, useT } from "@/lib/i18n/context";
/** What a search result is, by name a person reads. */
const searchKinds: Record<string, string> = { student: "Student", group: "Group", gig: "Paid service", evidence: "Service proof", case: "Case", account: "Client account", application: "Application", certificate: "Certificate", outcome: "Post-programme outcome" };
import { SearchableSelect } from "@/components/searchable-select";
import { useState, useEffect } from "react";
import { Download, LockKeyhole, RefreshCw, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
export function ControlCenter() {
  const t = useT();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [retryReason, setRetryReason] = useState("");
  async function load() {
    const r = await fetch("/api/system");
    const d = await r.json();
    if (d.error) setError(d.error);
    else setData(d);
  }
  useEffect(() => {
    load();
  }, []);
  async function backup() {
    setBusy(true);
    setMessage(t("Preparing encrypted database and evidence export…"));
    try {
      const r = await fetch("/api/backup", { method: "POST" });
      if (!r.ok) throw Error((await r.json()).error);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "depi-encrypted-backup.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setMessage(
        t("Encrypted export downloaded. Store it and the recovery key separately."),
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prose">
      <h2>{t("Connections and recovery")}</h2>
      {error && <p role="alert">{error}</p>}
      <div className="report-grid">
        {[
          ["automation", "Scheduled workflows"],
          ["vault", "Credential vault"],
          ["backup_encryption", "Encrypted backups"],
        ].map(([key, title]) => (
          <div className="panel prose" key={key}>
            <h3>{t(title)}</h3>
            <span
              className={
                "badge " + (data?.connections[key] ? "green" : "amber")
              }
            >
              {data?.connections[key] ? t("Configured") : t("Connection required")}
            </span>
          </div>
        ))}
      </div>
      <p>
        {t("Connections are configured through protected deployment settings. Secret values are never shown here.")}
      </p>
      <h3>{t("Student roster readiness")}</h3>
      <div className="mini-stats">
        <span><strong>{data?.roster?.total ?? "—"}</strong>{t("Total students")}</span>
        <span><strong>{data?.roster?.active ?? "—"}</strong>{t("Active students")}</span>
        <span><strong>{data?.roster?.missing_email ?? "—"}</strong>{t("Missing sign-in email")}</span>
        <span><strong>{data?.roster?.duplicate_emails?.length ?? "—"}</strong>{t("Duplicate emails")}</span>
      </div>
      {(data?.roster?.missing_email_rows?.length > 0 || data?.roster?.duplicate_emails?.length > 0) && (
        <div className="info-box">
          <strong>{t("Roster corrections required before student launch")}</strong>
          {data.roster.missing_email_rows.slice(0, 20).map((student: any) => <span key={student.id}>{student.id} · {student.name} · {student.group_id} {t("· missing email")}</span>)}
          {data.roster.duplicate_emails.slice(0, 20).map((row: any) => <span key={row.email}>{row.email} · {row.student_ids}</span>)}
          {(data.roster.missing_email_rows.length > 20 || data.roster.duplicate_emails.length > 20) && <small>{t("Only the first 20 rows in each category are shown. Correct the source roster and rerun import preview.")}</small>}
        </div>
      )}
      <button
        className="primary"
        disabled={busy || !data?.connections.backup_encryption}
        onClick={backup}
      >
        <Download size={16} />
        {busy ? t("Preparing backup…") : t("Download encrypted backup")}
      </button>
      <p role="status">{message}</p>
      <h3>{t("Scheduled workflow runs")}</h3>
      <label className="field">
        {t("Reason for retry authorization")}
        <input
          value={retryReason}
          onChange={(e) => setRetryReason(e.target.value)}
        />
      </label>
      <button className="small-btn" onClick={load}>
        <RefreshCw size={16} />
        {t("Refresh run log")}
      </button>
      {data?.runs.map((r: any) => (
        <div className="info-box" key={r.id}>
          <strong>{r.kind}</strong>
          <span className="badge">{r.status}</span>
          <small>{new Date(r.updated_at).toLocaleString()}</small>
          {r.status === "Failed" && (
            <button
              className="small-btn"
              onClick={async () => {
                const reason = retryReason.trim();
                if (!reason) {
                  setError(t("Record the retry reason first."));
                  return;
                }
                const response = await fetch("/api/system", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "retry_run",
                    id: r.id,
                    reason,
                  }),
                });
                const x = await response.json();
                if (x.error) setError(x.error);
                else {
                  setMessage(
                    t("Retry authorized. Resubmit the same event ID and contents from the runner."),
                  );
                  load();
                }
              }}
            >
              {t("Authorize retry")}
            </button>
          )}
        </div>
      ))}
      {data?.runs.length === 0 && <p>{t("No scheduled runs yet.")}</p>}
    </div>
  );
}
export function ReportsPanel({ canExport = false, showStaff = true }: { canExport?: boolean; showStaff?: boolean }) {
  const t = useT();
  const [data, setData] = useState<any>(null),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [error, setError] = useState("");
  async function load() {
    try {
      const r = await fetch("/api/reports?from=" + from + "&to=" + to);
      const x = await r.json();
      if (x.error) throw Error(x.error);
      setData(x);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    async function initialLoad() {
      try {
        const r = await fetch("/api/reports?from=&to=");
        const x = await r.json();
        if (x.error) throw Error(x.error);
        setData(x);
      } catch (e: any) {
        setError(e.message);
      }
    }
    void initialLoad();
  }, []);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{t("Period activity and capacity")}</h2>
      </div>
      <div className="prose">
        <div className="form-grid">
          <label className="field">
            {t("Activity from")}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            {t("Activity through")}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="detail-actions">
          <button className="primary" onClick={load}>
            {t("Apply period")}
          </button>
          {canExport && (<>
          <a
            className="small-btn"
            href={"/api/reports?format=xlsx&from=" + from + "&to=" + to}
          >
            {t("Export group report")}
          </a>
          <a className="small-btn" href={"/api/reports?dataset=service_links&format=csv&from=" + from + "&to=" + to}>{t("Export service links CSV")}</a>
          <a className="small-btn" href={"/api/reports?dataset=service_links&format=xlsx&from=" + from + "&to=" + to}>{t("Export service links XLSX")}</a>
          </>)}
        </div>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <div className="mini-stats">
              <span>
                <strong>{data.activity.contacts}</strong>{t("Contacts in period")}
              </span>
              <span>
                <strong>{data.activity.accepted_evidence}</strong>{t("Accepted in period")}
              </span>
              <span>
                <strong>{data.metrics.sla_breaches}</strong>{t("Current SLA breaches")}
              </span>
              <span>
                <strong>{data.metrics.available_accounts}</strong>{t("Accounts available")}
              </span>
            </div>
            <h3>{t("Graduation scenarios")}</h3>
            <p>
              {data.graduation_scenarios.confirmed} {t("confirmed graduates.")}{" "}
              {data.graduation_scenarios.with_all_pending_evidence_accepted}{" "}
              {t("would qualify if every pending review in the scenario were accepted.")}
            </p>
            <p>{t(data.graduation_scenarios.description)}</p>
            <h3>{t("Student service-link QC")}</h3>
            <div className="mini-stats">
              <span><strong>{data.service_links.submitted_percent}%</strong>{t("Submitted")}</span>
              <span><strong>{data.service_links.fully_approved_percent}%</strong>{t("Fully approved")}</span>
              <span><strong>{data.service_links.needs_correction_percent}%</strong>{t("Rejected")}</span>
              <span><strong>{data.service_links.average_qc_turnaround_hours ?? "—"}</strong>{t("Average QC hours")}</span>
              <span><strong>{data.service_links.automatic_failure_rate}%</strong>{t("Automatic failures")}</span>
              <span><strong>{data.service_links.average_revisions}</strong>{t("Average revisions")}</span>
            </div>
            <div className="report-grid">
              <div className="info-box"><strong>{t("Students by submitted links")}</strong>{data.service_links.students_by_link_count.map((row: any) => <span key={row.count}>{row.count} {t("links ·")}{" "}{row.students} {t("students")}</span>)}</div>
              <div className="info-box"><strong>{t("Platform distribution")}</strong>{Object.entries(data.service_links.platform_distribution).map(([platform, count]: any) => <span key={platform}>{platform} · {count}</span>)}</div>
              {showStaff && <div className="info-box"><strong>{t("Reviewer activity")}</strong>{Object.entries(data.service_links.reviewer_workload).map(([reviewer, count]: any) => <span key={reviewer}>{reviewer} · {count}</span>)}</div>}
            </div>
            <h3>{t("Account capacity by platform")}</h3>
            {Object.entries(data.capacity).map(([platform, r]: any) => (
              <div className="info-box" key={platform}>
                <strong>{platform}</strong>
                <span>{r.available} {t("available accounts")}</span>
                <span>${r.credits} {t("credits")}</span>
                <span>{r.requests} {t("pending requests")}</span>
              </div>
            ))}
            <p>
              {t("Activity counts use the selected period. Backlog, capacity and graduation show the current position.")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
export function CredentialPanel({ account }: { account: string }) {
  const t = useT();
  const [purpose, setPurpose] = useState(""),
    [reference, setReference] = useState(""),
    [secret, setSecret] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setSecret(null);
    setMessage("");
  }, [account]);
  useEffect(() => {
    if (!secret) return;
    const timer = setTimeout(() => setSecret(null), 30000);
    return () => clearTimeout(timer);
  }, [secret]);
  async function act(action: string) {
    setBusy(true);
    setSecret(null);
    try {
      const r = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          account_id: account,
          purpose,
          reference,
        }),
      });
      const x = await r.json();
      if (x.error) throw Error(x.error);
      if (action === "reveal") setSecret(x);
      setMessage(
        action === "reveal"
          ? t("Credentials hide after 30 seconds.")
          : t("Recorded in the audit history."),
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prose">
      <h3>{t("Controlled credential access")}</h3>
      <label className="field">
        {t("Access purpose")}
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          minLength={10}
        />
      </label>
      <div className="detail-actions">
        <button
          type="button"
          disabled={busy || purpose.trim().length < 10}
          className="small-btn"
          onClick={() => act("reveal")}
        >
          <LockKeyhole size={16} />
          {t("Retrieve credentials")}
        </button>
        <button
          type="button"
          disabled={busy || purpose.trim().length < 10}
          className="small-btn"
          onClick={() => act("report_exposure")}
        >
          {t("Report exposure")}
        </button>
      </div>
      {secret && (
        <div className="info-box">
          <span>{t("Username:")}{" "}{secret.username}</span>
          <span>{t("Password:")}{" "}{secret.password}</span>
          <button type="button" onClick={() => setSecret(null)}>
            {t("Hide now")}
          </button>
        </div>
      )}
      <p role="status">{message}</p>
      <label className="field">
        {t("Approved vault reference")}
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={t("depi/client-account-101")}
        />
      </label>
      <button
        type="button"
        disabled={busy || !reference || purpose.trim().length < 10}
        className="small-btn"
        onClick={() => act("set_reference")}
      >
        {t("Save reference")}
      </button>
    </div>
  );
}
export function NotificationCenter({
  onStudent,
}: {
  onStudent: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((x) => (x.error ? setError(x.error) : setItems(x.notifications)))
      .catch(() => setError("Notifications are unavailable."));
  }, []);
  return (
    <div className="notification-list">
      {error && <p role="alert">{t(error)}</p>}
      {items.map((n) => (
        <button
          key={n.id}
          onClick={async () => {
            const r = await fetch("/api/notifications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: n.id }),
            });
            if (r.ok)
              setItems(
                items.map((x) =>
                  x.id === n.id
                    ? { ...x, read_at: new Date().toISOString() }
                    : x,
                ),
              );
            if (n.entity_type === "student") onStudent(n.entity_id);
          }}
        >
          <span>
            <strong>
              {!n.read_at ? "● " : ""}
              {n.title}
            </strong>
            <small>
              {t(n.severity)} · {new Date(n.created_at).toLocaleString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}
            </small>
          </span>
        </button>
      ))}
      {!items.length && !error && <p>{t("No notifications assigned to you yet.")}</p>}
    </div>
  );
}

export function GlobalSearch({
  onStudent,
}: {
  onStudent: (id: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController(),
      timer = setTimeout(async () => {
        try {
          const r = await fetch("/api/search?q=" + encodeURIComponent(query), {
            signal: controller.signal,
          });
          const x = await r.json();
          if (x.error) throw Error(x.error);
          setResults(x.results);
          setError("");
        } catch (e: any) {
          if (e.name !== "AbortError") setError(e.message);
        }
      }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);
  function choose(r: any) {
    setOpen(false);
    if (r.type === "student") {
      onStudent(r.id);
      return;
    }
    const module =
      (
        {
          group: "groups",
          gig: "gigs",
          evidence: "evidence",
          case: "cases",
          account: "accounts",
          application: "program",
          certificate: "program",
          outcome: "program",
        } as any
      )[r.type] || "students";
    window.location.assign("/" + module + "?q=" + encodeURIComponent(r.id));
  }
  return (
    <>
      <button
        className="icon-btn"
        aria-label={t("Search the workspace")}
        onClick={() => setOpen(true)}
      >
        <Search size={18} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{t("Search the workspace")}</DialogTitle>
            <DialogDescription>
              {t("Find scoped students, applications, groups, services, evidence, certificates, outcomes, cases and authorized accounts.")}
            </DialogDescription>
          </DialogHeader>
          <label className="search-box">
            <Search size={17} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Name, ID, phone, order reference…")}
              aria-label={t("Global search")}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="notification-list">
            {results.map((r) => (
              <button key={r.type + ":" + r.id} onClick={() => choose(r)}>
                <span>
                  <strong>{r.label}</strong>
                  <small>
                    {t(searchKinds[r.type] || r.type)} · {r.id} · {r.detail}
                  </small>
                </span>
              </button>
            ))}
            {query.length >= 2 && !results.length && !error && (
              <p>{t("No matching records in your assigned scope.")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RetentionPanel() {
  const t = useT();
  const [data, setData] = useState<any>(null),
    [form, setForm] = useState({
      scope: "attachments",
      retention_action: "archive",
      days: "",
      authority: "",
      reason: "",
    }),
    [message, setMessage] = useState("");
  async function load() {
    const r = await fetch("/api/retention");
    const x = await r.json();
    if (!x.error) setData(x);
  }
  useEffect(() => {
    load();
  }, []);
  async function save() {
    const r = await fetch("/api/retention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const x = await r.json();
    setMessage(
      x.error ||
        t("Approved retention policy recorded; execution remains pending controlled implementation."),
    );
    if (!x.error) load();
  }
  const field = (key: string) => (e: any) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <div className="prose">
      <h2>{t("Retention policy controls")}</h2>
      <p>
        {t("Periods are intentionally blank until the organization supplies an approved legal or contractual rule.")}
      </p>
      <div className="form-grid">
        <label className="field">
          {t("Data scope")}
          <SearchableSelect label={t("Data scope")} value={form.scope} onChange={(scope) => setForm({ ...form, scope })} options={["audit_events", "attachments", "notifications", "automation_runs", "imports", "exports"].map((v) => ({ value: v, label: t(v) }))} />
        </label>
        <label className="field">
          {t("Approved action")}
          <SearchableSelect label={t("Approved action")} value={form.retention_action} onChange={(retention_action) => setForm({ ...form, retention_action })} options={["archive", "anonymize", "secure_delete"].map((v) => ({ value: v, label: t(v) }))} />
        </label>
        <label className="field">
          {t("Retention days")}
          <input
            type="number"
            min="1"
            max="36500"
            value={form.days}
            onChange={field("days")}
          />
        </label>
        <label className="field">
          {t("Policy / legal authority")}
          <input
            value={form.authority}
            onChange={field("authority")}
          />
        </label>
      </div>
      <label className="field">
        {t("Decision reason")}
        <input value={form.reason} onChange={field("reason")} />
      </label>
      <button
        className="small-btn"
        disabled={!form.days || !form.authority.trim() || !form.reason.trim()}
        onClick={save}
      >
        {t("Record approved policy")}
      </button>
      <p role="status">{message}</p>
      {data?.configurations?.map((x: any) => (
        <div className="info-box" key={x.key}>
          <strong>{x.key}</strong>
          <span>
            {JSON.parse(x.value).days} {t("days ·")}{" "}{JSON.parse(x.value).action}
          </span>
          <small>{JSON.parse(x.value).authority}</small>
        </div>
      ))}
    </div>
  );
}
