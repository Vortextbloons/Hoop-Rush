import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  seasonAlmanacDigest,
  seasonCommandLogDigest,
  type PlayoffRound,
  type PlayoffSeries,
  type SeasonAlmanac,
  type SeasonCommandLog,
  type SeasonCommandLogEntry,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository } from './season-run-dexie.ts';
import {
  SeasonPostseasonIntegrityError,
  type CommitPostseasonAdvancementInput,
} from './season-postseason.ts';
import {
  SeasonRunCommandDuplicateError,
  SeasonRunCommandRunMismatchError,
  SeasonRunCommandStaleStateError,
} from './season-run.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';

/**
 * M2.6 postseason-foundations repository contract tests (spec/2.0/07
 * persistence): postseason advancement commits are atomic (run state,
 * summaries, and the append-only command log in ONE transaction), the
 * command log is append-only with a stable chain, and champion promotion is
 * one atomic transaction â€” save the final result, create the almanac, record
 * the champion, finalize the command log, register completed history, and
 * remove the active-run pointer â€” that rolls back completely on injected
 * failure.
 */

const DIGEST_32 = '0'.repeat(32);

interface Adapters {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  schedule: ReturnType<typeof buildFixtureSchedule>;
  run: SeasonRun;
  seam: ReturnType<typeof buildStubSeasonEngineSeam>;
}

function makeAdapters(): Adapters {
  const db = new TestDatabase(testDatabaseName('season-postseason'));
  const seam = buildStubSeasonEngineSeam();
  const schedule = buildFixtureSchedule('a1b2c3d4e5f60718293a4b5c6d7e8f9a');
  const run = buildFixtureRun({ seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a', runId: 'ps-test-run' });
  const repo = new DexieSeasonRunRepository(db, { schedule, seam });
  return { db, repo, schedule, run, seam };
}

async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}

/** The engine-facing run after one advancement: stage play-in, revision + 1, recomputed digest. */
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
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
  });
}

/** A completed postseason state over the fixture league (validated shape). */
function completedPostseasonOf(adapters: Adapters, champion: string): SeasonRun['postseason'] {
  const east = adapters.run.league.teams
    .filter((team) => team.conference === 'east')
    .map((team) => team.franchiseId)
    .slice(0, 8);
  const west = adapters.run.league.teams
    .filter((team) => team.conference === 'west')
    .map((team) => team.franchiseId)
    .slice(0, 8);
  if (east.length !== 8 || west.length !== 8) throw new Error('fixture league conferences');
  const pending = (
    seriesId: string,
    round: PlayoffRound,
    conference: 'east' | 'west',
  ): PlayoffSeries => ({
    seriesId,
    round,
    conference,
    higherSeed: null,
    lowerSeed: null,
    homeCourtFranchiseId: null,
    challengerFranchiseId: null,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  });
  const conferenceBracket = (conference: 'east' | 'west', seeds: string[]) => ({
    conference,
    seeds,
    firstRound: [1, 2, 3, 4].map((n) =>
      pending(`${conference}-first-round-${String(n)}`, 'first-round', conference),
    ),
    semifinals: [1, 2].map((n) =>
      pending(`${conference}-semifinal-${String(n)}`, 'conference-semifinal', conference),
    ),
    conferenceFinal: pending(`${conference}-conference-final`, 'conference-final', conference),
  });
  const homeIsEast = east.includes(champion);
  const challenger = homeIsEast ? (west[0] ?? '') : (east[0] ?? '');
  const game = (gameNumber: number, atChallenger: boolean, winner: string) => ({
    gameId: `po-finals-g${String(gameNumber)}`,
    gameNumber,
    homeFranchiseId: atChallenger ? challenger : champion,
    awayFranchiseId: atChallenger ? champion : challenger,
    status: 'final' as const,
    homeScore: 100,
    awayScore: 90,
    winnerFranchiseId: winner,
  });
  return {
    ...adapters.run.postseason,
    playIn: {
      east: { ...adapters.run.postseason.playIn.east, playoffSeeds: east },
      west: { ...adapters.run.postseason.playIn.west, playoffSeeds: west },
    },
    bracket: {
      schemaVersion: 1,
      postseasonVersion: 'postseason-v2' as const,
      east: conferenceBracket('east', east),
      west: conferenceBracket('west', west),
      finals: {
        seriesId: 'finals',
        round: 'finals' as const,
        conference: null,
        higherSeed: null,
        lowerSeed: null,
        homeCourtFranchiseId: champion,
        challengerFranchiseId: challenger,
        homeCourtWins: 4,
        challengerWins: 2,
        games: [
          game(1, false, champion),
          game(2, false, champion),
          game(3, true, champion),
          game(4, true, challenger),
          game(5, false, champion),
          game(6, true, champion),
        ],
        winnerFranchiseId: champion,
      },
      championFranchiseId: champion,
    },
    championFranchiseId: champion,
  };
}

