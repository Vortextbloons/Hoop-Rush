import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  seasonCommandLogDigest,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import {
  SEASON_RUN_RECORD_ID,
  seasonPostseasonDetailSchema,
  type SeasonPostseasonDetail,
} from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository, SeasonRunLoadError } from './season-run-dexie.ts';
import type { CommitPostseasonAdvancementInput } from './season-postseason.ts';
import { SeasonRunCommandRunMismatchError, SeasonRunCommandStaleStateError } from './season-run.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureRetainedDetail,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildFixtureSummaries,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';

const DIGEST_32 = '0'.repeat(32);

interface Adapters {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  schedule: ReturnType<typeof buildFixtureSchedule>;
  run: SeasonRun;
  seam: ReturnType<typeof buildStubSeasonEngineSeam>;
}

function makeAdapters(
  seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
  runId = 'ps-detail-run',
): Adapters {
  const db = new TestDatabase(testDatabaseName('season-postseason-details'));
  const seam = buildStubSeasonEngineSeam();
  const schedule = buildFixtureSchedule(seed);
  const run = buildFixtureRun({ seed, runId });
  const repo = new DexieSeasonRunRepository(db, { schedule, seam });
  return { db, repo, schedule, run, seam };
}

async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}

function advancedRun(adapters: Adapters, stage: SeasonRun['stage']): SeasonRun {
  const next: SeasonRun = {
    ...adapters.run,
    stage,
    postseason: {
      ...adapters.run.postseason,
      tiebreakResolutions: [
        {
          resolutionId: 'tie-resolve-1',
          conference: 'east',
          kind: 'qualification',
          rule: 'head-to-head',
          teams: ['lakers', 'celtics'],
          slots: [7, 8],
          evidence: [{ label: 'h2h', value: 2 }],
          drawSeed: null,
        },
      ],
    },
    stateRevision: adapters.run.stateRevision + 1,
    stateDigest: DIGEST_32,
  };
  return { ...next, stateDigest: stateDigestOf(adapters, next) };
}

function stateDigestOf(adapters: Adapters, run: SeasonRun): string {
  const effects = buildFixtureEffectsState(run.rosters);
  return adapters.seam.seasonRunStateDigest({
    stateRevision: run.stateRevision,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: run.health,
    influence: run.influence,
    transactions: run.transactions,
    trade: run.trade,
    objectives: run.objectives,
    campaign: run.campaign ?? null,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
    freeAgency: run.freeAgency,
  });
}

function commandOf(
  run: SeasonRun,
  command: Extract<SeasonRunCommand, { command: string }>['command'],
  commandId: string,
): SeasonRunCommand {
  return {
    schemaVersion: 11,
    command,
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  } as SeasonRunCommand;
}

