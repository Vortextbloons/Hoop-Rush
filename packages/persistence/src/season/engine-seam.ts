import {
  emptySeasonPlayerAggregate,
  emptySeasonTeamAggregate,
  seasonEffectsStateSchema,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonPairChemistryState,
  type SeasonPlayerAggregate,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonTeamAggregate,
} from '@hoop-rush/data-contracts';
import {
  WINDOW_BLOCK_INDEX_TO_INDEX,
  createInitialSeasonInfluenceState,
  foldSeasonPlayerAggregates,
  foldSeasonTeamAggregates,
  reconstructSeasonGames,
  reduceSeasonStandings,
  seasonRotationSetDigest,
  seasonRunStateDigest,
} from '@hoop-rush/engine';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';

export const seasonRunEngineSeam: SeasonRunEngineSeam = {
  reconstructSeasonGames,
  foldSeasonTeamAggregates: paddedTeamAggregates,
  foldSeasonPlayerAggregates: paddedPlayerAggregates,
  reduceSeasonStandings,
  seasonRotationSetDigest,
  seasonRosterPlayerVersionIds,
  seasonRotationPlayerVersionIds,
  zeroSeasonEffectsState,
  seasonPairKey,
  seasonPairIsCanonical,
  seasonRunStateDigest,
  createInitialSeasonInfluenceState,
  windowBlockIndexToIndex: WINDOW_BLOCK_INDEX_TO_INDEX,
};

function paddedTeamAggregates(
  league: SeasonLeague,
  summaries: readonly SeasonGameSummary[],
): SeasonTeamAggregate[] {
  const folded = foldSeasonTeamAggregates(summaries);
  const byId = new Map(folded.map((row) => [row.franchiseId, row]));
  return league.teams
    .map((team) => byId.get(team.franchiseId) ?? emptySeasonTeamAggregate(team.franchiseId))
    .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
}

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
        return emptySeasonPlayerAggregate(player.playerVersionId, roster.franchiseId);
      }),
    )
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
}

function seasonRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[] {
  return [
    ...new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId))),
  ].sort();
}

function seasonRotationPlayerVersionIds(rotations: readonly SeasonRotation[]): string[] {
  return [
    ...new Set(rotations.flatMap((rotation) => [...rotation.starters, ...rotation.benchOrder])),
  ].sort();
}

function seasonPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function seasonPairIsCanonical(a: string, b: string): boolean {
  return a < b;
}

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
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  });
}