/** The final engine-facing completed run over the fixture league. */
function completedRunOf(adapters: Adapters, stateRevision: number): SeasonRun {
  const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
  const base: SeasonRun = {
    ...adapters.run,
    stage: 'completed',
    postseason: completedPostseasonOf(adapters, champion),
    completion: {
      championFranchiseId: champion,
      almanacDigest: 'a'.repeat(32),
      finalizedAtStateRevision: stateRevision,
    },
    stateRevision,
    stateDigest: '0'.repeat(32),
  };
  return { ...base, stateDigest: stateDigestOf(adapters, base) };
}

/** A digest-reconciling almanac for the fixture run. */
function buildAlmanac(
  run: SeasonRun,
  champion: string,
  commandLogDigestValue: string,
): SeasonAlmanac {
  const base = {
    schemaVersion: 1 as const,
    almanacVersion: 'almanac-v1' as const,
    runId: run.runId,
    rootSeed: run.rootSeed,
    championFranchiseId: champion,
    postseasonDigest: 'd'.repeat(32),
    commandLogDigest: commandLogDigestValue,
    awardsDigest: 'e'.repeat(32),
    digest: DIGEST_32,
  };
  return { ...base, digest: seasonAlmanacDigest(base) };
}

/** The run with the almanac digest patched into its completion state. */
function withAlmanacDigest(run: SeasonRun, almanacDigest: string): SeasonRun {
  const completion = run.completion;
  if (completion === null) throw new Error('expected completion state');
  return { ...run, completion: { ...completion, almanacDigest } };
}

/** A valid command-log entry mirroring the repository's append contract. */
function buildLogEntry(
  adapters: Adapters,
  command: SeasonRunCommand,
  ordinal: number,
  postStateRevision: number,
): SeasonCommandLogEntry {
  return {
    runId: adapters.run.runId,
    ordinal,
    command,
    preStateRevision: command.expectedStateRevision,
    preStateDigest: command.expectedStateDigest,
    postStateRevision,
    postStateDigest: '1'.repeat(32),
    resultDigest: '2'.repeat(32),
    previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
    relatedGameIds: [],
    transactionIds: [],
  };
}

function commandOf(
  run: SeasonRun,
  command: Extract<SeasonRunCommand, { command: string }>['command'],
  commandId: string,
): SeasonRunCommand {
  return {
    schemaVersion: 9,
    command,
    commandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  } as SeasonRunCommand;
}

