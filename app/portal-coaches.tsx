"use client";

// The portal's coach for each group (3 November 2026): upload the Coaches
// sheet downloaded from the ministry portal, see where it differs from the
// groups' coaches here, then apply. The gigs our quality team decided then go
// to each group's portal coach on their Gigs tab. See app/api/portal-coaches.

import { useEffect, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n/context";
import { readSheet } from "@/lib/spreadsheet";

type Row = Record<string, any>;

export function PortalCoaches() {
  const t = useT();
  const [list, setList] = useState<Row[] | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const r = await fetch("/api/portal-coaches", { cache: "no-store" });
    const v = await r.json().catch(() => null);
    if (v?.rows) setList(v.rows);
  }
  useEffect(() => {
    void load();
  }, []);

  async function send(apply: boolean, sheet = rows) {
    if (!sheet) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/portal-coaches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: sheet, apply }) });
      const v = await r.json().catch(() => null);
      if (!r.ok || !v || v.error) throw new Error(v?.error || t("Unable to read the sheet."));
      setSummary(v.summary);
      if (apply) {
        toast.success(t("Each group's portal coach is saved. Their Gigs tab follows it."));
        setRows(null);
        setSummary(null);
        await load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const differs = (list || []).filter((r) => r.coach_user_id && r.coach_user_id !== r.group_coach);
  const noAccount = (list || []).filter((r) => !r.coach_user_id);
  return (
    <section className="panel portal-coaches">
      <div className="panel-head">
        <h2>{t("Portal coaches")}</h2>
        <label className={"small-btn" + (busy ? " is-busy" : "")}>
          <Upload size={14} /> {t("Upload the portal's Coaches sheet")}
          <input
            type="file"
            accept=".xlsx,.csv"
            hidden
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const sheet = (await readSheet(file)) as Row[];
                setRows(sheet);
                await send(false, sheet);
              } catch (err: any) {
                setError(err.message);
              }
            }}
          />
        </label>
      </div>
      <p className="footnote">
        {t("Only the portal's coach for a group can carry out its gigs on the portal, so the gigs our quality team approved or rejected go to that coach's Gigs tab. A group the sheet does not name, or whose portal coach has no account here, stays with its coach here.")}
      </p>
      {error && <p className="form-error">{error}</p>}
      {summary && (
        <div className="info-box">
          <strong>{t("{v0} groups in the sheet", { v0: summary.groups })}</strong>
          <small>{t("{v0} with the same coach as here", { v0: summary.same_coach })}</small>
          {summary.different_coach.map((d: Row) => (
            <small key={d.group}>
              <bdi>{d.group}</bdi>: {t("portal coach {v0}, here {v1}", { v0: d.portal, v1: d.ours || "—" })}
            </small>
          ))}
          {summary.without_account.map((d: Row) => (
            <small key={d.group} className="credit-out">
              <bdi>{d.group}</bdi>: {t("{v0} has no coach account here, so the group stays with its coach here", { v0: d.coach })}
            </small>
          ))}
          {summary.unknown_groups.length > 0 && <small className="credit-out">{t("Not one of our groups: {v0}", { v0: summary.unknown_groups.join(", ") })}</small>}
          {summary.groups_not_in_sheet > 0 && <small>{t("{v0} of our groups are not in the sheet and keep their coach here", { v0: summary.groups_not_in_sheet })}</small>}
          <div className="detail-actions">
            <button type="button" className="primary small" disabled={busy} onClick={() => send(true)}>
              {busy ? <RefreshCw size={14} className="spin" /> : null} {t("Apply this sheet")}
            </button>
            <button type="button" className="small-btn" disabled={busy} onClick={() => { setRows(null); setSummary(null); }}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {list && !summary && (
        list.length ? (
          <div className="info-box">
            <strong>{t("{v0} groups follow the portal's coach", { v0: list.length })}</strong>
            {differs.map((r) => (
              <small key={r.group_id}>
                <bdi>{r.group_id}</bdi>: {t("portal coach {v0}, here {v1}", { v0: r.coach_user_name, v1: r.group_coach_name || "—" })}
              </small>
            ))}
            {noAccount.map((r) => (
              <small key={r.group_id} className="credit-out">
                <bdi>{r.group_id}</bdi>: {t("{v0} has no coach account here, so the group stays with its coach here", { v0: r.coach_name || r.coach_email })}
              </small>
            ))}
          </div>
        ) : (
          <p className="footnote">{t("No portal coaches sheet uploaded yet: every group's gigs go to its coach here.")}</p>
        )
      )}
    </section>
  );
}
