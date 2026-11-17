// Whose service rows each person follows in Service operations (16 November
// 2026). A service row is one student an account buys from: the account's
// first student or its second. The rule is the student's, never the account's:
// a coordinator follows their own groups' students, whoever is written on the
// account, so a coordinator's rows, their supervisor's and Project
// Operations' all count the same students.

import { can } from "./rules.ts";

type Person = { id: string; roles?: unknown; team?: unknown };
type ServiceRow = { student_id?: unknown; student_group?: unknown; student_coordinator_id?: unknown };
type Group = { id?: unknown; coordinator?: unknown; supervisor?: unknown };

const leaders = ["Higher Board", "Project Operations", "Operations Systems / Admin"];
const rolesOf = (u: Person): string[] => {
  if (Array.isArray(u.roles)) return u.roles.map(String);
  try {
    const list = JSON.parse(String(u.roles ?? "[]"));
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
};

/** The people who keep the accounts see every row: the leaders and the Service Team's supervisor (as lib/server keepsAccounts). */
export const seesEveryServiceRow = (u: Person) =>
  can(rolesOf(u), leaders) || (can(rolesOf(u), ["Team Supervisor"]) && u.team === "Service Team");

/** Whether this person follows the row: every row, their supervised groups' students, or their own groups' students. */
export function followsServiceRow(u: Person, row: ServiceRow, groupOf: (id: string) => Group | undefined) {
  if (!row.student_id) return false;
  if (seesEveryServiceRow(u)) return true;
  const group = groupOf(String(row.student_group ?? ""));
  if (can(rolesOf(u), ["Team Supervisor"]) && group?.supervisor === u.id) return true;
  if (can(rolesOf(u), ["Operations Coordinator"]) && (row.student_coordinator_id ?? group?.coordinator) === u.id) return true;
  return false;
}

/** The filters on the Service operations screen. "All" or empty means no filter. */
export type ServiceFilters = { q?: string; status?: string; coordinator?: string; supervisor?: string; group?: string; platform?: string };

/**
 * The coordinator a row is shown under (17 November 2026): the student's group
 * coordinator, whoever is written on the account, the same one the Coordinator
 * column shows and followsServiceRow follows. The filter used to match the
 * coordinators written on the account, so a student's row came up under the
 * wrong person.
 */
export const rowCoordinator = (row: ServiceRow & { student_coordinator_id?: unknown }, groupOf: (id: string) => Group | undefined) =>
  String(row.student_coordinator_id ?? groupOf(String(row.student_group ?? ""))?.coordinator ?? "");

/** The supervisor of the student's group. */
export const rowSupervisor = (row: ServiceRow, groupOf: (id: string) => Group | undefined) => String(groupOf(String(row.student_group ?? ""))?.supervisor ?? "");

/**
 * The rows that pass the filters. `skip: "status"` leaves the order-state
 * filter out: the state tiles count the rows the other filters leave, so each
 * tile shows how many there are in that state rather than 0 for every state but
 * the one chosen.
 */
export function filterServiceRows<T extends Record<string, any>>(rows: T[], filters: ServiceFilters, groupOf: (id: string) => Group | undefined, skip?: "status"): T[] {
  const off = (v?: string) => !v || v === "All";
  const q = String(filters.q ?? "").trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || [r.student_name, r.student_id, r.label, r.service_url].some((v) => String(v ?? "").toLowerCase().includes(q))) &&
      (skip === "status" || off(filters.status) || r.state === filters.status) &&
      (off(filters.coordinator) || rowCoordinator(r, groupOf) === filters.coordinator) &&
      (off(filters.supervisor) || rowSupervisor(r, groupOf) === filters.supervisor) &&
      (off(filters.group) || String(r.student_group ?? "") === filters.group) &&
      (off(filters.platform) || r.platform === filters.platform),
  );
}
