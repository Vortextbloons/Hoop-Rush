import { describe, expect, it } from 'vitest';
import {
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  type SeasonPendingBlockCandidate,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureCheckpointRow,
  buildFixtureEffectsState,
  buildFixturePendingBlock,
  buildFixtureRun,
  buildFixtureStoredDraft,
  fixtureSeedFromString,
} from '../testing/season-run-fixture.ts';
import {
  SEASON_RUN_RECORD_ID,
  storedSeasonAcceptedBlockRowSchema,
  storedSeasonActiveRunIndexSchema,
  storedSeasonDetailRowSchema,
  storedSeasonPendingBlockRowSchema,
  storedSeasonRunRecordSchema,
  storedSeasonSummaryRowSchema,
} from './season-run-record.ts';
import { SEASON_DRAFT_RECORD_ID } from './season-draft-record.ts';

/**
 * Stored-record schema tests for the M2.3/M2.4/M2.5 Season Run persistence:
 * the checkpoint row is the frozen snapshot minus the 1,230 scheduled game
 * records plus cursor facts, the M2.4 effects state, and the M2.5 mutable
 * run state; summary/detail/block/index/pending rows wrap the frozen
 * contracts. The record schema is the single save-schema-v5 row (projection
 * milestone) —
 * the v1-v3 development families are never read (the repository surfaces
 * them through the typed incompatibility flow), and this schema rejects
 * them. Every row validates at the storage boundary, so corrupt rows throw
 * instead of entering app state.
 */

function checkpointRowFixture() {
  const run = buildFixtureRun({});
  return buildFixtureCheckpointRow(run);
}

describe('storedSeasonRunRecordSchema', () => {
  it('accepts a promotion-time checkpoint row without the scheduled games', () => {
    const row = checkpointRowFixture();
    const parsed = storedSeasonRunRecordSchema.parse(row);
    expect(parsed.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(parsed.run.runId).toBe('fixture-season-run-1');
    expect('games' in parsed.run).toBe(false);
    expect(parsed.completedRounds).toBe(0);
    expect(parsed.revision).toBe(0);
    expect(parsed.recap).toBeNull();
    expect(parsed.effects.playerStates).toHaveLength(300);
    expect(parsed.effects.pairStates).toHaveLength(1350);
    expect(parsed.health.injuries).toHaveLength(0);
    expect(parsed.transactions).toHaveLength(0);
    expect(parsed.trade).toBeNull();
    expect(parsed.checkpointState).toBeNull();
    expect(parsed.stateRevision).toBe(0);
    expect(parsed.stateDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.objectives.catalog).toHaveLength(6);
  });

  it('accepts a post-commit row with cursor facts, aggregates, recap, and M2.5 state', () => {
    const base = checkpointRowFixture();
    const run = buildFixtureRun({});
    const row = {
      ...base,
      completedRounds: 82,
      revision: 9,
      lastCommandId: 'command-8',
      lastRotationDigest: 'a'.repeat(32),
      lastCheckpointDigest: 'b'.repeat(32),
      checkpointState: {
        runId: run.runId,
        blockIndex: 8,
        completedRounds: 82,
        revision: 9,
        commandId: 'command-8',
        rotationDigest: 'a'.repeat(32),
        checkpointDigest: 'b'.repeat(32),
      },
      stateRevision: 9,
      stateDigest: 'c'.repeat(32),
      effects: buildFixtureEffectsState(buildFixtureRun({}).rosters, {
        fatigueBasisPoints: 4000,
        sharedPossessions: 20_000,
        lastCompletedRound: 82,
      }),
      recap: {
        schemaVersion: 1,
        recapVersion: SEASON_RECAP_VERSION,
        runId: 'fixture-season-run-1',
        blockIndex: 8,
        completedRounds: 82,
        humanRecord: null,
        standingsMovement: [],
        notablePerformances: [],
        streaks: [],
        versionSpotlights: [],
        upcomingHumanGames: [],
        injuryEvidence: {
          injuries: 0,
          bySeverity: { minor: 0, moderate: 0, major: 0, 'season-ending': 0 },
          sameGameReturns: 0,
          seasonEnding: 0,
          returnedThisBlock: 0,
          activeAtBlockEnd: 0,
          humanTeamInjuries: [],
        },
        objectiveEvidence: null,
        tradeEvidence: { tradesAccepted: 0, influenceDelta: 0 },
        freeAgencyEvidence: {
          windowIndex: null,
          signings: [],
          influenceDelta: 0,
          seasonSignings: 0,
          seasonSpend: 0,
        },
        influenceBalance: { humanBalance: 2 },
      },
    };
    const parsed = storedSeasonRunRecordSchema.parse(row);
    expect(parsed.saveSchemaVersion).toBe(SEASON_RUN_SAVE_SCHEMA_VERSION);
    expect(parsed.lastCommandId).toBe('command-8');
    expect(parsed.recap?.blockIndex).toBe(8);
    expect(parsed.effects.playerStates[0]?.fatigueBasisPoints).toBe(4000);
    expect(parsed.checkpointState?.revision).toBe(9);
    expect(parsed.stateRevision).toBe(9);
  });

  it('rejects the v1 and v2 development rows outright (never read)', () => {
    expect(
      storedSeasonRunRecordSchema.safeParse({
        recordId: SEASON_RUN_RECORD_ID,
        saveSchemaVersion: 1,
        run: {
          runId: 'legacy-run-1',
          schemaVersion: 4,
          versions: { runSchemaVersion: 4 },
        },
      }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({
        ...checkpointRowFixture(),
        saveSchemaVersion: 2,
      }).success,
    ).toBe(false);
  });

  it('rejects a v4 row missing the M2.5 mutable state and with a wrong save schema', () => {
    const row = checkpointRowFixture();
    const { effects: _effects, ...withoutEffects } = row;
    expect(storedSeasonRunRecordSchema.safeParse(withoutEffects).success).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({
        ...row,
        saveSchemaVersion: 2,
      }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({
        ...row,
        saveSchemaVersion: 1,
        run: { runId: 'x', schemaVersion: 'not-a-number', versions: { runSchemaVersion: 4 } },
      }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, health: { corrupted: true } }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, stateDigest: 'not-a-digest' }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, objectives: { corrupted: true } }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, trade: { corrupted: true } }).success,
    ).toBe(false);
  });

  it('rejects a row with a corrupt snapshot portion or bad cursor facts', () => {
    const row = checkpointRowFixture();
    expect(storedSeasonRunRecordSchema.safeParse({ ...row, revision: -1 }).success).toBe(false);
    expect(storedSeasonRunRecordSchema.safeParse({ ...row, completedRounds: 83 }).success).toBe(
      false,
    );
    expect(storedSeasonRunRecordSchema.safeParse({ ...row, lastCommandId: 42 }).success).toBe(
      false,
    );
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, run: { ...row.run, runId: 'BAD ID!' } })
        .success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, standings: { corrupted: true } }).success,
    ).toBe(false);
    expect(
      storedSeasonRunRecordSchema.safeParse({ ...row, effects: { corrupted: true } }).success,
    ).toBe(false);
  });

  it('rejects wrong-length aggregate arrays', () => {
    const row = checkpointRowFixture();
    expect(storedSeasonRunRecordSchema.safeParse({ ...row, teamAggregates: [{}] }).success).toBe(
      false,
    );
  });
});

