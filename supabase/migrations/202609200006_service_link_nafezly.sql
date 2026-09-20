-- Nafezly joins Kafiil and Khamsat as an approved service-link marketplace.
--
-- Nafezly was already one of the programme's controlled account platforms
-- (see lib/domain/rules.ts) but the student service-link gate accepted only
-- Kafiil and Khamsat, so a valid Nafezly service page was returned to the
-- student as an unaccepted marketplace. The approved rules in
-- docs/service-link-launch-pack.md now list all three.
--
-- Nafezly publishes services under the same shape as Kafiil,
-- /service/<numeric-id>-<slug>.

alter table public.service_links drop constraint if exists service_links_platform_check;

alter table public.service_links
  add constraint service_links_platform_check
  check (platform in ('Kafiil', 'Khamsat', 'Nafezly', 'External service', 'Unknown'));
