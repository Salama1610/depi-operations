// The client accounts of one student (12 November 2026).
//
// A student holds at most three accounts. Until 17 November 2026 the three
// were never all on one marketplace (two and one); the accounts are there to
// buy a student's three gigs and the free places are not always on the
// marketplace that rule asked for, so three on one marketplace are allowed
// now, the owner's decision. The functions below keep their shape so the rule
// can be put back by turning one constant.

/** Whether a student may hold three accounts on one marketplace. */
export const sameMarketplaceAllowed = true;

export const accountMarketplaces = ["Kafeel", "Nafezly"] as const;
export type AccountMarketplace = (typeof accountMarketplaces)[number];

/** The most client accounts one student is linked to. */
export const maxAccountsPerStudent = 3;

/** The other marketplace. */
export const otherMarketplace = (platform: string): string => (platform === "Kafeel" ? "Nafezly" : platform === "Nafezly" ? "Kafeel" : "");

/**
 * Why an account on `candidate` cannot be added to the accounts a student
 * already holds (the platforms of those accounts), or null when it can.
 * "full": they already hold three. "same": their two accounts are on the same
 * marketplace as the candidate, which would make three on one (only while
 * sameMarketplaceAllowed is off).
 */
export function accountMixProblem(held: readonly unknown[], candidate: unknown): "full" | "same" | null {
  const platforms = held.map((p) => String(p ?? ""));
  const next = String(candidate ?? "");
  if (platforms.length >= maxAccountsPerStudent) return "full";
  if (!sameMarketplaceAllowed && platforms.length === maxAccountsPerStudent - 1 && next && platforms.every((p) => p === next)) return "same";
  return null;
}

/** The sentence that goes with a "same" refusal, naming the marketplace the student needs. */
export function accountMixMessage(candidate: unknown) {
  const platform = String(candidate ?? "");
  return `This student's two accounts are both on ${platform}, so the third has to be on ${otherMarketplace(platform)}.`;
}

/** Whether a student's accounts follow the rule: three are never all on one marketplace, and no more than three. */
export function accountsFollowTheRule(held: readonly unknown[]) {
  const platforms = held.map((p) => String(p ?? ""));
  if (platforms.length > maxAccountsPerStudent) return false;
  return sameMarketplaceAllowed || !(platforms.length === maxAccountsPerStudent && new Set(platforms).size === 1);
}

/** What a student with these accounts still needs: the marketplace the next account must be on, when only one is allowed. */
export function nextAccountMustBeOn(held: readonly unknown[]) {
  const platforms = held.map((p) => String(p ?? ""));
  if (!sameMarketplaceAllowed && platforms.length === maxAccountsPerStudent - 1 && new Set(platforms).size === 1) return otherMarketplace(platforms[0]) || null;
  return null;
}
