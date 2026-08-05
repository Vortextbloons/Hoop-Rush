import {
  SEASON_LEADER_DEPTH,
  SEASON_LEADER_MIN_GAME_SHARE,
  type SeasonLeaderCategory,
  type SeasonLeaderEntry,
  type SeasonPlayerAggregate,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';

/**
 * Leader tables in the ENGINE's authoritative order (M2.3.5 Leaders tab).
 *
 * The frozen engine rule (`deriveSeasonLeaders` in packages/engine) sorts
 * each category by per-game rate descending, then value descending, then
 * playerVersionId ascending, with the same eligibility gate (>= 0.7 share of
 * the owning team's games played) and depth (5). The web-side `leaderTables`
 * helper in season-presentation.ts sorts value-first; it is frozen and
 * lead-owned, so the Leaders tab uses this corrected mirror instead. All
 * values still derive from the same aggregate fold.
 */

/** Value of one category from a player aggregate (mirror of the engine). */
export function seasonLeaderCategoryValue(
  player: SeasonPlayerAggregate,
  category: SeasonLeaderCategory,
): number {
  switch (category) {
    case 'points':
      return player.points;
    case 'rebounds':
      return player.offensiveRebounds + player.defensiveRebounds;
    case 'assists':
      return player.assists;
    case 'steals':
      return player.steals;
    case 'blocks':
      return player.blocks;
    case 'threePointersMade':
      return player.threePointersMade;
  }
}

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
 * perGame desc, value desc, playerVersionId asc. Eligibility and depth match
 * the frozen engine constants.
 */
export function engineOrderLeaderTables(
  playerAggregates: readonly SeasonPlayerAggregate[],
  teamAggregates: readonly SeasonTeamAggregate[],
): Record<SeasonLeaderCategory, SeasonLeaderEntry[]> {
  const teamGames = new Map(teamAggregates.map((team) => [team.franchiseId, team.gamesPlayed]));
  const build = (category: SeasonLeaderCategory): SeasonLeaderEntry[] =>
    playerAggregates
      .map((player) => {
        const teamPlayed = teamGames.get(player.franchiseId) ?? 0;
        const value = seasonLeaderCategoryValue(player, category);
        return {
          playerVersionId: player.playerVersionId,
          franchiseId: player.franchiseId,
          gamesPlayed: player.gamesPlayed,
          value,
          perGame: player.gamesPlayed > 0 ? value / player.gamesPlayed : 0,
          eligible:
            teamPlayed > 0 && player.gamesPlayed >= SEASON_LEADER_MIN_GAME_SHARE * teamPlayed,
        };
      })
      .filter((entry) => entry.eligible && entry.gamesPlayed > 0)
      .sort(
        (a, b) =>
          b.perGame - a.perGame ||
          b.value - a.value ||
          a.playerVersionId.localeCompare(b.playerVersionId),
      )
      .slice(0, SEASON_LEADER_DEPTH)
      .map(({ playerVersionId, franchiseId, gamesPlayed, value, perGame }) => ({
        playerVersionId,
        franchiseId,
        gamesPlayed,
        value,
        perGame,
      }));
  return {
    points: build('points'),
    rebounds: build('rebounds'),
    assists: build('assists'),
    steals: build('steals'),
    blocks: build('blocks'),
    threePointersMade: build('threePointersMade'),
  };
}
