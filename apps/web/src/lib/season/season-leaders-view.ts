import {
  type SeasonLeaderCategory,
  type SeasonLeaderEntry,
  type SeasonPlayerAggregate,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import { deriveSeasonLeaders } from '@hoop-rush/engine';

/**
 * Leader tables in the ENGINE's authoritative order (M2.3.5 Leaders tab).
 *
 * The frozen engine rule (`deriveSeasonLeaders` in packages/engine) sorts
 * each category by per-game rate descending, then value descending, then
 * playerVersionId ascending, with the same eligibility gate (>= 0.7 share of
 * the owning team's games played) and depth (5). The web-side `leaderTables`
 * helper in season-presentation.ts sorts value-first; it is frozen and
 * lead-owned, so the Leaders tab uses this engine-backed adapter instead.
 * All values still derive from the same aggregate fold.
 */

/** All six leader categories in the display order of the Leaders tab. */
export const LEADER_CATEGORIES: readonly SeasonLeaderCategory[] = [
  'points',
  'rebounds',
  'assists',
  'steals',
  'blocks',
  'threePointersMade',
];

/**
 * Per-category leader tables sorted with the engine-authoritative tie-break:
 * perGame desc, value desc, playerVersionId asc. Delegates to the engine's
 * `deriveSeasonLeaders`; eligibility and depth match the frozen engine
 * constants.
 */
export function engineOrderLeaderTables(
  playerAggregates: readonly SeasonPlayerAggregate[],
  teamAggregates: readonly SeasonTeamAggregate[],
): Record<SeasonLeaderCategory, SeasonLeaderEntry[]> {
  return deriveSeasonLeaders(teamAggregates, playerAggregates).categories;
}
