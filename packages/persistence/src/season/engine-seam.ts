import {
  seasonEffectsStateSchema,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonPairChemistryState,
  type SeasonPlayerAggregate,
  type SeasonRoster,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import {
  createInitialSeasonInfluenceState,
  foldSeasonPlayerAggregates,
  foldSeasonTeamAggregates,
  reconstructSeasonGames,
  reduceSeasonStandings,
  seasonRotationSetDigest,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';

/**
 * Production binding of the `SeasonRunEngineSeam` to the pure engine helpers
 * (spec/2.0/07 persistence, M2.3, M2.4, M2.5). This file is the single place
 * that imports `@hoop-rush/engine`; the repository, the audit, and the test
 * fixtures depend only on the interface in `engine-seam-types.ts`, so a
 * signature drift in the engine implementation is fixed here and nowhere
 * else. The M2.4 effects helpers are pure TypeScript (canonical pair and
 * zero-state construction) with no engine dependency.
 *
 * Engine exports used:
 *
 * - `reconstructSeasonGames(schedule: SeasonSchedule, summaries: readonly SeasonGameSummary[]): SeasonGame[]`
 * - `foldSeasonTeamAggregates(summaries: readonly SeasonGameSummary[]): SeasonTeamAggregate[]`
 * - `foldSeasonPlayerAggregates(summaries: readonly SeasonGameSummary[]): SeasonPlayerAggregate[]`
 * - `reduceSeasonStandings(league: SeasonLeague, games: readonly SeasonGame[]): SeasonStandings`
 * - `seasonRotationSetDigest(rotations: readonly SeasonRotation[]): string`
 * - M2.5: `seasonRunStateDigest(facts)` (canonical mutable run-state digest)
 *   and `createInitialSeasonInfluenceState(franchiseIds)` (run-creation
 *   economy), both authoritative engine exports.
 *
 * The engine folds return one row per franchise/version that appears in the
 * summaries; the stored checkpoint contract requires the full 30-row team
 * and 300-row player tables (zero rows for anything unplayed), so the seam
 * pads the engine output with zero rows from the league and rosters. All
 * helpers are pure TypeScript; the seam imports no Svelte, Dexie, browser,
 * or network code.
 */
export const seasonRunEngineSeam: SeasonRunEngineSeam = {
  reconstructSeasonGames,
  foldSeasonTeamAggregates: paddedTeamAggregates,
  foldSeasonPlayerAggregates: paddedPlayerAggregates,
  reduceSeasonStandings,
  seasonRotationSetDigest,
  seasonRosterPlayerVersionIds,
  zeroSeasonEffectsState,
  seasonPairKey,
  seasonPairIsCanonical,
  seasonRunStateDigest,
  createInitialSeasonInfluenceState,
};

const ZERO_TEAM_FIELDS: Omit<
  SeasonTeamAggregate,
  'franchiseId' | 'gamesPlayed' | 'wins' | 'losses'
> = {
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  threePointersAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
  possessions: 0,
};

const ZERO_PLAYER_FIELDS: Omit<SeasonPlayerAggregate, 'playerVersionId' | 'franchiseId'> = {
  gamesPlayed: 0,
  seconds: 0,
  points: 0,
  fieldGoalsMade: 0,
  fieldGoalsAttempted: 0,
  threePointersMade: 0,
  threePointersAttempted: 0,
  freeThrowsMade: 0,
  freeThrowsAttempted: 0,
  offensiveRebounds: 0,
  defensiveRebounds: 0,
  assists: 0,
  steals: 0,
  blocks: 0,
  turnovers: 0,
  fouls: 0,
};

/** Engine team fold padded to the full 30-row table (zero rows unplayed). */
function paddedTeamAggregates(
  league: SeasonLeague,
  summaries: readonly SeasonGameSummary[],
): SeasonTeamAggregate[] {
  const folded = foldSeasonTeamAggregates(summaries);
  const byId = new Map(folded.map((row) => [row.franchiseId, row]));
  return league.teams
    .map((team) => {
      const row = byId.get(team.franchiseId);
      if (row !== undefined) return row;
      return {
        franchiseId: team.franchiseId,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        ...ZERO_TEAM_FIELDS,
      };
    })
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
}

/** Engine player fold padded to the full 300-row table (zero rows unplayed). */
function paddedPlayerAggregates(
  rosters: readonly SeasonRoster[],
  summaries: readonly SeasonGameSummary[],
): SeasonPlayerAggregate[] {
  const folded = foldSeasonPlayerAggregates(summaries);
  const byId = new Map(folded.map((row) => [row.playerVersionId, row]));
  return rosters
    .flatMap((roster) =>
      roster.players.map((player) => {
        const row = byId.get(player.playerVersionId);
        if (row !== undefined) return row;
        return {
          playerVersionId: player.playerVersionId,
          franchiseId: roster.franchiseId,
          ...ZERO_PLAYER_FIELDS,
        };
      }),
    )
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
}

/**
 * Sorted unique player-version ids across every roster.
 */
function seasonRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[] {
  return [
    ...new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId))),
  ].sort();
}

/** Canonical pair key: 'a\u0000b' with a < b (duplicate-detection convention). */
function seasonPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** Canonical pair ordering: a must be lexicographically smaller than b. */
function seasonPairIsCanonical(a: string, b: string): boolean {
  return a < b;
}

/**
 * Zero effects state for a league: one fresh load state per rostered version
 * (zero fatigue, zero recent load, no completed round) and the canonical
 * 1,350 zero-shared-possession pairs (45 per ten-player roster). Validated
 * through the stored-effects schema before it can be persisted.
 */
function zeroSeasonEffectsState(rosters: readonly SeasonRoster[]): SeasonEffectsState {
  const playerStates = seasonRosterPlayerVersionIds(rosters).map((playerVersionId) => ({
    playerVersionId,
    fatigueBasisPoints: 0,
    recentLoadBasisPoints: 0,
    lastCompletedRound: 0,
  }));
  const pairStates: SeasonPairChemistryState[] = [];
  for (const roster of rosters) {
    const ids = roster.players.map((player) => player.playerVersionId).sort();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = ids[j];
        if (b === undefined) continue;
        pairStates.push({ a, b, sharedPossessions: 0 });
      }
    }
  }
  return seasonEffectsStateSchema.parse({
    schemaVersion: 1,
    playerStates,
    pairStates,
  });
}
