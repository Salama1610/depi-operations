"use client";

// Problem reports (see app/api/quality-reports): the quality team reports a
// problem about a group to Coach Operations, Project Operations or both; the
// people it goes to are notified, read it here and mark it handled with a note.

import { useEffect, useMemo, useState } from "react";
import { Check, RefreshCw, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";

type Row = Record<string, any>;
const audienceLabel: Record<string, string> = {
  "Coach Operations": "Coach Operations",
  "Project Operations": "Project Operations",
  Both: "Coach Operations and Project Operations",
};

function HandleForm({ r, busy, send }: { r: Row; busy: boolean; send: (v: Row) => Promise<boolean> }) {
  const t = useT();
  const [note, setNote] = useState("");
  return (
    <div className="qr-handle">
      <input value={note} maxLength={1000} placeholder={t("What was done (optional)")} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className="small-btn" disabled={busy} onClick={() => send({ action: "handle", id: r.id, status: "Handled", note })}>
        <Check size={14} /> {t("Mark handled")}
      </button>
    </div>
  );
}

export function QualityReports() {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Row>({ group_id: "", audience: "Coach Operations", description: "" });
  const [filter, setFilter] = useState<Row>({ status: "Open", audience: "All", q: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/quality-reports", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      setData(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(values: Row) {
    setBusy(true);
    try {
      const res = await fetch("/api/quality-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error(body?.error || t("Request failed"));
      toast.success(values.action === "report" ? t("Report sent to {v0} people", { v0: body.notified }) : t("Saved to the activity history"));
      await load();
      return true;
    } catch (e: any) {
      toast.error(t(e.message));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const reports: Row[] = data?.reports || [];
  const shown = useMemo(() => {
    const needle = String(filter.q || "").trim().toLowerCase();
    return reports.filter(
      (r) =>
        (filter.status === "All" || r.status === filter.status) &&
        (filter.audience === "All" || r.audience === filter.audience) &&
        (!needle || [r.group_id, r.description, r.created_by_name, r.coordinator_name, r.coach_name].some((v) => String(v || "").toLowerCase().includes(needle))),
    );
  }, [reports, filter]);

  if (error) return <section className="panel"><p role="alert">{t(error)}</p><button className="small-btn" onClick={load}>{t("Try again")}</button></section>;
  if (!data) return <div className="dash-loading">{t("Loading…")}</div>;
  const open = reports.filter((r) => r.status === "Open").length;

  return (
    <div className="fr qr">
      <div className="fr-head">
        <div>
          <h2>{t("Problem reports")}</h2>
          <small>
            {data.reports_problems
              ? t("Report a problem in a group to Coach Operations, Project Operations or both. They are notified and mark it handled here.")
              : t("Problems the quality team found in groups, sent to you. Mark each one handled once it is dealt with.")}
          </small>
        </div>
        <div className="detail-actions">
          <button type="button" className="small-btn" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} /> {t("Refresh")}
          </button>
        </div>
      </div>

      {data.reports_problems && (
        <form
          className="fr-panel qr-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send({ action: "report", ...form })) setForm({ group_id: "", audience: form.audience, description: "" });
          }}
        >
          <h3>{t("Report a problem")}</h3>
          <div className="qr-form-row">
            <SearchableSelect
              label={t("Group code")}
              value={form.group_id}
              placeholder={t("Choose the group")}
              onChange={(v) => setForm({ ...form, group_id: v || "" })}
              options={(data.groups || []).map((g: Row) => ({ value: g.id, label: [g.id, g.track, g.provider].filter(Boolean).join(" · ") }))}
            />
            <SearchableSelect
              label={t("Send to")}
              value={form.audience}
              onChange={(v) => setForm({ ...form, audience: v || "Coach Operations" })}
              options={Object.keys(audienceLabel).map((v) => ({ value: v, label: t(audienceLabel[v]) }))}
            />
          </div>
          <textarea
            rows={3}
            maxLength={2000}
            required
            placeholder={t("Describe the problem")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="qr-actions">
            <button type="submit" className="primary small" disabled={busy || !form.group_id || form.description.trim().length < 5}>
              <Send size={14} /> {t("Send report")}
            </button>
          </div>
        </form>
      )}

      <div className="fr-kpis fr-kpis-top">
        <div className={open ? "is-bad" : ""}><span>{t("Open")}</span><strong><bdi dir="ltr">{open}</bdi></strong></div>
        <div><span>{t("Handled")}</span><strong><bdi dir="ltr">{reports.length - open}</bdi></strong></div>
        <div><span>{t("Groups reported")}</span><strong><bdi dir="ltr">{new Set(reports.map((r) => r.group_id)).size}</bdi></strong></div>
      </div>

      <div className="fr-filters">
        <input className="fr-search" type="search" placeholder={t("Search group, problem or person")} value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <SearchableSelect
          label={t("Status")}
          value={filter.status}
          onChange={(v) => setFilter({ ...filter, status: v || "All" })}
          options={[{ value: "Open", label: t("Open") }, { value: "Handled", label: t("Handled") }, { value: "All", label: t("All") }]}
        />
        <SearchableSelect
          label={t("Sent to")}
          value={filter.audience}
          onChange={(v) => setFilter({ ...filter, audience: v || "All" })}
          options={[{ value: "All", label: t("Anyone") }, ...Object.keys(audienceLabel).map((v) => ({ value: v, label: t(audienceLabel[v]) }))]}
        />
      </div>

      {!shown.length ? (
        <section className="panel"><p className="footnote">{filter.status === "Open" ? t("No open problem reports.") : t("No report matches these filters.")}</p></section>
      ) : (
        <div className="qr-list">
          {shown.map((r) => (
            <article key={r.id} className={"fr-panel qr-item" + (r.status === "Open" ? " is-open" : "")}>
              <header>
                <div>
                  <strong><bdi>{r.group_id}</bdi></strong>
                  <small className="table-subline">{[r.track, r.provider, r.coordinator_name && t("Coordinator: {v0}", { v0: r.coordinator_name }), r.coach_name && !/unassigned/i.test(r.coach_name) && t("Coach: {v0}", { v0: r.coach_name })].filter(Boolean).join(" · ")}</small>
                </div>
                <span className={"cue " + (r.status === "Open" ? "is-warn" : "is-ok")}>{t(r.status)}</span>
              </header>
              <p className="wrap-text qr-text">{r.description}</p>
              <small className="qr-meta">
                {t("By {v0}, {v1} · sent to {v2}", { v0: r.created_by_name || "—", v1: when(r.created_at), v2: t(audienceLabel[r.audience] || r.audience) })}
              </small>
              {r.status === "Handled" ? (
                <div className="qr-done">
                  <Check size={14} /> {t("Handled by {v0}, {v1}", { v0: r.handled_by_name || "—", v1: r.handled_at ? when(r.handled_at) : "" })}
                  {r.handled_note && <span className="wrap-text">: {r.handled_note}</span>}
                  {r.can_handle && (
                    <button type="button" className="student-link-btn" disabled={busy} onClick={() => send({ action: "handle", id: r.id, status: "Open" })}>
                      <RotateCcw size={12} /> {t("Open again")}
                    </button>
                  )}
                </div>
              ) : r.can_handle ? (
                <HandleForm r={r} busy={busy} send={send} />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
