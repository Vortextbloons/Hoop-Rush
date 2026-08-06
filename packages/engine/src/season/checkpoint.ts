import {
  seasonDigestHex,
  type SeasonCandidateCheckpoint,
  type SeasonGame,
  type SeasonGameSummary,
  type SeasonSchedule,
} from '@hoop-rush/data-contracts';
import { seasonBlockRecapCanonical } from './recap.ts';

/**
 * Season Run game reconstruction and canonical checkpoint digests
 * (spec/2.0/07 persistence, M2.3, season-checkpoint-v2). Completed game
 * facts live in per-block compact summaries, not in the run snapshot's
 * scheduled `games` array; the engine reconstructs finalized game records
 * from the schedule and summaries on demand. The checkpoint digest is a pure
 * function of the candidate's recorded facts — including the M2.4 effects
 * state (300 player loads + 1,350 pair chemistries) — so uninterrupted,
 * cancelled/retried, terminated/reloaded, single-worker, and CLI executions
 * must agree byte-for-byte.
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/**
 * Reconstructs all 1,230 game records: the scheduled base from the schedule
 * artifact overlaid with final/forfeit state from the completed summaries
 * (forfeit loser and official 2-0 result). Stable order = schedule order.
 * Games with no summary stay `scheduled`.
 */
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

/** A candidate checkpoint with or without its digest field. */
export type SeasonCheckpointFacts = Omit<SeasonCandidateCheckpoint, 'digest'>;

/**
 * Order-independent JSON serialization: object keys are sorted recursively
 * (array order is preserved). Runtime validation (zod) may reorder object
 * keys when parsing a persisted checkpoint, so the canonical serialization
 * must not depend on insertion order — otherwise the digest of a stored
 * checkpoint would differ from the digest of the freshly produced candidate.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
      const entry = record[key];
      if (entry === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(entry)}`);
    }
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Canonical per-row serialization of standings (sorted by franchiseId). */
function standingsCanonical(candidate: SeasonCheckpointFacts): unknown {
  return {
    schemaVersion: candidate.standings.schemaVersion,
    standingsVersion: candidate.standings.standingsVersion,
    rows: [...candidate.standings.rows].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1)),
  };
}

/**
 * Canonical byte-for-byte serialization of a candidate checkpoint: fixed
 * field order, every array sorted canonically, the recap canonicalized, the
 * effects state canonically ordered (player loads by playerVersionId, pairs
 * by the canonical a<b key), the M2.5 health/influence/transactions/
 * objective facts canonically ordered (injuries by injuryId, ledger by
 * entryId, transactions by transactionId), and the digest field itself
 * excluded (a digest is a function of the facts, not of itself). Identical
 * recorded facts always serialize identically, regardless of call order,
 * internal array order, or object key insertion order (keys are sorted
 * recursively; runtime validation may reorder them).
 */
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
    teamAggregates: [...candidate.teamAggregates].sort((a, b) =>
      a.franchiseId < b.franchiseId ? -1 : 1,
    ),
    playerAggregates: [...candidate.playerAggregates].sort((a, b) =>
      a.playerVersionId < b.playerVersionId ? -1 : 1,
    ),
    gameSummaries: [...candidate.gameSummaries].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    retainedDetails: [...candidate.retainedDetails].sort((a, b) => (a.gameId < b.gameId ? -1 : 1)),
    recap: seasonBlockRecapCanonical(candidate.recap),
    // M2.4: the effects state participates in the digest (canonical order).
    effects: canonicalJson({
      schemaVersion: candidate.effects.schemaVersion,
      playerStates: [...candidate.effects.playerStates].sort((a, b) =>
        a.playerVersionId < b.playerVersionId ? -1 : 1,
      ),
      pairStates: [...candidate.effects.pairStates].sort((a, b) =>
        a.a < b.a ? -1 : a.a > b.a ? 1 : a.b < b.b ? -1 : 1,
      ),
    }),
    // M2.5: the authoritative post-block health/influence/transactions
    // facts and the locked objective evaluation participate in the digest.
    health: canonicalJson({
      schemaVersion: candidate.health.schemaVersion,
      healthVersion: candidate.health.healthVersion,
      injuries: [...candidate.health.injuries].sort((a, b) => (a.injuryId < b.injuryId ? -1 : 1)),
    }),
    influence: canonicalJson({
      schemaVersion: candidate.influence.schemaVersion,
      influenceVersion: candidate.influence.influenceVersion,
      balances: candidate.influence.balances,
      ledger: [...candidate.influence.ledger].sort((a, b) => (a.entryId < b.entryId ? -1 : 1)),
      windows: candidate.influence.windows,
      rehabs: candidate.influence.rehabs,
    }),
    transactions: [...candidate.transactions].sort((a, b) =>
      a.transactionId < b.transactionId ? -1 : 1,
    ),
    objective: candidate.objective,
    // M2.5: the run state chain facts asserted pre-block (the post-block
    // facts are the commit side's derive output; the assembly placeholder
    // zeros are part of the assembled candidate, so they serialize here).
    expectedStateRevision: candidate.expectedStateRevision,
    expectedStateDigest: candidate.expectedStateDigest,
    stateRevision: candidate.stateRevision,
    stateDigest: candidate.stateDigest,
  });
}

/**
 * Canonical 32-hex checkpoint digest over the canonical serialization of the
 * candidate's recorded facts (the stored `digest` field is excluded).
 */
export function seasonCheckpointDigest(candidate: SeasonCheckpointFacts): string {
  return seasonDigestHex(seasonCheckpointCanonical(candidate));
}
