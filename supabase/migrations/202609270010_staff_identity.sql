-- The national ID and phone number of a member of staff.
--
-- Staff sign in the way students do: their email address with their national ID
-- as the first password. That only works if the programme's record of the person
-- carries the ID, and the phone number belongs with it — a coordinator is
-- reached by phone far more often than by email.
--
-- Both columns are added after auth_user_id so the positional inserts written
-- against the original column order stay valid on both engines. Mirrors the
-- additive Drizzle migration drizzle/0017.

alter table public.users
  add column if not exists national_id text;

alter table public.users
  add column if not exists phone text;

-- One person, one record: two staff rows cannot claim the same national ID.
create unique index if not exists user_national_identity on public.users (btrim(national_id))
  where national_id is not null and btrim(national_id) <> '';

comment on column public.users.national_id is
  'National ID of the staff member. Also their first sign-in password, as with students.';
