// The gap between the portal's gigs waiting for the coach and our system.
import test from "node:test";
import assert from "node:assert/strict";
import { portalCoachGap } from "../lib/domain/portal-gap.ts";

const ours = { student_id: "S1", lifecycle: "Active", delivery_model: "Regular", group_id: "G1", coach_id: "C1", coach_name: "Coach One", coach_active: 1 };
const gig = (id, fields = {}) => ({
  ...ours,
  portal_gig_id: id,
  portal_student_id: "P1",
  proof_url: "https://proof.example.org/" + id,
  status: "Pending",
  provider_status: "Pending",
  created_on: "2026-11-01",
  ...fields,
});
const placeOf = (gap, id) => {
  const g = gap.gigs.find((x) => x.id === id);
  return g && [g.place, g.why];
};

test("only the gigs waiting for the coach are counted: the portal's overall status settles the rest", () => {
  const gap = portalCoachGap(
    [
      gig("wait"),
      gig("edited", { status: "Edited", provider_status: "Edited" }),
      gig("blank", { provider_status: "" }),
      gig("auditor", { provider_status: "Approved" }),
      gig("approved", { status: "Approved", provider_status: "Approved" }),
      gig("rejected", { status: "Rejected", provider_status: "Pending" }),
    ],
    [],
  );
  assert.deepEqual(gap.gigs.map((g) => g.id).sort(), ["blank", "edited", "wait"]);
  assert.equal(gap.waiting.gigs, 3);
  assert.equal(gap.waiting.students, 1);
});

test("each waiting gig has one place, and the places add up to the portal's count", () => {
  const gap = portalCoachGap(
    [
      gig("checked-ok", { qc: "Approved" }),
      gig("checked-no", { qc: "Rejected", portal_student_id: "P2" }),
      gig("open", { qc: "Pending" }),
      gig("new"),
      gig("edited", { status: "Edited", provider_status: "Edited" }),
      gig("unlinked", { qc: "Approved", student_id: null, lifecycle: null, group_id: null, coach_id: null, coach_name: null, coach_active: null }),
    ],
    [],
  );
  assert.deepEqual(placeOf(gap, "checked-ok"), ["coach_tab", null]);
  assert.deepEqual(placeOf(gap, "checked-no"), ["coach_tab", null]);
  assert.deepEqual(placeOf(gap, "open"), ["with_qc", null]);
  assert.deepEqual(placeOf(gap, "new"), ["not_in_queue", "new"], "the queue takes it when Portal gigs QC next opens");
  assert.deepEqual(placeOf(gap, "edited"), ["not_in_queue", "not_pending"], "the queue takes Pending or blank only");
  assert.deepEqual(placeOf(gap, "unlinked"), ["no_coach", "not_linked"]);
  const { not_in_queue, no_coach, with_qc, coach_tab } = gap.places;
  assert.deepEqual([not_in_queue.gigs, no_coach.gigs, with_qc.gigs, coach_tab.gigs], [2, 1, 1, 2]);
  assert.equal(not_in_queue.gigs + no_coach.gigs + with_qc.gigs + coach_tab.gigs, gap.waiting.gigs);
  assert.equal(gap.in_our_system.gigs, gap.waiting.gigs - not_in_queue.gigs);
});

test("a checked gig reaches the coach under the same conditions as the coach's Gigs tab", () => {
  const stuck = (fields) => placeOf(portalCoachGap([gig("g", { qc: "Approved", ...fields })], []), "g");
  assert.deepEqual(stuck({}), ["coach_tab", null]);
  assert.deepEqual(stuck({ student_id: null }), ["no_coach", "not_linked"]);
  assert.deepEqual(stuck({ lifecycle: "Revoked" }), ["no_coach", "revoked"]);
  assert.deepEqual(stuck({ lifecycle: "Withdrawn" }), ["no_coach", "not_active"]);
  assert.deepEqual(stuck({ delivery_model: "Industry" }), ["no_coach", "industry"]);
  assert.deepEqual(stuck({ coach_id: null }), ["no_coach", "no_coach"]);
  assert.deepEqual(stuck({ coach_id: "system-unassigned-coach" }), ["no_coach", "no_coach"]);
  assert.deepEqual(stuck({ coach_active: 0 }), ["no_coach", "no_coach"], "a coach whose account is off");
  assert.deepEqual(placeOf(portalCoachGap([gig("g", { lifecycle: "Revoked" })], []), "g"), ["not_in_queue", "revoked"], "the queue leaves a revoked student out");
});

test("a review still open is in the gap only when its proof no longer waits on the portal", () => {
  const open = (id, fields = {}) => ({ ...gig(id), proof_key: "https://proof.example.org/" + id, qc: "Pending", in_sheet: id, ...fields });
  const gap = portalCoachGap(
    [gig("still", { qc: "Pending" }), gig("gone", { status: "Approved", provider_status: "Approved", qc: "Pending" })],
    [open("still"), open("gone", { status: "Approved", provider_status: "Approved" }), open("left", { in_sheet: null, status: null, provider_status: null })],
  );
  assert.deepEqual(placeOf(gap, "still"), ["with_qc", null]);
  assert.deepEqual(placeOf(gap, "gone"), ["moved_on", "decided_on_portal"]);
  assert.deepEqual(placeOf(gap, "left"), ["moved_on", "not_in_sheet"]);
  assert.equal(gap.places.moved_on.gigs, 2);
  assert.equal(gap.waiting.gigs, 1, "the other direction does not change the portal's count");
});

test("the counts by coach add up, those our QC checked first, with the oldest gig", () => {
  const gap = portalCoachGap(
    [
      gig("a", { coach_id: "C2", coach_name: "Coach Two", created_on: "2026-11-03" }),
      gig("b", { coach_id: "C2", coach_name: "Coach Two", qc: "Pending", created_on: "2026-10-20" }),
      gig("c", { qc: "Approved" }),
      gig("d", { qc: "Rejected" }),
      gig("e", { student_id: null, coach_id: null, coach_name: null, created_on: null }),
    ],
    [],
  );
  assert.deepEqual(
    gap.coaches.map((c) => [c.coach_id, c.waiting, c.qc_approved, c.qc_rejected, c.with_qc, c.not_in_queue, c.oldest]),
    [
      ["C1", 2, 1, 1, 0, 0, "2026-11-01"],
      ["C2", 2, 0, 0, 1, 1, "2026-10-20"],
      [null, 1, 0, 0, 0, 1, null],
    ],
  );
  assert.equal(gap.coaches.reduce((n, c) => n + c.waiting, 0), gap.waiting.gigs);
  assert.deepEqual(gap.gigs.map((g) => g.id).slice(0, 2), ["e", "b"], "oldest first, an undated gig before them");
});
