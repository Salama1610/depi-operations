-- Database-enforced business invariants and row-level authorization.
-- Authenticated clients receive read access only. All writes are intentionally
-- performed by the trusted backend (service role) after domain authorization.

create or replace function app_private.reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is immutable', tg_table_name using errcode = '55000';
end;
$$;

create or replace function app_private.validate_contact()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if btrim(new.next_action) = '' or btrim(new.outcome) = '' then
    raise exception 'Complete contact requires an outcome and next action.' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.attachments a
    where a.id = new.proof_id and a.student_id = new.student_id
  ) then
    raise exception 'Contact proof must belong to the same student.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger contact_complete
before insert or update of student_id, proof_id, outcome, next_action, due
on public.contacts for each row execute function app_private.validate_contact();

create or replace function app_private.validate_account_assignment()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  eligible boolean;
begin
  -- Lock the controlled account so two concurrent allocation transactions
  -- cannot both validate against the same Available balance.
  select true into eligible
  from public.accounts a
  join public.account_requests r on r.id = new.request_id
  join public.students s on s.id = new.student_id
  where a.id = new.account_id
    and a.status = 'Available'
    and a.active_assignment is null
    and a.credits >= r.value
    and a.platform = r.platform
    and r.status = 'Submitted'
    and r.student_id = new.student_id
    and s.group_id = new.group_id
  for update of a;

  if eligible is not true then
    raise exception 'Account assignment eligibility changed; refresh and retry.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger account_assignment_guard
before insert on public.account_assignments
for each row execute function app_private.validate_account_assignment();

create or replace function app_private.validate_evidence_intake()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.gigs g
    join public.attachments a on a.id = new.proof_id
    where g.id = new.gig_id
      and g.student_id = new.student_id
      and a.student_id = new.student_id
      and g.status = 'Paid'
  ) then
    raise exception 'Evidence requires a paid gig and matching proof.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger evidence_paid_intake
before insert or update of student_id, gig_id, proof_id
on public.evidence for each row execute function app_private.validate_evidence_intake();

create or replace function app_private.validate_gig_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'Account Assigned' and new.status = 'Gig Opened') or
    (old.status = 'Gig Opened' and new.status = 'Work Submitted') or
    (old.status = 'Work Submitted' and new.status = 'Delivered') or
    (old.status = 'Delivered' and new.status = 'Paid') or
    (old.status not in ('Paid', 'Cancelled', 'Failed') and new.status in ('Cancelled', 'Failed'))
  ) then
    raise exception 'Invalid gig workflow transition: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger gig_valid_transition
before update of status on public.gigs
for each row execute function app_private.validate_gig_transition();

create or replace function app_private.validate_evidence_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'Coach Review' and new.status = 'Coordinator L1') or
    (old.status = 'Coordinator L1' and new.status = 'Quality Review') or
    (old.status = 'Quality Review' and new.status in ('Accepted', 'Rejected', 'L3 Review')) or
    (old.status = 'Rejected' and new.status in ('Quality Review', 'L3 Review')) or
    (old.status = 'L3 Review' and new.status in ('Accepted', 'Rejected', 'Closed L3')) or
    (old.status = 'Accepted' and new.status = 'L3 Review')
  ) then
    raise exception 'Invalid evidence workflow transition: % -> %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger evidence_valid_transition
before update of status on public.evidence
for each row execute function app_private.validate_evidence_transition();

create or replace function app_private.validate_gig_fx()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1 from public.gigs g
    join public.fx_rates r on r.id = new.fx_rate_id
    where g.id = new.gig_id
      and g.currency <> 'USD'
      and g.currency = r.currency
      and r.status = 'Approved'
      and new.usd_value > 0
  ) then
    raise exception 'Gig FX application requires a matching approved rate.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger gig_fx_approved
before insert or update on public.gig_fx_applications
for each row execute function app_private.validate_gig_fx();

create or replace function app_private.protect_approved_policy()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status in ('Approved', 'Effective', 'Superseded') and new.config is distinct from old.config then
    raise exception 'Approved policy contents are immutable; create a new version.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger effective_policy_immutable
before update on public.policies
for each row execute function app_private.protect_approved_policy();

create or replace function app_private.protect_approved_fx()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.status = 'Approved' and (
    new.currency is distinct from old.currency or
    new.usd_rate is distinct from old.usd_rate or
    new.effective_date is distinct from old.effective_date or
    new.source is distinct from old.source
  ) then
    raise exception 'Approved FX evidence is immutable; create a new rate.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger approved_fx_immutable
before update on public.fx_rates
for each row execute function app_private.protect_approved_fx();

create or replace function app_private.validate_service_submission()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.status <> 'Draft' and (
    select count(*) from public.service_links l where l.student_id = new.student_id
  ) <> 3 then
    raise exception 'A service submission requires exactly three service links.' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger service_submission_three_links
