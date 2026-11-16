// The account review sheet (16 November 2026): every client account with the
// student whose service it buys, where its order stands, and drop-downs for
// Project Operations and Abdullah Waheed to say whether the account buys that
// service or should be cancelled, and which column or data should go. A second
// tab has one row per student, laid out like the team's Service Operations
// sheet.
//
// Built from the rows the Service status tab already shows the person asking,
// so it reaches no one further than the tab does. Accounts that are retired
// (taken off the system) are left out. The account tab carries no password and
// none of the student's contact details; the student tab, like the team's own
// sheet, has each student's phone and email, so it goes no further than the
// team does.

import type { Dropdown } from "../spreadsheet.ts";

type Row = Record<string, any>;

/** What each reviewer picks for an account's service. */
export const reviewDecisions = ["Buys this service", "Cancel"];

/** A student of a service group, and one whose group is no longer one (17 November 2026). */
export const currentStudent = "Current student";
export const oldStudent = "Old student";

export const reviewColumns = {
  account: "Account",
  marketplace: "Account marketplace",
  accountStatus: "Account status",
  credit: "Credit left",
  student: "Student",
  studentId: "Student ID",
  group: "Group",
  studentType: "Student type",
  provider: "Training provider",
  coordinator: "Coordinator",
  supervisor: "Supervisor",
  service: "Service link",
  servicePlatform: "Service marketplace",
  serviceNo: "Service no.",
  orderStatus: "Order status",
  price: "Price paid",
  boughtOn: "Bought on",
  orderUpdated: "Order last updated",
  operations: "Project Operations: decision",
  waheed: "Abdullah Waheed: decision",
  remove: "Column or data to remove",
  notes: "Notes",
} as const;

/** The columns the reviewers fill in: shaded in the sheet. */
export const reviewInputColumns = [reviewColumns.operations, reviewColumns.waheed, reviewColumns.remove, reviewColumns.notes];

export const reviewDropdowns: Dropdown[] = [
  { column: reviewColumns.operations, options: reviewDecisions, prompt: "Does this account buy this service, or should it be cancelled?" },
  { column: reviewColumns.waheed, options: reviewDecisions, prompt: "Does this account buy this service, or should it be cancelled?" },
];

/** The team's status words for an order; a service with no order yet says so. */
export const reviewOrderWord = (state: unknown) =>
  (
    ({
      Buy: "Buy",
      "In Progress": "In Progress",
      Done: "Done (POH not uploaded)",
      "Proof Uploaded": "POH uploaded",
      Cancelled: "Canceled",
    }) as Record<string, string>
  )[String(state ?? "")] || "No order yet";

/** The words of the team's own sheet, blank while there is no order. */
export const teamOrderWord = (state: unknown) =>
  (({ Buy: "Buy", "In Progress": "In Progress", Done: "Done", "Proof Uploaded": "Upload POH", Cancelled: "Canceled" }) as Record<string, string>)[String(state ?? "")] || "";

const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");

/** A retired account has been taken off the system: its services do not belong on the sheet. */
export const onSystem = (rows: Row[]) => rows.filter((r) => r.status !== "Retired");

type Lookups = {
  owner: (id: unknown) => string;
  provider: (group: unknown) => string;
  /** Whether the group is one of the service groups. */
  inService: (group: unknown) => boolean;
};

const studentType = (lookups: Lookups, group: unknown) => (lookups.inService(group) ? currentStudent : oldStudent);

/**
 * One row per account and student, the services in order of coordinator,
 * student and account. `rows` are the Service status tab's rows: an account
 * row with `latest` (its newest order) and `state` (that order's status).
 */
export function accountReviewRows(rows: Row[], lookups: Lookups) {
  const out = onSystem(rows).map((r) => ({
    [reviewColumns.account]: r.label || "",
    [reviewColumns.marketplace]: r.platform || "",
    [reviewColumns.accountStatus]: r.status || "",
    [reviewColumns.credit]: r.credits === null || r.credits === undefined || r.credits === "" ? "" : Number(r.credits),
    [reviewColumns.student]: r.student_name || "",
    [reviewColumns.studentId]: r.student_id || "",
    [reviewColumns.group]: r.student_group || "",
    [reviewColumns.studentType]: studentType(lookups, r.student_group),
    [reviewColumns.provider]: lookups.provider(r.student_group) || "",
    [reviewColumns.coordinator]: r.student_coordinator_name || (r.coordinator_id ? lookups.owner(r.coordinator_id) : ""),
    [reviewColumns.supervisor]: r.supervisor ? lookups.owner(r.supervisor) : "",
    [reviewColumns.service]: r.service_url || "",
    [reviewColumns.servicePlatform]: r.service_platform || "",
    [reviewColumns.serviceNo]: r.service_slot ?? "",
    [reviewColumns.orderStatus]: reviewOrderWord(r.state),
    [reviewColumns.price]: r.latest?.amount === null || r.latest?.amount === undefined || r.latest?.amount === "" ? "" : Number(r.latest.amount),
    [reviewColumns.boughtOn]: r.latest?.bought_on || "",
    [reviewColumns.orderUpdated]: day(r.latest?.updated_at),
    // To be filled in by the reviewers.
    [reviewColumns.operations]: "",
    [reviewColumns.waheed]: "",
    [reviewColumns.remove]: "",
    [reviewColumns.notes]: "",
  }));
  const text = (row: Record<string, any>, key: string) => String(row[key] ?? "");
  return out.sort(
    (a, b) =>
      text(a, reviewColumns.coordinator).localeCompare(text(b, reviewColumns.coordinator)) ||
      text(a, reviewColumns.student).localeCompare(text(b, reviewColumns.student)) ||
      text(a, reviewColumns.account).localeCompare(text(b, reviewColumns.account)),
  );
}

