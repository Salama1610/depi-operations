-- 2 November 2026: a portal gig's quality review is kept under its proof link.
--
-- The gigs sheet's "Status Proof Screenshot" link is the one cell that does
-- not repeat from gig to gig, and it stays the same each time the sheet is
-- exported and uploaded again. Reviews were found by the sheet's gig ID; they
-- are now found by that link, so a new upload brings every proof back to the
-- same Quality Member with its verdict, whatever ID its row carries. A gig
-- without a proof link falls back to 'gig:' and its ID. portal_gig_id stays,
-- pointing at the row of the latest sheet that carries the proof.
-- Mirrors drizzle/0049.

alter table public.portal_gig_reviews add column if not exists proof_key text;

update public.portal_gig_reviews r
   set proof_key = lower(trim(z.proof_url))
  from public.portal_gigs z
  join public.portal_uploads b on b.batch_id = z.batch_id and b.sheet = 'gigs' and b.status = 'Active'
 where r.proof_key is null
   and z.portal_gig_id = r.portal_gig_id
   and coalesce(trim(z.proof_url), '') <> '';

-- Two reviews on one proof (a student sending the same file for two gigs)
-- become one. The one kept is the decided one, else the one whose gig still
-- waits for the coach; an extra one still waiting for a verdict is dropped,
-- and a decided extra keeps a key of its own so no verdict is lost.
with ranked as (
  select r.portal_gig_id, r.status,
         row_number() over (
           partition by r.proof_key
           order by (r.status <> 'Pending') desc,
                    exists (
                      select 1 from public.portal_gigs z
                      join public.portal_uploads b on b.batch_id = z.batch_id and b.sheet = 'gigs' and b.status = 'Active'
                      where z.portal_gig_id = r.portal_gig_id
                        and lower(trim(coalesce(z.provider_status, ''))) in ('', 'pending')
                    ) desc,
                    r.reviewed_at desc nulls last, r.assigned_at desc, r.portal_gig_id desc
         ) n
  from public.portal_gig_reviews r
  where r.proof_key is not null
)
delete from public.portal_gig_reviews d
 using ranked k
 where d.portal_gig_id = k.portal_gig_id and k.n > 1 and k.status = 'Pending';

update public.portal_gig_reviews r
   set proof_key = 'gig:' || r.portal_gig_id
  from (
    select portal_gig_id, row_number() over (partition by proof_key order by reviewed_at desc nulls last, assigned_at desc) n
    from public.portal_gig_reviews where proof_key is not null
  ) k
 where k.portal_gig_id = r.portal_gig_id and k.n > 1;

update public.portal_gig_reviews set proof_key = 'gig:' || portal_gig_id where proof_key is null;

create unique index if not exists portal_gig_reviews_proof_key on public.portal_gig_reviews (proof_key);

comment on column public.portal_gig_reviews.proof_key is
  'The gig''s proof link, lower-cased and trimmed (or gig: and the gig ID when it has none): what finds the review again in a new upload of the gigs sheet.';
