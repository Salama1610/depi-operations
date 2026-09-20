-- Private evidence bucket. Object keys are recorded in attachments.key; access
-- is resolved through that table rather than trusting a user-controlled path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'depi-evidence',
  'depi-evidence',
  false,
  8388608,
  array['image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function app_private.can_access_evidence_object(object_name text)
returns boolean
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.attachments a
    where a.key = object_name
      and app_private.is_active_staff()
      and app_private.can_access_student(a.student_id)
  )
$$;

revoke all on function app_private.can_access_evidence_object(text) from public, anon;
grant execute on function app_private.can_access_evidence_object(text) to authenticated;

create policy evidence_objects_scoped_read
on storage.objects for select to authenticated
using (
  bucket_id = 'depi-evidence' and
  app_private.can_access_evidence_object(name)
);

-- No INSERT/UPDATE/DELETE storage policies are created. Evidence is byte-checked,
-- hashed, recorded, and uploaded by the trusted backend using the service role.
