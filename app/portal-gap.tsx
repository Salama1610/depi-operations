"use client";

// The gap between the portal's gigs waiting for the coach and our system, for
// the Quality Lead and Coach Operations (see lib/domain/portal-gap). Each count
// lists its gigs; the workbook carries them all, with the counts by coach.

import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useLocale, useT } from "@/lib/i18n/context";
import { SearchableSelect } from "@/components/searchable-select";
import { toWorkbook } from "@/lib/spreadsheet";
import { coachStatusOf } from "@/lib/domain/portal-figures";
import { safeHref } from "@/lib/safe-href";
import { proofHref } from "@/lib/portal-proof-link";

type Row = Record<string, any>;
type Place = "not_in_queue" | "no_coach" | "with_qc" | "coach_tab" | "moved_on" | "disagree";

const placeLabels: Record<Place, string> = {
  not_in_queue: "Not in our system",
  no_coach: "Checked, but no coach sees it",
  with_qc: "With our QC, no verdict yet",
  coach_tab: "In the coach's Gigs tab",
  moved_on: "Decided on the portal before our QC",
  disagree: "Our QC and the coach disagree",
};
const whyLabels: Record<string, string> = {
  new: "New in this sheet: the QC queue takes it when Portal gigs QC next opens",
  not_linked: "Not linked to our records",
  revoked: "Revoked",
  not_active: "Student not active with us",
  industry: "Depi Industry group",
  no_coach: "No coach with an account for this group",
  decided_on_portal: "The portal moved on before our QC gave a verdict",
  not_in_sheet: "No longer in the latest sheet",
  coach_first: "The coach decided first, before our QC's verdict",
  unclear: "The sheet cannot show who came first: it only has the day the gig last changed",
};
const noCoach = "none";
/** The list opens on the first of these with gigs in it: what most needs someone to act comes first. */
const firstShown: Place[] = ["not_in_queue", "no_coach", "disagree", "moved_on", "with_qc", "coach_tab"];

