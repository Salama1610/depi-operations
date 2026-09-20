-- DEPI Round 5 operational schema for Supabase/PostgreSQL.
--
-- IDs intentionally remain text because the existing operational dataset uses
-- stable business identifiers (for example S10901 and DEMO-EV-4). Supabase Auth
-- identities are linked separately through users.auth_user_id and normalized
-- email, so importing the existing D1 dataset does not rewrite foreign keys.

create schema if not exists app_private;

create table public.users (
  id text primary key,
  email text not null,
  name text not null,
  roles jsonb not null default '[]'::jsonb check (jsonb_typeof(roles) = 'array'),
  scopes jsonb not null default '[]'::jsonb check (jsonb_typeof(scopes) = 'array'),
  active boolean not null default true,
  -- Kept last so the application's positional INSERT INTO users VALUES(...) keeps
  -- matching the D1 column order; PostgreSQL fills trailing columns with defaults.
  auth_user_id uuid unique references auth.users(id) on delete set null
);
create unique index users_email_identity on public.users (lower(email));

create table public.policies (
  id text primary key,
  name text not null,
  status text not null,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_by text not null references public.users(id),
  approved_by text references public.users(id),
  created_at timestamptz not null default now()
);

create table public.groups (
  id text primary key,
  name text not null,
  track text not null,
  provider text not null,
  coordinator text not null references public.users(id),
  supervisor text not null references public.users(id),
  coach text not null references public.users(id),
  pathway text not null,
  delivery_model text not null default 'Regular' check (delivery_model in ('Regular', 'Industry')),
  start_date date not null,
  status text not null default 'Active',
  policy_id text not null references public.policies(id)
);

create table public.students (
  id text primary key,
  tp_id text,
  national_id text,
  name text not null,
  name_ar text,
  group_id text not null references public.groups(id),
  email text,
  phone text,
  job_profile text,
  student_type text,
  source_status text,
  serial text,
  round_1 text,
  source_row integer check (source_row is null or source_row > 0),
  lifecycle text not null default 'Active',
  engagement text not null default 'Active',
  coaching text not null default 'In Progress',
  milestone integer not null default 0 check (milestone >= 0),
  last_contact timestamptz,
  created_at timestamptz not null default now()
);
create index idx_students_group on public.students(group_id);
create unique index student_email_identity on public.students(lower(email))
  where email is not null and btrim(email) <> '';
create unique index student_tp_identity on public.students(tp_id)
  where tp_id is not null and btrim(tp_id) <> '';
create unique index student_national_identity on public.students(national_id)
  where national_id is not null and btrim(national_id) <> '';

create table public.tasks (
  id text primary key,
  student_id text references public.students(id),
  title text not null,
  owner text not null references public.users(id),
  due timestamptz not null,
  category text not null,
  priority text not null,
  status text not null default 'Open',
  source text unique,
  created_at timestamptz not null default now()
);
create index idx_tasks_owner_status_due on public.tasks(owner, status, due);

create table public.attachments (
  id text primary key,
  student_id text not null references public.students(id),
  key text not null unique,
  name text not null,
  mime text not null check (mime in ('image/png', 'image/jpeg')),
  size bigint not null check (size > 0),
  hash text not null,
  recorder text not null,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id text primary key,
  student_id text not null references public.students(id),
  channel text not null,
  outcome text not null,
  occurred_at timestamptz not null,
  proof_id text not null references public.attachments(id),
  next_action text not null,
  owner text not null references public.users(id),
  due timestamptz not null,
  notes text,
  recorder text not null,
  created_at timestamptz not null default now(),
  check (due >= occurred_at)
);
create index idx_contacts_student_date on public.contacts(student_id, occurred_at);

create table public.accounts (
  id text primary key,
  platform text not null check (platform in ('Kafeel', 'Nafezly', 'Khamsat')),
  label text not null,
  status text not null,
  credits numeric(14,2) not null check (credits >= 0),
  secret_ref text,
  active_assignment text
);