function basePostseasonSummary(
  adapters: Adapters,
  options: {
    gameId?: string;
    round?: SeasonPostseasonSummary['round'];
    conference?: SeasonPostseasonSummary['conference'];
    phase?: SeasonPostseasonSummary['phase'];
    seriesId?: string | null;
    gameNumber?: number;
  } = {},
): SeasonPostseasonSummary {
  const phase = options.phase ?? 'play-in';
  const players = adapters.run.rosters[0]?.players.slice(0, 10).map((player) => ({
    playerVersionId: player.playerVersionId,
    seconds: 1800,
    points: 10,
    fieldGoalsMade: 4,
    fieldGoalsAttempted: 9,
    threePointersMade: 1,
    threePointersAttempted: 3,
    freeThrowsMade: 1,
    freeThrowsAttempted: 1,
    offensiveRebounds: 1,
    defensiveRebounds: 3,
    assists: 3,
    steals: 1,
    blocks: 0,
    turnovers: 1,
    fouls: 2,
  }));
  if (players === undefined) throw new Error('no fixture players');
  const box = (franchiseId: string) => ({
    franchiseId,
    points: 100,
    fieldGoalsMade: 40,
    fieldGoalsAttempted: 90,
    threePointersMade: 10,
    threePointersAttempted: 30,
    freeThrowsMade: 10,
    freeThrowsAttempted: 12,
    offensiveRebounds: 10,
    defensiveRebounds: 30,
    assists: 25,
    steals: 8,
    blocks: 5,
    turnovers: 12,
    fouls: 18,
    possessions: 100,
  });
  return {
    schemaVersion: 1,
    summaryVersion: 'postseason-summary-v1',
    runId: adapters.run.runId,
    gameId: options.gameId ?? 'pi-east-seven-eight',
    phase,
    round: options.round ?? 'seven-eight',
    seriesId: options.seriesId ?? null,
    gameNumber: options.gameNumber ?? 1,
    conference: options.conference ?? 'east',
    homeFranchiseId: adapters.run.rosters[0]?.franchiseId ?? 'lakers',
    awayFranchiseId: adapters.run.rosters[1]?.franchiseId ?? 'celtics',
    winnerFranchiseId: adapters.run.rosters[0]?.franchiseId ?? 'lakers',
    loserFranchiseId: adapters.run.rosters[1]?.franchiseId ?? 'celtics',
    status: 'final',
    homeScore: 104,
    awayScore: 99,
    forfeitLoserFranchiseId: null,
    homeBox: box(adapters.run.rosters[0]?.franchiseId ?? 'lakers'),
    awayBox: box(adapters.run.rosters[1]?.franchiseId ?? 'celtics'),
    homePlayers: players,
    awayPlayers: players,
    rotationEvidence: {
      home: { playersUsed: 10, substitutions: 24 },
      away: { playersUsed: 10, substitutions: 22 },
    },
    injuryEvents: [],
    resultDigest: 'a'.repeat(32),
  };
}

function postseasonDetailOf(
  adapters: Adapters,
  summary: SeasonPostseasonSummary,
): SeasonPostseasonDetail {
  const regular = buildFixtureSummaries({
    runId: adapters.run.runId,
    schedule: adapters.schedule,
    rosters: adapters.run.rosters,
    fromRound: 1,
    toRound: 1,
  })[0];
  if (regular === undefined) throw new Error('no fixture regular summary');
  const retained = buildFixtureRetainedDetail({
    runId: adapters.run.runId,
    summary: regular,
    rosters: adapters.run.rosters,
  });
  return seasonPostseasonDetailSchema.parse({
    schemaVersion: 1,
    runId: adapters.run.runId,
    gameId: summary.gameId,
    phase: summary.phase,
    homeFranchiseId: summary.homeFranchiseId,
    awayFranchiseId: summary.awayFranchiseId,
    result: retained.result,
    injuryEvents: [],
  });
}

function advancementInput(
  adapters: Adapters,
  command: SeasonRunCommand,
  summary: SeasonPostseasonSummary,
  next: SeasonRun,
  details: SeasonPostseasonDetail[] = [],
): CommitPostseasonAdvancementInput {
  return {
    runId: adapters.run.runId,
    run: next,
    summaries: [summary],
    details,
    command,
    preStateRevision: command.expectedStateRevision,
    preStateDigest: command.expectedStateDigest,
    resultDigest: 'b'.repeat(32),
    relatedGameIds: [summary.gameId],
    transactionIds: [],
  };
}

