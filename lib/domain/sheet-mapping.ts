/**
 * Linking an uploaded sheet to the people already in the workspace.
 *
 * Operations data arrives from several places — the ministry list, a provider's
 * tracker, a coach's own sheet — and none of them use this application's column
 * names. What they do share is the national ID, which is the one identifier a
 * student cannot change, so it is the key an upload is matched on.
 *
 * This module holds the two parts of that job that are pure: cleaning an
 * identifier written by a spreadsheet, and guessing which field a column is
 * meant to fill. The guess is only a starting point; the person uploading
 * confirms or corrects it, and the confirmed mapping is what the import applies.
 */

/**
 * Egyptian national ID: 14 digits, first digit 2 or 3 (the century), then
 * YYMMDD, governorate, sequence and a check digit. Never starts with a zero,
 * so a short value is a damaged number rather than one missing a leading zero.
 */
const NATIONAL_ID = /^[23]\d{13}$/;

const ARABIC_INDIC = 0x0660; // ٠..٩
const EASTERN_ARABIC = 0x06f0; // ۰..۹

/** Arabic-Indic and Eastern Arabic digits written as ASCII digits. */
export function normalizeDigits(value: unknown) {
  return String(value ?? "").replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= EASTERN_ARABIC ? EASTERN_ARABIC : ARABIC_INDIC;
    return String(code - base);
  });
}

/**
 * The identifier as the sheet meant it, or "" when the cell cannot be one.
 *
 * Spreadsheets damage long numbers in predictable ways: Excel stores a 14-digit
 * number as a float and shows it as 2.98E+13, users paste with spaces, dashes
 * or a leading apostrophe, and Arabic keyboards produce Arabic-Indic digits.
 * Each of those is recoverable, because 14 digits is still exact in a double
 * (well under 2^53), so the expansion loses nothing.
 */
