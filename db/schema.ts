import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  roles: text("roles").notNull(),
  scopes: text("scopes").notNull().default("[]"),
  active: integer("active").notNull().default(1),
});
export const policies = sqliteTable("policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  config: text("config").notNull(),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  createdAt: text("created_at").notNull(),
});
export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  track: text("track").notNull(),
  provider: text("provider").notNull(),
  coordinator: text("coordinator")
    .notNull()
    .references(() => users.id),
  supervisor: text("supervisor")
    .notNull()
    .references(() => users.id),
  coach: text("coach")
    .notNull()
    .references(() => users.id),
  pathway: text("pathway").notNull(),
  startDate: text("start_date").notNull(),
  status: text("status").notNull().default("Active"),
  policyId: text("policy_id")
    .notNull()
    .references(() => policies.id),
});
export const students = sqliteTable(
  "students",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    email: text("email"),
    phone: text("phone"),
    lifecycle: text("lifecycle").notNull().default("Active"),
    engagement: text("engagement").notNull().default("Active"),
    coaching: text("coaching").notNull().default("In Progress"),
    milestone: integer("milestone").notNull().default(0),
    lastContact: text("last_contact"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_students_group").on(t.groupId)],
);
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id").references(() => students.id),
    title: text("title").notNull(),
    owner: text("owner")
      .notNull()
      .references(() => users.id),
    due: text("due").notNull(),
    category: text("category").notNull(),
    priority: text("priority").notNull(),
    status: text("status").notNull().default("Open"),
    source: text("source").unique(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_tasks_owner_status_due").on(t.owner, t.status, t.due)],
);
export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  hash: text("hash").notNull(),
  recorder: text("recorder").notNull(),
  createdAt: text("created_at").notNull(),
});
export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    channel: text("channel").notNull(),
    outcome: text("outcome").notNull(),
    occurredAt: text("occurred_at").notNull(),
    proofId: text("proof_id")
      .notNull()
      .references(() => attachments.id),
    nextAction: text("next_action").notNull(),
    owner: text("owner")
      .notNull()
      .references(() => users.id),
    due: text("due").notNull(),
    notes: text("notes"),
    recorder: text("recorder").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_contacts_student_date").on(t.studentId, t.occurredAt)],
);
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  platform: text("platform").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  credits: real("credits").notNull(),
  secretRef: text("secret_ref"),
  activeAssignment: text("active_assignment"),
});
export const requests = sqliteTable("account_requests", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  task: text("task").notNull(),
  platform: text("platform").notNull(),
  value: real("value").notNull(),
  status: text("status").notNull(),
  taskFit: integer("task_fit").notNull().default(0),
  recorder: text("recorder").notNull(),
  createdAt: text("created_at").notNull(),
});
export const assignments = sqliteTable(
  "account_assignments",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    requestId: text("request_id")
      .notNull()
      .unique()
      .references(() => requests.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("account_group_once").on(t.accountId, t.groupId),
    uniqueIndex("student_account_once").on(t.studentId, t.accountId),
  ],
);
export const gigs = sqliteTable(
  "gigs",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    accountId: text("account_id").references(() => accounts.id),
    platform: text("platform").notNull(),
    title: text("title").notNull(),
    value: real("value").notNull(),
    currency: text("currency").notNull().default("USD"),
    orderRef: text("order_ref"),
    status: text("status").notNull(),
    due: text("due").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("unique_platform_order").on(t.platform, t.orderRef)],
);
export const gigEvents = sqliteTable("gig_events", {
  id: text("id").primaryKey(),
  gigId: text("gig_id")
    .notNull()
    .references(() => gigs.id),
  status: text("status").notNull(),
  proofId: text("proof_id")
    .notNull()
    .references(() => attachments.id),
  performedBy: text("performed_by").notNull(),
  recorder: text("recorder").notNull(),
  occurredAt: text("occurred_at").notNull(),
  createdAt: text("created_at").notNull(),
});
export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .references(() => students.id),
  gigId: text("gig_id")
    .notNull()
    .unique()
    .references(() => gigs.id),
  proofId: text("proof_id")
    .notNull()
    .references(() => attachments.id),
  source: text("source").notNull(),
  status: text("status").notNull(),
  rejections: integer("rejections").notNull().default(0),
  code: text("code"),
  requirements: text("requirements"),
  recorder: text("recorder").notNull(),
  stageAt: text("stage_at").notNull(),
  createdAt: text("created_at").notNull(),
  policyId: text("policy_id")
    .notNull()
    .references(() => policies.id),
});
export const reviews = sqliteTable("evidence_reviews", {
  id: text("id").primaryKey(),
  evidenceId: text("evidence_id")
    .notNull()
    .references(() => evidence.id),
  actor: text("actor").notNull(),
  decision: text("decision").notNull(),
  code: text("code"),
  notes: text("notes").notNull(),
  createdAt: text("created_at").notNull(),
});
export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  studentId: text("student_id").references(() => students.id),
  title: text("title").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull(),
  owner: text("owner")
    .notNull()
    .references(() => users.id),
  due: text("due").notNull(),
  resolution: text("resolution"),
  rootCause: text("root_cause"),
  prevention: text("prevention"),
  verifier: text("verifier"),
  source: text("source").unique(),
  createdAt: text("created_at").notNull(),
});
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  title: text("title").notNull(),
  startsAt: text("starts_at").notNull(),
  status: text("status").notNull(),
  week: integer("week").notNull(),
});
export const attendance = sqliteTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    status: text("status").notNull(),
    recorder: text("recorder").notNull(),
    source: text("source").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("one_attendance").on(t.sessionId, t.studentId)],
);
export const ledger = sqliteTable(
  "graduation_ledger",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    result: text("result").notNull(),
    evidenceIds: text("evidence_ids").notNull(),
    calculatedAt: text("calculated_at").notNull(),
  },
  (t) => [
    index("idx_graduation_ledger_student_date").on(t.studentId, t.calculatedAt),
  ],
);
export const audit = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityId: text("entity_id").notNull(),
  previous: text("previous"),
  value: text("value").notNull(),
  reason: text("reason"),
  requestId: text("request_id").notNull().unique(),
  createdAt: text("created_at").notNull(),
});
export const imports = sqliteTable("imports", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  module: text("module").notNull(),
  summary: text("summary").notNull(),
  createdAt: text("created_at").notNull(),
});
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipient: text("recipient")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    severity: text("severity").notNull(),
    source: text("source").notNull().unique(),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (t) => [
    index("idx_notifications_recipient_date").on(t.recipient, t.createdAt),
  ],
);
export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  kind: text("kind").notNull(),
  payloadHash: text("payload_hash").notNull(),
  status: text("status").notNull(),
  result: text("result"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const taskBank = sqliteTable(
  "task_bank",
  {
    id: text("id").primaryKey(),
    track: text("track").notNull(),
    title: text("title").notNull(),
    platform: text("platform").notNull(),
    value: real("value").notNull(),
    active: integer("active").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("task_bank_track_title").on(t.track, t.title)],
);
export const requestDetails = sqliteTable("account_request_details", {
  requestId: text("request_id")
    .primaryKey()
    .references(() => requests.id),
  taskBankId: text("task_bank_id")
    .notNull()
    .references(() => taskBank.id),
  jobProfile: text("job_profile").notNull(),
  gigNumber: integer("gig_number").notNull(),
  notes: text("notes"),
});
export const attachmentContext = sqliteTable(
  "attachment_context",
  {
    attachmentId: text("attachment_id")
      .primaryKey()
      .references(() => attachments.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    gigId: text("gig_id").references(() => gigs.id),
    accountId: text("account_id").references(() => accounts.id),
    activityType: text("activity_type").notNull(),
    platform: text("platform"),
    occurredAt: text("occurred_at").notNull(),
    source: text("source").notNull(),
    performedByType: text("performed_by_type").notNull(),
    performedByStudentId: text("performed_by_student_id").references(
      () => students.id,
    ),
  },
  (t) => [
    index("idx_attachment_context_gig_activity").on(t.gigId, t.activityType),
  ],
);
export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    module: text("module").notNull(),
    name: text("name").notNull(),
    filters: text("filters").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("saved_view_user_module_name").on(t.userId, t.module, t.name),
  ],
);
export const systemConfiguration = sqliteTable("system_configuration", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  classification: text("classification").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: text("updated_at").notNull(),
});
export const retentionActions = sqliteTable("retention_actions", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  cutoff: text("cutoff").notNull(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  approvedBy: text("approved_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});
export const exportJobs = sqliteTable("export_jobs", {
  id: text("id").primaryKey(),
  actor: text("actor")
    .notNull()
    .references(() => users.id),
  module: text("module").notNull(),
  format: text("format").notNull(),
  filters: text("filters").notNull(),
  count: integer("count").notNull(),
  createdAt: text("created_at").notNull(),
});
export const importRows = sqliteTable(
  "import_rows",
  {
    id: text("id").primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id),
    rowNumber: integer("row_number").notNull(),
    status: text("status").notNull(),
    errors: text("errors"),
    recordId: text("record_id"),
  },
  (t) => [uniqueIndex("import_row_once").on(t.importId, t.rowNumber)],
);
export const caseEvents = sqliteTable(
  "case_events",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.id),
    status: text("status").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => users.id),
    notes: text("notes").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_case_events_case_date").on(t.caseId, t.createdAt)],
);
export const statusEvents = sqliteTable(
  "student_status_events",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    dimension: text("dimension").notNull(),
    previous: text("previous").notNull(),
    value: text("value").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_status_events_student_date").on(t.studentId, t.createdAt)],
);
export const groupGateChecks = sqliteTable(
  "group_gate_checks",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    week: integer("week").notNull(),
    checkKey: text("check_key").notNull(),
    status: text("status").notNull(),
    evidenceId: text("evidence_id").references(() => attachments.id),
    owner: text("owner")
      .notNull()
      .references(() => users.id),
    due: text("due").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("group_gate_check_once").on(t.groupId, t.week, t.checkKey),
  ],
);
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    id: text("id").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("idx_rate_limits_expiry").on(t.expiresAt)],
);
export const fxRates = sqliteTable(
  "fx_rates",
  {
    id: text("id").primaryKey(),
    currency: text("currency").notNull(),
    usdRate: real("usd_rate").notNull(),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("Draft"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    approvedBy: text("approved_by").references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("fx_rate_currency_date").on(t.currency, t.effectiveDate)],
);
export const gigFxApplications = sqliteTable("gig_fx_applications", {
  gigId: text("gig_id")
    .primaryKey()
    .references(() => gigs.id),
  fxRateId: text("fx_rate_id")
    .notNull()
    .references(() => fxRates.id),
  usdValue: real("usd_value").notNull(),
  appliedBy: text("applied_by")
    .notNull()
    .references(() => users.id),
  appliedAt: text("applied_at").notNull(),
});

// Round 5 end-to-end program lifecycle. These tables keep pre-admission,
// delivery, certification, and closure records separate from the operational
// student record while linking every accepted transition back to one person.
export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  provider: text("provider"),
  capacity: integer("capacity"),
  active: integer("active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});
export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    externalRef: text("external_ref").unique(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    preferredTrack: text("preferred_track").notNull(),
    status: text("status").notNull().default("Submitted"),
    source: text("source").notNull(),
    consentRef: text("consent_ref"),
    owner: text("owner")
      .notNull()
      .references(() => users.id),
    submittedAt: text("submitted_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_applications_status_owner").on(t.status, t.owner),
    index("idx_applications_track_status").on(t.preferredTrack, t.status),
  ],
);
export const screenings = sqliteTable(
  "screenings",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id")
      .notNull()
      .references(() => applications.id),
    decision: text("decision").notNull(),
    criteria: text("criteria").notNull(),
    reason: text("reason").notNull(),
    reviewer: text("reviewer")
      .notNull()
      .references(() => users.id),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (t) => [
    index("idx_screenings_application_date").on(t.applicationId, t.reviewedAt),
  ],
);
export const admissions = sqliteTable("admissions", {
  id: text("id").primaryKey(),
  applicationId: text("application_id")
    .notNull()
    .unique()
    .references(() => applications.id),
  studentId: text("student_id")
    .notNull()
    .unique()
    .references(() => students.id),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  assignedBy: text("assigned_by")
    .notNull()
    .references(() => users.id),
  admittedAt: text("admitted_at").notNull(),
});
export const groupCoaches = sqliteTable(
  "group_coaches",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    coachType: text("coach_type").notNull(),
    status: text("status").notNull().default("Active"),
    onboardingStatus: text("onboarding_status").notNull().default("Pending"),
    checklist: text("checklist").notNull().default("[]"),
    assignedBy: text("assigned_by")
      .notNull()
      .references(() => users.id),
    assignedAt: text("assigned_at").notNull(),
    onboardedAt: text("onboarded_at"),
  },
  (t) => [
    uniqueIndex("group_coach_role_once").on(t.groupId, t.userId, t.coachType),
    index("idx_group_coaches_group_status").on(t.groupId, t.status),
  ],
);
export const sessionReports = sqliteTable("session_reports", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id),
  facilitator: text("facilitator")
    .notNull()
    .references(() => users.id),
  notes: text("notes").notNull(),
  attendanceReconciled: integer("attendance_reconciled").notNull(),
  submittedAt: text("submitted_at").notNull(),
});
export const assessments = sqliteTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id").references(() => groups.id),
    title: text("title").notNull(),
    type: text("type").notNull(),
    maxScore: real("max_score").notNull(),
    passScore: real("pass_score").notNull(),
    dueAt: text("due_at").notNull(),
    status: text("status").notNull().default("Open"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_assessments_group_due").on(t.groupId, t.dueAt)],
);
export const assessmentResults = sqliteTable(
  "assessment_results",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id")
      .notNull()
      .references(() => assessments.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    score: real("score").notNull(),
    outcome: text("outcome").notNull(),
    evidenceId: text("evidence_id").references(() => attachments.id),
    notes: text("notes").notNull(),
    assessedBy: text("assessed_by")
      .notNull()
      .references(() => users.id),
    assessedAt: text("assessed_at").notNull(),
  },
  (t) => [
    uniqueIndex("assessment_student_once").on(t.assessmentId, t.studentId),
    index("idx_assessment_results_student").on(t.studentId),
  ],
);
export const certificates = sqliteTable(
  "certificates",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    type: text("type").notNull(),
    status: text("status").notNull(),
    externalRef: text("external_ref").unique(),
    issuedBy: text("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: text("issued_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("certificate_student_type").on(t.studentId, t.type)],
);
export const postProgramOutcomes = sqliteTable(
  "post_program_outcomes",
  {
    id: text("id").primaryKey(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    type: text("type").notNull(),
    organization: text("organization"),
    title: text("title").notNull(),
    value: real("value"),
    currency: text("currency"),
    status: text("status").notNull(),
    proofId: text("proof_id").references(() => attachments.id),
    followUpAt: text("follow_up_at").notNull(),
    owner: text("owner")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_outcomes_student_followup").on(t.studentId, t.followUpAt)],
);
export const withdrawalDecisions = sqliteTable("withdrawal_decisions", {
  id: text("id").primaryKey(),
  studentId: text("student_id")
    .notNull()
    .unique()
    .references(() => students.id),
  ministryReference: text("ministry_reference").notNull().unique(),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  decidedAt: text("decided_at").notNull(),
  recordedBy: text("recorded_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
});
export const groupClosures = sqliteTable(
  "group_closures",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    action: text("action").notNull(),
    snapshot: text("snapshot").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("group_closure_action_once").on(t.groupId, t.action)],
);
export const accountReservations = sqliteTable("account_reservations", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => accounts.id),
  id: text("id").notNull().unique(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id),
  reservedBy: text("reserved_by")
    .notNull()
    .references(() => users.id),
  expiresAt: text("expires_at").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});
