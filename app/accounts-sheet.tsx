"use client";

// Upload of the team's own accounts sheet (Accounts.xlsx) on the Accounts tab,
// for the people who keep the accounts: choose the file, pick its tabs, see
// what would change, then apply. See app/api/accounts-sheet and
// lib/domain/accounts-sheet.ts for how each row is read.

import { useState } from "react";
import { Download, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/lib/i18n/context";
import { readAllSheets, toXLSX } from "@/lib/spreadsheet";
import { accountSheetHeader } from "@/lib/domain/accounts-sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Tab = { name: string; rows: string[][]; use: boolean };
type Summary = Record<string, any>;

/** A tab holds accounts when its first row has "Password" in the second column. */
const holdsAccounts = (rows: string[][]) => /password/i.test(String(rows[0]?.[1] || ""));
/** Depi Industry was dropped from Round 5, so its tab is left out unless chosen. */
const industry = (name: string) => /\bIND\b/i.test(name);

function save(bytes: any, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function AccountsSheetUpload({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows = () => tabs.filter((tab) => tab.use).flatMap((tab) => tab.rows.slice(1).map((cells) => ({ sheet: tab.name, cells })));

  async function send(apply: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/accounts-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows(), apply }),
      }).catch(() => {
        throw new Error(t("Check your connection and try again."));
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value || value.error) throw new Error(value?.error || t("Unable to read the sheet."));
      setSummary(value.summary);
      if (apply) {
        toast.success(t("The accounts now match the sheet."));
        setOpen(false);
        setTabs([]);
        setSummary(null);
        onDone();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to read the sheet."));
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File) {
    setError("");
    setSummary(null);
    try {
      const all = await readAllSheets(file);
      const found = all.filter((s) => holdsAccounts(s.rows)).map((s) => ({ ...s, use: !industry(s.name) }));
      if (!found.length) throw new Error(t("No tab in this file has the accounts columns (Account, Password, Coordinator, Account on…)."));
      setTabs(found);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Unable to read the sheet."));
    }
  }

  const changes: [string, string][] = [
    ["new", "New accounts"],
    ["password", "Passwords to update"],
    ["status", "Status changes"],
    ["credit", "Credit corrections"],
    ["pending", "Pending credit changes"],
    ["owner", "Coordinator (owner) changes"],
    ["comments", "Comment changes"],
    ["unchanged", "Already up to date"],
    ["status_kept", "Status kept (in use or decided in the app)"],
    ["credit_kept", "Credit kept (changed in the app since)"],
    ["repeated_in_sheet", "Listed twice in the sheet"],
    ["only_in_app", "In the app but not in the sheet (left alone)"],
  ];

  return (
    <>
      <button
        type="button"
        className="small-btn"
        onClick={() => save(toXLSX([Object.fromEntries(accountSheetHeader.map((h) => [h, ""]))], "Accounts"), "depi-accounts-sheet-layout.xlsx")}
        title={t("The same columns as the team's accounts sheet: Account, Password, Coordinator, Account on, Active or Not, Credits Available, pending credit, Comments.")}
      >
        <Download size={15} /> {t("Download the sheet layout")}
      </button>
      <button type="button" className="small-btn" onClick={() => setOpen(true)}>
        <Upload size={15} /> {t("Upload the accounts sheet")}
      </button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="action-dialog sm:max-w-[620px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Upload the accounts sheet")}</DialogTitle>
            <DialogDescription>
              {t("Upload the team's accounts workbook as it is. Passwords are encrypted before they are stored. You see what would change before anything is saved.")}
            </DialogDescription>
          </DialogHeader>
          <label className="small-btn">
            <Upload size={15} /> {t("Choose the XLSX file")}
            <input className="sr-only" type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
          </label>
          {tabs.length > 0 && (
            <fieldset className="sheet-tabs">
              <legend>{t("Tabs to read")}</legend>
              {tabs.map((tab, i) => (
                <label key={tab.name} className="check">
                  <input
                    type="checkbox"
                    checked={tab.use}
                    onChange={(e) => {
                      setSummary(null);
                      setTabs(tabs.map((x, j) => (j === i ? { ...x, use: e.target.checked } : x)));
                    }}
                  />
                  <bdi>{tab.name}</bdi> · {t("{v0} rows", { v0: tab.rows.length - 1 })}
                </label>
              ))}
            </fieldset>
          )}
          {error && <div className="form-error" role="alert">{t(error)}</div>}
          {summary && (
            <div className="sheet-summary">
              <p><strong>{t("{v0} accounts in the sheet", { v0: summary.accounts })}</strong></p>
              <ul>
                {changes
                  .filter(([k]) => Number(summary[k]) > 0)
                  .map(([k, label]) => (
                    <li key={k}><strong>{summary[k]}</strong> {t(label)}</li>
                  ))}
                {Object.entries(summary.skipped || {}).map(([why, count]) => (
                  <li key={why}><strong>{String(count)}</strong> {t("skipped: {v0}", { v0: t(why) })}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-footer">
            <span />
            <button type="button" className="small-btn" disabled={busy} onClick={() => setOpen(false)}>{t("Cancel")}</button>
            {!summary ? (
              <button type="button" className="primary" disabled={busy || !tabs.some((x) => x.use)} onClick={() => send(false)}>
                {busy ? <RefreshCw className="spin" size={15} /> : null} {t("Check the sheet")}
              </button>
            ) : (
              <button type="button" className="primary" disabled={busy} onClick={() => send(true)}>
                {busy ? <RefreshCw className="spin" size={15} /> : null} {t("Apply these changes")}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
