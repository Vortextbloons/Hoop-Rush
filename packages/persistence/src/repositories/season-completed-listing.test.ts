import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SEASON_AWARDS_VERSION,
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  SEASON_GAME_COUNT,
  seasonAlmanacDigest,
  seasonAwardsDigest,
  seasonCommandLogDigest,
  type PlayoffRound,
  type PlayoffSeries,
  type SeasonAlmanac,
  type SeasonAwards,
  type SeasonCommandLog,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
} from '@hoop-rush/data-contracts';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository } from './season-run-dexie.ts';
import type { CommitPostseasonAdvancementInput } from './season-postseason.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureRetainedDetail,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildFixtureSummaries,
  buildStubSeasonEngineSeam,
  seasonRotationSetDigestFixture,
} from '../testing/season-run-fixture.ts';

/**
 * M2.6 completed-season listing and completion-transaction tests
 * (spec/2.0/07 persistence): no completed-history entry exists before a
 * champion promotion succeeds; `listCompletedSeasonRuns` returns the
 * validated metadata rows newest-first; `loadCompletedSeason` round-trips the
 * final run (including engine awards), the almanac, and the command log;
 * regular-season records survive completion; deletion is scoped to one run;
 * and EVERY write of the promotion transaction rolls back completely when it
 * fails.
 */

const DIGEST_32 = '0'.repeat(32);

interface Adapters {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  schedule: ReturnType<typeof buildFixtureSchedule>;
  run: SeasonRun;
  seam: ReturnType<typeof buildStubSeasonEngineSeam>;
}

function makeAdapters(
  options: { db?: TestDatabase; seed?: string; runId?: string } = {},
): Adapters {
  const db = options.db ?? new TestDatabase(testDatabaseName('season-completed-listing'));
  const seam = buildStubSeasonEngineSeam();
  const seed = options.seed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
  const schedule = buildFixtureSchedule(seed);
  const run = buildFixtureRun({ seed, runId: options.runId ?? 'cl-run-a' });
  const repo = new DexieSeasonRunRepository(db, { schedule, seam });
  return { db, repo, schedule, run, seam };
}

async function promote(adapters: Adapters): Promise<void> {
  await adapters.repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(adapters.run), adapters.run);
}

/** The engine-facing run after one advancement: stage, revision + 1, recomputed digest. */
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
    freeAgency: run.freeAgency,
  });
}