create table public.account_requests (
  id text primary key,
  student_id text not null references public.students(id),
  task text not null,
  platform text not null check (platform in ('Kafeel', 'Nafezly', 'Khamsat')),
  value numeric(14,2) not null check (value > 0),
  status text not null,
  task_fit boolean not null default false,
  recorder text not null,
  created_at timestamptz not null default now()
);

create table public.account_assignments (
  id text primary key,
  account_id text not null references public.accounts(id),
  student_id text not null references public.students(id),
  group_id text not null references public.groups(id),
  request_id text not null unique references public.account_requests(id),
  created_at timestamptz not null default now(),
  unique (account_id, group_id),
  unique (student_id, account_id)
);

create table public.gigs (
  id text primary key,
  student_id text not null references public.students(id),
  account_id text references public.accounts(id),
  platform text not null,
  title text not null,
  value numeric(14,2) not null check (value > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  order_ref text,
  status text not null,
  due timestamptz not null,
  created_at timestamptz not null default now(),
  unique (platform, order_ref)
);

create table public.gig_events (
  id text primary key,
  gig_id text not null references public.gigs(id),
  status text not null,
  proof_id text not null references public.attachments(id),
  performed_by text not null,
  recorder text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.evidence (
  id text primary key,
  student_id text not null references public.students(id),
  gig_id text not null unique references public.gigs(id),
  proof_id text not null references public.attachments(id),
  source text not null,
  status text not null,
  rejections integer not null default 0 check (rejections >= 0),
  code text,
  requirements text,
  recorder text not null,
  stage_at timestamptz not null,
  created_at timestamptz not null default now(),
  policy_id text not null references public.policies(id)
);

create table public.evidence_reviews (
  id text primary key,
  evidence_id text not null references public.evidence(id),
  actor text not null,
  decision text not null,
  code text,
  notes text not null,
  created_at timestamptz not null default now()
);

create table public.cases (
  id text primary key,
  student_id text references public.students(id),
  title text not null,
  type text not null,
  severity text not null,
  status text not null,
  owner text not null references public.users(id),
  due timestamptz not null,
  resolution text,
  root_cause text,
  prevention text,
  verifier text,
  source text unique,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id text primary key,
  group_id text not null references public.groups(id),
  coach_id text references public.users(id),
  title text not null,
  starts_at timestamptz not null,
  session_day date not null,
  duration_minutes integer not null default 180 check (duration_minutes = 180),
  status text not null,
  week integer not null check (week > 0),
  confirmed_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now()
);
create unique index one_active_session_per_group_week on public.sessions(group_id, week)
  where status <> 'Cancelled';
create unique index one_active_coach_session_per_day on public.sessions(coach_id, session_day)
  where coach_id is not null and status <> 'Cancelled';
create index idx_sessions_start on public.sessions(starts_at);

create table public.attendance (
  id text primary key,
  session_id text not null references public.sessions(id),
  student_id text not null references public.students(id),
  status text not null,
  recorder text not null,
  source text not null,
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.graduation_ledger (
  id text primary key,
  student_id text not null references public.students(id),
  policy_id text not null references public.policies(id),
  result text not null,
  evidence_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_ids) = 'array'),
  calculated_at timestamptz not null default now()
);
create index idx_graduation_ledger_student_date on public.graduation_ledger(student_id, calculated_at);

create table public.audit_events (
  id text primary key,
  actor text not null,
  action text not null,
  entity_id text not null,
  previous jsonb,
  value jsonb not null,
  reason text,
  request_id text not null unique,
  created_at timestamptz not null default now()
);

create table public.imports (
  id text primary key,
  actor text not null,
  module text not null,
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id text primary key,
  recipient text not null references public.users(id),
  title text not null,
  entity_type text not null,
  entity_id text not null,
  severity text not null,
  source text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index idx_notifications_recipient_date on public.notifications(recipient, created_at);

create table public.automation_runs (
  id text primary key,
  actor text not null,
  kind text not null,
  payload_hash text not null,
  status text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_bank (
  id text primary key,
  track text not null,
  title text not null,
  platform text not null check (platform in ('Kafeel', 'Nafezly', 'Khamsat')),
  value numeric(14,2) not null check (value > 0),
  active boolean not null default true,
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (track, title)
);

create table public.account_request_details (
  request_id text primary key references public.account_requests(id),
  task_bank_id text not null references public.task_bank(id),
  job_profile text not null,
  gig_number integer not null check (gig_number > 0),
  notes text
);

create table public.attachment_context (
  attachment_id text primary key references public.attachments(id),
  group_id text not null references public.groups(id),
  gig_id text references public.gigs(id),
  account_id text references public.accounts(id),
  activity_type text not null,
  platform text,
  occurred_at timestamptz not null,
  source text not null,
  performed_by_type text not null,
  performed_by_student_id text references public.students(id)
);
create index idx_attachment_context_gig_activity on public.attachment_context(gig_id, activity_type);

create table public.saved_views (
  id text primary key,
  user_id text not null references public.users(id),
  module text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, module, name)
);

create table public.system_configuration (
  key text primary key,
  value jsonb not null,
  classification text not null,
  updated_by text not null references public.users(id),
  updated_at timestamptz not null default now()
);

create table public.retention_actions (
  id text primary key,
  scope text not null,
  cutoff timestamptz not null,
  action text not null,
  status text not null,
  reason text not null,
  approved_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.export_jobs (
  id text primary key,
  actor text not null references public.users(id),
  module text not null,
  format text not null,
  filters jsonb not null default '{}'::jsonb,
  count integer not null check (count >= 0),
  created_at timestamptz not null default now()
);

create table public.import_rows (
  id text primary key,
  import_id text not null references public.imports(id),
  row_number integer not null check (row_number > 0),
  status text not null,
  errors jsonb,
  record_id text,
  unique (import_id, row_number)
);

create table public.roster_imports (
  id text primary key,
  source_name text not null,
  source_sheet text not null,
  source_sha256 text not null unique,
  total_rows integer not null check (total_rows >= 0),
  canonical_students integer not null check (canonical_students >= 0),
  duplicate_rows integer not null check (duplicate_rows >= 0),
  status text not null,
  summary jsonb not null,
  created_at timestamptz not null default now(),
  check (canonical_students + duplicate_rows <= total_rows)
);

create table public.roster_source_rows (
  id text primary key,
  import_id text not null references public.roster_imports(id),
  row_number integer not null check (row_number > 0),
  student_id text references public.students(id),
  disposition text not null,
  reason text,
  payload jsonb not null,
  unique (import_id, row_number)
);
create index idx_roster_source_student on public.roster_source_rows(student_id);

create table public.case_events (
  id text primary key,
  case_id text not null references public.cases(id),
  status text not null,
  actor text not null references public.users(id),
  notes text not null,
  created_at timestamptz not null default now()
);
create index idx_case_events_case_date on public.case_events(case_id, created_at);

create table public.student_status_events (
  id text primary key,
  student_id text not null references public.students(id),
  dimension text not null,
  previous text not null,
  value text not null,
  actor text not null references public.users(id),
  reason text not null,
  created_at timestamptz not null default now()
);
create index idx_status_events_student_date on public.student_status_events(student_id, created_at);

create table public.group_gate_checks (
  id text primary key,
  group_id text not null references public.groups(id),
  week integer not null check (week > 0),
  check_key text not null,
  status text not null,
  evidence_id text references public.attachments(id),
  owner text not null references public.users(id),
  due timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (group_id, week, check_key)
);

create table public.rate_limits (
  id text primary key,
  count integer not null check (count > 0),
  expires_at timestamptz not null
);
create index idx_rate_limits_expiry on public.rate_limits(expires_at);

create table public.fx_rates (
  id text primary key,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  usd_rate numeric(20,8) not null check (usd_rate > 0),
  effective_date date not null,
  source text not null,
  status text not null default 'Draft',
  created_by text not null references public.users(id),
  approved_by text references public.users(id),
  created_at timestamptz not null default now(),
  unique (currency, effective_date),
  check (approved_by is null or approved_by <> created_by)
);

create table public.gig_fx_applications (
  gig_id text primary key references public.gigs(id),
  fx_rate_id text not null references public.fx_rates(id),
  usd_value numeric(14,2) not null check (usd_value > 0),
  applied_by text not null references public.users(id),
  applied_at timestamptz not null default now()
);

create table public.tracks (
  id text primary key,
  name text not null unique,
  provider text,
  capacity integer check (capacity is null or capacity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.applications (
  id text primary key,
  external_ref text unique,
  name text not null,
  email text,
  phone text,
  preferred_track text not null,
  status text not null default 'Submitted',
  source text not null,
  consent_ref text,
  owner text not null references public.users(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_applications_status_owner on public.applications(status, owner);
create index idx_applications_track_status on public.applications(preferred_track, status);

create table public.screenings (
  id text primary key,
  application_id text not null references public.applications(id),
  decision text not null,
  criteria jsonb not null,
  reason text not null,
  reviewer text not null references public.users(id),
  reviewed_at timestamptz not null default now()
);
create index idx_screenings_application_date on public.screenings(application_id, reviewed_at);

create table public.admissions (
  id text primary key,
  application_id text not null unique references public.applications(id),
  student_id text not null unique references public.students(id),
  group_id text not null references public.groups(id),
  assigned_by text not null references public.users(id),
  admitted_at timestamptz not null default now()
);

create table public.group_coaches (
  id text primary key,
  group_id text not null references public.groups(id),
  user_id text not null references public.users(id),
  coach_type text not null,
  status text not null default 'Active',
  onboarding_status text not null default 'Pending',
  checklist jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  assigned_by text not null references public.users(id),
  assigned_at timestamptz not null default now(),
  onboarded_at timestamptz,
  unique (group_id, user_id, coach_type)
);
create index idx_group_coaches_group_status on public.group_coaches(group_id, status);

create table public.session_reports (
  session_id text primary key references public.sessions(id),
  facilitator text not null references public.users(id),
  notes text not null,
  attendance_reconciled boolean not null,
  submitted_at timestamptz not null default now()
);

create table public.assessments (
  id text primary key,
  group_id text references public.groups(id),
  title text not null,
  type text not null,
  max_score numeric(10,2) not null check (max_score > 0),
  pass_score numeric(10,2) not null check (pass_score >= 0 and pass_score <= max_score),
  due_at timestamptz not null,
  status text not null default 'Open',
  created_by text not null references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_assessments_group_due on public.assessments(group_id, due_at);

create table public.assessment_results (
  id text primary key,
  assessment_id text not null references public.assessments(id),
  student_id text not null references public.students(id),
  score numeric(10,2) not null check (score >= 0),
  outcome text not null,
  evidence_id text references public.attachments(id),
  notes text not null,
  assessed_by text not null references public.users(id),
  assessed_at timestamptz not null default now(),
  unique (assessment_id, student_id)
);
create index idx_assessment_results_student on public.assessment_results(student_id);

create table public.certificates (
  id text primary key,
  student_id text not null references public.students(id),
  type text not null,
  status text not null,
  external_ref text unique,
  issued_by text not null references public.users(id),
  issued_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (student_id, type)
);

create table public.post_program_outcomes (
  id text primary key,
  student_id text not null references public.students(id),
  type text not null,
  organization text,
  title text not null,
  value numeric(14,2) check (value is null or value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  status text not null,
  proof_id text references public.attachments(id),
  follow_up_at timestamptz not null,
  owner text not null references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_outcomes_student_followup on public.post_program_outcomes(student_id, follow_up_at);

create table public.withdrawal_decisions (
  id text primary key,
  student_id text not null unique references public.students(id),
  ministry_reference text not null unique,
  decision text not null,
  reason text not null,
  decided_at timestamptz not null,
  recorded_by text not null references public.users(id),
  created_at timestamptz not null default now()
);

create table public.group_closures (
  id text primary key,
  group_id text not null references public.groups(id),
  action text not null,
  snapshot jsonb not null,
  reason text not null,
  actor text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (group_id, action)
);

create table public.account_reservations (
  account_id text primary key references public.accounts(id),
  id text not null unique,
  request_id text not null references public.account_requests(id),
  reserved_by text not null references public.users(id),
  expires_at timestamptz not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table public.account_credit_ledger (
  id text primary key,
  account_id text not null references public.accounts(id),
  assignment_id text references public.account_assignments(id),
  gig_id text references public.gigs(id),
  delta numeric(14,2) not null,
  balance_after numeric(14,2) not null check (balance_after >= 0),
  reason text not null,
  actor text not null references public.users(id),
  created_at timestamptz not null default now()
);
create index idx_account_credit_ledger_account_date on public.account_credit_ledger(account_id, created_at);

create table public.evidence_packages (
  id text primary key,
  evidence_id text not null references public.evidence(id),
  revision integer not null check (revision > 0),
  status text not null,
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (evidence_id, revision)
);

create table public.evidence_package_items (
  id text primary key,
  package_id text not null references public.evidence_packages(id),
  item_type text not null,
  attachment_id text not null references public.attachments(id),
  created_at timestamptz not null default now(),
  unique (package_id, item_type)
);

create table public.report_definitions (
  id text primary key,
  name text not null unique,
  status text not null,
  columns jsonb not null check (jsonb_typeof(columns) = 'array'),
  created_by text not null references public.users(id),
  created_at timestamptz not null default now(),
  approved_by text references public.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> created_by)
);

create table public.report_runs (
  id text primary key,
  definition_id text not null references public.report_definitions(id),
  actor text not null references public.users(id),
  filters jsonb not null default '{}'::jsonb,
  count integer not null check (count >= 0),
  created_at timestamptz not null default now()
);

create table public.service_submissions (
  id text primary key,
  student_id text not null unique references public.students(id),
  status text not null default 'Pending QC',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  qc_completed_at timestamptz
);
create index idx_service_submissions_status on public.service_submissions(status);

create table public.service_links (
  id text primary key,
  student_id text not null references public.students(id),
  slot smallint not null check (slot between 1 and 3),
  url text not null,
  normalized_url text not null,
  platform text not null check (platform in ('Kafiil', 'Khamsat')),
  auto_status text not null default 'Needs Review',
  auto_result jsonb not null default '{}'::jsonb,
  auto_checked_at timestamptz,
  qc_status text not null default 'Pending',
  qc_comment text,
  qc_actor text references public.users(id),
  qc_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, slot)
);
create index idx_service_links_qc_status on public.service_links(qc_status, updated_at);
create index idx_service_links_student on public.service_links(student_id);
create unique index service_link_student_url on public.service_links(student_id, normalized_url);

create table public.service_link_reviews (
  id text primary key,
  service_link_id text not null references public.service_links(id),
  revision integer not null check (revision > 0),
  decision text not null,
  comment text not null,
  reviewed_by text not null references public.users(id),
  reviewed_at timestamptz not null default now(),
  unique (service_link_id, revision)
);
create index idx_service_link_reviews_link_date on public.service_link_reviews(service_link_id, reviewed_at);

comment on table public.users is 'Application staff identities linked to Supabase Auth without replacing stable business IDs.';
comment on table public.students is 'Canonical Round 5 student roster; email is the Supabase Auth identity fallback.';
comment on table public.audit_events is 'Append-only operational audit history protected by an integrity trigger.';
comment on table public.service_links is 'Three-slot student service-link submission model with per-revision QC.';
