// The account review sheet (16 November 2026): every client account with the
// student whose service it buys, where its order stands, and drop-downs for
// Project Operations and Abdullah Waheed to say whether the account buys that
// service or should be cancelled, and which column or data should go.
//
// Built from the rows the Service status tab already shows the person asking,
// so it reaches no one further than the tab does. It carries no password and
// none of the student's contact details.

import type { Dropdown } from "../spreadsheet.ts";

type Row = Record<string, any>;

/** What each reviewer picks for an account's service. */
export const reviewDecisions = ["Buys this service", "Cancel"];

export const reviewColumns = {
  account: "Account",
  marketplace: "Account marketplace",
  accountStatus: "Account status",
  credit: "Credit left",
  student: "Student",
  studentId: "Student ID",
  group: "Group",
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

const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");

/**
 * One row per account and student, the services in order of coordinator,
 * student and account. `rows` are the Service status tab's rows: an account
 * row with `latest` (its newest order) and `state` (that order's status).
 */
export function accountReviewRows(rows: Row[], lookups: { owner: (id: unknown) => string; provider: (group: unknown) => string }) {
  const out = rows.map((r) => ({
    [reviewColumns.account]: r.label || "",
    [reviewColumns.marketplace]: r.platform || "",
    [reviewColumns.accountStatus]: r.status || "",
    [reviewColumns.credit]: r.credits === null || r.credits === undefined || r.credits === "" ? "" : Number(r.credits),
    [reviewColumns.student]: r.student_name || "",
    [reviewColumns.studentId]: r.student_id || "",
    [reviewColumns.group]: r.student_group || "",
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

/** The sheet's instructions, a tab of its own. */
export const reviewHowTo = [
  "Each row is one client account and the student whose service it buys.",
  "In the shaded columns, pick from the list: \"Buys this service\" if the account really buys that service, or \"Cancel\" if it should be cancelled. Project Operations and Abdullah Waheed each have a column.",
  "If a column or some data in this sheet should be removed, write which one in \"Column or data to remove\". Anything else goes in \"Notes\".",
  "The list in the decision columns accepts only those two answers. Filter any column with the arrows in the header row.",
  "The sheet has no passwords. Send it back to the person who gave it to you when you are done.",
].map((line) => ({ "How to fill in this sheet": line }));
