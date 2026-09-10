"use client";
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
    setMessage("Preparing encrypted database and evidence export…");
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
        "Encrypted export downloaded. Store it and the recovery key separately.",
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prose">
      <h2>Connections and recovery</h2>
      {error && <p role="alert">{error}</p>}
      <div className="report-grid">
        {[
          ["automation", "Scheduled workflows"],
          ["vault", "Credential vault"],
          ["backup_encryption", "Encrypted backups"],
        ].map(([key, title]) => (
          <div className="panel prose" key={key}>
            <h3>{title}</h3>
            <span
              className={
                "badge " + (data?.connections[key] ? "green" : "amber")
              }
            >
              {data?.connections[key] ? "Configured" : "Connection required"}
            </span>
          </div>
        ))}
      </div>
      <p>
        Connections are configured through protected deployment settings. Secret
        values are never shown here.
      </p>
      <button
        className="primary"
        disabled={busy || !data?.connections.backup_encryption}
        onClick={backup}
      >
        <Download size={16} />
        {busy ? "Preparing backup…" : "Download encrypted backup"}
      </button>
      <p role="status">{message}</p>
      <h3>Scheduled workflow runs</h3>
      <label className="field">
        Reason for retry authorization
        <input
          value={retryReason}
          onChange={(e) => setRetryReason(e.target.value)}
        />
      </label>
      <button className="small-btn" onClick={load}>
        <RefreshCw size={16} />
        Refresh run log
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
                  setError("Record the retry reason first.");
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
                    "Retry authorized. Resubmit the same event ID and contents from the runner.",
                  );
                  load();
                }
              }}
            >
              Authorize retry
            </button>
          )}
        </div>
      ))}
      {data?.runs.length === 0 && <p>No scheduled runs yet.</p>}
    </div>
  );
}
export function ReportsPanel() {
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
    load();
  }, []);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Period activity and capacity</h2>
      </div>
      <div className="prose">
        <div className="form-grid">
          <label className="field">
            Activity from
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="field">
            Activity through
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        <div className="detail-actions">
          <button className="primary" onClick={load}>
            Apply period
          </button>
          <a
            className="small-btn"
            href={"/api/reports?format=xlsx&from=" + from + "&to=" + to}
          >
            Export group report
          </a>
        </div>
        {error && <p role="alert">{error}</p>}
        {data && (
          <>
            <div className="mini-stats">
              <span>
                <strong>{data.activity.contacts}</strong>Contacts in period
              </span>
              <span>
                <strong>{data.activity.accepted_evidence}</strong>Accepted in
                period
              </span>
              <span>
                <strong>{data.metrics.sla_breaches}</strong>Current SLA breaches
              </span>
              <span>
                <strong>{data.metrics.available_accounts}</strong>Accounts
                available
              </span>
            </div>
            <h3>Graduation scenarios</h3>
            <p>
              {data.graduation_scenarios.confirmed} confirmed graduates.{" "}
              {data.graduation_scenarios.with_all_pending_evidence_accepted}{" "}
              would qualify if every pending review in the scenario were
              accepted.
            </p>
            <p>{data.graduation_scenarios.description}</p>
            <h3>Account capacity by platform</h3>
            {Object.entries(data.capacity).map(([platform, r]: any) => (
              <div className="info-box" key={platform}>
                <strong>{platform}</strong>
                <span>{r.available} available accounts</span>
                <span>${r.credits} credits</span>
                <span>{r.requests} pending requests</span>
              </div>
            ))}
            <p>
              Activity counts use the selected period. Backlog, capacity and
              graduation show the current position.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
export function CredentialPanel({ account }: { account: string }) {
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
    const t = setTimeout(() => setSecret(null), 30000);
    return () => clearTimeout(t);
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
          ? "Credentials hide after 30 seconds."
          : "Recorded in the audit history.",
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="prose">
      <h3>Controlled credential access</h3>
      <label className="field">
        Access purpose
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
          Retrieve credentials
        </button>
        <button
          type="button"
          disabled={busy || purpose.trim().length < 10}
          className="small-btn"
          onClick={() => act("report_exposure")}
        >
          Report exposure
        </button>
      </div>
      {secret && (
        <div className="info-box">
          <span>Username: {secret.username}</span>
          <span>Password: {secret.password}</span>
          <button type="button" onClick={() => setSecret(null)}>
            Hide now
          </button>
        </div>
      )}
      <p role="status">{message}</p>
      <label className="field">
        Approved vault reference
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="depi/client-account-101"
        />
      </label>
      <button
        type="button"
        disabled={busy || !reference || purpose.trim().length < 10}
        className="small-btn"
        onClick={() => act("set_reference")}
      >
        Save reference
      </button>
    </div>
  );
}
export function NotificationCenter({
  onStudent,
}: {
  onStudent: (id: string) => void;
}) {
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
      {error && <p role="alert">{error}</p>}
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
              {n.severity} · {new Date(n.created_at).toLocaleString()}
            </small>
          </span>
        </button>
      ))}
      {!items.length && !error && <p>No notifications assigned to you yet.</p>}
    </div>
  );
}

