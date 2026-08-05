import {
  SEASON_AI_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STANDINGS_VERSION,
  seasonNamespaceSeed,
  seasonRunSchema,
  type SeasonCheckpointVersions,
  type SeasonDraftCatalog,
  type SeasonGameSummary,
  type SeasonLeagueGenerationResult,
  type SeasonRun,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildFixtureGenerationAudit,
  buildFixtureSeasonDraftFacts,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
} from '@hoop-rush/test-fixtures';
import { generateSeasonSchedule } from './schedule.ts';
import { generateAiLeague } from './ai.ts';
import {
  expandSeasonRunRosters,
  rosterPlayerIdsOf,
  simulateSeasonBlock,
  type SeasonBlockSimulationInput,
} from './block.ts';
import { seasonRotationSetDigest } from './rotation.ts';

/**
 * Deterministic full-league test support for the M2.3 block pipeline: a
 * synthetic 30-franchise draft catalog, AI-generated rosters and rotations,
 * the committed-format schedule, and a schema-valid run snapshot. Building
 * the league is expensive (AI generation), so the result is cached per test
 * file; run states are cheap clones.
 */

export const TEST_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

export const ALL_FRANCHISES = [
  'hawks',
  'celtics',
  'nets',
  'hornets',
  'bulls',
  'cavaliers',
  'pistons',
  'pacers',
  'heat',
  'bucks',
  'knicks',
  'magic',
  'sixers',
  'raptors',
  'wizards',
  'mavericks',
  'nuggets',
  'warriors',
  'rockets',
  'clippers',
  'lakers',
  'grizzlies',
  'timberwolves',
  'pelicans',
  'thunder',
  'suns',
  'blazers',
  'kings',
  'spurs',
  'jazz',
] as const;

export const VERSIONS: SeasonCheckpointVersions = {
  blockVersion: 'season-block-v1',
  summaryVersion: 'season-game-summary-v1',
  aggregatesVersion: 'season-aggregates-v1',
  recapVersion: 'season-recap-v1',
  leadersVersion: 'season-leaders-v1',
  homeCourtVersion: 'season-home-court-v1',
  gameVersion: 'season-game-v2',
  gameTargetsVersion: 'season-game-targets-v2',
  seedDerivationVersion: 'season-seeds-v1',
};

export interface TestRun {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  generation: SeasonLeagueGenerationResult;
}

let cachedRun: TestRun | null = null;

/** Builds (once per test file) a full synthetic league and run snapshot. */
export function buildTestRun(options: { humanFranchiseId?: string } = {}): TestRun {
  if (cachedRun !== null) return cachedRun;
  cachedRun = buildFreshTestRun(options);
  return cachedRun;
}