describe('storedSeasonSummaryRowSchema', () => {
  const summary = {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId: 's000001',
    round: 1,
    homeFranchiseId: 'hawks',
    awayFranchiseId: 'celtics',
    status: 'forfeit',
    overtimePeriods: 0,
    homeScore: 2,
    awayScore: 0,
    forfeitLoserFranchiseId: 'celtics',
    homeBox: {
      franchiseId: 'hawks',
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
    },
    awayBox: {
      franchiseId: 'celtics',
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
    },
    homePlayers: [],
    awayPlayers: [],
    injuryEvents: [],
  };

  it('accepts a valid summary row for a forfeited game', () => {
    const parsed = storedSeasonSummaryRowSchema.parse({
      runId: 'run-1',
      gameId: 's000001',
      blockIndex: 0,
      round: 1,
      summary,
    });
    expect(parsed.summary.status).toBe('forfeit');
  });

  it('accepts rows whose row facts are consistent; identity is the repository audit', () => {
    const base = {
      runId: 'run-1',
      gameId: 's000001',
      blockIndex: 0,
      round: 1,
      summary,
    };
    // The stored schema validates each side; cross-field identity is enforced
    // by the repository's reload audit, so this parses at the schema level.
    expect(
      storedSeasonSummaryRowSchema.safeParse({
        ...base,
        summary: { ...summary, gameId: 's000002' },
      }).success,
    ).toBe(true);
  });

  it('rejects rows with a corrupt summary', () => {
    const base = {
      runId: 'run-1',
      gameId: 's000001',
      blockIndex: 0,
      round: 1,
      summary,
    };
    expect(storedSeasonSummaryRowSchema.safeParse({ ...base, gameId: 'nope' }).success).toBe(false);
    expect(storedSeasonSummaryRowSchema.safeParse({ ...base, blockIndex: 9 }).success).toBe(false);
    expect(
      storedSeasonSummaryRowSchema.safeParse({
        ...base,
        summary: { ...summary, status: 'final' },
      }).success,
    ).toBe(false);
  });
});

