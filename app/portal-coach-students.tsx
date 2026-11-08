"use client";

// Each coach's students by where they stand on the ministry portal, for Coach
// Operations and the administrators (see lib/domain/portal-coach-students),
// and the coaches ranked from the furthest behind, as a workbook to download.

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { toWorkbook } from "@/lib/spreadsheet";
import { slowAfterDays } from "@/lib/domain/portal-coach-students";

type Row = Record<string, any>;

export function PortalCoachStudents() {
  const t = useT();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/portal-coach-students", { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => null);
        if (!r.ok || !v || v.error) throw new Error(v?.error || "Unable to load the coaches' students.");
        setData(v);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="panel portal-gap"><small role="alert">{t(error)}</small></div>;
  if (data && !data.sheet) return null;

  const coachName = (c: Row) => c.coach_name || c.coach_id || t("No coach");
  const q = query.trim().toLowerCase();
  const coaches: Row[] = (data?.coaches || []).filter((c: Row) => !q || String(coachName(c)).toLowerCase().includes(q));
  const ranking: Row[] = (data?.ranking || []).filter((c: Row) => !q || String(coachName(c)).toLowerCase().includes(q));
  // Every coach in the workbook, whatever the search.
  function download() {
    const file = toWorkbook([
      {
        name: "Coach ranking",
        rows: (data?.ranking || []).map((c: Row) => ({
          Rank: c.rank,
          Coach: coachName(c),
          Groups: c.groups,
          "Assigned students": c.assigned,
          Started: c.started,
          Graduated: c.graduated,
          "Not started": c.not_started,
          "Not on the portal": c.no_status,
          "Not started or not on the portal": c.not_moving,
          "Share of students (%)": c.not_moving_pct,
          "Gigs waiting for the coach": c.waiting,
          [`Waiting over ${slowAfterDays} days`]: c.slow,
          "Longest wait (days)": c.oldest_days ?? "",
        })),
      },
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([file as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `coach-ranking-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  }
  const counts = (c: Row) =>
    [c.assigned, c.started, c.not_started, c.graduated, c.no_status].map((n, i) => (
      <td key={i}><bdi dir="ltr">{n}</bdi></td>
    ));

  return (
    <details className="panel portal-gap">
      <summary>
        {data
          ? t("Coaches' students: {v0} assigned, {v1} started, {v2} not started, {v3} graduated", { v0: data.total.assigned, v1: data.total.started, v2: data.total.not_started, v3: data.total.graduated })
          : t("Coaches' students")}
      </summary>
      {!data ? (
        <small>{t("Loading…")}</small>
      ) : (
        <>
          <small className="footnote">
            {t("From the latest students sheet: each student is counted once, by the portal's Final Status, under the coach of their group in our system (not the portal's coach). No portal status: not on the sheet yet, or the sheet gives no status.")}
          </small>
          <div className="portal-gap-tools">
            <label className="field">
              {t("Coach")}
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by coach")} />
            </label>
          </div>
          <div className="table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>{t("Coach")}</th>
                  <th>{t("Groups")}</th>
                  <th>{t("Assigned students")}</th>
                  <th>{t("Started")}</th>
                  <th>{t("Not started")}</th>
                  <th>{t("Graduated")}</th>
                  <th>{t("No portal status")}</th>
                </tr>
              </thead>
              <tbody>
                {coaches.map((c) => (
                  <tr key={c.coach_id || "none"}>
                    <td><strong>{coachName(c)}</strong></td>
                    <td><bdi dir="ltr">{c.groups}</bdi></td>
                    {counts(c)}
                  </tr>
                ))}
                {!coaches.length && (
                  <tr>
                    <td colSpan={7}>{t("Nothing in this list.")}</td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t("Total")}</th>
                  <td />
                  {counts(data.total)}
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="portal-gap-tools">
            <h3>{t("Coaches ranked, furthest behind first")}</h3>
            <button type="button" className="small-btn" onClick={download} disabled={!(data.ranking || []).length}>
              <Download size={14} /> {t("Download the ranking (Excel)")}
            </button>
          </div>
          <small className="footnote">
            {t(
              "Rank 1 is the coach furthest behind. Two measures, each ranking the coaches on its own: the share of their students not started on the portal or not on its students sheet yet, and their students' gigs waiting for the coach's decision for more than {v0} days. The overall rank adds the two, so neither outweighs the other.",
              { v0: slowAfterDays },
            )}
          </small>
          <div className="table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>{t("Rank")}</th>
                  <th>{t("Coach")}</th>
                  <th>{t("Assigned students")}</th>
                  <th>{t("Not started or not on the portal")}</th>
                  <th>{t("Share of students")}</th>
                  <th>{t("Gigs waiting for the coach")}</th>
                  <th>{t("Waiting over {v0} days", { v0: slowAfterDays })}</th>
                  <th>{t("Longest wait (days)")}</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((c) => (
                  <tr key={c.coach_id}>
                    <td><strong><bdi dir="ltr">{c.rank}</bdi></strong></td>
                    <td><strong>{coachName(c)}</strong></td>
                    <td><bdi dir="ltr">{c.assigned}</bdi></td>
                    <td><bdi dir="ltr">{c.not_moving}</bdi></td>
                    <td><bdi dir="ltr">{c.not_moving_pct}%</bdi></td>
                    <td><bdi dir="ltr">{c.waiting}</bdi></td>
                    <td><bdi dir="ltr">{c.slow}</bdi></td>
                    <td><bdi dir="ltr">{c.oldest_days ?? "—"}</bdi></td>
                  </tr>
                ))}
                {!ranking.length && (
                  <tr>
                    <td colSpan={8}>{t("Nothing in this list.")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
