/**
 * Temporal decay scoring for memory search results.
 *
 * Re-ranks results so recent memories score higher than old ones.
 * Formula: score = (1 / (1 + rank)) * exp(-ln(2) * age_days / half_life_days)
 */

/**
 * Compute a decay-adjusted relevance score in (0, 1].
 *
 * @param rank        0-based position in the original result list
 * @param createdAt   timestamp of the result (null skips decay)
 * @param halfLifeDays  number of days for score to halve (default 30)
 */
export function decayScore(
  rank: number,
  createdAt: Date | null,
  halfLifeDays: number = 30,
): number {
  const base = 1.0 / (1.0 + rank);
  if (createdAt === null) {
    return base;
  }
  const now = Date.now();
  const ageDays = Math.max((now - createdAt.getTime()) / 86_400_000, 0.0);
  return base * Math.exp(-Math.LN2 * ageDays / halfLifeDays);
}

/**
 * Re-rank an array of results by temporal decay score (best first).
 *
 * Each result must carry a `created_at` ISO-8601 string (or null).
 * Returns a new array — the input is not mutated.
 */
export function rerankByDecay<T extends { created_at: string | null }>(
  results: T[],
  halfLifeDays: number = 30,
): T[] {
  if (results.length === 0) {
    return results;
  }
  const scored = results.map((result, i) => ({
    result,
    score: decayScore(
      i,
      result.created_at !== null ? new Date(result.created_at) : null,
      halfLifeDays,
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ result }) => result);
}