function commandOf(
  run: SeasonRun,
  command: Extract<SeasonRunCommand, { command: string }>['command'],
  commandId: string,
): SeasonRunCommand {
  return {
    schemaVersion: 10,
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

/** Advances the run once (play-in stage), keeping `adapters.run` current. */
async function advanceOnce(adapters: Adapters, commandId = 'cmd-adv-1'): Promise<void> {
  const command = commandOf(adapters.run, 'start-postseason', commandId);
  const next = advancedRun(adapters, 'play-in');
  await adapters.repo.commitPostseasonAdvancement(
    advancementInput(adapters, command, basePostseasonSummary(adapters), next),
  );
  adapters.run = next;
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
function completedRunOf(
  adapters: Adapters,
  stateRevision: number,
  awards: SeasonAwards | null = null,
): SeasonRun {
  const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
  const base: SeasonRun = {
    ...adapters.run,
    stage: 'completed',
    postseason: completedPostseasonOf(adapters, champion),
    awards,
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
  awardsDigest = 'e'.repeat(32),
): SeasonAlmanac {
  const base = {
    schemaVersion: 1 as const,
    almanacVersion: 'almanac-v1' as const,
    runId: run.runId,
    rootSeed: run.rootSeed,
    championFranchiseId: champion,
    postseasonDigest: 'd'.repeat(32),
    commandLogDigest: commandLogDigestValue,
    awardsDigest,
    tradeGradesDigest: 'f'.repeat(32),
    digest: DIGEST_32,
  };
  return { ...base, digest: seasonAlmanacDigest(base) };
}

/** The run with the almanac digest patched into its completion state. */
function finalRunWithAlmanac(run: SeasonRun, almanacDigest: string): SeasonRun {
  const completion = run.completion;
  if (completion === null) throw new Error('expected completion state');
  return { ...run, completion: { ...completion, almanacDigest } };
}

/** Schema-valid awards over the fixture rosters (engine-supplied at completion). */
function buildAwards(run: SeasonRun): SeasonAwards {
  const all = run.rosters.flatMap((roster) => roster.players);
  const recipient = (index: number) => ({
    playerVersionId: all[index]?.playerVersionId ?? `pv-${'1'.repeat(32)}`,
    franchiseId: all[index]?.franchiseId ?? 'lakers',
  });
  const base = {
    schemaVersion: 1 as const,
    awardsVersion: SEASON_AWARDS_VERSION as 'awards-v1',
    runId: run.runId,
    mvp: recipient(0),
    defensivePlayerOfYear: recipient(1),
    sixthManOfYear: recipient(2),
    allLeagueFirstTeam: [3, 4, 5, 6, 7].map(recipient),
    digest: DIGEST_32,
  };
  return { ...base, digest: seasonAwardsDigest(base) };
}

/** Promotes the champion of the current `adapters.run` into completed history. */
async function completeChampion(
  adapters: Adapters,
  awards: SeasonAwards | null = null,
): Promise<{
  almanac: SeasonAlmanac;
  commandLog: SeasonCommandLog;
  finalRun: SeasonRun;
}> {
  const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
  const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1, awards);
  const log = await adapters.repo.loadCommandLog(adapters.run.runId);
  if (log === null) throw new Error('expected a command log');
  const almanac = buildAlmanac(
    adapters.run,
    champion,
    seasonCommandLogDigest(log.entries),
    awards?.digest ?? 'e'.repeat(32),
  );
  await adapters.repo.promoteChampionToCompleted({
    runId: adapters.run.runId,
    run: finalRunWithAlmanac(finalRun, almanac.digest),
    almanac,
    commandLog: log,
    postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
  });
  return { almanac, commandLog: log, finalRun };
}

/** Stores a few regular-season rows (summaries, one retained detail, one block) for the run. */
async function storeRegularSeasonRows(adapters: Adapters): Promise<number> {
  const regularSummaries = buildFixtureSummaries({
    runId: adapters.run.runId,
    schedule: adapters.schedule,
    rosters: adapters.run.rosters,
    fromRound: 1,
    toRound: 2,
  });
  await adapters.db.seasonRunSummaries.bulkPut(
    regularSummaries.map((summary) => ({
      runId: adapters.run.runId,
      gameId: summary.gameId,
      blockIndex: 0,
      round: summary.round,
      summary,
    })),
  );
  const first = regularSummaries[0];
  if (first === undefined) throw new Error('no fixture regular summaries');
  const detail = buildFixtureRetainedDetail({
    runId: adapters.run.runId,
    summary: first,
    rosters: adapters.run.rosters,
  });
  await adapters.db.seasonRunDetails.put({
    runId: adapters.run.runId,
    gameId: detail.gameId,
    round: detail.round,
    detail,
  });
  await adapters.db.seasonRunBlocks.put({
    runId: adapters.run.runId,
    blockIndex: 0,
    block: {
      runId: adapters.run.runId,
      blockIndex: 0,
      completedRounds: 2,
      revision: 1,
      commandId: 'block-cmd-0',
      rotationDigest: seasonRotationSetDigestFixture(adapters.run.rotations),
      checkpointDigest: DIGEST_32,
      summaryCount: regularSummaries.length,
      stateRevision: 0,
      stateDigest: adapters.run.stateDigest,
    },
  });
  return regularSummaries.length;
}

describe('season completed-season listing and completion transaction (M2.6)', () => {
  afterEach(() => {
    restoreIndexedDb();
    vi.restoreAllMocks();
  });

  it('lists no completed seasons before a champion promotion succeeds', async () => {
    const adapters = makeAdapters();
    await promote(adapters);
    expect(await adapters.repo.listCompletedSeasonRuns()).toEqual([]);
    await advanceOnce(adapters);
    // Postseason advances alone never register completed history.
    expect(await adapters.repo.listCompletedSeasonRuns()).toEqual([]);
    expect(await adapters.repo.loadCompletedSeason(adapters.run.runId)).toBeNull();
  });

  it('lists completed-history metadata newest-first and round-trips into loadCompletedSeason', async () => {
    const adapters = makeAdapters({ runId: 'cl-run-a' });
    await promote(adapters);
    await advanceOnce(adapters, 'cmd-a-1');
    const firstCompletion = await completeChampion(adapters);

    // A second run completes in the SAME database after the first is archived.
    const runB = makeAdapters({
      db: adapters.db,
      seed: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      runId: 'cl-run-b',
    });
    await promote(runB);
    await advanceOnce(runB, 'cmd-b-1');
    const secondCompletion = await completeChampion(runB);

    const listing = await adapters.repo.listCompletedSeasonRuns();
    expect(listing).toHaveLength(2);
    const byRunId = new Map(listing.map((entry) => [entry.runId, entry]));
    const entryA = byRunId.get('cl-run-a');
    const entryB = byRunId.get('cl-run-b');
    expect(entryA).toBeDefined();
    expect(entryB).toBeDefined();
    // Newest first.
    const timestamps = listing.map((entry) => entry.completedAtIso);
    expect((timestamps[0] ?? '') >= (timestamps[1] ?? '')).toBe(true);
    // Metadata facts are recorded and stable.
    for (const [entry, completion] of [
      [entryA, firstCompletion],
      [entryB, secondCompletion],
    ] as const) {
      expect(entry?.recordId).toBe(entry?.runId);
      expect(entry?.championFranchiseId).toBe(completion.almanac.championFranchiseId);
      expect(entry?.almanacDigest).toBe(completion.almanac.digest);
      expect(entry?.commandLogDigest).toBe(completion.almanac.commandLogDigest);
      expect(entry?.rootSeed).toMatch(/^[0-9a-f]{16,64}$/);
      expect(entry?.completedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }

    const loadedA = await adapters.repo.loadCompletedSeason('cl-run-a');
    expect(loadedA).not.toBeNull();
    expect(loadedA?.run.runId).toBe('cl-run-a');
    expect(loadedA?.almanac.digest).toBe(firstCompletion.almanac.digest);
    const loadedB = await adapters.repo.loadCompletedSeason('cl-run-b');
    expect(loadedB).not.toBeNull();
    expect(loadedB?.almanac.digest).toBe(secondCompletion.almanac.digest);
  });

  it('persists engine awards through champion promotion via the run row', async () => {
    const adapters = makeAdapters({ runId: 'cl-run-awards' });
    await promote(adapters);
    await advanceOnce(adapters, 'cmd-awards-1');
    const awards = buildAwards(adapters.run);
    await completeChampion(adapters, awards);

    const completedSeason = await adapters.repo.loadCompletedSeason(adapters.run.runId);
    expect(completedSeason).not.toBeNull();
    expect(completedSeason?.run.awards).toEqual(awards);
    expect(completedSeason?.almanac.awardsDigest).toBe(awards.digest);
    expect(completedSeason?.run.stage).toBe('completed');
    expect(completedSeason?.run.completion?.championFranchiseId).toBe(
      completedSeason?.almanac.championFranchiseId,
    );
  });

  it('keeps regular-season records loadable after completion', async () => {
    const adapters = makeAdapters({ runId: 'cl-run-survive' });
    await promote(adapters);
    const regularCount = await storeRegularSeasonRows(adapters);
    await advanceOnce(adapters, 'cmd-survive-1');
    await completeChampion(adapters);

    // Regular-season summary rows still load through the block views.
    const blockSummaries = await adapters.repo.loadBlockSummaries(adapters.run.runId, 0);
    expect(blockSummaries).toHaveLength(regularCount);
    const blockHistory = await adapters.repo.loadBlockHistory(adapters.run.runId);
    expect(blockHistory).toHaveLength(1);
    expect(blockHistory[0]?.commandId).toBe('block-cmd-0');
    expect(await adapters.repo.loadRetainedDetails(adapters.run.runId)).toHaveLength(1);

    // The completed view assembles the same regular-season facts.
    const completedSeason = await adapters.repo.loadCompletedSeason(adapters.run.runId);
    expect(completedSeason).not.toBeNull();
    expect(completedSeason?.run.games).toHaveLength(SEASON_GAME_COUNT);
    expect(completedSeason?.summaries).toHaveLength(regularCount);
    expect(completedSeason?.postseasonSummaries).toHaveLength(1);
    expect(completedSeason?.commandLog.entries.map((entry) => entry.ordinal)).toEqual([0]);
  });

  it('deletes only the requested run: another run of the same database survives', async () => {
    const adapters = makeAdapters({ runId: 'cl-run-del-a' });
    await promote(adapters);
    await advanceOnce(adapters, 'cmd-del-a');
    await completeChampion(adapters);

    const runB = makeAdapters({
      db: adapters.db,
      seed: 'cccccccccccccccccccccccccccccccc',
      runId: 'cl-run-del-b',
    });
    await promote(runB);
    await advanceOnce(runB, 'cmd-del-b');
    await completeChampion(runB);
    expect(await adapters.repo.listCompletedSeasonRuns()).toHaveLength(2);

    await adapters.repo.deleteCompletedSeason('cl-run-del-a');

    expect(await adapters.repo.loadCompletedSeason('cl-run-del-a')).toBeNull();
    expect(await adapters.repo.listCompletedSeasonRuns()).toHaveLength(1);
    expect((await adapters.repo.listCompletedSeasonRuns())[0]?.runId).toBe('cl-run-del-b');
    expect(await adapters.db.seasonAlmanacs.get('cl-run-del-a')).toBeUndefined();
    expect(await adapters.db.seasonCompletedIndex.get('cl-run-del-a')).toBeUndefined();
    expect(await adapters.db.seasonAlmanacs.get('cl-run-del-b')).toBeDefined();
    // Run B still loads completely.
    const surviving = await adapters.repo.loadCompletedSeason('cl-run-del-b');
    expect(surviving?.almanac.runId).toBe('cl-run-del-b');
    expect(surviving?.commandLog.entries).toHaveLength(1);
  });

  it('rolls the whole promotion back when ANY transaction write fails', async () => {
    const failures: Array<[string, string, (adapters: Adapters) => void]> = [
      [
        'completed run row',
        'x-completed',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonCompletedRuns, 'put')
            .mockRejectedValueOnce(new Error('x-completed')),
      ],
      [
        'almanac row',
        'x-almanac',
        (adapters) =>
          vi.spyOn(adapters.db.seasonAlmanacs, 'put').mockRejectedValueOnce(new Error('x-almanac')),
      ],
      [
        'command log finalize',
        'x-command-log',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonCommandLog, 'bulkPut')
            .mockRejectedValueOnce(new Error('x-command-log')),
      ],
      [
        'history index row',
        'x-index',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonCompletedIndex, 'put')
            .mockRejectedValueOnce(new Error('x-index')),
      ],
      [
        'active checkpoint removal',
        'x-run-delete',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonRuns, 'delete')
            .mockRejectedValueOnce(new Error('x-run-delete')),
      ],
      [
        'active index removal',
        'x-index-delete',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonRunIndex, 'delete')
            .mockRejectedValueOnce(new Error('x-index-delete')),
      ],
      [
        'pending candidate removal',
        'x-pending-delete',
        (adapters) =>
          vi
            .spyOn(adapters.db.seasonPendingBlocks, 'delete')
            .mockRejectedValueOnce(new Error('x-pending-delete')),
      ],
    ];
    for (const [label, errorMessage, inject] of failures) {
      const adapters = makeAdapters({ runId: `cl-run-fail-${label.replaceAll(' ', '-')}` });
      await promote(adapters);
      await advanceOnce(adapters, `cmd-fail-${label.replaceAll(' ', '-')}`);
      const champion = adapters.run.rosters[0]?.franchiseId ?? 'lakers';
      const finalRun = completedRunOf(adapters, adapters.run.stateRevision + 1);
      const log = await adapters.repo.loadCommandLog(adapters.run.runId);
      if (log === null) throw new Error('expected a command log');
      const entriesBefore = log.entries;
      const almanac = buildAlmanac(adapters.run, champion, seasonCommandLogDigest(entriesBefore));
      const input = {
        runId: adapters.run.runId,
        run: finalRunWithAlmanac(finalRun, almanac.digest),
        almanac,
        commandLog: log,
        postseasonSummaries: await adapters.repo.loadPostseasonSummaries(adapters.run.runId),
      };
      inject(adapters);
      await expect(adapters.repo.promoteChampionToCompleted(input)).rejects.toThrow(errorMessage);
      // NOTHING committed: no completed rows, no almanac, no history index,
      // no partial command log, and the active run is intact.
      expect(await adapters.db.seasonCompletedRuns.count(), label).toBe(0);
      expect(await adapters.db.seasonAlmanacs.count(), label).toBe(0);
      expect(await adapters.db.seasonCompletedIndex.count(), label).toBe(0);
      expect(await adapters.repo.listCompletedSeasonRuns(), label).toEqual([]);
      expect(await adapters.repo.loadActiveRun(), label).not.toBeNull();
      expect(await adapters.db.seasonRuns.get(SEASON_RUN_RECORD_ID), label).not.toBeUndefined();
      expect((await adapters.repo.loadCommandLog(adapters.run.runId))?.entries, label).toEqual(
        entriesBefore,
      );
      expect(await adapters.repo.loadPostseasonSummaries(adapters.run.runId), label).toHaveLength(
        1,
      );
      vi.restoreAllMocks();
    }
  });

  it('reloads between every postseason stage and completes with identical digests', async () => {
    const adapters = makeAdapters({ runId: 'cl-run-stages' });
    await promote(adapters);

    // Stage 1: play-in, reload through a fresh repository instance.
    await advanceOnce(adapters, 'cmd-stage-1');
    const repo1 = new DexieSeasonRunRepository(adapters.db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    const reload1 = await repo1.loadActiveRunWithSchedule(adapters.schedule);
    expect(reload1?.run.stage).toBe('play-in');
    expect(reload1?.run.stateRevision).toBe(1);
    expect(reload1?.run.stateDigest).toBe(adapters.run.stateDigest);

    // Stage 2: playoffs, reload again.
    const command2 = commandOf(adapters.run, 'advance-postseason', 'cmd-stage-2');
    const next2 = advancedRun(adapters, 'playoffs');
    await repo1.commitPostseasonAdvancement(
      advancementInput(adapters, command2, basePostseasonSummary(adapters), next2),
    );
    adapters.run = next2;
    const repo2 = new DexieSeasonRunRepository(adapters.db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    const reload2 = await repo2.loadActiveRunWithSchedule(adapters.schedule);
    expect(reload2?.run.stage).toBe('playoffs');
    expect(reload2?.run.stateRevision).toBe(2);
    expect(reload2?.run.stateDigest).toBe(adapters.run.stateDigest);
    const log2 = await repo2.loadCommandLog(adapters.run.runId);
    expect(log2?.entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(log2?.entries[1]?.previousLogDigest).toBe(
      seasonCommandLogDigest(log2?.entries.slice(0, 1) ?? []),
    );

    // Stage 3: completed, through a third repository instance.
    await completeChampion(adapters);
    const repo3 = new DexieSeasonRunRepository(adapters.db, {
      schedule: adapters.schedule,
      seam: adapters.seam,
    });
    expect(await repo3.loadActiveRun()).toBeNull();
    const completed = await repo3.loadCompletedSeason(adapters.run.runId);
    expect(completed).not.toBeNull();
    expect(completed?.run.stage).toBe('completed');
    expect(completed?.run.stateRevision).toBe(3);
    expect(completed?.commandLog.entries.map((entry) => entry.ordinal)).toEqual([0, 1]);
    expect(completed?.almanac.commandLogDigest).toBe(
      seasonCommandLogDigest(completed?.commandLog.entries ?? []),
    );
    expect(completed?.run.completion?.championFranchiseId).toBe(
      completed?.almanac.championFranchiseId,
    );
  });

  it('produces identical command logs and replay exports for identical inputs', async () => {
    const runA = makeAdapters({ runId: 'cl-run-det-a' });
    const runB = makeAdapters({ seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a', runId: 'cl-run-det-a' });
    await promote(runA);
    await promote(runB);
    for (const [commandId, stage] of [
      ['cmd-det-1', 'play-in'],
      ['cmd-det-2', 'playoffs'],
    ] as const) {
      const commandA = commandOf(
        runA.run,
        commandId === 'cmd-det-1' ? 'start-postseason' : 'advance-postseason',
        commandId,
      );
      const nextA = advancedRun(runA, stage);
      await runA.repo.commitPostseasonAdvancement(
        advancementInput(runA, commandA, basePostseasonSummary(runA), nextA),
      );
      runA.run = nextA;

      const commandB = commandOf(
        runB.run,
        commandId === 'cmd-det-1' ? 'start-postseason' : 'advance-postseason',
        commandId,
      );
      const nextB = advancedRun(runB, stage);
      await runB.repo.commitPostseasonAdvancement(
        advancementInput(runB, commandB, basePostseasonSummary(runB), nextB),
      );
      runB.run = nextB;
    }
    const logA = await runA.repo.loadCommandLog(runA.run.runId);
    const logB = await runB.repo.loadCommandLog(runB.run.runId);
    expect(logA?.entries).toEqual(logB?.entries);
    expect(seasonCommandLogDigest(logA?.entries ?? [])).toBe(
      seasonCommandLogDigest(logB?.entries ?? []),
    );
    expect(logA?.entries[0]?.previousLogDigest).toBe(SEASON_EMPTY_COMMAND_LOG_DIGEST);

    // Replay exports are byte-identical within and across runs.
    const exportA1 = await runA.repo.buildReplayExport(runA.run.runId, 'pi-east-seven-eight');
    const exportA2 = await runA.repo.buildReplayExport(runA.run.runId, 'pi-east-seven-eight');
    const exportB1 = await runB.repo.buildReplayExport(runB.run.runId, 'pi-east-seven-eight');
    expect(JSON.stringify(exportA1)).toBe(JSON.stringify(exportA2));
    expect(JSON.stringify(exportA1)).toBe(JSON.stringify(exportB1));
  });
});
