"use client";

// The Gigs portal view: the DEPI portal's students and gigs sheets, the
// cohort's official record. Leaders upload both, several times a day; each
// upload replaces the last. Everyone who opens the view sees the cohort as the
// portal has it, linked to our students, with each student's gigs a click
// away. Coordinators see their own linked students.

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FileUp, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { readSheet } from "@/lib/spreadsheet";
import { guessPortalMapping, mappingProblems, type PortalSheet } from "@/lib/domain/portal-sheets";

type Row = Record<string, any>;
type Draft = { sheet: PortalSheet; fileName: string; headers: string[]; rows: Row[]; mapping: Record<string, string> };

const CHUNK = 800;

async function call(body: Row) {
  const r = await fetch("/api/portal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const v = await r.json();
  if (!r.ok || v.error) throw new Error(v.error || "The upload failed.");
  return v;
}

export function PortalView({ staffName }: { staffName: (id: string) => string }) {
  const t = useT();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ final: "All", type: "All", link: "All", provider: "All" });
  const [open, setOpen] = useState<string | null>(null);
  const [gigs, setGigs] = useState<Record<string, Row[]>>({});
  const [shown, setShown] = useState(100);

  async function load() {
    setError("");
    try {
      const r = await fetch("/api/portal", { cache: "no-store" });
      const v = await r.json();
      if (!r.ok || v.error) throw new Error(v.error || t("Unable to load the portal sheets."));
      setData(v);
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(sheet: PortalSheet, file: File | undefined) {
    if (!file) return;
    setNotice("");
    setError("");
    try {
      const rows = (await readSheet(file)) as Row[];
      if (!rows.length) throw new Error(t("The sheet has no rows."));
      const headers = Object.keys(rows[0]);
      const saved: Record<string, string> | null = data?.mappings?.[sheet] || null;
      const mapping =
        saved && Object.keys(saved).some((h) => headers.includes(h))
          ? Object.fromEntries(Object.entries(saved).filter(([h]) => headers.includes(h)))
          : guessPortalMapping(sheet, headers);
      setDraft({ sheet, fileName: file.name, headers, rows, mapping });
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function upload() {
    if (!draft) return;
    const pairs = Object.entries(draft.mapping).filter(([, f]) => f);
    const mapped = draft.rows.map((row) => Object.fromEntries(pairs.map(([h, f]) => [f, row[h] ?? ""])));
    setProgress({ sent: 0, total: mapped.length });
    setError("");
    let batch = "";
    try {
      batch = (await call({ action: "begin", sheet: draft.sheet, mapping: draft.mapping, total: mapped.length, file_name: draft.fileName })).batch;
      for (let i = 0; i < mapped.length; i += CHUNK) {
        await call({ action: "chunk", batch, rows: mapped.slice(i, i + CHUNK) });
        setProgress({ sent: Math.min(i + CHUNK, mapped.length), total: mapped.length });
      }
      const done = await call({ action: "commit", batch });
      setNotice(
        draft.sheet === "students"
          ? t("Students sheet updated: {v0} students, {v1} linked to our records.", { v0: done.rows, v1: done.linked })
          : t("Gigs sheet updated: {v0} gigs, {v1} belong to students in the students sheet.", { v0: done.rows, v1: done.linked }),
      );
      setDraft(null);
      setGigs({});
      await load();
    } catch (e: any) {
      setError(e.message);
      if (batch) call({ action: "cancel", batch }).catch(() => {});
    } finally {
      setProgress(null);
    }
  }

  const counts = useMemo(() => new Map<string, Row>((data?.gigCounts || []).map((g: Row) => [g.portal_student_id, g])), [data]);
  const students: Row[] = data?.students || [];
  const options = (key: string) => ["All", ...Array.from(new Set(students.map((s) => s[key]).filter(Boolean))).sort()];
  const rows = students
    .filter((s) => !query || JSON.stringify([s.full_name, s.email, s.phone, s.round_code, s.app_name]).toLowerCase().includes(query.toLowerCase()))
    .filter((s) => filters.final === "All" || s.final_status === filters.final)
    .filter((s) => filters.type === "All" || s.graduate_type === filters.type)
    .filter((s) => filters.provider === "All" || s.provider === filters.provider)
    .filter((s) => filters.link === "All" || (filters.link === "Linked" ? !!s.student_id : !s.student_id));
  const gigTotals = (data?.gigCounts || []).reduce(
    (n: Row, g: Row) => ({ total: n.total + Number(g.total), approved: n.approved + Number(g.approved), rejected: n.rejected + Number(g.rejected), pending: n.pending + Number(g.audit_pending) }),
    { total: 0, approved: 0, rejected: 0, pending: 0 },
  );

  async function toggle(portalId: string) {
    if (open === portalId) return setOpen(null);
    setOpen(portalId);
    if (!gigs[portalId]) {
      const r = await fetch("/api/portal?student=" + encodeURIComponent(portalId), { cache: "no-store" });
      const v = await r.json();
      setGigs((current) => ({ ...current, [portalId]: v.gigs || [] }));
    }
  }

  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const problems = draft ? mappingProblems(draft.sheet, draft.mapping) : [];

  if (!data && !error) return <div className="panel"><RefreshCw className="spin" size={18} /> {t("Loading the portal sheets…")}</div>;
  return (
    <div className="portal-view">
      <p className="portal-lede">
        {t("The DEPI portal's students and gigs sheets are the cohort's official record. Services coordinators record in this app are internal validation.")}
      </p>
      {data?.canUpload && (
        <div className="portal-uploads">
          {(["students", "gigs"] as PortalSheet[]).map((sheet) => {
            const active = data.active?.[sheet];
            return (
              <div className="portal-upload-card" key={sheet}>
                <div>
                  <strong>{sheet === "students" ? t("Students sheet") : t("Gigs sheet")}</strong>
                  <small>
                    {active
                      ? t("{v0} rows · uploaded {v1} by {v2}", { v0: active.rows_total, v1: when(active.committed_at), v2: staffName(active.uploaded_by) })
                      : t("Not uploaded yet")}
                  </small>
                </div>
                <label className="small-btn portal-file">
                  <FileUp size={15} /> {active ? t("Upload a new version") : t("Upload")}
                  <input type="file" accept=".xlsx,.csv" hidden disabled={!!progress} onChange={(e) => { choose(sheet, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              </div>
            );
          })}
        </div>
      )}
      {draft && (
        <div className="panel portal-mapping">
          <div className="portal-mapping-head">
            <strong>{draft.sheet === "students" ? t("Students sheet") : t("Gigs sheet")}: {draft.fileName}</strong>
            <small>{t("{v0} rows. Check which column fills each field; this is remembered for the next upload.", { v0: draft.rows.length })}</small>
          </div>
          <table className="portal-mapping-table">
            <thead>
              <tr><th>{t("Column in the sheet")}</th><th>{t("Example")}</th><th>{t("Field")}</th></tr>
            </thead>
            <tbody>
              {draft.headers.map((h) => (
                <tr key={h}>
                  <td>{h}</td>
                  <td><small>{String(draft.rows.find((r) => String(r[h] ?? "").trim())?.[h] ?? "—").slice(0, 60)}</small></td>
                  <td>
                    <select
                      className="pick-inline"
                      value={draft.mapping[h] || ""}
                      onChange={(e) => {
                        const next = { ...draft.mapping };
                        for (const [k, v] of Object.entries(next)) if (v === e.target.value && k !== h) delete next[k];
                        if (e.target.value) next[h] = e.target.value;
                        else delete next[h];
                        setDraft({ ...draft, mapping: next });
                      }}
                    >
                      <option value="">{t("Ignore this column")}</option>
                      {(data?.fields?.[draft.sheet] || []).map((f: Row) => (
                        <option key={f.field} value={f.field}>{t(f.label)}{f.required ? " *" : ""}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {problems.length > 0 && <div className="form-error">{t("Map these columns first: {v0}.", { v0: problems.map((p) => t(p)).join(", ") })}</div>}
          {progress && (
            <div className="portal-progress">
              <div className="student-progress-bar"><span style={{ width: `${(100 * progress.sent) / progress.total}%` }} /></div>
              <small>{t("{v0} of {v1} rows sent", { v0: progress.sent, v1: progress.total })}</small>
            </div>
          )}
          <div className="detail-actions">
            <button className="small-btn" disabled={!!progress} onClick={() => setDraft(null)}>{t("Cancel")}</button>
            <button className="primary small" disabled={!!progress || problems.length > 0} onClick={upload}>
              {progress ? t("Uploading…") : t("Replace the {v0} with this file", { v0: draft.sheet === "students" ? t("students sheet") : t("gigs sheet") })}
            </button>
          </div>
        </div>
      )}
      {notice && <div className="info-box portal-notice">{notice}</div>}
      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="mini-stats">
        <span><strong>{students.length}</strong>{t("Students in the portal")}</span>
        <span><strong>{students.filter((s) => s.student_id).length}</strong>{t("Linked to our students")}</span>
        <span><strong>{students.filter((s) => s.final_status === "Graduated").length}</strong>{t("Graduated")}</span>
        <span><strong>{gigTotals.approved}/{gigTotals.total}</strong>{t("Gigs approved")}</span>
        <span><strong>{gigTotals.pending}</strong>{t("Awaiting the auditor")}</span>
      </div>
      <div className="filter-row">
        <input className="portal-search" placeholder={t("Search name, email, phone or round")} value={query} onChange={(e) => { setQuery(e.target.value); setShown(100); }} />
        {[
          ["final", "Final status", "final_status"],
          ["type", "Graduate type", "graduate_type"],
          ["provider", "Provider", "provider"],
        ].map(([key, label, column]) => (
          <label className="portal-filter" key={key}>
            <small>{t(label)}</small>
            <select className="pick-inline" value={(filters as Row)[key]} onChange={(e) => { setFilters({ ...filters, [key]: e.target.value }); setShown(100); }}>
              {options(column).map((o) => <option key={o} value={o}>{o === "All" ? t("All") : o}</option>)}
            </select>
          </label>
        ))}
        <label className="portal-filter">
          <small>{t("Our record")}</small>
          <select className="pick-inline" value={filters.link} onChange={(e) => { setFilters({ ...filters, link: e.target.value }); setShown(100); }}>
            <option value="All">{t("All")}</option>
            <option value="Linked">{t("Linked")}</option>
            <option value="Unlinked">{t("Not linked")}</option>
          </select>
        </label>
      </div>
      <div className="panel">
        <h3>{t("Cohort in the portal · {v0} students", { v0: rows.length })}</h3>
        {!students.length ? (
          <p className="footnote">{data?.canUpload ? t("Upload the students sheet and the gigs sheet to see the cohort.") : t("The leaders have not uploaded the portal sheets yet.")}</p>
        ) : (
          <div className="table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>{t("Student")}</th><th>{t("Round")}</th><th>{t("Final status")}</th><th>{t("Graduate type")}</th>
                  <th>{t("Gigs")}</th><th>{t("Revenue")}</th><th>{t("Our record")}</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((s) => {
                  const c = counts.get(s.portal_id);
                  return (
                    <PortalRow key={s.portal_id} s={s} c={c} open={open === s.portal_id} gigs={gigs[s.portal_id]} onToggle={() => toggle(s.portal_id)} />
                  );
                })}
              </tbody>
            </table>
            {rows.length > shown && (
              <button className="small-btn portal-more" onClick={() => setShown(shown + 200)}>{t("Show more ({v0} left)", { v0: rows.length - shown })}</button>
            )}
          </div>
        )}
      </div>
      {data?.history?.length > 0 && (
        <details className="panel portal-history">
          <summary>{t("Upload history")}</summary>
          <table className="portal-table">
            <tbody>
              {data!.history.map((h: Row) => (
                <tr key={h.id}>
                  <td>{h.sheet === "students" ? t("Students sheet") : t("Gigs sheet")}</td>
                  <td>{t(h.status)}</td>
                  <td>{h.file_name}</td>
                  <td>{t("{v0} rows", { v0: h.rows_total })}</td>
                  <td>{staffName(h.uploaded_by)}</td>
                  <td>{when(h.committed_at || h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function PortalRow({ s, c, open, gigs, onToggle }: { s: Row; c?: Row; open: boolean; gigs?: Row[]; onToggle: () => void }) {
  const t = useT();
  const tone = (v?: string) => (/Graduat|Approved/.test(v || "") ? "green" : /Reject|Not/.test(v || "") ? "red" : /Pending|Started/.test(v || "") ? "amber" : "neutral");
  return (
    <>
      <tr className={open ? "is-open" : ""}>
        <td><strong>{s.full_name}</strong><small className="table-subline">{s.email || s.phone}</small></td>
        <td>{s.round_code}<small className="table-subline">{s.provider}</small></td>
        <td><span className={"badge " + tone(s.final_status)}>{s.final_status || "—"}</span></td>
        <td>{s.graduate_type || "—"}</td>
        <td>
          {c ? `${c.approved}/${c.total}` : `${s.approved_gigs ?? 0}/${s.total_gigs ?? 0}`}
          {c && Number(c.audit_pending) > 0 && <small className="table-subline">{t("{v0} awaiting the auditor", { v0: c.audit_pending })}</small>}
        </td>
        <td>{s.total_revenue != null ? "$" + Number(s.total_revenue).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</td>
        <td>
          {s.student_id ? (
            <span>{s.app_name}<small className="table-subline">{s.group_id} · {s.coordinator_name}</small></span>
          ) : (
            <small>{t("Not linked")}</small>
          )}
        </td>
        <td><button className="small-btn" onClick={onToggle}>{open ? t("Hide gigs") : t("Gigs")}</button></td>
      </tr>
      {open && (
        <tr className="portal-gigs-row">
          <td colSpan={8}>
            {!gigs ? (
              <small>{t("Loading…")}</small>
            ) : !gigs.length ? (
              <small>{t("No gigs for this student in the gigs sheet.")}</small>
            ) : (
              <table className="portal-gigs">
                <thead>
                  <tr><th>{t("Gig")}</th><th>{t("Platform")}</th><th>{t("Price")}</th><th>{t("Status")}</th><th>{t("Auditor")}</th><th>{t("Comment")}</th><th /></tr>
                </thead>
                <tbody>
                  {gigs.map((g) => (
                    <tr key={g.id}>
                      <td><strong>{g.title}</strong><small className="table-subline">{g.category} · {g.created_on ? new Date(g.created_on).toLocaleDateString("en-GB") : ""}</small></td>
                      <td>{g.organization}</td>
                      <td>{g.price != null ? "$" + g.price : "—"}</td>
                      <td><span className={"badge " + tone(g.status)}>{g.status}</span></td>
                      <td><span className={"badge " + tone(g.auditor_status)}>{g.auditor_status}</span><small className="table-subline">{g.action_by}</small></td>
                      <td><small>{g.comment}</small></td>
                      <td>
                        {g.url && <a className="text-link" href={g.url} target="_blank" rel="noreferrer">{t("Gig")} <ExternalLink size={12} /></a>}
                        {g.proof_url && <a className="text-link" href={g.proof_url} target="_blank" rel="noreferrer"> {t("Proof")} <ExternalLink size={12} /></a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
