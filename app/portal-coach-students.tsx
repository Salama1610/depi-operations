"use client";

// Each coach's students by where they stand on the ministry portal, for Coach
// Operations and the administrators (see lib/domain/portal-coach-students).

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";

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
        </>
      )}
    </details>
  );
}
