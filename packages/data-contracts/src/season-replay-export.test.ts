import { describe, expect, it } from 'vitest';
import {
  buildRun,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonPostseasonSummarySchema,
  seasonReplayExportSchema,
  seasonRunReplayExportSchema,
  type SeasonAlmanac,
  type SeasonCommandLog,
  type SeasonCommandLogEntry,
  type SeasonPostseasonSummary,
  type SeasonRunReplayExport,
  type SeasonRunReplayExportInput,
} from './index.ts';
import { buildSeasonRunReplayExport, seasonRunReplayExportDigest } from './season-replay-export.ts';
import {
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  seasonCommandLogDigest,
  seasonCommandResultDigest,
} from './season-command-log.ts';
import { SEASON_COMMAND_LOG_VERSION } from './season-versions.ts';
const DIGEST_32 = '0'.repeat(32);
const HASH_64 = '0'.repeat(64);
function commandLogEntry(ordinal: number): SeasonCommandLogEntry {
  return seasonCommandLogEntrySchema.parse({
    runId: 'fixture-run-1',
    ordinal,
    command: {
      schemaVersion: 11,
      command: 'start-postseason',
      commandId: `cmd-ps-${String(ordinal)}`,
      runId: 'fixture-run-1',
      expectedStateRevision: ordinal,
      expectedStateDigest: DIGEST_32,
    },
    preStateRevision: ordinal,
    preStateDigest: DIGEST_32,
    postStateRevision: ordinal + 1,
    postStateDigest: '1'.repeat(32),
    resultDigest: '2'.repeat(32),
    previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
    relatedGameIds: [],
    transactionIds: [],
  });
}
function commandLog(): SeasonCommandLog {
  const raw = [commandLogEntry(0), commandLogEntry(1)];
  const chained: SeasonCommandLogEntry[] = [];
  for (const entry of raw) {
    chained.push({
      ...entry,
      previousLogDigest: seasonCommandLogDigest(chained),
    });
  }
  return seasonCommandLogSchema.parse({
    schemaVersion: 1,
    commandLogVersion: SEASON_COMMAND_LOG_VERSION,
    runId: 'fixture-run-1',
    entries: chained,
  });
}
function postseasonSummary(): SeasonPostseasonSummary {
  return seasonPostseasonSummarySchema.parse({
    schemaVersion: 1,
    summaryVersion: 'postseason-summary-v1',
    runId: 'fixture-run-1',
    gameId: 'pi-east-seven-eight',
    phase: 'play-in',
    round: 'seven-eight',
    seriesId: null,
    gameNumber: 1,
    conference: 'east',
    homeFranchiseId: 'lakers',
    awayFranchiseId: 'celtics',
    winnerFranchiseId: 'lakers',
    loserFranchiseId: 'celtics',
    status: 'final',
    homeScore: 102,
    awayScore: 97,
    forfeitLoserFranchiseId: null,
    homeBox: {
      franchiseId: 'lakers',
      points: 102,
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
      possessions: 100,
    },
    awayBox: {
      franchiseId: 'celtics',
      points: 97,
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
      possessions: 100,
    },
    homePlayers: Array.from({ length: 10 }, (_, index) => ({
      playerVersionId: `pv-00${String(index).padStart(30, '0')}`,
      seconds: 1440,
      started: index < 5,
      points: 10,
      fieldGoalsMade: 4,
      fieldGoalsAttempted: 9,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 2,
      freeThrowsAttempted: 3,
      offensiveRebounds: 1,
      defensiveRebounds: 4,
      assists: 2,
      steals: 1,
      blocks: 1,
      turnovers: 1,
      fouls: 2,
    })),
    awayPlayers: Array.from({ length: 10 }, (_, index) => ({
      playerVersionId: `pv-01${String(index).padStart(30, '0')}`,
      seconds: 1440,
      started: index < 5,
      points: 9,
      fieldGoalsMade: 3,
      fieldGoalsAttempted: 9,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 3,
      freeThrowsAttempted: 4,
      offensiveRebounds: 1,
      defensiveRebounds: 4,
      assists: 2,
      steals: 1,
      blocks: 1,
      turnovers: 1,
      fouls: 2,
    })),
    rotationEvidence: {
      home: { playersUsed: 10, substitutions: 20 },
      away: { playersUsed: 10, substitutions: 20 },
    },
    injuryEvents: [],
    resultDigest: '3'.repeat(32),
  });
}
function almanac(commandLogDigest: string): SeasonAlmanac {
  return {
    schemaVersion: 1,
    almanacVersion: 'almanac-v1',
    runId: 'fixture-run-1',
    rootSeed: buildRun().rootSeed,
    championFranchiseId: 'lakers',
    postseasonDigest: '4'.repeat(32),
    commandLogDigest,
    awardsDigest: '5'.repeat(32),
    tradeGradesDigest: '6'.repeat(32),
    digest: DIGEST_32,
  };
}
function exportInput(): SeasonRunReplayExportInput {
  const run = buildRun();
  const log = commandLog();
  return {
    runId: run.runId,
    rootSeed: run.rootSeed,
    eraId: '1990s',
    versions: run.versions,
    assetHashes: {
      league: HASH_64,
      schedule: run.schedule.contentHash,
      draftCatalog: HASH_64,
      eraProfile: HASH_64,
    },
    initialRun: run,
    commandLog: log,
    postseasonSummaries: [postseasonSummary()],
    almanac: almanac(seasonCommandLogDigest(log.entries)),
    championFranchiseId: 'lakers',
    finalStateDigest: '6'.repeat(32),
  };
}
describe('full-run replay export (replay-export-v1)', () => {
  it('builds a byte-stable export: identical inputs, identical bytes and digest', () => {
    const first = buildSeasonRunReplayExport(exportInput());
    const second = buildSeasonRunReplayExport(exportInput());
    expect(second).toEqual(first);
    expect(second.digest).toBe(first.digest);
    expect(second.digest).toMatch(/^[0-9a-f]{32}$/);
    const parsed = seasonRunReplayExportSchema.parse(
      JSON.parse(JSON.stringify(first)) as SeasonRunReplayExport,
    );
    expect(parsed.digest).toBe(first.digest);
    expect(seasonRunReplayExportDigest(parsed)).toBe(first.digest);
  });
  it('excludes the digest field from its own computation', () => {
    const exportArtifact = buildSeasonRunReplayExport(exportInput());
    const withMutatedDigest = seasonRunReplayExportSchema.parse({
      ...exportArtifact,
      digest: 'f'.repeat(32),
    });
    expect(seasonRunReplayExportDigest(withMutatedDigest)).toBe(exportArtifact.digest);
  });
  it('changes the digest when any recorded fact changes', () => {
    const base = buildSeasonRunReplayExport(exportInput());
    const input = exportInput();
    const withOtherChampion = buildSeasonRunReplayExport({
      ...input,
      championFranchiseId: 'celtics',
      almanac: { ...input.almanac, championFranchiseId: 'celtics' },
    });
    expect(withOtherChampion.digest).not.toBe(base.digest);
    const withOtherRootSeed = buildSeasonRunReplayExport({
      ...input,
      rootSeed: '1'.repeat(32),
      initialRun: undefined,
      almanac: { ...input.almanac, rootSeed: '1'.repeat(32) },
    });
    expect(withOtherRootSeed.digest).not.toBe(base.digest);
    const log = commandLog();
    const longerLog = seasonCommandLogSchema.parse({
      ...log,
      entries: [...log.entries, commandLogEntry(2)],
    });
    const withLongerLog = buildSeasonRunReplayExport({
      ...input,
      commandLog: longerLog,
      almanac: { ...input.almanac, commandLogDigest: seasonCommandLogDigest(longerLog.entries) },
    });
    expect(withLongerLog.digest).not.toBe(base.digest);
  });
  it('rejects identity mismatches and an unreconciled almanac', () => {
    const input = exportInput();
    expect(() => buildSeasonRunReplayExport({ ...input, runId: 'other-run' })).toThrow(
      /command log targets a different run/,
    );
    expect(() =>
      buildSeasonRunReplayExport({
        ...input,
        championFranchiseId: 'celtics',
        almanac: { ...input.almanac, championFranchiseId: 'lakers' },
      }),
    ).toThrow(/almanac champion disagrees/);
    const log = commandLog();
    const wrongDigestLog = seasonCommandLogSchema.parse({
      ...log,
      entries: log.entries.map((entry) => ({ ...entry, resultDigest: '9'.repeat(32) })),
    });
    expect(() =>
      buildSeasonRunReplayExport({
        ...input,
        commandLog: wrongDigestLog,
        almanac: { ...input.almanac },
      }),
    ).toThrow(/command-log digest does not reconcile/);
    expect(() =>
      buildSeasonRunReplayExport({
        ...input,
        initialRun: { ...buildRun(), runId: 'other-run' },
      }),
    ).toThrow(/initialRun targets a different run/);
    expect(() =>
      buildSeasonRunReplayExport({
        ...input,
        finalStateDigest: 'not-a-digest',
      }),
    ).toThrow();
  });
  it('keeps the per-game replay-export contract unchanged', () => {
    const summary = postseasonSummary();
    const perGame = seasonReplayExportSchema.parse({
      schemaVersion: 1,
      replayExportVersion: 'replay-export-v1',
      runId: 'fixture-run-1',
      gameId: summary.gameId,
      summary,
      digest: DIGEST_32,
    });
    expect(perGame.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(perGame.replayExportVersion).toBe('replay-export-v1');
  });
});
describe('seasonCommandResultDigest (command-log-v1 shared convention)', () => {
  it('is a stable pure function of the recorded result facts', () => {
    const first = seasonCommandResultDigest({
      commandId: 'cmd-adv-1',
      gameIds: ['po-finals-g2', 'po-finals-g1'],
      summaryDigests: ['b'.repeat(32), 'a'.repeat(32)],
    });
    const second = seasonCommandResultDigest({
      commandId: 'cmd-adv-1',
      gameIds: ['po-finals-g1', 'po-finals-g2'],
      summaryDigests: ['a'.repeat(32), 'b'.repeat(32)],
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(
      seasonCommandResultDigest({
        commandId: 'cmd-adv-2',
        gameIds: ['po-finals-g1'],
        summaryDigests: ['a'.repeat(32)],
      }),
    ).not.toBe(first);
  });
});