describe('season postseason details (M2.6)', () => {
  afterEach(() => {
    restoreIndexedDb();
    vi.restoreAllMocks();
  });

  it('commits details atomically with the advance: run, summary, detail, and log in one transaction', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-detail-1');
    const next = advancedRun(adapters, 'play-in');
    const summary = basePostseasonSummary(adapters);
    const detail = postseasonDetailOf(adapters, summary);
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, summary, next, [detail]),
    );

    const details = await adapters.repo.loadPostseasonDetails(adapters.run.runId);
    expect(details).toHaveLength(1);
    expect(details[0]?.gameId).toBe('pi-east-seven-eight');
    expect(details[0]?.phase).toBe('play-in');
    expect(details[0]?.runId).toBe(adapters.run.runId);
    expect(details[0]?.injuryEvents).toEqual([]);
    const result = details[0]?.result;
    if (result?.outcome !== 'completed') throw new Error('expected a completed result');

    expect(result.home.franchiseId).not.toBe(result.away.franchiseId);

    expect(JSON.stringify(result)).toBe(JSON.stringify(detail.result));

    expect(
      await adapters.repo.loadPostseasonSummary(adapters.run.runId, 'pi-east-seven-eight'),
    ).not.toBeNull();
    const log = await adapters.repo.loadCommandLog(adapters.run.runId);
    expect(log?.entries).toHaveLength(1);
    expect(log?.entries[0]?.command.commandId).toBe('cmd-detail-1');

    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.stage).toBe('play-in');
    expect(snapshot?.run.stateRevision).toBe(1);
  });

  it('round-trips details from multiple advances, ordered by gameId ascending', async () => {
    const adapters = makeAdapters();
    await promote(adapters);

    const first = basePostseasonSummary(adapters, {
      gameId: 'pi-west-nine-ten',
      round: 'nine-ten',
      conference: 'west',
    });
    const firstCommand = commandOf(adapters.run, 'start-postseason', 'cmd-detail-a');
    let next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, firstCommand, first, next, [postseasonDetailOf(adapters, first)]),
    );
    adapters.run = next;

    const second = basePostseasonSummary(adapters, {
      gameId: 'pi-east-seven-eight',
      round: 'seven-eight',
      conference: 'east',
    });
    const secondCommand = commandOf(adapters.run, 'advance-postseason', 'cmd-detail-b');
    next = advancedRun(adapters, 'playoffs');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, secondCommand, second, next, [
        postseasonDetailOf(adapters, second),
      ]),
    );
    adapters.run = next;

    const details = await adapters.repo.loadPostseasonDetails(adapters.run.runId);
    expect(details.map((detail) => detail.gameId)).toEqual([
      'pi-east-seven-eight',
      'pi-west-nine-ten',
    ]);

    const third = basePostseasonSummary(adapters, {
      gameId: 'pi-east-final',
      round: 'final',
      conference: 'east',
    });
    const thirdCommand = commandOf(adapters.run, 'advance-postseason', 'cmd-detail-c');
    next = advancedRun(adapters, 'playoffs');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, thirdCommand, third, next),
    );
    expect((await adapters.repo.loadPostseasonDetails(adapters.run.runId)).length).toBe(2);
  });

  it('returns an empty list for a run with summaries but no details', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-no-detail');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );
    expect(await adapters.repo.loadPostseasonDetails(adapters.run.runId)).toEqual([]);
    expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId)).toHaveLength(1);
  });

  it('rejects a stale command with details without writing anything', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-stale-detail');
    const next = advancedRun(adapters, 'play-in');
    const stale: SeasonRunCommand = {
      ...command,
      expectedStateDigest: 'f'.repeat(32),
    };
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, stale, basePostseasonSummary(adapters), next, [
          postseasonDetailOf(adapters, basePostseasonSummary(adapters)),
        ]),
      ),
    ).rejects.toBeInstanceOf(SeasonRunCommandStaleStateError);
    expect(await adapters.repo.loadCommandLog(adapters.run.runId)).toBeNull();
    expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId)).toEqual([]);
    expect(await adapters.repo.loadPostseasonDetails(adapters.run.runId)).toEqual([]);
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.stage).toBe('regular-season');
    expect(snapshot?.run.stateRevision).toBe(0);
  });

  it('rejects a detail naming another run without writing anything', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-foreign-detail');
    const next = advancedRun(adapters, 'play-in');
    const summary = basePostseasonSummary(adapters);
    const foreign = { ...postseasonDetailOf(adapters, summary), runId: 'other-run' };
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, command, summary, next, [foreign]),
      ),
    ).rejects.toBeInstanceOf(SeasonRunCommandRunMismatchError);
    expect(await adapters.repo.loadCommandLog(adapters.run.runId)).toBeNull();
    expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId)).toEqual([]);
    expect(await adapters.repo.loadPostseasonDetails(adapters.run.runId)).toEqual([]);
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.stage).toBe('regular-season');
  });

  it('rolls the whole advance back when ANY transaction write fails', async () => {
    const failures: Array<[string, (adapters: Adapters) => void]> = [
      [
        'run',
        (adapters) =>
          vi.spyOn(adapters.db.seasonRuns, 'put').mockRejectedValueOnce(new Error('x-run')),
      ],
      [
        'log',
        (adapters) =>
          vi.spyOn(adapters.db.seasonCommandLog, 'put').mockRejectedValueOnce(new Error('x-log')),
      ],
      [
        'summary',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonPostseasonSummaries, 'bulkPut')
            .mockRejectedValueOnce(new Error('x-summary')),
      ],
      [
        'detail',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonPostseasonDetails, 'bulkPut')
            .mockRejectedValueOnce(new Error('x-detail')),
      ],
    ];
    for (const [label, inject] of failures) {
      const adapters = makeAdapters();
      await promote(adapters);
      const command = commandOf(adapters.run, 'start-postseason', `cmd-fail-${label}`);
      const next = advancedRun(adapters, 'play-in');
      const summary = basePostseasonSummary(adapters);
      const detail = postseasonDetailOf(adapters, summary);
      const input = advancementInput(adapters, command, summary, next, [detail]);
      inject(adapters);
      await expect(adapters.repo.commitPostseasonAdvancement(input)).rejects.toThrow(`x-${label}`);

      expect(await adapters.repo.loadCommandLog(adapters.run.runId), label).toBeNull();
      expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId), label).toEqual([]);
      expect(await adapters.repo.loadPostseasonDetails(adapters.run.runId), label).toEqual([]);
      const snapshot = await adapters.repo.loadActiveRun();
      expect(snapshot?.run.stage, label).toBe('regular-season');
      expect(snapshot?.run.stateRevision, label).toBe(0);
      expect(await adapters.db.seasonCommandLog.count(), label).toBe(0);
      expect(await adapters.db.seasonPostseasonSummaries.count(), label).toBe(0);
      expect(await adapters.db.seasonPostseasonDetails.count(), label).toBe(0);
      vi.restoreAllMocks();
    }
  });

  it('surfaces corrupt detail rows (row identity disagrees with the detail facts) as SeasonRunLoadError', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-corrupt-detail');
    const next = advancedRun(adapters, 'play-in');
    const summary = basePostseasonSummary(adapters);
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, summary, next, [postseasonDetailOf(adapters, summary)]),
    );

    const row = await adapters.db.seasonPostseasonDetails.get([
      adapters.run.runId,
      'pi-east-seven-eight',
    ]);
    if (row === undefined) throw new Error('expected a detail row');
    await adapters.db.seasonPostseasonDetails.put({
      ...row,
      detail: { ...row.detail, gameId: 'pi-east-nine-ten' },
    });
    await expect(adapters.repo.loadPostseasonDetails(adapters.run.runId)).rejects.toBeInstanceOf(
      SeasonRunLoadError,
    );

    const second = await adapters.db.seasonPostseasonDetails.get([
      adapters.run.runId,
      'pi-east-seven-eight',
    ]);
    if (second === undefined) throw new Error('expected a detail row');
    await adapters.db.seasonPostseasonDetails.put({ ...second, phase: 'playoffs' });
    await expect(adapters.repo.loadPostseasonDetails(adapters.run.runId)).rejects.toBeInstanceOf(
      SeasonRunLoadError,
    );
  });

  it('reloads the run through a fresh repository between advances with identical state and digests', async () => {
    const adapters = makeAdapters();
    await promote(adapters);

    const first = basePostseasonSummary(adapters, {
      gameId: 'pi-east-seven-eight',
      round: 'seven-eight',
      conference: 'east',
    });
    const firstCommand = commandOf(adapters.run, 'start-postseason', 'cmd-reload-1');
    let next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, firstCommand, first, next, [postseasonDetailOf(adapters, first)]),
    );
    adapters.run = next;

    const reloadedRepo = new DexieSeasonRunRepository(adapters.db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    const firstReload = await reloadedRepo.loadActiveRunWithSchedule(adapters.schedule);
    expect(firstReload?.run.stage).toBe('play-in');
    expect(firstReload?.run.stateRevision).toBe(adapters.run.stateRevision);
    expect(firstReload?.run.stateDigest).toBe(adapters.run.stateDigest);
    expect(firstReload?.run.postseason.tiebreakResolutions).toEqual(
      adapters.run.postseason.tiebreakResolutions,
    );
    expect(
      seasonCommandLogDigest(
        (await reloadedRepo.loadCommandLog(adapters.run.runId))?.entries ?? [],
      ),
    ).toBe(
      seasonCommandLogDigest(
        (await adapters.repo.loadCommandLog(adapters.run.runId))?.entries ?? [],
      ),
    );
    expect((await reloadedRepo.loadPostseasonDetails(adapters.run.runId))[0]?.result.outcome).toBe(
      'completed',
    );

    const second = basePostseasonSummary(adapters, {
      gameId: 'po-finals-g1',
      round: 'finals',
      conference: 'west',
      phase: 'playoffs',
      seriesId: 'finals',
    });
    const secondCommand = commandOf(adapters.run, 'advance-postseason', 'cmd-reload-2');
    next = advancedRun(adapters, 'playoffs');
    await reloadedRepo.commitPostseasonAdvancement(
      advancementInput(adapters, secondCommand, second, next, [
        postseasonDetailOf(adapters, second),
      ]),
    );
    adapters.run = next;

    const secondReload = await reloadedRepo.loadActiveRunWithSchedule(adapters.schedule);
    expect(secondReload?.run.stage).toBe('playoffs');
    expect(secondReload?.run.stateRevision).toBe(2);
    expect(secondReload?.run.stateDigest).toBe(adapters.run.stateDigest);
    const log = await reloadedRepo.loadCommandLog(adapters.run.runId);
    expect(log?.entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(log?.entries[1]?.previousLogDigest).toBe(
      seasonCommandLogDigest(log?.entries.slice(0, 1) ?? []),
    );
    expect(
      (await reloadedRepo.loadPostseasonDetails(adapters.run.runId)).map((detail) => detail.gameId),
    ).toEqual(['pi-east-seven-eight', 'po-finals-g1']);
  });

  it('rejects an advancement against a gapped command log (ordinals not dense from 0)', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const first = commandOf(adapters.run, 'start-postseason', 'cmd-gap-1');
    let next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, first, basePostseasonSummary(adapters), next),
    );
    adapters.run = next;
    const second = commandOf(adapters.run, 'advance-postseason', 'cmd-gap-2');
    next = advancedRun(adapters, 'playoffs');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, second, basePostseasonSummary(adapters), next),
    );
    adapters.run = next;

    await adapters.db.seasonCommandLog.delete([adapters.run.runId, 0]);
    const third = commandOf(adapters.run, 'advance-postseason', 'cmd-gap-3');
    const after = advancedRun(adapters, 'playoffs');
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, third, basePostseasonSummary(adapters), after),
      ),
    ).rejects.toThrow('ordinals are not dense from 0');

    expect((await adapters.repo.loadCommandLog(adapters.run.runId))?.entries).toHaveLength(1);
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.stateRevision).toBe(2);
    expect(await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID)).not.toBeUndefined();
  });
});
