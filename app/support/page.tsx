"use client";

// Report a technical problem: bugs, access problems and error messages only.
// How-to questions go to the person's team leader. The app fills in the
// reporter, their roles, the page they came from, the time and the browser;
// the person adds what they did, what happened, what they expected, how much
// it blocks them and a screenshot. The system owner sees every report here and
// works it to Resolved; everyone else sees their own (app/api/support).

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ImagePlus, RefreshCw, Send, X } from "lucide-react";
import { LanguageToggle, useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";

type Row = Record<string, any>;

/** The workspace's pages, keyed by the module name the sidebar link sends. */
const pages: [string, string][] = [
  ["home", "Overview"],
  ["work", "My work"],
  ["weekly", "Weekly progress"],
  ["students", "Students"],
  ["progress", "Student progress"],
  ["groups", "Groups"],
  ["sessions", "Sessions"],
  ["accounts", "Accounts"],
  ["gigs", "Services"],
  ["portal", "Gigs portal view"],
  ["quality", "Quality review"],
  ["cases", "Cases"],
  ["reports", "Reports"],
  ["program", "Program flow"],
  ["administration", "Administration"],
  ["login", "Sign-in"],
  ["other", "Other"],
];
const categories: [string, string][] = [
  ["Bug", "Something does not work as it should"],
  ["Access", "I cannot open or reach something I need"],
  ["Error", "I see an error message"],
];
const severities: [string, string][] = [
  ["Blocking", "I cannot do my work"],
  ["Major", "I can work around it, but it slows me down"],
  ["Minor", "A small problem"],
];
const statusTone: Record<string, string> = { Open: "is-bad", "In progress": "is-warn", Resolved: "is-ok", "Not a bug": "is-info" };

const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

async function readJson(response: Response, failed: string) {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || value.error) throw new Error(value?.error || failed);
  return value;
}