export function normalizeNationalId(value: unknown) {
  const text = normalizeDigits(value).trim().replace(/^['\u200f\u200e]+/, "");
  if (!text) return "";
  const scientific = text.match(/^(\d)(?:[.,](\d+))?[eE]\+?(\d+)$/);
  if (scientific) {
    const [, lead, decimals = "", exponent] = scientific;
    const digits = lead + decimals;
    const zeros = Number(exponent) - decimals.length;
    if (zeros >= 0 && digits.length + zeros <= 20) return digits + "0".repeat(zeros);
  }
  const digits = text.replace(/[\s\u00a0\u200b_.,/'-]/g, "");
  return /^\d+$/.test(digits) ? digits : "";
}

export function isNationalId(value: unknown) {
  return NATIONAL_ID.test(normalizeNationalId(value));
}

/** Why a value cannot be used as a key, for the row's error message. */
export function nationalIdProblem(value: unknown) {
  const digits = normalizeNationalId(value);
  if (!digits) return "This cell does not hold a number";
  if (digits.length !== 14) return `The national ID is 14 digits; this cell has ${digits.length}`;
  if (!NATIONAL_ID.test(digits)) return "A national ID starts with 2 or 3";
  return null;
}

/**
 * Header text reduced to something comparable: case, punctuation, Arabic
 * diacritics and the spelling variants of alef, yeh and teh marbuta all
 * stop mattering, because sheets spell the same heading several ways.
 */
export function normalizeHeader(value: unknown) {
  return normalizeDigits(value)
    .toLowerCase()
    .replace(/[\u064b-\u0652\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/**
 * Column headings this application recognizes, in English and Arabic.
 *
 * "Student ID" is listed under the national ID on purpose: the programme calls
 * the national ID the student ID, while this application's own `id` is the
 * record reference printed in exports.
 */
export const fieldAliases: Record<string, string[]> = {
  national_id: [
    "national id",
    "nationalid",
    "national number",
    "nid",
    "student id",
    "student number",
    "id number",
    "الرقم القومي",
    "الرقم القومى",
    "رقم قومي",
    "الرقم القومي للطالب",
    "رقم البطاقة",
    "البطاقة",
    "الرقم القومي/البطاقة",
  ],
  id: ["id", "record id", "reference", "depi id", "workspace id"],
  tp_id: ["tp id", "tp", "tpid", "tp reference", "training provider id"],
  name: ["name", "full name", "student name", "الاسم", "اسم الطالب", "الاسم بالكامل", "الاسم الرباعي"],
  name_ar: ["arabic name", "name ar", "الاسم بالعربية", "الاسم عربي"],
  email: ["email", "e mail", "mail", "email address", "البريد", "البريد الالكتروني", "الايميل"],
  phone: [
    "phone",
    "mobile",
    "phone number",
    "mobile number",
    "whatsapp",
    "contact number",
    "الهاتف",
    "رقم الهاتف",
    "الموبايل",
    "رقم الموبايل",
    "واتساب",
  ],
  job_profile: ["job profile", "job title", "profile", "specialization", "الوظيفة", "المسمى الوظيفي", "التخصص"],
  student_type: ["student type", "type", "category", "نوع الطالب", "الفئة"],
  coaching: ["coaching", "coaching status", "حالة الكوتشينج", "حالة التدريب"],
  group_id: ["group", "group id", "group code", "المجموعة", "كود المجموعة"],
  lifecycle: ["lifecycle", "status", "student status", "الحالة", "حالة الطالب"],
  engagement: ["engagement", "engagement status", "التفاعل"],
  label: ["label", "account label", "account name", "اسم الحساب"],
  platform: ["platform", "marketplace", "المنصة"],
  credits: ["credits", "credit", "balance", "الرصيد"],
  track: ["track", "المسار"],
  provider: ["provider", "training provider", "مقدم الخدمة"],
  coordinator: ["coordinator", "المنسق"],
  supervisor: ["supervisor", "المشرف"],
  coach: ["coach", "الكوتش", "المدرب"],
  account_manager: ["account manager", "مدير الحساب"],
  pathway: ["pathway", "المسار الوظيفي"],
  delivery_model: ["delivery model", "model", "نموذج التسليم"],
  start_date: ["start date", "starts", "تاريخ البدء", "تاريخ البداية"],
};

const aliasIndex = new Map<string, string>();
for (const [field, aliases] of Object.entries(fieldAliases))
  for (const alias of [field, ...aliases]) {
    const key = normalizeHeader(alias);
    if (key && !aliasIndex.has(key)) aliasIndex.set(key, field);
  }

/** The field a heading most likely fills, or null when nothing fits. */
export function guessField(header: string, allowed?: string[]) {
  const key = normalizeHeader(header);
  if (!key) return null;
  const field = aliasIndex.get(key);
  if (field && (!allowed || allowed.includes(field))) return field;
  // Headings often carry a qualifier: "Student Mobile No.", "الرقم القومي (14)".
  for (const [alias, candidate] of aliasIndex)
    if (alias.length >= 4 && key.includes(alias) && (!allowed || allowed.includes(candidate))) return candidate;
  return null;
}

export type Mapping = Record<string, string>;

/**
 * A first proposal for the whole sheet: heading -> field, leaving a heading out
 * when nothing fits and never proposing the same field twice (the first
 * matching column wins, so a later "ID" column cannot displace it).
 */
export function guessMapping(headers: string[], allowed: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const header of headers) {
    const field = guessField(header, allowed);
    if (!field || used.has(field)) continue;
    mapping[header] = field;
    used.add(field);
  }
  return mapping;
}

/**
 * Which column holds the key, preferring a mapped national ID, then any column
 * whose values look like national IDs, so a sheet with an unnamed first column
 * still links.
 */
export function guessKeyColumn(headers: string[], rows: Record<string, unknown>[], mapping: Mapping) {
  const mapped = Object.entries(mapping).find(([, field]) => field === "national_id");
  if (mapped) return mapped[0];
  const sample = rows.slice(0, 50);
  let best: { header: string; hits: number } | null = null;
  for (const header of headers) {
    const hits = sample.filter((row) => isNationalId(row[header])).length;
    if (hits && (!best || hits > best.hits)) best = { header, hits };
  }
  return best && best.hits >= Math.max(1, Math.floor(sample.length / 2)) ? best.header : null;
}

/** Rewrites raw sheet rows into field-keyed rows, dropping unmapped columns. */
export function applyMapping(rows: Record<string, unknown>[], mapping: Mapping) {
  const pairs = Object.entries(mapping).filter(([, field]) => field);
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [header, field] of pairs) {
      const value = row[header];
      const text = field === "national_id" ? normalizeNationalId(value) : String(value ?? "").trim();
      // A column mapped twice would silently lose data; the first non-empty wins.
      if (text && !out[field]) out[field] = text;
      else if (!(field in out)) out[field] = text;
    }
    return out;
  });
}
