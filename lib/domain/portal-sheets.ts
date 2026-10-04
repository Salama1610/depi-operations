// The DEPI portal's two exports: the students sheet and the gigs sheet.
//
// They are the programme's main record of the cohort's gigs, uploaded several
// times a day by the leaders. Each upload replaces the previous one of the same
// sheet. The gigs sheet's "Student ID" is the students sheet's "ID", which is
// how the two are read together, and each portal student is linked to a
// student in this application by email, then by phone. The services that
// coordinators record in the app are internal validation; these sheets are
// the cohort's official one.

import { normalizeDigits, normalizeHeader, normalizePhone } from "./sheet-mapping";

export type PortalSheet = "students" | "gigs";

type FieldSpec = { field: string; label: string; aliases: string[]; required?: boolean };

/** The fields kept from each sheet, the headings they go by, and which are needed. */
export const portalFields: Record<PortalSheet, FieldSpec[]> = {
  students: [
    { field: "portal_id", label: "Portal student ID", aliases: ["id", "student id", "portal id", "user id"], required: true },
    { field: "email", label: "Email", aliases: ["email", "e-mail", "student email", "mail"] },
    { field: "full_name", label: "Full name", aliases: ["full name", "name", "student name"] },
    { field: "phone", label: "Phone", aliases: ["phone", "mobile", "phone number"] },
    { field: "round_code", label: "Round code", aliases: ["round code", "group code", "round"] },
    { field: "city", label: "City", aliases: ["city", "governorate"] },
    { field: "provider", label: "Provider", aliases: ["provider", "training provider"] },
    { field: "track", label: "Track", aliases: ["track"] },
    { field: "profile", label: "Profile", aliases: ["profile", "job profile"] },
    { field: "status", label: "Status", aliases: ["status"] },
    { field: "final_status", label: "Final status", aliases: ["final status"] },
    { field: "graduate_type", label: "Graduate type", aliases: ["graduate type", "graduation type"] },
    { field: "total_gigs", label: "Total gigs", aliases: ["total gigs"] },
    { field: "approved_gigs", label: "Approved gigs", aliases: ["approved gigs"] },
    { field: "rejected_gigs", label: "Rejected gigs", aliases: ["rejected gigs"] },
    { field: "total_revenue", label: "Total revenue", aliases: ["total revenue", "revenue"] },
    { field: "proof_1", label: "Proof link 1", aliases: ["proff link 1", "proof link 1"] },
    { field: "proof_2", label: "Proof link 2", aliases: ["proff link 2", "proof link 2"] },
    { field: "proof_3", label: "Proof link 3", aliases: ["proff link 3", "proof link 3"] },
    { field: "proof_extra", label: "Extra proofs", aliases: ["extra proffs", "extra proofs"] },
  ],
  gigs: [
    { field: "portal_gig_id", label: "Gig ID", aliases: ["id", "gig id"], required: true },
    { field: "portal_student_id", label: "Student ID", aliases: ["student id"], required: true },
    { field: "student_email", label: "Student email", aliases: ["student email", "email"] },
    { field: "student_name", label: "Student name", aliases: ["student name", "name"] },
    { field: "title", label: "Title", aliases: ["title", "gig title"] },
    { field: "url", label: "URL", aliases: ["url", "link", "gig url"] },
    { field: "category", label: "Category", aliases: ["category"] },
    { field: "task", label: "Task", aliases: ["task"] },
    { field: "organization", label: "Organization (platform)", aliases: ["organization", "platform"] },
    { field: "client_name", label: "Client name", aliases: ["client name", "client"] },
    { field: "price", label: "Price", aliases: ["price", "value", "amount"] },
    { field: "created_on", label: "Created on", aliases: ["created on", "created at", "created"] },
    { field: "updated_on", label: "Updated on", aliases: ["updated on", "updated at", "updated"] },
    { field: "status", label: "Status", aliases: ["status"] },
    { field: "provider_status", label: "Provider status", aliases: ["provider status"] },
    { field: "auditor_status", label: "Auditor status", aliases: ["auditor status"] },
    { field: "comment", label: "Comment", aliases: ["comment", "comments"] },
    { field: "action_by", label: "Action by", aliases: ["action by", "reviewed by"] },
    { field: "proof_url", label: "Proof screenshot", aliases: ["status proof screenshot", "proof", "proof screenshot"] },
  ],
};

