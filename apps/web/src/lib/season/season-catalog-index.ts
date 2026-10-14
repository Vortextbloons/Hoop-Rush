import type { SeasonDraftCatalog, SeasonDraftCandidate } from '@hoop-rush/data-contracts';
const catalogByVersion = new WeakMap<SeasonDraftCatalog, Map<string, SeasonDraftCandidate>>();
export function catalogCandidateMap(
  catalog: SeasonDraftCatalog,
): Map<string, SeasonDraftCandidate> {
  let map = catalogByVersion.get(catalog);
  if (map === undefined) {
    map = new Map(catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]));
    catalogByVersion.set(catalog, map);
  }
  return map;
}
export function candidateOf(
  catalog: SeasonDraftCatalog | null,
  playerVersionId: string,
): SeasonDraftCandidate | null {
  return catalog === null ? null : (catalogCandidateMap(catalog).get(playerVersionId) ?? null);
}
export function overallRatingOf(
  catalog: SeasonDraftCatalog | null,
  playerVersionId: string,
): number | null {
  return candidateOf(catalog, playerVersionId)?.summaryRatings.overallRating ?? null;
}