after insert or update of status on public.service_submissions
deferrable initially deferred
for each row execute function app_private.validate_service_submission();

create trigger audit_no_update before update on public.audit_events
for each row execute function app_private.reject_mutation();
create trigger audit_no_delete before delete on public.audit_events
for each row execute function app_private.reject_mutation();
create trigger reviews_no_update before update on public.evidence_reviews
for each row execute function app_private.reject_mutation();
create trigger reviews_no_delete before delete on public.evidence_reviews
for each row execute function app_private.reject_mutation();
create trigger service_reviews_no_update before update on public.service_link_reviews
for each row execute function app_private.reject_mutation();
create trigger service_reviews_no_delete before delete on public.service_link_reviews
for each row execute function app_private.reject_mutation();
create trigger credit_ledger_no_update before update on public.account_credit_ledger
for each row execute function app_private.reject_mutation();
create trigger credit_ledger_no_delete before delete on public.account_credit_ledger
for each row execute function app_private.reject_mutation();
create trigger withdrawal_no_update before update on public.withdrawal_decisions
for each row execute function app_private.reject_mutation();
create trigger withdrawal_no_delete before delete on public.withdrawal_decisions
for each row execute function app_private.reject_mutation();
create trigger group_closure_no_update before update on public.group_closures
for each row execute function app_private.reject_mutation();
create trigger group_closure_no_delete before delete on public.group_closures
for each row execute function app_private.reject_mutation();
create trigger gig_no_delete before delete on public.gigs
for each row execute function app_private.reject_mutation();

-- Identity and scope helpers run as the migration owner so policy evaluation
-- does not recursively invoke RLS on users, students, groups, or group_coaches.
create or replace function app_private.current_email()
returns text
language sql stable
set search_path = pg_catalog
as $$
  select lower(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''))
$$;

create or replace function app_private.current_app_user_id()
returns text
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select u.id
  from public.users u
  where u.active
    and (
      u.auth_user_id = auth.uid() or
      (u.auth_user_id is null and lower(u.email) = app_private.current_email())
    )
  order by (u.auth_user_id = auth.uid()) desc
  limit 1
$$;

create or replace function app_private.current_student_id()
returns text
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select s.id
  from public.students s
  where lower(s.email) = app_private.current_email()
  limit 1
$$;

create or replace function app_private.is_active_staff()
returns boolean
language sql stable
set search_path = pg_catalog
as $$
  select app_private.current_app_user_id() is not null
$$;

create or replace function app_private.has_role(required_roles text[])
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(u.roles ?| required_roles, false)
  from public.users u
  where u.id = app_private.current_app_user_id() and u.active
$$;

create or replace function app_private.can_access_group(target_group_id text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    app_private.has_role(array[
      'Project Operations', 'Operations Systems / Admin', 'Quality Member',
      'Quality Lead', 'Higher Board', 'Coach Operations'
    ]) or exists (
      select 1 from public.groups g
      where g.id = target_group_id and app_private.current_app_user_id() in (g.coordinator, g.supervisor, g.coach)
    ) or exists (
      select 1 from public.group_coaches gc
      where gc.group_id = target_group_id
        and gc.user_id = app_private.current_app_user_id()
        and gc.status = 'Active'
    ), false
  )
$$;

create or replace function app_private.can_access_student(target_student_id text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    target_student_id = app_private.current_student_id() or exists (
      select 1 from public.students s
      where s.id = target_student_id and app_private.can_access_group(s.group_id)
    ), false
  )
$$;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','policies','groups','students','tasks','attachments','contacts','accounts',
    'account_requests','account_assignments','gigs','gig_events','evidence','evidence_reviews',
    'cases','sessions','attendance','graduation_ledger','audit_events','imports','notifications',
    'automation_runs','task_bank','account_request_details','attachment_context','saved_views',
    'system_configuration','retention_actions','export_jobs','import_rows','roster_imports',
    'roster_source_rows','case_events','student_status_events','group_gate_checks','rate_limits',
    'fx_rates','gig_fx_applications','tracks','applications','screenings','admissions',
    'group_coaches','session_reports','assessments','assessment_results','certificates',
    'post_program_outcomes','withdrawal_decisions','group_closures','account_reservations',
    'account_credit_ledger','evidence_packages','evidence_package_items','report_definitions',
    'report_runs','service_submissions','service_links','service_link_reviews'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
  end loop;
end;
$$;

create policy users_staff_read on public.users for select to authenticated
using (app_private.is_active_staff());

create policy groups_scoped_staff_read on public.groups for select to authenticated
using (app_private.can_access_group(id));
create policy groups_student_read on public.groups for select to authenticated
using (id = (select s.group_id from public.students s where s.id = app_private.current_student_id()));

create policy students_scoped_read on public.students for select to authenticated
using (app_private.can_access_student(id));

