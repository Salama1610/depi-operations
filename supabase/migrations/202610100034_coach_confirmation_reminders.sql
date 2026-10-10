-- A coach who has not confirmed a session 27 hours before it starts is
-- chased (decided 10 Oct 2026): Coach Operations, the coach and the group's
-- coordinator each get one urgent notification for that session. The check
-- runs inside the database every 15 minutes (pg_cron), so it does not depend
-- on anyone opening the app. A coach who said they cannot attend is already
-- reported at that moment and is not chased again. Demo people only hear
-- about demo groups. PostgreSQL only; there is no SQLite mirror.

create or replace function app_private.coach_confirmation_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  made integer := 0;
begin
  with due as (
    select s.id, s.group_id, s.week, s.starts_at,
           coalesce(s.coach_id, g.coach) as coach,
           coalesce(s.coordinator_id, g.coordinator) as coordinator
    from public.sessions s
    join public.groups g on g.id = s.group_id
    where s.status = 'Scheduled'
      and s.coach_confirmed_at is null
      and s.coach_unavailable is null
      and s.starts_at > now()
      and s.starts_at <= now() + interval '27 hours'
      and coalesce(g.delivery_model, 'Regular') <> 'Industry'
  ),
  recipients as (
    select d.*, u.id as recipient
    from due d
    join public.users u
      on u.active
     and (u.roles ? 'Coach Operations' or u.id = d.coach or u.id = d.coordinator)
     and (u.id like 'DEMO-%') = (d.group_id like 'DEMO-%')
  )
  insert into public.notifications(id, recipient, title, entity_type, entity_id, severity, source, created_at, read_at)
  select 'NTF-' || md5('coach-unconfirmed:' || r.id || ':' || r.recipient),
         r.recipient,
         'The coach has not confirmed ' || r.group_id || ' Week ' || r.week || ' ('
           || to_char(r.starts_at at time zone 'Africa/Cairo', 'Dy DD Mon, HH12:MI AM') || ')',
         'session',
         r.id,
         'Urgent',
         'coach-unconfirmed:' || r.id || ':' || r.recipient,
         now(),
         null
  from recipients r
  on conflict (source) do nothing;
  get diagnostics made = row_count;
  return made;
end;
$$;

revoke all on function app_private.coach_confirmation_reminders() from public, anon, authenticated;

do $$
begin
  -- Only where pg_cron can run (Supabase preloads it); a plain test server skips the schedule.
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and coalesce(current_setting('shared_preload_libraries', true), '') like '%pg_cron%' then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'depi-coach-confirmation';
    perform cron.schedule('depi-coach-confirmation', '*/15 * * * *', 'select app_private.coach_confirmation_reminders()');
  end if;
end;
$$;