export function GlobalSearch({
  onStudent,
}: {
  onStudent: (id: string) => void;
}) {
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
        } as any
      )[r.type] || "students";
    window.location.href = "/" + module + "?q=" + encodeURIComponent(r.id);
  }
  return (
    <>
      <button
        className="icon-btn"
        aria-label="Search the workspace"
        onClick={() => setOpen(true)}
      >
        <Search size={18} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Search the workspace</DialogTitle>
            <DialogDescription>
              Find scoped students, groups, gigs, evidence, cases and authorized
              accounts.
            </DialogDescription>
          </DialogHeader>
          <label className="search-box">
            <Search size={17} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, ID, phone, order reference…"
              aria-label="Global search"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="notification-list">
            {results.map((r) => (
              <button key={r.type + ":" + r.id} onClick={() => choose(r)}>
                <span>
                  <strong>{r.label}</strong>
                  <small>
                    {r.type} · {r.id} · {r.detail}
                  </small>
                </span>
              </button>
            ))}
            {query.length >= 2 && !results.length && !error && (
              <p>No matching records in your assigned scope.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RetentionPanel() {
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
        "Approved retention policy recorded; execution remains pending controlled implementation.",
    );
    if (!x.error) load();
  }
  const field = (key: string, value: string) => (e: any) =>
    setForm({ ...form, [key]: e.target.value });
  return (
    <div className="prose">
      <h2>Retention policy controls</h2>
      <p>
        Periods are intentionally blank until the organization supplies an
        approved legal or contractual rule.
      </p>
      <div className="form-grid">
        <label className="field">
          Data scope
          <select value={form.scope} onChange={field("scope", form.scope)}>
            {[
              "audit_events",
              "attachments",
              "notifications",
              "automation_runs",
              "imports",
              "exports",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Approved action
          <select
            value={form.retention_action}
            onChange={field("retention_action", form.retention_action)}
          >
            {["archive", "anonymize", "secure_delete"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Retention days
          <input
            type="number"
            min="1"
            max="36500"
            value={form.days}
            onChange={field("days", form.days)}
          />
        </label>
        <label className="field">
          Policy / legal authority
          <input
            value={form.authority}
            onChange={field("authority", form.authority)}
          />
        </label>
      </div>
      <label className="field">
        Decision reason
        <input value={form.reason} onChange={field("reason", form.reason)} />
      </label>
      <button
        className="small-btn"
        disabled={!form.days || !form.authority.trim() || !form.reason.trim()}
        onClick={save}
      >
        Record approved policy
      </button>
      <p role="status">{message}</p>
      {data?.configurations?.map((x: any) => (
        <div className="info-box" key={x.key}>
          <strong>{x.key}</strong>
          <span>
            {JSON.parse(x.value).days} days · {JSON.parse(x.value).action}
          </span>
          <small>{JSON.parse(x.value).authority}</small>
        </div>
      ))}
    </div>
  );
}
