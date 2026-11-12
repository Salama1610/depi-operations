-- A portal proof is known by its file path, not the server it is on.
--
-- On 12 November 2026 the ministry portal moved its proof files from
-- depiback.eyouthlearning.com/media/... to depi-green.s3.eu-west-2.amazonaws.com/media/...
-- with the same path. Reviews were keyed by the whole link, so the new sheet's
-- rows no longer found their review: 507 gigs the portal had decided stayed
-- "waiting for review", and 150 gigs still with the coach were taken for new
-- proofs and reset to Pending. Keys are now the link without its scheme and
-- host, lower-cased; a gig with no proof stays "gig:" and its ID.
-- This step adds the sheet rows' key; 202611120061 moves the reviews' keys,
-- once the code that reads them is live. Mirrors drizzle/0061.

alter table public.portal_gigs add column if not exists proof_key text;
update public.portal_gigs
   set proof_key = case when coalesce(trim(proof_url), '') <> ''
                        then lower(regexp_replace(trim(proof_url), '^[a-z][a-z0-9+.-]*://[^/]+', '', 'i'))
                        else 'gig:' || trim(portal_gig_id) end
 where proof_key is null;
create index if not exists portal_gigs_batch_proof_idx on public.portal_gigs (batch_id, proof_key);

comment on column public.portal_gigs.proof_key is
  'The proof link without its scheme and host, lower-cased (or gig: and the ID): the key of its quality review.';