function basePostseasonSummary(adapters: Adapters): SeasonPostseasonSummary {
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
    gameId: 'pi-east-seven-eight',
    phase: 'play-in',
    round: 'seven-eight',
    seriesId: null,
    gameNumber: 1,
    conference: 'east',
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

function advancementInput(
  adapters: Adapters,
  command: SeasonRunCommand,
  summary: SeasonPostseasonSummary,
  next: SeasonRun,
): CommitPostseasonAdvancementInput {
  return {
    runId: adapters.run.runId,
    run: next,
    summaries: [summary],
    command,
    preStateRevision: command.expectedStateRevision,
    preStateDigest: command.expectedStateDigest,
    resultDigest: 'b'.repeat(32),
    relatedGameIds: [summary.gameId],
    transactionIds: [],
  };
}

describe('season postseason repository (M2.6)', () => {
  afterEach(() => {
    restoreIndexedDb();
    vi.restoreAllMocks();
  });

  it('commits an advancement atomically: run state, summary, and command log in one transaction', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-start-1');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );

    const log = await adapters.repo.loadCommandLog(adapters.run.runId);
    expect(log).not.toBeNull();
    expect(log?.entries).toHaveLength(1);
    const entry = log?.entries[0];
    expect(entry?.command.commandId).toBe('cmd-start-1');
    expect(entry?.preStateRevision).toBe(0);
    expect(entry?.postStateRevision).toBe(1);
    expect(entry?.previousLogDigest).toBe(SEASON_EMPTY_COMMAND_LOG_DIGEST);
    expect(entry?.relatedGameIds).toEqual(['pi-east-seven-eight']);

    const summaries = await adapters.repo.loadPostseasonSummaries(adapters.run.runId);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.gameId).toBe('pi-east-seven-eight');
    expect(
      await adapters.repo.loadPostseasonSummary(adapters.run.runId, 'pi-east-seven-eight'),
    ).not.toBeNull();
    expect(
      await adapters.repo.loadPostseasonSummary(adapters.run.runId, 'pi-east-nine-ten'),
    ).toBeNull();

    // The active run reloads with the advanced stage and a passing audit.
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.run.stage).toBe('play-in');
    expect(snapshot?.run.stateRevision).toBe(1);
    expect(snapshot?.run.postseason.tiebreakResolutions).toHaveLength(1);
  });

  it('appends commands with a stable chain and stable log digests across loads', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    for (const [commandId, stage] of [
      ['cmd-start-1', 'play-in'],
      ['cmd-advance-1', 'playoffs'],
    ] as const) {
      const command = commandOf(
        adapters.run,
        commandId === 'cmd-start-1' ? 'start-postseason' : 'advance-postseason',
        commandId,
      );
      const next = advancedRun(adapters, stage);
      await adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, command, basePostseasonSummary(adapters), next),
      );
      adapters.run = next;
    }
    const log = await adapters.repo.loadCommandLog(adapters.run.runId);
    expect(log?.entries).toHaveLength(2);
    const entries = log?.entries ?? [];
    expect(entries[1]?.previousLogDigest).toBe(seasonCommandLogDigest(entries.slice(0, 1)));
    expect(seasonCommandLogDigest(entries)).toBe(
      seasonCommandLogDigest(
        (await adapters.repo.loadCommandLog(adapters.run.runId))?.entries ?? [],
      ),
    );
  });

  it('rejects stale expected state facts without writing anything', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-stale-1');
    const next = advancedRun(adapters, 'play-in');
    const stale: SeasonRunCommand = {
      ...command,
      expectedStateDigest: 'f'.repeat(32),
    };
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, stale, basePostseasonSummary(adapters), next),
      ),
    ).rejects.toBeInstanceOf(SeasonRunCommandStaleStateError);
    expect(await adapters.repo.loadCommandLog(adapters.run.runId)).toBeNull();
    expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId)).toEqual([]);
    const snapshot = await adapters.repo.loadActiveRun();
    expect(snapshot?.run.stage).toBe('regular-season');
  });

  it('rejects duplicate command ids and run mismatches', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-dupe-1');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );
    adapters.run = next;
    const again = commandOf(adapters.run, 'start-postseason', 'cmd-dupe-1');
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, again, basePostseasonSummary(adapters), adapters.run),
      ),
    ).rejects.toBeInstanceOf(SeasonRunCommandDuplicateError);
    const otherRun: SeasonRunCommand = { ...command, runId: 'other-run' };
    await expect(
      adapters.repo.commitPostseasonAdvancement(
        advancementInput(adapters, otherRun, basePostseasonSummary(adapters), adapters.run),
      ),
    ).rejects.toBeInstanceOf(SeasonRunCommandRunMismatchError);
  });

  it('promotes a champion to completed history atomically', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-start-1');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );
    adapters.run = next;

    const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
    const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
    const log = await adapters.repo.loadCommandLog(adapters.run.runId);
    if (log === null) throw new Error('expected a command log');
    const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(log.entries));
    await adapters.repo.promoteChampionToCompleted({
      runId: adapters.run.runId,
      run: withAlmanacDigest(finalRun, almanac.digest),
      almanac,
      commandLog: log,
      postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
    });

    // Active-run pointer removed.
    expect(await adapters.repo.loadActiveRun()).toBeNull();
    expect(await adapters.repo.loadActiveRunIndex()).toBeNull();
    // Completed history registered with the champion.
    const completedSeason = await adapters.repo.loadCompletedSeason(adapters.run.runId);
    expect(completedSeason).not.toBeNull();
    expect(completedSeason?.run.stage).toBe('completed');
    expect(completedSeason?.run.completion?.championFranchiseId).toBe(champion);
    expect(completedSeason?.almanac.championFranchiseId).toBe(champion);
    expect(completedSeason?.commandLog.entries).toHaveLength(1);
    expect(completedSeason?.postseasonSummaries).toHaveLength(1);
    expect(await adapters.db.seasonCompletedIndex.get(adapters.run.runId)).not.toBeUndefined();
  });

  it('rolls the whole promotion back when a write fails mid-transaction', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
    const finalRun = completedRunOf(adapters, 1);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-rollback-1');
    const logEntry = buildLogEntry(adapters, command, 0, adapters.run.stateRevision + 1);
    const commandLog: SeasonCommandLog = {
      schemaVersion: 1,
      commandLogVersion: 'command-log-v1',
      runId: adapters.run.runId,
      entries: [logEntry],
    };
    const almanac = buildAlmanac(
      adapters.run,
      champion,
      seasonCommandLogDigest(commandLog.entries),
    );
    // Inject a failure on the LAST write of the transaction: the completed
    // history index registration. Every earlier write must roll back.
    vi.spyOn(adapters.db.seasonCompletedIndex, 'put').mockRejectedValueOnce(
      new Error('injected index write failure'),
    );
    await expect(
      adapters.repo.promoteChampionToCompleted({
        runId: adapters.run.runId,
        run: withAlmanacDigest(finalRun, almanac.digest),
        almanac,
        commandLog,
        postseasonSummaries: [],
      }),
    ).rejects.toThrow('injected index write failure');
    // Nothing committed: no completed rows, no almanac, active pointer intact.
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(0);
    expect(await adapters.db.seasonAlmanacs.count()).toBe(0);
    expect(await adapters.db.seasonCompletedIndex.count()).toBe(0);
    expect(await adapters.repo.loadActiveRun()).not.toBeNull();
    expect(await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID)).not.toBeUndefined();
  });

  it('rejects promotions with an empty command log', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
    const finalRun = completedRunOf(adapters, 1);
    const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest([]));
    await expect(
      adapters.repo.promoteChampionToCompleted({
        runId: adapters.run.runId,
        run: withAlmanacDigest(finalRun, almanac.digest),
        almanac,
        commandLog: {
          schemaVersion: 1,
          commandLogVersion: 'command-log-v1',
          runId: adapters.run.runId,
          entries: [],
        },
        postseasonSummaries: [],
      }),
    ).rejects.toBeInstanceOf(SeasonPostseasonIntegrityError);
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(0);
    expect(await adapters.repo.loadActiveRun()).not.toBeNull();
  });

  it('rejects promotions that fail integrity validation', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
    const finalRun = completedRunOf(adapters, 1);
    const almanac: SeasonAlmanac = {
      ...buildAlmanac(adapters.run, champion, seasonCommandLogDigest([])),
      commandLogDigest: '5'.repeat(32),
    };
    await expect(
      adapters.repo.promoteChampionToCompleted({
        runId: adapters.run.runId,
        run: withAlmanacDigest(finalRun, almanac.digest),
        almanac,
        commandLog: {
          schemaVersion: 1,
          commandLogVersion: 'command-log-v1',
          runId: adapters.run.runId,
          entries: [],
        },
        postseasonSummaries: [],
      }),
    ).rejects.toBeInstanceOf(SeasonPostseasonIntegrityError);
    expect(await adapters.db.seasonCompletedRuns.count()).toBe(0);
    expect(await adapters.repo.loadActiveRun()).not.toBeNull();
  });

  it('deletes a completed season and every row of its run', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-start-1');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );
    adapters.run = next;
    const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
    const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
    const log = await adapters.repo.loadCommandLog(adapters.run.runId);
    if (log === null) throw new Error('expected a command log');
    const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(log.entries));
    await adapters.repo.promoteChampionToCompleted({
      runId: adapters.run.runId,
      run: withAlmanacDigest(finalRun, almanac.digest),
      almanac,
      commandLog: log,
      postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
    });
    expect(await adapters.repo.loadCompletedSeason(adapters.run.runId)).not.toBeNull();
    await adapters.repo.deleteCompletedSeason(adapters.run.runId);
    expect(await adapters.repo.loadCompletedSeason(adapters.run.runId)).toBeNull();
    expect(await adapters.db.seasonCommandLog.count()).toBe(0);
    expect(await adapters.db.seasonPostseasonSummaries.count()).toBe(0);
    expect(await adapters.db.seasonCompletedIndex.count()).toBe(0);
  });

  it('builds validated replay exports whose digest reconciles with the summary', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    const command = commandOf(adapters.run, 'start-postseason', 'cmd-start-1');
    const next = advancedRun(adapters, 'play-in');
    await adapters.repo.commitPostseasonAdvancement(
      advancementInput(adapters, command, basePostseasonSummary(adapters), next),
    );
    const exportArtifact = await adapters.repo.buildReplayExport(
      adapters.run.runId,
      'pi-east-seven-eight',
    );
    expect(exportArtifact).not.toBeNull();
    expect(exportArtifact?.gameId).toBe('pi-east-seven-eight');
    expect(exportArtifact?.summary.resultDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(exportArtifact?.digest).toMatch(/^[0-9a-f]{32}$/);
    expect(exportArtifact?.digest).not.toBe(exportArtifact?.summary.resultDigest);
    expect(await adapters.repo.buildReplayExport(adapters.run.runId, 'po-finals-g7')).toBeNull();
  });
});
