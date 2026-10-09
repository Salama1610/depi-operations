-- Two fields asked for after the 9 October 2026 meeting.
--
-- groups.whatsapp_link: the link to the group's WhatsApp chat, so its
-- coordinator can open it in one tap (and paste the session confirmation and
-- the feedback request there). Set from the Groups page by the group's
-- coordinator, its supervisor, Project Operations or an administrator.
--
-- accounts.coordinator_2_id: a second coordinator sharing a client account.
-- Both see the account and can open its sign-in, as the first one can.
-- Mirrors drizzle/0036.

alter table public.groups add column if not exists whatsapp_link text
  check (whatsapp_link is null or char_length(whatsapp_link) between 10 and 300);

alter table public.accounts add column if not exists coordinator_2_id text references public.users(id);
alter table public.accounts drop constraint if exists accounts_two_different_coordinators;
alter table public.accounts add constraint accounts_two_different_coordinators
  check (coordinator_2_id is null or coordinator_2_id is distinct from coordinator_id);
