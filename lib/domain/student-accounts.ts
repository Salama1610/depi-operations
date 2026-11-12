// The client accounts of one student (12 November 2026).
//
// A student holds at most three accounts, and the three are never all on one
// marketplace: two on Kafeel and one on Nafezly, or two on Nafezly and one on
// Kafeel. So a student who already holds two accounts on the same marketplace
// can only be given the third on the other one. Fewer than three accounts are
// free to be on either.

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
 * marketplace as the candidate, which would make three on one.
 */
export function accountMixProblem(held: readonly unknown[], candidate: unknown): "full" | "same" | null {
  const platforms = held.map((p) => String(p ?? ""));
  const next = String(candidate ?? "");
  if (platforms.length >= maxAccountsPerStudent) return "full";
  if (platforms.length === maxAccountsPerStudent - 1 && next && platforms.every((p) => p === next)) return "same";
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
  return !(platforms.length === maxAccountsPerStudent && new Set(platforms).size === 1);
}

/** What a student with these accounts still needs: the marketplace the next account must be on, when only one is allowed. */
export function nextAccountMustBeOn(held: readonly unknown[]) {
  const platforms = held.map((p) => String(p ?? ""));
  if (platforms.length === maxAccountsPerStudent - 1 && new Set(platforms).size === 1) return otherMarketplace(platforms[0]) || null;
  return null;
}
