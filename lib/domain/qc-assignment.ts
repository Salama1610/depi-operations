/**
 * Even distribution of quality work.
 *
 * Reviewers used to claim items themselves, so the queue drifted: whoever
 * looked first took the easy ones and nobody could see who owed what. A lead
 * can now hand out the open work, and the split is deliberately boring.
 *
 * Every unassigned item goes to whoever currently holds the least, counting the
 * work they already have. Ties break on reviewer id, so the same queue and the
 * same reviewers always produce the same result, which makes it testable and
 * makes a disputed allocation explainable.
 */

export interface ReviewerLoad {
  id: string;
  open: number;
}

export interface Allocation {
  itemId: string;
  reviewerId: string;
}

/**
 * Assigns each item to the least-loaded reviewer, updating the running load as
 * it goes so one person never receives the whole queue. Returns the pairs to
 * write; the caller decides how to persist them.
 */
export function distributeEvenly(itemIds: readonly string[], reviewers: readonly ReviewerLoad[]): Allocation[] {
  if (reviewers.length === 0 || itemIds.length === 0) return [];
  const load = new Map(reviewers.map((r) => [r.id, Number(r.open) || 0]));
  const order = [...load.keys()].sort();
  const allocations: Allocation[] = [];
  for (const itemId of itemIds) {
    let chosen = order[0];
    for (const candidate of order) {
      if ((load.get(candidate) ?? 0) < (load.get(chosen) ?? 0)) chosen = candidate;
    }
    load.set(chosen, (load.get(chosen) ?? 0) + 1);
    allocations.push({ itemId, reviewerId: chosen });
  }
  return allocations;
}

/**
 * How uneven a finished distribution is: the gap between the busiest and the
 * quietest reviewer. Zero or one is the best achievable when the queue does not
 * divide exactly. Used by the tests and reported back to the lead.
 */
export function spread(reviewers: readonly ReviewerLoad[], allocations: readonly Allocation[]): number {
  const load = new Map(reviewers.map((r) => [r.id, Number(r.open) || 0]));
  for (const allocation of allocations) load.set(allocation.reviewerId, (load.get(allocation.reviewerId) ?? 0) + 1);
  const counts = [...load.values()];
  return counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
}
