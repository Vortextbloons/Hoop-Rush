import { buildPlayerProfileReferences } from '#lib/players/player-profile.js';
import type { PlayerProfileReferences } from '#lib/players/player-profile.js';
import { loadDraftCatalog } from '#lib/data-assets.js';

let cached: Promise<PlayerProfileReferences> | null = null;

/**
 * Percentile cohorts for Cap Rush, derived from the packaged draft catalog.
 * Built once and shared by every card and lineup so percentiles never disagree.
 */
export function loadCapRushProfileReferences(): Promise<PlayerProfileReferences> {
  if (cached !== null) return cached;
  const promise = loadDraftCatalog().then((catalog) =>
    buildPlayerProfileReferences(
      catalog.candidates.map((candidate) => ({
        positions: candidate.positions.playable,
        ratings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
      })),
    ),
  );
  cached = promise;
  promise.catch(() => {
    if (cached === promise) cached = null;
  });
  return promise;
}

export function clearCapRushProfileReferences(): void {
  cached = null;
}