/**
 * The second tab: one row per student, in the layout of the team's Service
 * Operations sheet (the one the Service status tab's own download follows):
 * their Kafiil and Nafezly services and accounts, and where each service's
 * order stands, with the price and where it was bought. A student has up to
 * three services, so there is a third status beside the sheet's two.
 */
export const studentColumns = [
  "Coordinator",
  "NameEn",
  "Student ID",
  "Phone",
  "Email",
  "Current Group Code",
  "Training Provider",
  "Kafiil Services URL",
  "Kafeel Account",
  "Nafezly Services URL",
  "Nafezly Account",
  "Service 1 Platform",
  "Service 1 Status",
  "Service 2 Platform",
  "Service 2 Status",
  "Service 3 Platform",
  "Service 3 Status",
  "Price Paid",
  "Bought On",
  "Student type",
];

export function studentServiceRows(rows: Row[], lookups: Lookups & { contact: (studentId: unknown) => { phone?: unknown; email?: unknown } }) {
  const byStudent = new Map<string, Row[]>();
  for (const r of onSystem(rows)) byStudent.set(r.student_id, [...(byStudent.get(r.student_id) || []), r]);
  const out = [...byStudent.entries()].map(([id, list]) => {
    const services = [...list].sort((a, b) => Number(a.service_slot || 0) - Number(b.service_slot || 0) || String(a.label).localeCompare(String(b.label)));
    const first = services[0] || {};
    const contact = lookups.contact(id);
    const kafeel = services.filter((r) => r.platform === "Kafeel");
    const nafezly = services.filter((r) => r.platform === "Nafezly");
    const platform = (r?: Row) => (r ? r.service_platform || r.platform || "" : "");
    const status = (r?: Row) => (r ? teamOrderWord(r.state) : "");
    return {
      Coordinator: first.student_coordinator_name || (first.coordinator_id ? lookups.owner(first.coordinator_id) : ""),
      NameEn: first.student_name || "",
      "Student ID": id,
      Phone: String(contact.phone ?? ""),
      Email: String(contact.email ?? ""),
      "Current Group Code": first.student_group || "",
      "Training Provider": lookups.provider(first.student_group) || "",
      "Kafiil Services URL": kafeel.map((r) => r.service_url || "").join(" | "),
      "Kafeel Account": kafeel.map((r) => r.label).join(" | "),
      "Nafezly Services URL": nafezly.map((r) => r.service_url || "").join(" | "),
      "Nafezly Account": nafezly.map((r) => r.label).join(" | "),
      "Service 1 Platform": platform(services[0]),
      "Service 1 Status": status(services[0]),
      "Service 2 Platform": platform(services[1]),
      "Service 2 Status": status(services[1]),
      "Service 3 Platform": platform(services[2]),
      "Service 3 Status": status(services[2]),
      "Price Paid": services.map((r) => r.latest?.amount ?? "").filter((v) => v !== "").join(" | "),
      "Bought On": services.map((r) => r.latest?.bought_on || "").filter(Boolean).join(" | "),
      "Student type": studentType(lookups, first.student_group),
    };
  });
  return out.sort((a, b) => a.Coordinator.localeCompare(b.Coordinator) || a.NameEn.localeCompare(b.NameEn));
}

/** The sheet's instructions, a tab of its own. */
export const reviewHowTo = [
  "On the Account review tab, each row is one client account and the student whose service it buys.",
  "In the shaded columns, pick from the list: \"Buys this service\" if the account really buys that service, or \"Cancel\" if it should be cancelled. Project Operations and Abdullah Waheed each have a column.",
  "If a column or some data in this sheet should be removed, write which one in \"Column or data to remove\". Anything else goes in \"Notes\".",
  "The list in the decision columns accepts only those two answers. Filter any column with the arrows in the header row.",
  "Student type says \"Old student\" when the student's group is no longer one of the service groups, and \"Current student\" when it is.",
  "The Student per row tab shows each student's services, accounts and order status on one line. Decisions go on the Account review tab.",
  "Accounts that have been retired are not on this sheet. It has no passwords; the Student per row tab has student phones and emails, so keep the file to the team.",
].map((line) => ({ "How to fill in this sheet": line }));
