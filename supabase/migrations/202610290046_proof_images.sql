-- Fingerprints of the proof screenshots on the ministry portal's gigs.
--
-- A student can upload the same screenshot again for another gig, under a new
-- link, so comparing links finds nothing. Each proof image is fetched once
-- and kept here as a sha256 of the file and a 256-bit difference hash of the
-- picture; the quality queue then flags gigs whose proofs show the same
-- picture. Keyed by the proof's link, which stays the same across uploads of
-- the gigs sheet, so nothing is fetched twice. Mirrors drizzle/0047.

create table if not exists public.proof_images (
  proof_url text primary key,
  sha256 text,
  dhash text,
  bytes integer,
  error text,
  checked_at timestamptz not null default now()
);

create index if not exists proof_images_sha256_idx on public.proof_images (sha256);

alter table public.proof_images enable row level security;
revoke all on table public.proof_images from anon, authenticated;

comment on table public.proof_images is
  'Fingerprints (sha256 and dHash) of portal gig proof screenshots, to spot one picture used for several gigs.';