export function PortalGap({ open = false }: { open?: boolean }) {
  const t = useT();
  const tag = useLocale() === "ar" ? "ar-EG-u-nu-latn" : "en-GB";
  const day = (value?: string | null) => (value ? new Date(value).toLocaleDateString(tag, { timeZone: "Africa/Cairo", day: "numeric", month: "short" }) : "—");
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Place | null>(null);
  const [coach, setCoach] = useState("All");
  const [shown, setShown] = useState(50);

  useEffect(() => {
    fetch("/api/portal-gap", { cache: "no-store" })
      .then(async (r) => {
        const v = await r.json().catch(() => null);
        if (!r.ok || !v || v.error) throw new Error(v?.error || "Unable to load the gap.");
        setData(v);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="panel portal-gap"><small role="alert">{t(error)}</small></div>;
  if (data && !data.sheet) return null;

  const coachName = (c: Row) => c.coach_name || c.coach_id || t("Not linked to our records");
  const students = (n: number) => (n === 1 ? t("1 student") : t("{v0} students", { v0: n }));
  const count = (key: Place) => data?.places[key].gigs ?? 0;
  const place = picked ?? firstShown.find((key) => count(key) > 0) ?? "not_in_queue";
  const tile = (key: Place, note?: string) => (
    <button
      type="button"
      className="mini-stat-btn"
      aria-pressed={place === key}
      onClick={() => {
        setPicked(key);
        setShown(50);
      }}
    >
      <strong>{count(key)}</strong>
      {t(placeLabels[key])}
      <small>{note ?? students(data?.places[key].students ?? 0)}</small>
    </button>
  );

  const gigs: Row[] = data?.gigs || [];
  const list = gigs.filter((g) => g.place === place && (coach === "All" || (g.coach_id || noCoach) === coach));
  const checked = gigs.filter((g) => g.place === "coach_tab");

  function download() {
    const file = toWorkbook([
      {
        name: "By coach",
        rows: (data?.coaches || []).map((c: Row) => ({
          Coach: coachName(c),
          "Waiting on the portal": c.waiting,
          "Checked by our QC: approved": c.qc_approved,
          "Checked by our QC: rejected": c.qc_rejected,
          "With our QC": c.with_qc,
          "Not in our system": c.not_in_queue,
          "Against our QC": c.against_qc,
          "Oldest since": c.oldest ? String(c.oldest).slice(0, 10) : "",
        })),
      },
      {
        name: "Gigs",
        rows: gigs.map((g) => ({
          Where: t(placeLabels[g.place as Place]),
          Why: g.why ? t(whyLabels[g.why]) : "",
          "Gig ID": g.id || "",
          "Portal ID": g.portal_student_id || "",
          "Our student ID": g.student_id || "",
          Student: g.student || "",
          Group: g.group_id || "",
          Coach: g.coach_name || g.coach_id || "",
          "Portal status": g.status || "",
          "Coach status": coachStatusOf(g),
          "Portal QC status": g.trainer_status ? g.provider_status || "" : "",
          "Our QC": g.qc || "",
          "Our QC date": g.qc_at ? String(g.qc_at).slice(0, 10) : "",
          "Portal last changed": g.portal_changed ? String(g.portal_changed).slice(0, 10) : "",
          Date: g.date ? String(g.date).slice(0, 10) : "",
          Gig: g.url || "",
          Proof: g.proof_url || "",
        })),
      },
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([file as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `portal-coach-gap-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
  }

  return (
    <details className="panel portal-gap" open={open}>
      <summary>
        {data
          ? t("Portal vs our system: {v0} gigs waiting for the coach, {v1} not in our system", { v0: data.waiting.gigs, v1: count("not_in_queue") })
          : t("Portal vs our system")}
      </summary>
      {!data ? (
        <small>{t("Loading…")}</small>
      ) : (
        <>
          <small className="footnote">
            {t("Counted from the latest gigs sheet. A gig waits for the coach until the coach approves it, or the portal approves or rejects it. Our system is our quality team's queue and the coach's Gigs tab. A coach is counted against our QC only when the sheet does not show they decided first.")}
          </small>
          <div className="mini-stats">
            <span>
              <strong>{data.waiting.gigs}</strong>
              {t("Waiting for the coach on the portal")}
              <small>{students(data.waiting.students)}</small>
            </span>
            <span>
              <strong>{data.in_our_system.gigs}</strong>
              {t("In our system")}
              <small>{students(data.in_our_system.students)}</small>
            </span>
            {tile("not_in_queue")}
            {tile("coach_tab", t("{v0} approved · {v1} rejected", { v0: checked.filter((g) => g.qc === "Approved").length, v1: checked.filter((g) => g.qc === "Rejected").length }))}
            {tile("with_qc")}
            {tile("no_coach")}
            {tile("moved_on")}
            {tile("disagree", t("{v0} where the coach decided first", { v0: gigs.filter((g) => g.why === "coach_first").length }))}
          </div>

          <div className="pqc-table">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>{t("Coach")}</th>
                  <th>{t("Waiting on the portal")}</th>
                  <th>{t("Checked by our QC: approved")}</th>
                  <th>{t("Checked by our QC: rejected")}</th>
                  <th>{t("With our QC")}</th>
                  <th>{t("Not in our system")}</th>
                  <th>{t("Against our QC")}</th>
                  <th>{t("Oldest since")}</th>
                </tr>
              </thead>
              <tbody>
                {data.coaches.map((c: Row) => (
                  <tr key={c.coach_id || noCoach}>
                    <td>{coachName(c)}</td>
                    <td><strong><bdi dir="ltr">{c.waiting}</bdi></strong></td>
                    <td><bdi dir="ltr">{c.qc_approved}</bdi></td>
                    <td><bdi dir="ltr">{c.qc_rejected}</bdi></td>
                    <td><bdi dir="ltr">{c.with_qc}</bdi></td>
                    <td><bdi dir="ltr">{c.not_in_queue}</bdi></td>
                    <td><bdi dir="ltr">{c.against_qc}</bdi></td>
                    <td>{day(c.oldest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="portal-gap-tools">
            <h3>{t(placeLabels[place])}</h3>
            <label className="field">
              {t("Coach")}
              <SearchableSelect
                label={t("Coach")}
                value={coach}
                onChange={(value) => {
                  setCoach(value);
                  setShown(50);
                }}
                options={[
                  { value: "All", label: t("Every coach") },
                  ...data.coaches.map((c: Row) => ({ value: c.coach_id || noCoach, label: coachName(c) })),
                ]}
              />
            </label>
            <button type="button" className="small-btn" onClick={download}>
              <Download size={14} /> {t("Download every gig (Excel)")}
            </button>
          </div>
          {!list.length ? (
            <p className="footnote">{t("No gig matches these filters.")}</p>
          ) : (
            <div className="pqc-table">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>{t("Student")}</th>
                    <th>{t("Group")}</th>
                    <th>{t("Coach")}</th>
                    <th>{t("Gig ID")}</th>
                    <th>{t("Portal status")}</th>
                    <th>{t("Coach status")}</th>
                    <th>{t("Our QC")}</th>
                    <th>{t("Date")}</th>
                    <th>{t("Why")}</th>
                    <th>{t("Links")}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, shown).map((g) => (
                    <tr key={g.place + (g.id || g.portal_student_id)}>
                      <td>
                        {g.student || "—"}
                        <small className="portal-ids"><bdi dir="ltr">{g.student_id || g.portal_student_id}</bdi></small>
                      </td>
                      <td><bdi dir="ltr">{g.group_id || "—"}</bdi></td>
                      <td>{g.coach_name || g.coach_id || "—"}</td>
                      <td><bdi dir="ltr">{g.id}</bdi></td>
                      <td>{g.status ? t(g.status) : "—"}</td>
                      <td>{coachStatusOf(g) ? t(coachStatusOf(g)) : "—"}</td>
                      <td>{g.qc ? t(g.qc) : "—"}</td>
                      <td>{day(g.date)}</td>
                      <td>{g.why ? t(whyLabels[g.why]) : "—"}</td>
                      <td>
                        {g.url && <a className="text-link" href={safeHref(g.url)} target="_blank" rel="noreferrer">{t("Gig")} <ExternalLink size={12} /></a>}
                        {g.proof_url && <a className="text-link" href={proofHref(g.proof_url)} target="_blank" rel="noreferrer"> {t("Proof")} <ExternalLink size={12} /></a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list.length > shown && (
            <button type="button" className="small-btn portal-more" onClick={() => setShown(shown + 100)}>
              {t("Show more ({v0} left)", { v0: list.length - shown })}
            </button>
          )}
        </>
      )}
    </details>
  );
}
