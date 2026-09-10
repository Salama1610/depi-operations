// Installed after the host has applied table migrations. Keeping these outside the
// migration archive avoids the hosted runner's semicolon splitter while preserving
// database-level safeguards for every initialized workspace and restored backup.
export const runtimeTriggers = [
  `CREATE TRIGGER IF NOT EXISTS account_assignment_guard BEFORE INSERT ON account_assignments BEGIN
    SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM accounts a JOIN account_requests r ON r.id=NEW.request_id JOIN students s ON s.id=NEW.student_id WHERE a.id=NEW.account_id AND a.status='Available' AND a.active_assignment IS NULL AND a.credits>=r.value AND a.platform=r.platform AND r.status='Submitted' AND r.student_id=NEW.student_id AND s.group_id=NEW.group_id) THEN RAISE(ABORT,'Account assignment eligibility changed; refresh and retry.') END;
  END`,
  `CREATE TRIGGER IF NOT EXISTS account_nonnegative_insert BEFORE INSERT ON accounts WHEN NEW.credits<0 BEGIN SELECT RAISE(ABORT,'Account credits cannot be negative.'); END`,
  `CREATE TRIGGER IF NOT EXISTS account_nonnegative_update BEFORE UPDATE ON accounts WHEN NEW.credits<0 BEGIN SELECT RAISE(ABORT,'Account credits cannot be negative.'); END`,
  `CREATE TRIGGER IF NOT EXISTS account_platform_insert BEFORE INSERT ON accounts WHEN NEW.platform NOT IN ('Kafeel','Nafezly','Khamsat') BEGIN SELECT RAISE(ABORT,'Controlled account platform is not approved.'); END`,
  `CREATE TRIGGER IF NOT EXISTS account_platform_update BEFORE UPDATE OF platform ON accounts WHEN NEW.platform NOT IN ('Kafeel','Nafezly','Khamsat') BEGIN SELECT RAISE(ABORT,'Controlled account platform is not approved.'); END`,
  `CREATE TRIGGER IF NOT EXISTS task_bank_platform_insert BEFORE INSERT ON task_bank WHEN NEW.platform NOT IN ('Kafeel','Nafezly','Khamsat') OR NEW.value<=0 BEGIN SELECT RAISE(ABORT,'Controlled task platform or value is invalid.'); END`,
  `CREATE TRIGGER IF NOT EXISTS account_retired_terminal BEFORE UPDATE OF status ON accounts WHEN OLD.status='Retired' AND NEW.status<>'Retired' BEGIN SELECT RAISE(ABORT,'Retired accounts cannot be reopened.'); END`,
  `CREATE TRIGGER IF NOT EXISTS contact_complete BEFORE INSERT ON contacts BEGIN
    SELECT CASE WHEN trim(NEW.next_action)='' OR trim(NEW.outcome)='' OR trim(NEW.due)='' OR NOT EXISTS(SELECT 1 FROM attachments a WHERE a.id=NEW.proof_id AND a.student_id=NEW.student_id) THEN RAISE(ABORT,'Complete contact requires matching proof, outcome, next action and due date.') END;
  END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS reviews_no_update BEFORE UPDATE ON evidence_reviews BEGIN SELECT RAISE(ABORT,'Review history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS reviews_no_delete BEFORE DELETE ON evidence_reviews BEGIN SELECT RAISE(ABORT,'Review history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS credit_ledger_no_update BEFORE UPDATE ON account_credit_ledger BEGIN SELECT RAISE(ABORT,'Account credit history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS credit_ledger_no_delete BEFORE DELETE ON account_credit_ledger BEGIN SELECT RAISE(ABORT,'Account credit history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS withdrawal_no_update BEFORE UPDATE ON withdrawal_decisions BEGIN SELECT RAISE(ABORT,'Ministry withdrawal decisions are immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS withdrawal_no_delete BEFORE DELETE ON withdrawal_decisions BEGIN SELECT RAISE(ABORT,'Ministry withdrawal decisions are immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS group_closure_no_update BEFORE UPDATE ON group_closures BEGIN SELECT RAISE(ABORT,'Group closure history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS group_closure_no_delete BEFORE DELETE ON group_closures BEGIN SELECT RAISE(ABORT,'Group closure history is immutable.'); END`,
  `CREATE TRIGGER IF NOT EXISTS gig_valid_transition BEFORE UPDATE OF status ON gigs WHEN NEW.status<>OLD.status BEGIN
    SELECT CASE WHEN NOT ((OLD.status='Account Assigned' AND NEW.status='Gig Opened') OR (OLD.status='Gig Opened' AND NEW.status='Work Submitted') OR (OLD.status='Work Submitted' AND NEW.status='Delivered') OR (OLD.status='Delivered' AND NEW.status='Paid') OR (OLD.status NOT IN ('Paid','Cancelled','Failed') AND NEW.status IN ('Cancelled','Failed'))) THEN RAISE(ABORT,'Invalid gig workflow transition.') END;
  END`,
  `CREATE TRIGGER IF NOT EXISTS evidence_paid_intake BEFORE INSERT ON evidence BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gigs g JOIN attachments a ON a.id=NEW.proof_id WHERE g.id=NEW.gig_id AND g.student_id=NEW.student_id AND a.student_id=NEW.student_id AND g.status='Paid') THEN RAISE(ABORT,'Evidence requires a paid gig and matching proof.') END; END`,
  `CREATE TRIGGER IF NOT EXISTS gig_no_delete BEFORE DELETE ON gigs BEGIN SELECT RAISE(ABORT,'Gigs must remain in history.'); END`,
  `CREATE TRIGGER IF NOT EXISTS effective_policy_immutable BEFORE UPDATE OF config ON policies WHEN OLD.status IN ('Approved','Effective','Superseded') BEGIN SELECT RAISE(ABORT,'Approved policy contents are immutable; create a new version.'); END`,
  `CREATE TRIGGER IF NOT EXISTS approved_fx_immutable BEFORE UPDATE OF currency,usd_rate,effective_date,source ON fx_rates WHEN OLD.status='Approved' BEGIN SELECT RAISE(ABORT,'Approved FX evidence is immutable; create a new rate.'); END`,
  `CREATE TRIGGER IF NOT EXISTS gig_fx_approved_insert BEFORE INSERT ON gig_fx_applications BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gigs g JOIN fx_rates r ON r.id=NEW.fx_rate_id WHERE g.id=NEW.gig_id AND g.currency<>'USD' AND g.currency=r.currency AND r.status='Approved' AND NEW.usd_value>0) THEN RAISE(ABORT,'Gig FX application requires a matching approved rate.') END; END`,
  `CREATE TRIGGER IF NOT EXISTS gig_fx_approved_update BEFORE UPDATE ON gig_fx_applications BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gigs g JOIN fx_rates r ON r.id=NEW.fx_rate_id WHERE g.id=NEW.gig_id AND g.currency<>'USD' AND g.currency=r.currency AND r.status='Approved' AND NEW.usd_value>0) THEN RAISE(ABORT,'Gig FX application requires a matching approved rate.') END; END`,
  `CREATE TRIGGER IF NOT EXISTS evidence_valid_transition BEFORE UPDATE OF status ON evidence WHEN NEW.status<>OLD.status BEGIN
    SELECT CASE WHEN NOT ((OLD.status='Coach Review' AND NEW.status='Coordinator L1') OR (OLD.status='Coordinator L1' AND NEW.status='Quality Review') OR (OLD.status='Quality Review' AND NEW.status IN ('Accepted','Rejected','L3 Review')) OR (OLD.status='Rejected' AND NEW.status IN ('Quality Review','L3 Review')) OR (OLD.status='L3 Review' AND NEW.status IN ('Accepted','Rejected','Closed L3')) OR (OLD.status='Accepted' AND NEW.status='L3 Review')) THEN RAISE(ABORT,'Evidence state changed or transition is invalid; refresh the review.') END;
  END`,
];