create policy tasks_scoped_read on public.tasks for select to authenticated
using (
  app_private.is_active_staff() and (
    (student_id is not null and app_private.can_access_student(student_id)) or
    owner = app_private.current_app_user_id()
  )
);
create policy attachments_scoped_read on public.attachments for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy contacts_scoped_staff_read on public.contacts for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy account_requests_scoped_staff_read on public.account_requests for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy assignments_scoped_staff_read on public.account_assignments for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy gigs_scoped_staff_read on public.gigs for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy evidence_scoped_staff_read on public.evidence for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy cases_scoped_staff_read on public.cases for select to authenticated
using (
  app_private.is_active_staff() and
  ((student_id is not null and app_private.can_access_student(student_id)) or owner = app_private.current_app_user_id())
);
create policy attendance_scoped_staff_read on public.attendance for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy ledger_scoped_staff_read on public.graduation_ledger for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy status_events_scoped_staff_read on public.student_status_events for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy assessment_results_scoped_staff_read on public.assessment_results for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy certificates_scoped_staff_read on public.certificates for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy outcomes_scoped_staff_read on public.post_program_outcomes for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));
create policy withdrawals_scoped_staff_read on public.withdrawal_decisions for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_student(student_id));

create policy sessions_scoped_staff_read on public.sessions for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));
create policy group_coaches_scoped_staff_read on public.group_coaches for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));
create policy gate_checks_scoped_staff_read on public.group_gate_checks for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));
create policy assessments_scoped_staff_read on public.assessments for select to authenticated
using (app_private.is_active_staff() and (group_id is null or app_private.can_access_group(group_id)));
create policy closures_scoped_staff_read on public.group_closures for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));
create policy attachment_context_scoped_staff_read on public.attachment_context for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));
create policy admissions_scoped_staff_read on public.admissions for select to authenticated
using (app_private.is_active_staff() and app_private.can_access_group(group_id));

create policy gig_events_scoped_staff_read on public.gig_events for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.gigs g where g.id = gig_id and app_private.can_access_student(g.student_id)
));
create policy evidence_reviews_scoped_staff_read on public.evidence_reviews for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.evidence e where e.id = evidence_id and app_private.can_access_student(e.student_id)
));
create policy request_details_scoped_staff_read on public.account_request_details for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.account_requests r where r.id = request_id and app_private.can_access_student(r.student_id)
));
create policy case_events_scoped_staff_read on public.case_events for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.cases c where c.id = case_id and
    ((c.student_id is not null and app_private.can_access_student(c.student_id)) or c.owner = app_private.current_app_user_id())
));
create policy gig_fx_scoped_staff_read on public.gig_fx_applications for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.gigs g where g.id = gig_id and app_private.can_access_student(g.student_id)
));
create policy session_reports_scoped_staff_read on public.session_reports for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.sessions s where s.id = session_id and app_private.can_access_group(s.group_id)
));
create policy evidence_packages_scoped_staff_read on public.evidence_packages for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.evidence e where e.id = evidence_id and app_private.can_access_student(e.student_id)
));
create policy evidence_items_scoped_staff_read on public.evidence_package_items for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.evidence_packages p
  join public.evidence e on e.id = p.evidence_id
  where p.id = package_id and app_private.can_access_student(e.student_id)
));
create policy reservations_scoped_staff_read on public.account_reservations for select to authenticated
using (app_private.is_active_staff() and exists (
  select 1 from public.account_requests r where r.id = request_id and app_private.can_access_student(r.student_id)
));

create policy notifications_recipient_read on public.notifications for select to authenticated
using (recipient = app_private.current_app_user_id());
create policy saved_views_owner_read on public.saved_views for select to authenticated
using (user_id = app_private.current_app_user_id());
create policy export_jobs_owner_read on public.export_jobs for select to authenticated
using (actor = app_private.current_app_user_id());
create policy report_runs_owner_read on public.report_runs for select to authenticated
using (actor = app_private.current_app_user_id());

create policy service_submissions_scoped_read on public.service_submissions for select to authenticated
using (app_private.can_access_student(student_id));
create policy service_links_scoped_read on public.service_links for select to authenticated
using (app_private.can_access_student(student_id));
create policy service_reviews_scoped_read on public.service_link_reviews for select to authenticated
using (exists (
  select 1 from public.service_links l
  where l.id = service_link_id and app_private.can_access_student(l.student_id)
));

-- These tables do not contain a group/student foreign key. They remain visible
-- only to active staff; mutations still require the trusted backend service role.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'policies','accounts','audit_events','imports','automation_runs','task_bank',
    'system_configuration','retention_actions','import_rows','roster_imports',
    'roster_source_rows','fx_rates','tracks','applications','screenings',
    'account_credit_ledger','report_definitions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (app_private.is_active_staff())',
      table_name || '_staff_read', table_name
    );
  end loop;
end;
$$;

comment on schema app_private is 'Security-definer helpers and integrity triggers; not exposed as an API schema.';
