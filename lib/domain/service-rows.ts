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
