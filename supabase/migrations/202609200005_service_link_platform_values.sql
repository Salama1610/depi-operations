-- Align the service_links platform constraint with the application contract.
--
-- The automatic gate in lib/domain/service-links.ts records every submitted
-- link, including a rejected one, so the student sees the correction message
-- and QC keeps an auditable history. For a link that is not a direct Kafiil or
-- Khamsat service page it stores the platform as 'External service' (a URL on
-- another host) or 'Unknown' (a value that is not a parsable URL), together
-- with auto_status 'Failed' and qc_status 'Needs Correction'.
--
-- The original constraint allowed only the two accepted marketplaces, so those
-- rejected rows raised a check violation instead of being returned to the
-- student for correction. The D1 schema never constrained the column, so this
-- only ever affected the PostgreSQL target.
--
-- Accepting a link is still restricted to Kafiil and Khamsat: that rule lives
-- in the automatic gate and in the QC decision, not in this column.

alter table public.service_links drop constraint if exists service_links_platform_check;

alter table public.service_links
  add constraint service_links_platform_check
  check (platform in ('Kafiil', 'Khamsat', 'External service', 'Unknown'));