function buildFreshTestRun(options: { humanFranchiseId?: string } = {}): TestRun {
  const humanFranchiseId = options.humanFranchiseId ?? 'lakers';
  const league = buildSeasonLeague({}, { humanFranchiseId });
  const catalog = buildSeasonDraftCatalog({
    franchiseIds: [...ALL_FRANCHISES],
    eras: ['1990s'],
    playersPerPool: 40,
  });
  const humanPool = catalog.pools.find(
    (pool) => pool.franchiseId === humanFranchiseId && pool.eraId === '1990s',
  );
  if (humanPool === undefined) throw new Error('missing human pool');
  // The full position-archetype cycle (indices 0..9) covers G/F/C variety.
  const humanRoster = humanPool.playerVersionIds.slice(0, 10);
  const generation = generateAiLeague({
    seed: TEST_SEED,
    catalog,
    league,
    humanFranchiseIds: [humanFranchiseId],
    humanRosters: [{ franchiseId: humanFranchiseId, playerVersionIds: humanRoster }],
    targets: null,
  });
  const schedule = generateSeasonSchedule({ league, seed: TEST_SEED });
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: 'block-test-run-1',
    rootSeed: TEST_SEED,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: SEASON_LEAGUE_VERSION,
      scheduleVersion: SEASON_SCHEDULE_VERSION,
      scheduleFormulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
      standingsVersion: SEASON_STANDINGS_VERSION,
      postseasonVersion: SEASON_POSTSEASON_VERSION,
      seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: 'season-draft-v1',
      rosterRulesVersion: SEASON_ROSTER_RULES_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      aiVersion: SEASON_AI_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      rotationPlannerVersion: SEASON_ROTATION_PLANNER_VERSION,
      gameVersion: VERSIONS.gameVersion,
      gameTargetsVersion: VERSIONS.gameTargetsVersion,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      checkpointVersion: 'season-checkpoint-v1',
      blockVersion: VERSIONS.blockVersion,
      summaryVersion: VERSIONS.summaryVersion,
      aggregatesVersion: VERSIONS.aggregatesVersion,
      recapVersion: VERSIONS.recapVersion,
      leadersVersion: VERSIONS.leadersVersion,
      homeCourtVersion: VERSIONS.homeCourtVersion,
    },
    league,
    rosters: generation.rosters,
    ownership: generation.ownership,
    schedule: {
      leagueVersion: SEASON_LEAGUE_VERSION,
      scheduleVersion: SEASON_SCHEDULE_VERSION,
      formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
      generationSeed: schedule.generationSeed,
      contentHash: '0'.repeat(64),
    },
    games: schedule.games.map((game) => ({
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      status: 'scheduled' as const,
      homeScore: null,
      awayScore: null,
      forfeitLoserFranchiseId: null,
    })),
    standings: {
      schemaVersion: 1,
      standingsVersion: SEASON_STANDINGS_VERSION,
      rows: league.teams.map((team) => ({
        franchiseId: team.franchiseId,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
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
        headToHead: league.teams
          .filter((other) => other.franchiseId !== team.franchiseId)
          .map((other) => ({ franchiseId: other.franchiseId, wins: 0, losses: 0 })),
      })),
    },
    cursor: { schemaVersion: 1, completedRounds: 0 },
    postseason: emptyPostseason(TEST_SEED),
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments: generation.aiAssignments,
    rotations: generation.rotations,
    generationAudit: buildFixtureGenerationAudit(TEST_SEED),
    evaluations: generation.evaluations,
  };
  const parsed = seasonRunSchema.safeParse(run);
  if (!parsed.success) {
    throw new Error(`test run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return { run, catalog, generation };
}

function emptyPostseason(rootSeed: string): SeasonRun['postseason'] {
  const game = (gameId: 'seven-eight' | 'nine-ten' | 'final') => ({
    gameId,
    status: 'scheduled' as const,
    homeFranchiseId: null,
    awayFranchiseId: null,
    winnerFranchiseId: null,
    loserFranchiseId: null,
    homeScore: null,
    awayScore: null,
  });
  const conference = (id: 'east' | 'west') => ({
    conference: id,
    ranking: null,
    games: {
      sevenEight: game('seven-eight'),
      nineTen: game('nine-ten'),
      final: game('final'),
    },
    playoffSeeds: null,
  });
  return {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    seed: seasonNamespaceSeed(rootSeed, 'postseason-ties'),
    playIn: { east: conference('east'), west: conference('west') },
    bracket: null,
    championFranchiseId: null,
  };
}

export function scheduleOf(run: SeasonRun): ReturnType<typeof generateSeasonSchedule> {
  return generateSeasonSchedule({ league: run.league, seed: run.schedule.generationSeed });
}

export function blockCommand(
  run: SeasonRun,
  blockIndex: number,
  expectedRevision: number,
): SeasonSubmitBlockCommand {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: 'season-block-v1',
    command: 'submit-season-block',
    commandId: `block-${String(blockIndex)}-${String(expectedRevision)}`,
    runId: run.runId,
    expectedRevision,
    blockIndex,
    rotationDigest: seasonRotationSetDigest(run.rotations),
  };
}

/** The pipeline input for a run at the given cursor state. */
export function pipelineInput(
  run: SeasonRun,
  catalog: SeasonDraftCatalog,
  blockIndex: number,
  priorSummaries: readonly SeasonGameSummary[] = [],
): SeasonBlockSimulationInput {
  return {
    command: blockCommand(run, blockIndex, blockIndex),
    run,
    expanded: expandSeasonRunRosters(run, catalog),
    schedule: scheduleOf(run),
    catalog,
    profile: buildEraSimulationProfile(),
    humanFranchiseId: 'lakers',
    rosterPlayerIds: rosterPlayerIdsOf(run),
    priorSummaries,
  };
}

export interface RunnerState {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  summaries: SeasonGameSummary[];
}

/** Runs one block through the pipeline and advances the runner state. */
export function runBlock(
  state: RunnerState,
  blockIndex: number,
): import('@hoop-rush/data-contracts').SeasonCandidateCheckpoint {
  const input = pipelineInput(state.run, state.catalog, blockIndex, state.summaries);
  const checkpoint = simulateSeasonBlock(input);
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.run = {
    ...state.run,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
  };
  return checkpoint;
}

/** Builds a fresh runner state from the shared run (cheap clone). */
export function freshState(): RunnerState {
  const { run, catalog } = buildTestRun();
  return { run, catalog, summaries: [] as SeasonGameSummary[] };
}
