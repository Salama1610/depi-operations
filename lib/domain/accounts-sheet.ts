// The team's own accounts sheet (the "Accounts" and "Not Active" tabs of
// Accounts.xlsx), read by position because the "Not Active" tab has no header
// over its email column:
//   A Account (email) · B Password · C Coordinator · D Account on (platform)
//   E Active or Not · F Credits available · G Pending credit · H Comments
//   I (optional) a newer password, which wins when filled.
// One account is one email on one platform, with the same stable id the first
// import used, so uploading the sheet again updates rather than duplicates.

export type SheetAccount = {
  id: string;
  label: string;
  platform: "Kafeel" | "Nafezly" | "Khamsat";
  status: "Available" | "Access Issue" | "Under Review";
  credits: number;
  pending: number;
  owner: string | null;
  comments: string | null;
  password: string;
  sheet: string;
};

export const accountSheetHeader = [
  "Account",
  "Password",
  "Coordinator",
  "Account on",
  "Active or Not",
  "Credits Available",
  "الرصيد المعلق",
  "Comments",
];

const PLATFORM: Record<string, SheetAccount["platform"]> = {
  kafeel: "Kafeel",
  kafiil: "Kafeel",
  nafezly: "Nafezly",
  kamsat: "Khamsat",
  khamsat: "Khamsat",
};

export function money(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const n = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

async function sha1(text: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The account id the first import gave this email on this platform. */
export async function accountId(email: string, platform: string) {
  return "ACC-" + platform.slice(0, 3).toUpperCase() + "-" + (await sha1(email)).slice(0, 10);
}

/**
 * Raw sheet rows (each an array of cell texts, header row included or not)
 * into accounts. Returns the accounts and what was skipped, by reason.
 */
export async function readAccountRows(rows: { sheet: string; cells: string[] }[]) {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] || 0) + 1);
  const spell = new Map<string, string>();
  const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  for (const { cells } of rows) {
    const name = clean(cells[2]);
    if (name && (!spell.has(name.toLowerCase()) || /^[A-Z]/.test(name))) spell.set(name.toLowerCase(), name);
  }
  const out = new Map<string, SheetAccount>();
  let repeated = 0;
  for (const { sheet, cells } of rows) {
    const email = clean(cells[0]).toLowerCase();
    if (/password/i.test(clean(cells[1])) && !email.includes("@")) continue; // a header row
    if (!email.includes("@")) {
      if (cells.some((c) => clean(c))) skip("row without an email");
      continue;
    }
    const platform = PLATFORM[clean(cells[3]).toLowerCase()];
    if (!platform) {
      skip("platform not Kafeel, Nafezly or Khamsat");
      continue;
    }
    const newer = clean(cells[8]);
    const password = newer || clean(cells[1]);
    if (!password) {
      skip("no password");
      continue;
    }
    const state = clean(cells[4]).toLowerCase();
    const status: SheetAccount["status"] = state === "active" ? "Available" : state === "not active" ? "Access Issue" : "Under Review";
    const owner = clean(cells[2]);
    const key = email + "|" + platform;
    const prev = out.get(key);
    if (prev) {
      repeated++;
      // The same account twice: the active row wins, otherwise the later one.
      if (prev.status === "Available" && status !== "Available") continue;
    }
    const pendingRaw = clean(cells[6]);
    out.set(key, {
      id: await accountId(email, platform),
      label: email,
      platform,
      status,
      credits: money(cells[5]),
      pending: pendingRaw === "-" ? 0 : money(pendingRaw),
      owner: owner ? spell.get(owner.toLowerCase()) || owner : null,
      comments: clean(cells[7]) || null,
      password,
      sheet,
    });
  }
  return { accounts: [...out.values()], skipped, repeated };
}
