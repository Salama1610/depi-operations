// How many client accounts are left to use, by marketplace (17 November 2026).
//
// An account takes up to two students, each buying their own service, so what
// is left is counted in places: a free account has two, an account with one
// student has one, a full account none. Only an account with status Available
// takes a new student; one with an access issue, blocked, under review and so
// on is counted apart, and a retired account is off the system.

type Row = Record<string, any>;

/** Students one account buys from at most (studentsPerAccount in lib/service-followup.ts). */
export const placesPerAccount = 2;

/** The students on an account: its first, and a second whose service it buys. */
export const accountUses = (a: Row) => (a.student_id ? 1 : 0) + (a.second ? 1 : 0);

export function accountPlaces(accounts: Row[], platforms: string[]) {
  return platforms.map((platform) => {
    const ofPlatform = accounts.filter((a) => a.platform === platform);
    const onSystem = ofPlatform.filter((a) => a.status !== "Retired");
    const usable = onSystem.filter((a) => a.status === "Available" && !a.active_assignment);
    const open = usable.filter((a) => accountUses(a) < placesPerAccount);
    return {
      platform,
      /** Students that can still be given an account on this marketplace. */
      places: open.reduce((n, a) => n + placesPerAccount - accountUses(a), 0),
      withPlace: open.length,
      empty: usable.filter((a) => accountUses(a) === 0).length,
      oneStudent: usable.filter((a) => accountUses(a) === 1).length,
      full: usable.length - open.length,
      /** On the system but not Available: access issue, blocked, under review. */
      notUsable: onSystem.length - usable.length,
      retired: ofPlatform.length - onSystem.length,
      total: onSystem.length,
    };
  });
}
