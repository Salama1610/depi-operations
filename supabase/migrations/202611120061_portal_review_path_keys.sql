-- The reviews' and their comments' keys, without the proof link's host.
--
-- Second step of 202611120060 (12 November 2026), applied once the code that
-- keys reviews by path was live, so no page load saw the two disagree.

update public.portal_gig_reviews
   set proof_key = lower(regexp_replace(proof_key, '^[a-z][a-z0-9+.-]*://[^/]+', '', 'i'))
 where proof_key ~* '^[a-z][a-z0-9+.-]*://';
update public.portal_gig_review_notes
   set proof_key = lower(regexp_replace(proof_key, '^[a-z][a-z0-9+.-]*://[^/]+', '', 'i'))
 where proof_key ~* '^[a-z][a-z0-9+.-]*://';