/** The upload roles: supervisors, Project Operations, Coach Operations and the Quality Lead. */
export const portalUploadRoles = ["Team Supervisor", "Project Operations", "Coach Operations", "Quality Lead"];

/**
 * A proposal for the sheet: heading -> field, matching the headings exactly
 * (after normalising case, spacing and punctuation) so the gigs sheet's "ID"
 * and "Student ID" are never confused. A field is proposed once.
 */
export function guessPortalMapping(sheet: PortalSheet, headers: string[]) {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  for (const header of headers) {
    const h = normalizeHeader(header);
    const spec = portalFields[sheet].find((f) => !used.has(f.field) && f.aliases.some((a) => normalizeHeader(a) === h));
    if (!spec) continue;
    mapping[header] = spec.field;
    used.add(spec.field);
  }
  return mapping;
}

/** What a mapping is missing before the sheet can be read. */
export function mappingProblems(sheet: PortalSheet, mapping: Record<string, string>) {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const missing = portalFields[sheet].filter((f) => f.required && !mapped.has(f.field)).map((f) => f.label);
  if (sheet === "students" && !mapped.has("email") && !mapped.has("phone")) missing.push("Email or Phone");
  return missing;
}

const text = (v: unknown, max = 500) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const number = (v: unknown) => {
  const s = normalizeDigits(String(v ?? "")).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** A date from a sheet: an ISO or written date, or Excel's day number. */
export function sheetDate(v: unknown) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) return new Date(Math.round((serial - 25569) * 86400000)).toISOString();
  }
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/** One students-sheet row, mapped and cleaned. */
export function portalStudentRow(row: Record<string, unknown>) {
  const proofs = [row.proof_1, row.proof_2, row.proof_3, row.proof_extra].map((v) => text(v, 1000)).filter(Boolean);
  return {
    portal_id: text(row.portal_id, 80),
    email: text(row.email, 200)?.toLowerCase() || null,
    full_name: text(row.full_name, 200),
    phone: text(row.phone) ? normalizePhone(row.phone) : null,
    round_code: text(row.round_code, 80),
    city: text(row.city, 80),
    provider: text(row.provider, 80),
    track: text(row.track, 120),
    profile: text(row.profile, 200),
    status: text(row.status, 60),
    final_status: text(row.final_status, 60),
    graduate_type: text(row.graduate_type, 80),
    total_gigs: number(row.total_gigs),
    approved_gigs: number(row.approved_gigs),
    rejected_gigs: number(row.rejected_gigs),
    total_revenue: number(row.total_revenue),
    proof_links: JSON.stringify(proofs),
  };
}

/** One gigs-sheet row, mapped and cleaned. */
export function portalGigRow(row: Record<string, unknown>) {
  return {
    portal_gig_id: text(row.portal_gig_id, 80),
    portal_student_id: text(row.portal_student_id, 80),
    student_email: text(row.student_email, 200)?.toLowerCase() || null,
    student_name: text(row.student_name, 200),
    title: text(row.title, 300),
    url: text(row.url, 1000),
    category: text(row.category, 80),
    task: text(row.task, 300),
    organization: text(row.organization, 120),
    client_name: text(row.client_name, 200),
    price: number(row.price),
    created_on: sheetDate(row.created_on),
    updated_on: sheetDate(row.updated_on),
    status: text(row.status, 60),
    provider_status: text(row.provider_status, 60),
    auditor_status: text(row.auditor_status, 60),
    comment: text(row.comment, 1000),
    action_by: text(row.action_by, 200),
    proof_url: text(row.proof_url, 1000),
  };
}

/**
 * The application student a portal row belongs to: the same email first,
 * then the same mobile. `byEmail` and `byPhone` map to student ids.
 */
export function linkStudent(
  row: { email?: string | null; phone?: string | null },
  byEmail: Map<string, string>,
  byPhone: Map<string, string>,
) {
  if (row.email && byEmail.has(row.email)) return byEmail.get(row.email)!;
  for (const phone of String(row.phone || "").split(" / "))
    if (phone && byPhone.has(phone)) return byPhone.get(phone)!;
  return null;
}
