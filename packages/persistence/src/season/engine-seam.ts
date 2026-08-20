import {
  canonicalJson,
  emptySeasonPlayerAggregate,
  emptySeasonTeamAggregate,
  seasonDigestHex,
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
  seasonRunStateDigest as engineSeasonRunStateDigest,
} from '@hoop-rush/engine';
import type { SeasonRunEngineSeam, SeasonRunStateDigestFacts } from './engine-seam-types.ts';

function wrappedSeasonRunStateDigest(facts: SeasonRunStateDigestFacts): string {
  // If no campaign, delegate to engine's implementation for exact parity.
  if (facts.campaign === undefined) {
    const { campaign: _campaign, ...rest } = facts as SeasonRunStateDigestFacts & {
      campaign?: unknown;
    };
    return engineSeasonRunStateDigest(
      rest as unknown as Parameters<typeof engineSeasonRunStateDigest>[0],
    );
  }
  // For schema-11 saves with campaign, compute canonical digest including campaign.
  // Replicate engine's canonical logic but add campaign field.
  const sortedBy = <T>(items: readonly T[], keyOf: (item: T) => string): T[] =>
    [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
  const postseasonCanonical = (postseason: SeasonRunStateDigestFacts['postseason']): unknown => ({
    schemaVersion: postseason.schemaVersion,
    postseasonVersion: postseason.postseasonVersion,
    tiebreakVersion: postseason.tiebreakVersion,
    seed: postseason.seed,
    finalsHomeCourtDrawSeed: postseason.finalsHomeCourtDrawSeed,
    tiebreakResolutions: sortedBy(
      postseason.tiebreakResolutions,
      (resolution) => resolution.resolutionId,
    ),
    playIn: postseason.playIn,
    bracket: postseason.bracket,
    championFranchiseId: postseason.championFranchiseId,
  });
  const canonical = canonicalJson({
    stateRevision: facts.stateRevision,
    stage: facts.stage,
    postseason: postseasonCanonical(facts.postseason),
    awards: facts.awards,
    completion: facts.completion,
    checkpointState: facts.checkpointState,
    health: {
      schemaVersion: facts.health.schemaVersion,
      healthVersion: facts.health.healthVersion,
      injuries: sortedBy(facts.health.injuries, (injury) => injury.injuryId),
    },
    influence: {
      schemaVersion: facts.influence.schemaVersion,
      influenceVersion: facts.influence.influenceVersion,
      balances: facts.influence.balances,
      ledger: sortedBy(facts.influence.ledger, (entry) => entry.entryId),
      windows: facts.influence.windows,
      rehabs: facts.influence.rehabs,
    },
    transactions: sortedBy(facts.transactions, (entry) => entry.transactionId),
    trade: facts.trade,
    freeAgency: {
      schemaVersion: facts.freeAgency.schemaVersion,
      freeAgencyVersion: facts.freeAgency.freeAgencyVersion,
      windows: facts.freeAgency.windows.map((window) => ({
        windowIndex: window.windowIndex,
        blockIndex: window.blockIndex,
        status: window.status,
        candidates: sortedBy(window.candidates, (candidate) => candidate.playerVersionId),
        declarations: window.declarations,
        traces: window.traces,
        signings: sortedBy(window.signings, (signing) => signing.signingId),
      })),
      canonicalCandidates: facts.freeAgency.canonicalCandidates,
      signingCounts: facts.freeAgency.signingCounts,
      seasonSpend: facts.freeAgency.seasonSpend,
    },
    objectives: facts.objectives,
    ...(facts.campaign !== undefined ? { campaign: facts.campaign } : {}),
    rosters: sortedBy(facts.rosters, (roster) => roster.franchiseId),
    ownership: sortedBy(facts.ownership, (row) => row.playerVersionId),
    rotations: sortedBy(facts.rotations, (rotation) => rotation.franchiseId),
    effects: canonicalJson({
      schemaVersion: facts.effects.schemaVersion,
      playerStates: sortedBy(facts.effects.playerStates, (player) => player.playerVersionId),
      pairStates: [...facts.effects.pairStates].sort((a, b) =>
        a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : a.b > b.b ? 1 : 0,
      ),
    }),
  });
  return seasonDigestHex(canonical);
}

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
  seasonRunStateDigest: wrappedSeasonRunStateDigest,
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
