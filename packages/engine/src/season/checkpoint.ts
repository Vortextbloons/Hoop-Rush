import {
  canonicalJson,
  seasonDigestHex,
  type SeasonCandidateCheckpoint,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonSchedule,
  type SeasonRunAuthority,
} from '@hoop-rush/data-contracts';
import { seasonBlockRecapCanonical } from './recap.ts';
import {
  canonicalEffectsPayload,
  canonicalHealthPayload,
  canonicalInfluencePayload,
  sortedBy,
  sortedEntries,
} from './canonical.ts';
export function reconstructSeasonGames(
  schedule: SeasonSchedule,
  summaries: readonly SeasonGameSummary[],
): SeasonGame[] {
  const summaryByGameId = new Map(summaries.map((summary) => [summary.gameId, summary]));
  return schedule.games.map((game) => {
    const summary = summaryByGameId.get(game.gameId);
    if (summary === undefined) {
      return {
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        status: 'scheduled' as const,
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: null,
      };
    }
    if (summary.status === 'forfeit') {
      return {
        gameId: game.gameId,
        round: game.round,
        homeFranchiseId: game.homeFranchiseId,
        awayFranchiseId: game.awayFranchiseId,
        status: 'forfeit' as const,
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
      };
    }
    return {
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      status: 'final' as const,
      homeScore: summary.homeScore,
      awayScore: summary.awayScore,
      forfeitLoserFranchiseId: null,
    };
  });
}
export type SeasonCheckpointFacts = Omit<SeasonCandidateCheckpoint, 'digest'> & {
  authority?: SeasonRunAuthority;
};
function standingsCanonical(candidate: SeasonCheckpointFacts): unknown {
  return {
    schemaVersion: candidate.standings.schemaVersion,
    standingsVersion: candidate.standings.standingsVersion,
    rows: sortedBy(candidate.standings.rows, (row) => row.franchiseId),
  };
}
export function authorityCanonical(authority: SeasonRunAuthority): unknown {
  if (authority.kind === 'local-solo') {
    return {
      kind: authority.kind,
      soloFranchiseId: authority.soloFranchiseId,
      authorityVersion: authority.authorityVersion,
    };
  }
  return {
    kind: authority.kind,
    p1: authority.p1,
    p2: authority.p2,
    pace: authority.pace,
    timerPolicyVersion: authority.timerPolicyVersion,
    authorityVersion: authority.authorityVersion,
    multiplayerVersion: authority.multiplayerVersion,
    control: Object.fromEntries(sortedEntries(authority.control)),
    missStreak: Object.fromEntries(sortedEntries(authority.missStreak)),
    reclaimRequests: Object.fromEntries(sortedEntries(authority.reclaimRequests)),
    timeoutEvents: [...authority.timeoutEvents].sort((a, b) => {
      if (a.participantId !== b.participantId) return a.participantId < b.participantId ? -1 : 1;
      return a.atRevision - b.atRevision;
    }),
    checkpointVerification: authority.checkpointVerification,
    integrityFailure: authority.integrityFailure,
    createdAtRevision: authority.createdAtRevision,
  };
}
export function seasonCheckpointCanonical(candidate: SeasonCheckpointFacts): string {
  return canonicalJson({
    schemaVersion: candidate.schemaVersion,
    checkpointVersion: candidate.checkpointVersion,
    runId: candidate.runId,
    rootSeed: candidate.rootSeed,
    versions: candidate.versions,
    blockIndex: candidate.blockIndex,
    completedRounds: candidate.completedRounds,
    revision: candidate.revision,
    rotationDigest: candidate.rotationDigest,
    standings: standingsCanonical(candidate),
    teamAggregates: sortedBy(candidate.teamAggregates, (row) => row.franchiseId),
    playerAggregates: sortedBy(candidate.playerAggregates, (row) => row.playerVersionId),
    gameSummaries: sortedBy(candidate.gameSummaries, (row) => row.gameId),
    retainedDetails: sortedBy(candidate.retainedDetails, (row) => row.gameId),
    recap: seasonBlockRecapCanonical(candidate.recap),
    effects: canonicalEffectsPayload(candidate.effects),
    health: canonicalHealthPayload(candidate.health),
    influence: canonicalInfluencePayload(candidate.influence),
    transactions: sortedBy(candidate.transactions, (entry) => entry.transactionId),
    objective: candidate.objective,
    challenges: (
      candidate as unknown as {
        challenges?: import('@hoop-rush/data-contracts').SeasonBlockChallengeEvaluation | null;
      }
    ).challenges
      ? canonicalJson(
          (
            candidate as unknown as {
              challenges: import('@hoop-rush/data-contracts').SeasonBlockChallengeEvaluation;
            }
          ).challenges,
        )
      : undefined,
    challengeIds: (
      candidate as unknown as {
        challengeIds?: readonly string[] | null;
      }
    ).challengeIds
      ? [
          ...(
            candidate as unknown as {
              challengeIds: readonly string[];
            }
          ).challengeIds,
        ].sort()
      : undefined,
    campaign: (
      candidate as unknown as {
        campaign?: unknown;
      }
    ).campaign
      ? canonicalJson(
          (
            candidate as unknown as {
              campaign: unknown;
            }
          ).campaign,
        )
      : undefined,
    trade: (
      candidate as unknown as {
        trade?: unknown;
      }
    ).trade
      ? canonicalJson(
          (
            candidate as unknown as {
              trade: unknown;
            }
          ).trade,
        )
      : undefined,
    expectedStateRevision: candidate.expectedStateRevision,
    expectedStateDigest: candidate.expectedStateDigest,
    stateRevision: candidate.stateRevision,
    stateDigest: candidate.stateDigest,
    authority: (
      candidate as unknown as {
        authority?: SeasonRunAuthority;
      }
    ).authority
      ? canonicalJson(
          authorityCanonical(
            (
              candidate as unknown as {
                authority: SeasonRunAuthority;
              }
            ).authority,
          ),
        )
      : undefined,
  });
}
export function seasonCheckpointDigest(candidate: SeasonCheckpointFacts): string {
  return seasonDigestHex(seasonCheckpointCanonical(candidate));
}