export default function SupportPage() {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const when = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
  const [data, setData] = useState<Row | null>(null);
  const [loadError, setLoadError] = useState("");
  const [from, setFrom] = useState("other");
  const [form, setForm] = useState<Row>({ category: "", severity: "", action: "", happened: "", expected: "", occurred_at: localNow() });
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [statusFilter, setStatusFilter] = useState("Open");

  async function load() {
    setLoadError("");
    try {
      const response = await fetch("/api/support", { cache: "no-store" }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      setData(await readJson(response, t("Unable to load your reports.")));
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : t("Unable to load your reports."));
    }
  }
  useEffect(() => {
    const page = new URLSearchParams(window.location.search).get("from") || "";
    setFrom(pages.some(([key]) => key === page) ? page : "other");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preview = useMemo(() => (shot ? URL.createObjectURL(shot) : ""), [shot]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function takeScreenshot(file: File | null | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) return setError(t("The screenshot must be a PNG or JPEG image."));
    if (file.size > 8 * 1024 * 1024) return setError(t("Maximum screenshot size is 8 MB."));
    setError("");
    setShot(file);
  }

  const ready = form.category && form.severity && form.action.trim().length >= 5 && form.happened.trim().length >= 5;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      const page = pages.find(([key]) => key === from)?.[1] || "Other";
      for (const [key, value] of Object.entries({ ...form, page, url: from === "other" ? "" : "/" + (from === "home" ? "" : from) }))
        body.set(key, key === "occurred_at" && value ? new Date(String(value)).toISOString() : String(value ?? ""));
      if (shot) body.set("screenshot", shot);
      const response = await fetch("/api/support", { method: "POST", body }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      const value = await readJson(response, t("Unable to send the report. Try again."));
      setSent(value.id);
      setForm({ category: "", severity: "", action: "", happened: "", expected: "", occurred_at: localNow() });
      setShot(null);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to send the report. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const reports: Row[] = data?.reports || [];
  const mine = data?.admin ? reports.filter((r) => r.reporter === data?.me?.id) : reports;
  const queue = reports.filter((r) => statusFilter === "All" || r.status === statusFilter);

  return (
    <main className="support-shell" onPaste={(e) => takeScreenshot(Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/")))}>
      <header className="support-header">
        <a className="support-back" href={from === "home" || from === "other" || from === "login" ? "/" : "/" + from}>
          <ArrowLeft size={16} /> {t("Back to the workspace")}
        </a>
        <LanguageToggle />
      </header>

      <section className="panel support-card">
        <div className="panel-heading">
          <h1><AlertTriangle size={20} aria-hidden="true" /> {t("Report a technical problem")}</h1>
        </div>
        <p className="support-scope">
          {t("For bugs, access problems and error messages only. Questions about how to do your work go to your team leader, not this form.")}
        </p>

        {loadError && !data ? (
          <div className="form-error" role="alert">
            {loadError}{" "}
            {/sign in/i.test(loadError) ? <a href="/login">{t("Sign in")}</a> : <button className="small-btn" onClick={load}>{t("Try again")}</button>}
          </div>
        ) : !data ? (
          <p className="footnote"><RefreshCw className="spin" size={16} /> {t("Loading…")}</p>
        ) : sent ? (
          <div className="support-sent" role="status">
            <Check size={20} aria-hidden="true" />
            <div>
              <strong>{t("Thank you. Your report was sent.")}</strong>
              <p>{t("Reference {v0}. The system owner will look at it; you can follow its status below.", { v0: sent })}</p>
            </div>
            <button className="small-btn" onClick={() => setSent("")}>{t("Report another problem")}</button>
          </div>
        ) : (
          <form className="support-form" onSubmit={submit}>
            <p className="support-meta">
              {t("Sent as {v0} · {v1}. The page, the time and your browser are added for you.", { v0: data.me?.name || "—", v1: (data.me?.roles || []).map((r: string) => t(r)).join(", ") || "—" })}
            </p>
            <fieldset>
              <legend>{t("What kind of problem is it?")}</legend>
              <div className="support-choices">
                {categories.map(([value, label]) => (
                  <label key={value} className={"support-choice" + (form.category === value ? " is-on" : "")}>
                    <input type="radio" name="category" value={value} checked={form.category === value} onChange={() => setForm({ ...form, category: value })} />
                    {t(label)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              {t("Which page were you on?")}
              <SearchableSelect label={t("Which page were you on?")} value={from} onChange={setFrom} options={pages.map(([value, label]) => ({ value, label: t(label) }))} />
            </label>
            <label className="field">
              {t("What did you do?")}
              <textarea required minLength={5} maxLength={2000} rows={3} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder={t("For example: I opened Sessions, chose Week 3 and pressed Take attendance.")} />
            </label>
            <label className="field">
              {t("What happened?")}
              <textarea required minLength={5} maxLength={2000} rows={3} value={form.happened} onChange={(e) => setForm({ ...form, happened: e.target.value })} placeholder={t("For example: the window closed and the marks were not saved. Copy any error message word for word.")} />
            </label>
            <label className="field">
              {t("What did you expect instead? (optional)")}
              <textarea maxLength={2000} rows={2} value={form.expected} onChange={(e) => setForm({ ...form, expected: e.target.value })} />
            </label>
            <fieldset>
              <legend>{t("How much does it block your work?")}</legend>
              <div className="support-choices">
                {severities.map(([value, label]) => (
                  <label key={value} className={"support-choice" + (form.severity === value ? " is-on" : "")}>
                    <input type="radio" name="severity" value={value} checked={form.severity === value} onChange={() => setForm({ ...form, severity: value })} />
                    {t(label)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              {t("When did it happen?")}
              <input type="datetime-local" value={form.occurred_at} max={localNow()} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
            </label>
            <div className="field">
              {t("Screenshot (recommended)")}
              {shot ? (
                <div className="support-shot">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
                  <img src={preview} alt={t("Screenshot to send")} />
                  <button type="button" className="small-btn" onClick={() => setShot(null)}><X size={14} /> {t("Remove")}</button>
                </div>
              ) : (
                <label className="support-drop">
                  <ImagePlus size={18} aria-hidden="true" />
                  <span>{t("Choose a PNG or JPEG, or press Ctrl+V to paste one. Up to 8 MB.")}</span>
                  <input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { takeScreenshot(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              )}
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="detail-actions">
              <button type="submit" className="primary" disabled={!ready || busy}><Send size={16} /> {busy ? t("Sending…") : t("Send report")}</button>
            </div>
          </form>
        )}
      </section>

      {data && !data.demo && (
        <section className="panel support-card">
          <div className="panel-heading"><h2>{t("Your reports")}</h2></div>
          {!mine.length ? (
            <p className="footnote">{t("You have not reported any problem yet.")}</p>
          ) : (
            <ul className="support-list">
              {mine.map((r) => (
                <li key={r.id}>
                  <span>
                    <strong>{t(r.page)}</strong> · {t(r.category)} · {when(r.created_at)}
                    {r.resolution ? <small>{r.resolution}</small> : null}
                  </span>
                  <span className={"cue " + (statusTone[r.status] || "is-info")}>{t(r.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data?.admin && <ReportQueue reports={queue} all={reports} filter={statusFilter} onFilter={setStatusFilter} onSaved={load} when={when} />}
    </main>
  );
}

/** The system owner's view: every report, newest first, to work to Resolved. */
function ReportQueue({ reports, all, filter, onFilter, onSaved, when }: { reports: Row[]; all: Row[]; filter: string; onFilter: (v: string) => void; onSaved: () => void; when: (iso?: string) => string }) {
  const t = useT();
  const count = (status: string) => all.filter((r) => r.status === status).length;
  return (
    <section className="panel support-card">
      <div className="panel-heading">
        <h2>{t("All reports")}</h2>
        <span className="support-counts">
          {["Open", "In progress", "Resolved", "Not a bug", "All"].map((status) => (
            <button key={status} type="button" className={"small-btn" + (filter === status ? " is-active" : "")} onClick={() => onFilter(status)}>
              {t(status)} {status === "All" ? all.length : count(status)}
            </button>
          ))}
        </span>
      </div>
      {!reports.length ? (
        <p className="footnote">{t("Nothing here.")}</p>
      ) : (
        reports.map((r) => <ReportItem key={r.id} report={r} onSaved={onSaved} when={when} />)
      )}
    </section>
  );
}

function ReportItem({ report, onSaved, when }: { report: Row; onSaved: () => void; when: (iso?: string) => string }) {
  const t = useT();
  const [status, setStatus] = useState(report.status);
  const [resolution, setResolution] = useState(report.resolution || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: report.id, status, resolution }),
      }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      await readJson(response, t("Unable to save. Try again."));
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to save. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="support-item">
      <summary>
        <span className={"cue " + (report.severity === "Blocking" ? "is-bad" : report.severity === "Major" ? "is-warn" : "is-info")}>{t(report.severity)}</span>
        <span className="support-item-title">
          <strong>{t(report.page)} · {t(report.category)}</strong>
          <small>{report.reporter_name || report.reporter} · {when(report.created_at)}</small>
        </span>
        <span className={"cue " + (statusTone[report.status] || "is-info")}>{t(report.status)}</span>
      </summary>
      <dl className="support-detail">
        <dt>{t("Reported by")}</dt><dd>{report.reporter_name || report.reporter} · {report.reporter_roles}</dd>
        <dt>{t("When it happened")}</dt><dd>{when(report.occurred_at)}</dd>
        <dt>{t("What did you do?")}</dt><dd>{report.action}</dd>
        <dt>{t("What happened?")}</dt><dd>{report.happened}</dd>
        {report.expected ? <><dt>{t("What did you expect instead? (optional)")}</dt><dd>{report.expected}</dd></> : null}
        {report.url ? <><dt>{t("Page address")}</dt><dd>{report.url}</dd></> : null}
        {report.browser ? <><dt>{t("Browser")}</dt><dd><small>{report.browser}</small></dd></> : null}
        {report.has_screenshot ? (
          <>
            <dt>{t("Screenshot")}</dt>
            <dd><a className="text-link" href={"/api/support?screenshot=" + encodeURIComponent(report.id)} target="_blank" rel="noopener noreferrer">{t("Open the screenshot")}</a></dd>
          </>
        ) : null}
        {report.handled_at ? <><dt>{t("Last updated")}</dt><dd>{report.handled_by_name || report.handled_by} · {when(report.handled_at)}</dd></> : null}
      </dl>
      <div className="support-update">
        <label className="field">
          {t("Status")}
          <SearchableSelect label={t("Status")} value={status} onChange={setStatus} options={["Open", "In progress", "Resolved", "Not a bug"].map((s) => ({ value: s, label: t(s) }))} />
        </label>
        <label className="field">
          {t("What was done")}
          <textarea rows={2} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button type="button" className="primary small" disabled={busy || (status === report.status && resolution === (report.resolution || ""))} onClick={save}>
          {busy ? t("Saving…") : t("Save")}
        </button>
      </div>
    </details>
  );
}