export const accountCreditLedger = sqliteTable(
  "account_credit_ledger",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    assignmentId: text("assignment_id").references(() => assignments.id),
    gigId: text("gig_id").references(() => gigs.id),
    delta: real("delta").notNull(),
    balanceAfter: real("balance_after").notNull(),
    reason: text("reason").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_account_credit_ledger_account_date").on(
      t.accountId,
      t.createdAt,
    ),
  ],
);
export const evidencePackages = sqliteTable(
  "evidence_packages",
  {
    id: text("id").primaryKey(),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id),
    revision: integer("revision").notNull(),
    status: text("status").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("evidence_package_revision").on(t.evidenceId, t.revision),
  ],
);
export const evidencePackageItems = sqliteTable(
  "evidence_package_items",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => evidencePackages.id),
    itemType: text("item_type").notNull(),
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachments.id),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("evidence_package_item_type").on(t.packageId, t.itemType),
  ],
);
export const reportDefinitions = sqliteTable("report_definitions", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  status: text("status").notNull(),
  columns: text("columns").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const reportRuns = sqliteTable("report_runs", {
  id: text("id").primaryKey(),
  definitionId: text("definition_id")
    .notNull()
    .references(() => reportDefinitions.id),
  actor: text("actor")
    .notNull()
    .references(() => users.id),
  filters: text("filters").notNull(),
  count: integer("count").notNull(),
  createdAt: text("created_at").notNull(),
});
