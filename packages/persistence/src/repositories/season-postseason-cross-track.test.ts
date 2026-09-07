import { afterEach, describe, expect, it } from 'vitest';
import {
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_ROUND_COUNT,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  PLAYER_VERSION_ID_VERSION,
  canonicalJson,
  buildEmptyChallengeState,
  commandIdSchema,
  eraIdSchema,
  franchiseIdSchema,
  seasonAlmanacDigest,
  seasonCommandLogDigest,
  seasonDigestHex,
  seasonHealthStateSchema,
  seasonPostseasonSummarySchema,
  seasonRunCommandSchema,
  type Position,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonGameSideResult,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunCommand,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  handleSeasonRunCommand,
  rankSeasonPostseason,
  seasonPostseasonHumanPlaysGame,
  zeroSeasonGameTransition,
  type SeasonPostseasonGameResolver,
} from '@hoop-rush/engine';
import { buildEraSimulationProfile } from '@hoop-rush/test-fixtures';
import { SEASON_RUN_RECORD_ID } from '../schemas/season-run-record.ts';
import { DexieSeasonRunRepository } from './season-run-dexie.ts';
import { TestDatabase, restoreIndexedDb, testDatabaseName } from '../testing/repo-test-support.ts';
import {
  buildFixtureEffectsState,
  buildFixtureLeague,
  buildFixtureRosters,
  buildFixturePromotedDigestContext,
  buildFixtureRun,
  buildFixtureSchedule,
  buildFixtureStoredDraft,
  buildStubSeasonEngineSeam,
} from '../testing/season-run-fixture.ts';
const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
const RUN_ID = 'cross-track-run';
const HUMAN = 'lakers';
const DIGEST_32 = '0'.repeat(32);
interface TeamSpec {
  w: number;
  l: number;
  h2h?: Record<string, number>;
}
function standingsSpec(): Record<string, TeamSpec> {
  const league = buildFixtureLeague(HUMAN);
  const spec: Record<string, TeamSpec> = {};
  const east = league.teams.filter((team) => team.conference === 'east');
  east.forEach((team, index) => {
    const w = 62 - index;
    spec[team.franchiseId] = { w, l: 82 - w };
  });
  const west = league.teams.filter((team) => team.conference === 'west');
  let above = 0;
  let below = 0;
  west.forEach((team) => {
    if (team.franchiseId === HUMAN || team.franchiseId === 'clippers') {
      spec[team.franchiseId] = { w: 40, l: 42 };
    } else if (above < 6) {
      const w = 52 + above;
      spec[team.franchiseId] = { w, l: 82 - w };
      above += 1;
    } else {
      const w = 30 - below;
      spec[team.franchiseId] = { w, l: 82 - w };
      below += 1;
    }
  });
  spec[HUMAN] = { w: 40, l: 42, h2h: { clippers: 1 } };
  spec.clippers = { w: 40, l: 42, h2h: { [HUMAN]: 3 } };
  return spec;
}
function standingsOf(spec: Record<string, TeamSpec>): SeasonStandings {
  const league = buildFixtureLeague(HUMAN);
  const teamIds = league.teams.map((team) => team.franchiseId);
  return {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
    rows: teamIds.map((franchiseId) => {
      const teamSpec = spec[franchiseId] ?? { w: 0, l: 0 };
      return {
        franchiseId,
        wins: teamSpec.w,
        losses: teamSpec.l,
        gamesPlayed: teamSpec.w + teamSpec.l,
        homeWins: 0,
        homeLosses: 0,
        awayWins: 0,
        awayLosses: 0,
        conferenceWins: 0,
        conferenceLosses: 0,
        divisionWins: 0,
        divisionLosses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        headToHead: teamIds
          .filter((other) => other !== franchiseId)
          .map((other) => ({
            franchiseId: other,
            wins: teamSpec.h2h?.[other] ?? 0,
            losses: spec[other]?.h2h?.[franchiseId] ?? 0,
          })),
      };
    }),
  };
}
const SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];
function catalogOf(rosters: ReturnType<typeof buildFixtureRosters>): SeasonDraftCatalog {
  const candidates: SeasonDraftCandidate[] = rosters.flatMap((roster) =>
    roster.players.map((player, slot) => {
      const playable = SLOT_POSITIONS[slot];
      if (playable === undefined) throw new Error(`no position pattern for slot ${String(slot)}`);
      const primary = playable[0];
      if (primary === undefined) throw new Error(`no primary position for slot ${String(slot)}`);
      return {
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        franchiseId: roster.franchiseId,
        eraId: player.eraId,
        seasonKey: player.seasonKey,
        displayName: player.displayName,
        playerExternalId: '101',
        positions: {
          primary,
          secondary: playable.slice(1),
          playable: [...playable],
          normalizationVersion: 'position-v3',
        },
        heightInches: 79,
        weightLbs: 215,
        summaryRatings: { overallRating: 90, offenseRating: 92, defenseRating: 84 },
        detailedRatings: { ...SIMULATION_RATINGS },
        tendencies: { ...SIMULATION_TENDENCIES },
        stamina: { rating: 70, historicalMpg: 30, derivationVersion: SEASON_STAMINA_VERSION },
        durability: { rating: 70, derivationVersion: SEASON_DURABILITY_VERSION },
      };
    }),
  );
  const pools = rosters.map((roster) => ({
    franchiseId: roster.franchiseId,
    eraId: eraIdSchema.parse('1990s'),
    playerVersionIds: roster.players.map((player) => player.playerVersionId),
  }));
  return {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: 'data-v1',
    ratingsVersion: 'ratings-v1',
    positionNormalizationVersion: 'position-v3',
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates,
  };
}
function runAtPostseasonBoundary(): SeasonRun {
  const run = buildFixtureRun({ seed: SEED, runId: RUN_ID });
  return {
    ...run,
    cursor: { ...run.cursor, completedRounds: SEASON_ROUND_COUNT },
    standings: standingsOf(standingsSpec()),
    stateRevision: 0,
    stateDigest: DIGEST_32,
  };
}
function commandOf(
  run: SeasonRun,
  command: 'start-postseason' | 'advance-postseason' | 'submit-postseason-rotation',
  commandId: string,
  extra: Record<string, unknown> = {},
): SeasonRunCommand {
  const parsedCommandId = commandIdSchema.parse(commandId);
  return seasonRunCommandSchema.parse({
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    commandId: parsedCommandId,
    runId: run.runId,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
    command,
    ...extra,
  });
}
function forcedCompletedResult(
  gameInput: SeasonGameSimulationInput,
  homeScore: number,
  awayScore: number,
): {
  result: SeasonGameSimulationResult;
} {
  const homeWon = homeScore > awayScore;
  const sideOf = (side: 'home' | 'away', score: number): SeasonGameSideResult => {
    const team = side === 'home' ? gameInput.home : gameInput.away;
    const fgm = Math.floor(score / 2);
    const ftm = score % 2;
    return {
      teamId: team.teamId,
      displayName: team.displayName,
      franchiseId: team.franchiseId,
      score,
      periodScores: [score],
      box: {
        points: score,
        fieldGoals: { made: fgm, attempted: fgm },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: ftm, attempted: ftm },
        rebounds: { total: 0, offensive: 0, defensive: 0, team: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 60,
        diagnostics: {
          assistedFieldGoals: 0,
          unassistedFieldGoals: fgm,
          reboundOpportunities: 0,
          contestedShots: 0,
        },
      },
      players: team.players.map((player, index) => ({
        playerVersionId: player.playerVersionId,
        playerId: player.playerId,
        seconds: 1440,
        minutes: 24,
        points: index === 0 ? score : 0,
        fieldGoals: { made: index === 0 ? fgm : 0, attempted: index === 0 ? fgm : 0 },
        threes: { made: 0, attempted: 0 },
        freeThrows: { made: index === 0 ? ftm : 0, attempted: index === 0 ? ftm : 0 },
        rebounds: { total: 0, offensive: 0, defensive: 0 },
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        diagnostics: {
          usage: 0,
          shotZones: [],
          assistOpportunities: 0,
          offensiveReboundChances: 0,
          defensiveReboundChances: 0,
          contestedShots: 0,
        },
      })),
      shotZones: [],
      returns: [],
    };
  };
  return {
    result: {
      schemaVersion: 1,
      outcome: 'completed',
      seed: gameInput.seed,
      gameNumber: gameInput.gameNumber,
      dataVersion: gameInput.dataVersion,
      engineVersion: 'engine-v1',
      profileVersion: gameInput.profile.profileVersion,
      winner: homeWon ? 'home' : 'away',
      overtimePeriods: 0,
      home: sideOf('home', homeScore),
      away: sideOf('away', awayScore),
      substitutions: [],
      unitStints: [],
      deviations: [],
      foulOuts: [],
      removals: [],
    },
  };
}
function humanWinsResolver(): SeasonPostseasonGameResolver {
  return ({ gameInput, pregameEffects }) => {
    const home = gameInput.home.franchiseId;
    const away = gameInput.away.franchiseId;
    const winner = home === HUMAN ? 'home' : away === HUMAN ? 'away' : 'home';
    return {
      ...forcedCompletedResult(
        gameInput,
        winner === 'home' ? 110 : 90,
        winner === 'home' ? 90 : 110,
      ),
      transition: zeroSeasonGameTransition(pregameEffects),
    };
  };
}
interface FlowContext {
  db: TestDatabase;
  repo: DexieSeasonRunRepository;
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  effects: ReturnType<typeof buildFixtureEffectsState>;
}
async function makeFlow(): Promise<FlowContext> {
  const db = new TestDatabase(testDatabaseName('cross-track'));
  const run = runAtPostseasonBoundary();
  const catalog = catalogOf(run.rosters);
  const effects = buildFixtureEffectsState(run.rosters);
  const seam = buildStubSeasonEngineSeam();
  const repo = new DexieSeasonRunRepository(db, {
    schedule: buildFixtureSchedule(SEED),
    seam,
  });
  const influence = seam.createInitialSeasonInfluenceState(
    run.league.teams.map((team) => team.franchiseId),
  );
  const promoted = buildFixturePromotedDigestContext(run, seam);
  const stateDigest = seam.seasonRunStateDigest({
    stateRevision: 0,
    stage: run.stage,
    postseason: run.postseason,
    awards: run.awards,
    completion: run.completion,
    checkpointState: run.checkpointState,
    health: promoted.health,
    influence: promoted.influence,
    transactions: [],
    trade: run.trade,
    objectives: promoted.objectives,
    challenges: promoted.challenges,
    campaign: promoted.campaign,
    rosters: run.rosters,
    ownership: run.ownership,
    rotations: run.rotations,
    effects,
    freeAgency: run.freeAgency,
    authority: run.authority,
  });
  const aligned: SeasonRun = {
    ...run,
    health: promoted.health,
    influence: promoted.influence,
    transactions: [],
    stateRevision: 0,
    stateDigest,
  };
  await repo.promoteSeasonDraftToRun(buildFixtureStoredDraft(aligned), aligned);
  return { db, repo, run: aligned, catalog, effects };
}
async function commit(
  repo: DexieSeasonRunRepository,
  nextRun: SeasonRun,
  command: SeasonRunCommand,
  summaries: readonly SeasonPostseasonSummary[],
  relatedGameIds: readonly string[],
): Promise<void> {
  await repo.commitPostseasonAdvancement({
    runId: command.runId,
    run: nextRun,
    summaries: summaries.map((summary) => seasonPostseasonSummarySchema.parse(summary)),
    command,
    preStateRevision: command.expectedStateRevision,
    preStateDigest: command.expectedStateDigest,
    resultDigest: seasonDigestHex(
      canonicalJson({
        commandId: command.commandId,
        gameIds: [...relatedGameIds].sort(),
        summaryDigests: summaries.map((summary) => summary.resultDigest).sort(),
      }),
    ),
    relatedGameIds: [...relatedGameIds],
    transactionIds: [],
  });
}
afterEach(() => {
  restoreIndexedDb();
});
describe('cross-track postseason integration (M2.6)', () => {
  it('ranks, starts, advances, reloads, and promotes one champion', async () => {
    const { db, repo, run: initial, catalog, effects } = await makeFlow();
    let run = initial;
    const rankings = rankSeasonPostseason(run.league, run.standings, run.rootSeed);
    const clippersId = franchiseIdSchema.parse('clippers');
    const humanId = franchiseIdSchema.parse(HUMAN);
    const westTie = rankings.west.resolutions.find(
      (entry) => entry.teams.includes(clippersId) && entry.teams.includes(humanId),
    );
    expect(westTie).toBeDefined();
    expect(westTie?.rule).toBe('head-to-head');
    expect(westTie?.kind).toBe('qualification');
    expect(westTie?.slots).toEqual([7, 8]);
    expect(rankings.west.playInSeeds.slice(0, 2)).toEqual(['clippers', HUMAN]);
    const contextOf = (current: SeasonRun) => ({
      run: current,
      pending: null,
      humanFranchiseId: HUMAN,
      catalog,
      effects,
      profile: buildEraSimulationProfile(),
      postseasonGameResolver: humanWinsResolver(),
    });
    const startCommand = commandOf(run, 'start-postseason', 'xt-start-1');
    const start = handleSeasonRunCommand(startCommand, contextOf(run));
    expect(start.result.result.status).toBe('accepted');
    run = start.run;
    expect(run.stage).toBe('play-in');
    expect(run.postseason.playIn.west.ranking).toEqual(rankings.west.topTen);
    await commit(repo, run, startCommand, [], []);
    let guard = 0;
    let totalSummaries = 0;
    while (run.stage !== 'completed' && guard < 40) {
      guard += 1;
      const advanceCommand = commandOf(run, 'advance-postseason', `xt-adv-${String(guard)}`);
      const output = handleSeasonRunCommand(advanceCommand, contextOf(run));
      if (output.result.result.status === 'rejected') {
        throw new Error(`advance rejected: ${JSON.stringify(output.result.result)}`);
      }
      const accepted = output.result.result;
      if ('nextDecision' in accepted) {
        if (accepted.nextDecision === 'rotation') {
          const next = accepted.nextGameId;
          expect(next).not.toBeNull();
          if (next === null) throw new Error('missing next human game');
          expect(seasonPostseasonHumanPlaysGame(run.postseason, HUMAN, next)).toBe(true);
          const rotation = run.rotations.find((entry) => entry.franchiseId === HUMAN);
          if (rotation === undefined) throw new Error('no human rotation');
          const submitCommand = commandOf(
            run,
            'submit-postseason-rotation',
            `xt-sub-${String(guard)}`,
            {
              targetGameId: next,
              rotation: { franchiseId: HUMAN, rotation },
            },
          );
          const submitted = handleSeasonRunCommand(submitCommand, contextOf(run));
          expect(submitted.result.result.status).toBe('accepted');
          run = submitted.run;
          await commit(repo, run, submitCommand, [], []);
          continue;
        }
        const summaries = output.postseasonSummaries ?? [];
        await commit(repo, output.run, advanceCommand, summaries, accepted.advancedGameIds);
        totalSummaries += summaries.length;
        run = output.run;
      } else {
        throw new Error(`advance not accepted: ${JSON.stringify(accepted)}`);
      }
      const reloaded = await repo.loadActiveRun();
      expect(reloaded).not.toBeNull();
      if (reloaded !== null) {
        expect(reloaded.run.stateRevision).toBe(run.stateRevision);
        expect(reloaded.run.stateDigest).toBe(run.stateDigest);
        expect(reloaded.run.postseason).toEqual(run.postseason);
        run = reloaded.run;
      }
    }
    expect(run.stage).toBe('completed');
    const champion = run.postseason.championFranchiseId;
    expect(champion).not.toBeNull();
    expect(run.completion?.championFranchiseId).toBe(champion);
    expect(totalSummaries).toBeGreaterThan(0);
    const postseasonSummaries = await repo.loadPostseasonSummaries(RUN_ID);
    expect(postseasonSummaries.length).toBe(totalSummaries);
    const commandLog = await repo.loadCommandLog(RUN_ID);
    if (commandLog === null) throw new Error('expected a command log');
    expect(commandLog.entries.length).toBeGreaterThan(1);
    for (let index = 0; index < commandLog.entries.length; index += 1) {
      expect(commandLog.entries[index]?.ordinal).toBe(index);
    }
    if (champion === null) throw new Error('expected champion');
    const championId = champion;
    const almanacFacts = {
      schemaVersion: 1 as const,
      almanacVersion: 'almanac-v2' as const,
      runId: RUN_ID,
      rootSeed: run.rootSeed,
      championFranchiseId: championId,
      postseasonDigest: seasonDigestHex(canonicalJson(run.postseason)),
      commandLogDigest: seasonCommandLogDigest(commandLog.entries),
      awardsDigest: seasonDigestHex(canonicalJson(run.awards)),
      tradeGradesDigest: seasonDigestHex(canonicalJson(null)),
      digest: DIGEST_32,
    };
    const almanac = { ...almanacFacts, digest: seasonAlmanacDigest(almanacFacts) };
    const completion = run.completion;
    if (completion === null) throw new Error('expected completion state');
    await repo.promoteChampionToCompleted({
      runId: RUN_ID,
      run: { ...run, completion: { ...completion, almanacDigest: almanac.digest } },
      almanac,
      commandLog,
      postseasonSummaries,
    });
    expect(await repo.loadActiveRun()).toBeNull();
    expect(await repo.loadActiveRunIndex()).toBeNull();
    const completed = await repo.loadCompletedSeason(RUN_ID);
    expect(completed).not.toBeNull();
    expect(completed?.run.stage).toBe('completed');
    expect(completed?.almanac.championFranchiseId).toBe(champion);
    expect(completed?.commandLog.entries).toHaveLength(commandLog.entries.length);
    expect(completed?.postseasonSummaries).toHaveLength(postseasonSummaries.length);
    expect((await repo.listCompletedSeasonRuns()).some((entry) => entry.runId === RUN_ID)).toBe(
      true,
    );
    for (const summary of postseasonSummaries) {
      expect(() => seasonPostseasonSummarySchema.parse(summary)).not.toThrow();
    }
    const firstGame = postseasonSummaries[0]?.gameId;
    if (firstGame !== undefined) {
      const exportArtifact = await repo.buildReplayExport(RUN_ID, firstGame);
      expect(exportArtifact).not.toBeNull();
      expect(exportArtifact?.digest).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(await db.seasonRuns.get(SEASON_RUN_RECORD_ID)).toBeUndefined();
  });
  it('produces identical rankings and seeds from identical standings', () => {
    const run = runAtPostseasonBoundary();
    const first = rankSeasonPostseason(run.league, run.standings, run.rootSeed);
    const second = rankSeasonPostseason(run.league, run.standings, run.rootSeed);
    expect(second).toEqual(first);
    expect(first.west.ranked).toHaveLength(15);
    expect(first.east.ranked).toHaveLength(15);
    expect(first.west.topTen).toHaveLength(10);
  });
});
