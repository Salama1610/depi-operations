-- Staff teams, and attendance with two values.
--
-- A member of staff now carries a Team (Target Team or Service Team) chosen
-- from a list, instead of the team being read out of their title. The Service
-- Team's checks (who records services, who tops up the client accounts) read
-- it. Supervisors take it from their title once; coordinators from the
-- supervisor of their groups.
--
-- Attendance is Present or Absent. Late becomes Present and Excused becomes
-- Absent. Mirrors drizzle/0030.

alter table public.users
  add column if not exists team text;

alter table public.users drop constraint if exists users_team_check;
alter table public.users
  add constraint users_team_check check (team is null or team in ('Target Team', 'Service Team'));

update public.users set team = 'Service Team' where team is null and title ilike '%service team%';
update public.users set team = 'Target Team' where team is null and title ilike '%target team%';
update public.users u
   set team = (
     select s.team from public.groups g join public.users s on s.id = g.supervisor
      where g.coordinator = u.id and s.team is not null
      group by s.team order by count(*) desc limit 1)
 where u.team is null and u.roles::text like '%Operations Coordinator%';

update public.attendance set status = 'Present' where status = 'Late';
update public.attendance set status = 'Absent' where status = 'Excused';
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check check (status in ('Present', 'Absent'));

comment on column public.users.team is 'Target Team or Service Team; chosen from a list in Administration.';