describe('storedSeasonDetailRowSchema', () => {
  it('accepts a valid retained detail row and rejects a corrupt one', () => {
    const base = {
      runId: 'run-1',
      gameId: 's000001',
      round: 1,
      detail: {
        schemaVersion: 1,
        runId: 'run-1',
        gameId: 's000001',
        round: 1,
        homeFranchiseId: 'hawks',
        awayFranchiseId: 'celtics',
        injuryEvents: [],
        result: {
          schemaVersion: 1,
          outcome: 'forfeit',
          seed: 'a'.repeat(32),
          gameNumber: 1,
          dataVersion: 'data-v1',
          engineVersion: 'engine-v1',
          profileVersion: 'profile-v1',
          winner: 'home',
          losingFranchiseId: 'celtics',
          trigger: 'no-legal-five-tipoff',
          homeScore: 2,
          awayScore: 0,
        },
      },
    };
    expect(storedSeasonDetailRowSchema.parse(base).detail.gameId).toBe('s000001');
    expect(
      storedSeasonDetailRowSchema.safeParse({ ...base, detail: { corrupted: true } }).success,
    ).toBe(false);
  });
});

describe('storedSeasonAcceptedBlockRowSchema and index row', () => {
  it('accepts a valid accepted-block row (with M2.5 state chain facts) and rejects a corrupt one', () => {
    const block = {
      runId: 'run-1',
      blockIndex: 0,
      block: {
        runId: 'run-1',
        blockIndex: 0,
        completedRounds: 10,
        revision: 1,
        commandId: 'command-0',
        rotationDigest: 'a'.repeat(32),
        checkpointDigest: 'b'.repeat(32),
        summaryCount: 150,
        stateRevision: 1,
        stateDigest: 'c'.repeat(32),
      },
    };
    expect(storedSeasonAcceptedBlockRowSchema.parse(block).block.revision).toBe(1);
    expect(
      storedSeasonAcceptedBlockRowSchema.safeParse({
        ...block,
        block: { ...block.block, checkpointDigest: 'not-a-digest' },
      }).success,
    ).toBe(false);
    expect(
      storedSeasonAcceptedBlockRowSchema.safeParse({
        ...block,
        block: { ...block.block, stateDigest: undefined },
      }).success,
    ).toBe(false);
  });

  it('accepts a valid active-run index row', () => {
    const row = storedSeasonActiveRunIndexSchema.parse({
      recordId: SEASON_RUN_RECORD_ID,
      index: {
        runId: 'run-1',
        rootSeed: 'a'.repeat(32),
        humanFranchiseId: 'lakers',
        completedRounds: 10,
        revision: 1,
        humanWins: 6,
        humanLosses: 4,
        updatedAtIso: '2026-08-04T12:00:00.000Z',
      },
    });
    expect(row.index.humanWins).toBe(6);
    expect(
      storedSeasonActiveRunIndexSchema.safeParse({
        recordId: SEASON_RUN_RECORD_ID,
        index: { runId: 'run-1' },
      }).success,
    ).toBe(false);
  });

  it('the fixture stored draft and run parse at their boundaries', () => {
    const run = buildFixtureRun({});
    const draft = buildFixtureStoredDraft(run);
    expect(draft.recordId).toBe(SEASON_DRAFT_RECORD_ID);
    expect(draft.draft.runId).toBe(run.runId);
    expect(fixtureSeedFromString('x').length).toBe(32);
  });
});

describe('storedSeasonPendingBlockRowSchema', () => {
  function pendingRowFixture(overrides: Partial<SeasonPendingBlockCandidate> = {}) {
    const run = buildFixtureRun({});
    const pending = buildFixturePendingBlock({
      run,
      commandId: 'command-0',
      blockIndex: 0,
      expectedRevision: 0,
      expectedStateRevision: 0,
      expectedStateDigest: run.stateDigest,
      nextGameId: 's000016',
    });
    return {
      runId: run.runId,
      block: { ...pending, ...overrides },
      interruption: {
        code: 'invalid-roster' as const,
        runId: run.runId,
        blockIndex: 0,
        commandId: 'command-0',
        nextGameId: 's000016',
        humanFranchiseId: 'lakers',
        unavailablePlayerVersionIds: ['pv-' + '1'.repeat(32)],
      },
      updatedAtIso: '2026-08-04T12:00:00.000Z',
    };
  }

  it('accepts a valid pending row and round-trips the candidate', () => {
    const row = pendingRowFixture();
    const parsed = storedSeasonPendingBlockRowSchema.parse(row);
    expect(parsed.block.blockVersion).toBe(SEASON_BLOCK_VERSION);
    expect(parsed.block.summaries).toHaveLength(0);
    expect(parsed.block.nextGameId).toBe('s000016');
    expect(parsed.interruption.code).toBe('invalid-roster');
  });

  it('rejects a corrupt candidate or interruption', () => {
    expect(
      storedSeasonPendingBlockRowSchema.safeParse({
        ...pendingRowFixture(),
        block: { corrupted: true },
      }).success,
    ).toBe(false);
    expect(
      storedSeasonPendingBlockRowSchema.safeParse({
        ...pendingRowFixture(),
        interruption: { code: 'invalid-roster' },
      }).success,
    ).toBe(false);
    expect(
      storedSeasonPendingBlockRowSchema.safeParse({
        ...pendingRowFixture(),
        runId: 'other-run',
      }).success,
    ).toBe(true);
  });
});
