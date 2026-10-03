import {
  seasonEffectsStateSchema,
  type SeasonEffectsState,
  type SeasonPairChemistryState,
  type SeasonRoster,
} from '@hoop-rush/data-contracts';
import {
  WINDOW_BLOCK_INDEX_TO_INDEX,
  createInitialSeasonInfluenceState,
  padSeasonPlayerAggregates,
  padSeasonTeamAggregates,
  reconstructSeasonGames,
  reduceSeasonStandings,
  seasonRosterPlayerVersionIds,
  seasonRotationPlayerVersionIds,
  seasonRotationSetDigest,
  seasonRunStateDigest as engineSeasonRunStateDigest,
} from '@hoop-rush/engine';
import type { SeasonRunEngineSeam } from './engine-seam-types.ts';
export const seasonRunEngineSeam: SeasonRunEngineSeam = {
  reconstructSeasonGames,
  foldSeasonTeamAggregates: padSeasonTeamAggregates,
  foldSeasonPlayerAggregates: padSeasonPlayerAggregates,
  reduceSeasonStandings,
  seasonRotationSetDigest,
  seasonRosterPlayerVersionIds,
  seasonRotationPlayerVersionIds,
  zeroSeasonEffectsState,
  seasonPairKey,
  seasonPairIsCanonical,
  seasonRunStateDigest: engineSeasonRunStateDigest,
  createInitialSeasonInfluenceState,
  windowBlockIndexToIndex: WINDOW_BLOCK_INDEX_TO_INDEX,
};
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
