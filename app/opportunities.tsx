"use client";

// Work opportunities the Service Team's coordinators find on the freelance
// platforms (see app/api/opportunities). The staff tab lists every post and,
// for those coordinators, takes new ones; a student's page shows the active
// posts for their own track.

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, RefreshCw } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";

type Row = Record<string, any>;

/** Where the jobs are found. "Other" lets a coordinator name a site not listed. */
const platforms = ["Khamsat", "Mostaql", "Kafeel", "Nafezly", "Upwork", "Fiverr", "Freelancer", "Freelance Yard", "LinkedIn", "Other"];

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function readJson(response: Response, failed: string) {
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || value.error) throw new Error(value?.error || failed);
  return value;
}

function useDay() {
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  // A posting date is a calendar day: read it as noon UTC so no time zone moves it.
  return (value?: string) =>
    value ? new Date(String(value).slice(0, 10) + "T12:00:00Z").toLocaleDateString(tag, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—";
}

function useOpportunities(failed: string, offline: string) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/opportunities", { cache: "no-store" }).catch(() => {
        throw new Error(offline);
      });
      setData(await readJson(response, failed));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : failed);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, error, load };
}

/** The Opportunities tab in the staff workspace. */
export function Opportunities() {
  const t = useT();
  const day = useDay();
  const { data, error, load } = useOpportunities(t("Unable to load the opportunities."), t("Check your connection and try again."));
  const [filters, setFilters] = useState({ track: "All", platform: "All" });
  const [form, setForm] = useState({ url: "", title: "", track: "", platform: "", other: "", posted_on: today() });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);

  const rows: Row[] = useMemo(() => data?.opportunities || [], [data]);
  const tracks: string[] = data?.tracks || [];
  const shown = rows.filter((r) => (filters.track === "All" || r.track === filters.track) && (filters.platform === "All" || r.platform === filters.platform));
  const platform = form.platform === "Other" ? form.other.trim() : form.platform;
  const ready = form.url.trim() && form.title.trim().length >= 3 && form.track && platform.length >= 2 && form.posted_on;

  async function send(body: Row) {
    const response = await fetch("/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {
      throw new Error(t("Check your connection and try again."));
    });
    return readJson(response, t("Unable to save. Try again."));
  }
  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setFormError("");
    setSaved(false);
    try {
      await send({ action: "post", url: form.url.trim(), title: form.title.trim(), track: form.track, platform, posted_on: form.posted_on });
      setForm({ url: "", title: "", track: form.track, platform: form.platform, other: form.other, posted_on: today() });
      setSaved(true);
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : t("Unable to save. Try again."));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setFormError("");
    try {
      await send({ action: "remove", id });
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : t("Unable to save. Try again."));
    }
  }

  if (!data && !error) return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading the opportunities…")}</div>;
  if (error && !data)
    return (
      <div className="error-panel" role="alert">
        <p>{t(error)}</p>
        <button className="primary" onClick={load}>{t("Try again")}</button>
      </div>
    );

  return (
    <div className="opportunities">
      <p className="footnote">{t("Jobs the Service Team's coordinators found on the platforms. Each one shows to the students of its track on their own page.")}</p>

      {data?.posts && (
        <section className="panel">
          <div className="panel-heading"><h2>{t("Post an opportunity")}</h2></div>
          <form className="opportunity-form" onSubmit={post}>
            <label className="field opportunity-wide">
              {t("Job link")}
              <input type="url" required maxLength={2000} dir="ltr" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
            </label>
            <label className="field opportunity-wide">
              {t("What is the job?")}
              <input required minLength={3} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("For example: logo design for a coffee shop")} />
            </label>
            <label className="field">
              {t("Track")}
              <SearchableSelect required label={t("Track")} placeholder={t("Choose…")} value={form.track} onChange={(track) => setForm({ ...form, track })} options={tracks.map((track) => ({ value: track, label: t(track) }))} />
            </label>
            <label className="field">
              {t("Platform")}
              <SearchableSelect required label={t("Platform")} placeholder={t("Choose…")} value={form.platform} onChange={(value) => setForm({ ...form, platform: value })} options={platforms.map((p) => ({ value: p, label: t(p) }))} />
            </label>
            {form.platform === "Other" && (
              <label className="field">
                {t("Platform name")}
                <input required minLength={2} maxLength={60} value={form.other} onChange={(e) => setForm({ ...form, other: e.target.value })} />
              </label>
            )}
            <label className="field">
              {t("Date the job was posted")}
              <input type="date" required max={today()} value={form.posted_on} onChange={(e) => setForm({ ...form, posted_on: e.target.value })} />
            </label>
            {formError && <div className="form-error opportunity-wide" role="alert">{t(formError)}</div>}
            {saved && <div className="info-box opportunity-wide" role="status">{t("Posted. The students of this track can see it now.")}</div>}
            <div className="detail-actions opportunity-wide">
              <button type="submit" className="primary" disabled={!ready || busy}><Plus size={16} /> {busy ? t("Saving…") : t("Post opportunity")}</button>
            </div>
          </form>
        </section>
      )}
      {!data?.posts && formError && <div className="form-error" role="alert">{t(formError)}</div>}

      <div className="filter-row">
        <label className="field">
          {t("Track")}
          <SearchableSelect label={t("Track")} value={filters.track} onChange={(track) => setFilters({ ...filters, track })} options={[{ value: "All", label: t("Every track") }, ...tracks.map((track) => ({ value: track, label: t(track) }))]} />
        </label>
        <label className="field">
          {t("Platform")}
          <SearchableSelect label={t("Platform")} value={filters.platform} onChange={(value) => setFilters({ ...filters, platform: value })} options={[{ value: "All", label: t("Every platform") }, ...[...new Set(rows.map((r) => r.platform))].sort().map((p) => ({ value: p, label: t(p) }))]} />
        </label>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>{t("Opportunities")}</h2>
          <span className="count">{shown.length}</span>
        </div>
        {!shown.length ? (
          <p className="footnote">{rows.length ? t("No opportunity matches these filters.") : t("No opportunities posted yet.")}</p>
        ) : (
          <ul className="opportunity-list">
            {shown.map((r) => (
              <li key={r.id}>
                <div className="opportunity-main">
                  <a href={r.url} target="_blank" rel="noopener noreferrer"><bdi>{r.title}</bdi> <ExternalLink size={14} aria-hidden="true" /></a>
                  <small>
                    <bdi>{t(r.platform)}</bdi> · <bdi>{t(r.track)}</bdi> · {t("Posted {v0}", { v0: day(r.posted_on) })} · <bdi>{r.created_by_name || r.created_by}</bdi>
                  </small>
                </div>
                {(data?.leads || r.created_by === data?.me) && (
                  <button type="button" className="small-btn" onClick={() => remove(r.id)}>{t("Remove")}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** On the student's page: the jobs shared with their track. Hidden while there are none. */
export function StudentOpportunities() {
  const t = useT();
  const day = useDay();
  const { data } = useOpportunities("", "");
  const rows: Row[] = data?.opportunities || [];
  if (!rows.length) return null;
  return (
    <section className="student-card" aria-labelledby="opportunities-title">
      <div className="student-card-heading">
        <div>
          <h2 id="opportunities-title">{t("Jobs to apply for")}</h2>
          <p>{t("Your coordinators found these for your track. Open one and apply on the platform.")}</p>
        </div>
        <span className="student-status pending">{rows.length}</span>
      </div>
      <ul className="opportunity-list">
        {rows.map((r) => (
          <li key={r.id}>
            <div className="opportunity-main">
              <a href={r.url} target="_blank" rel="noopener noreferrer"><bdi>{r.title}</bdi> <ExternalLink size={14} aria-hidden="true" /></a>
              <small><bdi>{t(r.platform)}</bdi> · {t("Posted {v0}", { v0: day(r.posted_on) })}</small>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
