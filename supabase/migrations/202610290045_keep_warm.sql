-- 29 October 2026: keep the app's server functions warm.
--
-- After a few idle minutes Vercel stops the app's functions, and the next
-- person waited 9 to 22 seconds while they started again. Every 4 minutes the
-- database (pg_cron, with pg_net for the requests) asks the sign-in page, the
-- staff workspace API and the student API for a response, so a function is
-- always running. The requests are anonymous: they are refused at once and
-- read no data. PostgreSQL only, and only where pg_cron and pg_net can run
-- (Supabase); a plain test server skips it.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net')
     and coalesce(current_setting('shared_preload_libraries', true), '') like '%pg_cron%' then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.unschedule(jobid) from cron.job where jobname = 'depi-keep-warm';
    perform cron.schedule(
      'depi-keep-warm',
      '*/4 * * * *',
      $job$
        select net.http_get(url := 'https://depi-r5.vercel.app/login', timeout_milliseconds := 30000);
        select net.http_get(url := 'https://depi-r5.vercel.app/api/operations', timeout_milliseconds := 30000);
        select net.http_get(url := 'https://depi-r5.vercel.app/api/student-services', timeout_milliseconds := 30000);
      $job$
    );
  end if;
end;
$$;
