// A student's figures from the portal sheets: the Overview and the Dashboard
// read graduation and gigs from here, so they follow every upload.
import test from "node:test";
import assert from "node:assert/strict";
import { coachStatusOf, portalFiguresByStudent, portalGigStage, portalGraduation, sumPortalFigures } from "../lib/domain/portal-figures.ts";

test("the coach's decision is Trainer Status; Provider Status is the portal's QC, after the coach", () => {
  // The coach approved; the portal's QC has not decided yet: no longer the coach's.
  assert.equal(portalGigStage({ status: "Pending", trainer_status: "Approved", provider_status: "Pending", auditor_status: "Pending" }), "auditor");
  assert.equal(portalGigStage({ status: "Edited", trainer_status: "Approved", provider_status: "Pending", auditor_status: "Pending" }), "auditor");
  // Still the coach's, whatever the portal's QC says.
  assert.equal(portalGigStage({ status: "Pending", trainer_status: "Pending", provider_status: "Approved" }), "coach");
  assert.equal(portalGigStage({ status: "Edited", trainer_status: "Edited", provider_status: "Pending" }), "coach");
  assert.equal(portalGigStage({ status: "Rejected", trainer_status: "Approved", provider_status: "Rejected" }), "rejected");
  assert.equal(coachStatusOf({ trainer_status: "Edited", provider_status: "Approved" }), "Edited");
  // A sheet from before 7 November has no Trainer Status: Provider Status stands in.
  assert.equal(coachStatusOf({ trainer_status: null, provider_status: "Approved" }), "Approved");
  assert.equal(portalGigStage({ status: "Pending", provider_status: "Approved" }), "auditor");
});

test("a portal gig is approved or rejected for good, or waits for the coach, then the auditor", () => {
  assert.equal(portalGigStage({ status: "Approved", provider_status: "Approved", auditor_status: "Approved" }), "approved");
  assert.equal(portalGigStage({ status: "Rejected", provider_status: "Approved", auditor_status: "Rejected" }), "rejected");
  assert.equal(portalGigStage({ status: "Rejected", provider_status: "Pending", auditor_status: "Pending" }), "rejected");
  assert.equal(portalGigStage({ status: "Pending", provider_status: "Pending", auditor_status: "Pending" }), "coach");
  assert.equal(portalGigStage({ status: "Edited", provider_status: "", auditor_status: "" }), "coach");
  assert.equal(portalGigStage({ status: "Pending", provider_status: "Approved", auditor_status: "Pending" }), "auditor");
  assert.equal(portalGigStage({ status: "Edited", provider_status: "Approved", auditor_status: "Edited" }), "auditor");
});

test("each linked student's graduation and gigs, the further record winning when there are two", () => {
  const figures = portalFiguresByStudent(
    [
      { student_id: "S1", final_status: "Graduated", graduate_type: "3 Gigs" },
      { student_id: "S2", final_status: "Started", graduate_type: "Not Graduated" },
      { student_id: "S2", final_status: "Not Started", graduate_type: "Not Graduated" },
      { student_id: null, final_status: "Graduated" },
    ],
    [
      { student_id: "S1", status: "Approved", provider_status: "Approved", auditor_status: "Approved", qc: "Approved" },
      { student_id: "S1", status: "Approved", provider_status: "Approved", auditor_status: "Approved" },
      { student_id: "S2", status: "Pending", provider_status: "Pending", auditor_status: "Pending", qc: "Rejected" },
      { student_id: "S2", status: "Pending", provider_status: "Approved", auditor_status: "Pending" },
      { student_id: "S9", status: "Approved" },
    ],
  );
  assert.deepEqual([...figures.keys()].sort(), ["S1", "S2"], "an unlinked row and a gig of nobody we know are left out");
  assert.equal(figures.get("S1").graduated, true);
  assert.equal(figures.get("S2").final_status, "Started");
  assert.deepEqual(
    [figures.get("S2").gigs, figures.get("S2").coach, figures.get("S2").auditor, figures.get("S2").qc_rejected],
    [2, 1, 1, 1],
  );
  assert.deepEqual([portalGraduation(figures.get("S1")), portalGraduation(figures.get("S2")), portalGraduation(null)], ["Graduated", "0/3", "0/3"]);
  assert.equal(portalGraduation({ graduated: false, approved: 5 }), "3/3", "three approved but not yet graduated on the portal");
  const total = sumPortalFigures([figures.get("S1"), figures.get("S2"), null]);
  assert.deepEqual([total.students, total.graduated, total.gigs, total.approved, total.coach, total.auditor, total.qc_approved, total.qc_rejected], [2, 1, 4, 2, 1, 1, 1, 1]);
});
