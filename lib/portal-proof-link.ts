import { safeHref } from "./safe-href.ts";

// A proof on the ministry portal opens wherever the portal holds the file.
//
// In November 2026 the portal began moving its files from depiback to an S3
// bucket, with the same paths. Its sheets name the new address, but some files
// are still only at the old one (and a few new ones only at the new one), so a
// link opened as written is sometimes refused. A portal proof link therefore
// goes through /api/portal-proof, which opens the address that has the file.

/** The portal's file servers: the only hosts /api/portal-proof will try. */
export const portalFileHosts = ["depi-green.s3.eu-west-2.amazonaws.com", "depiback.eyouthlearning.com"];

/** A proof link as an href: a portal file through /api/portal-proof, any other web link as it is. */
export function proofHref(value: unknown): string | undefined {
  const href = safeHref(value);
  if (!href) return undefined;
  return portalFileHosts.includes(new URL(href).hostname) ? "/api/portal-proof?link=" + encodeURIComponent(href) : href;
}

/** The same file on each portal host, the given address first. */
export function portalFileCandidates(link: string): string[] {
  const url = new URL(link);
  return [url.href, ...portalFileHosts.filter((h) => h !== url.hostname).map((h) => `https://${h}${url.pathname}${url.search}`)];
}
