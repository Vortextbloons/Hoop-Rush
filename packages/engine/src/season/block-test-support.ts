import {
  SEASON_AI_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  seasonEffectsStateSchema,
  seasonNamespaceSeed,
  seasonRunSchema,
  type SeasonCheckpointVersions,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonLeagueGenerationResult,
  type SeasonPairChemistryState,
  type SeasonRun,
  type SeasonSubmitBlockCommand,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildFixtureGenerationAudit,
  buildFixtureRosterTargets,
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
 * the committed-format schedule, and a schema-valid run snapshot. The league
 * build runs AI generation, so the result is cached per test file; run
 * states are cheap clones.
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
  blockVersion: SEASON_BLOCK_VERSION,
  summaryVersion: SEASON_GAME_SUMMARY_VERSION,
  aggregatesVersion: 'season-aggregates-v1',
  recapVersion: SEASON_RECAP_VERSION,
  leadersVersion: 'season-leaders-v1',
  homeCourtVersion: 'season-home-court-v1',
  gameVersion: SEASON_GAME_VERSION,
  gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
  seedDerivationVersion: 'season-seeds-v1',
  staminaVersion: SEASON_STAMINA_VERSION,
  chemistryVersion: SEASON_CHEMISTRY_VERSION,
  effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
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
    targets: buildFixtureRosterTargets(),
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
      checkpointVersion: 'season-checkpoint-v2',
      blockVersion: VERSIONS.blockVersion,
      summaryVersion: VERSIONS.summaryVersion,
      aggregatesVersion: VERSIONS.aggregatesVersion,
      recapVersion: VERSIONS.recapVersion,
      leadersVersion: VERSIONS.leadersVersion,
      homeCourtVersion: VERSIONS.homeCourtVersion,
      staminaVersion: VERSIONS.staminaVersion,
      chemistryVersion: VERSIONS.chemistryVersion,
      effectsTargetsVersion: VERSIONS.effectsTargetsVersion,
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
    aiPools: fixtureAiPools(generation.aiAssignments),
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

/**
 * Synthetic roster-generation-v2 pools for the test run: one 20-player pool
 * per AI franchise (the run's AI assignments exclude the human team), each
 * with ten selections and one allocation seed path per selection. The block
 * pipeline never reads pools (simulation consumes final rosters), so these
 * carry only the recorded facts schema 6 requires.
 */
function fixtureAiPools(aiAssignments: SeasonRun['aiAssignments']): SeasonRun['aiPools'] {
  return aiAssignments
    .filter((assignment) => assignment.franchiseId !== 'lakers')
    .map((assignment, poolIndex) => {
      const playerVersionIds = Array.from({ length: 20 }, (_, slot) => {
        const hex = `${String(poolIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
          32,
          '0',
        );
        return `pv-${hex}`;
      });
      const selections = playerVersionIds.slice(0, 10);
      return {
        franchiseId: assignment.franchiseId,
        band: assignment.band,
        identity: assignment.identity,
        playerVersionIds,
        anchors: [],
        selections,
        allocationSeedPaths: selections.map((_version, slot) => [
          'ai',
          'selection',
          assignment.franchiseId,
          String(slot),
        ]),
        repairCount: 0,
      };
    });
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

// The generated schedule is a pure function of (league, seed), and every
// run clone shares the same league object and generation seed, so a
// per-league cache is exact. Blocks cost ~10s; the schedule is ~250ms.
const scheduleByLeague = new WeakMap<
  SeasonRun['league'],
  ReturnType<typeof generateSeasonSchedule>
>();

export function scheduleOf(run: SeasonRun): ReturnType<typeof generateSeasonSchedule> {
  const cached = scheduleByLeague.get(run.league);
  if (cached !== undefined) return cached;
  const schedule = generateSeasonSchedule({
    league: run.league,
    seed: run.schedule.generationSeed,
  });
  scheduleByLeague.set(run.league, schedule);
  return schedule;
}

export function blockCommand(
  run: SeasonRun,
  blockIndex: number,
  expectedRevision: number,
): SeasonSubmitBlockCommand {
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    blockVersion: 'season-block-v2',
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
  effects: SeasonEffectsState = zeroEffectsOf(run),
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
    effects,
  };
}

/**
 * The M2.4 zero effects state for a test run: one fresh load state per
 * rostered version (300) and the 45 canonical a<b zero-shared-possession
 * pairs per ten-player roster (1,350). Schema-validated so the candidate
 * checkpoint the pipeline assembles is schema-valid too.
 */
function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
  const playerStates = run.rosters
    .flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints: 0,
        recentLoadBasisPoints: 0,
        lastCompletedRound: 0,
      })),
    )
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  const pairStates: SeasonPairChemistryState[] = [];
  for (const roster of run.rosters) {
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
    schemaVersion: 1,
    playerStates,
    pairStates,
  });
}

export interface RunnerState {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  summaries: SeasonGameSummary[];
  effects: SeasonEffectsState;
}

/** Runs one block through the pipeline and advances the runner state. */
export function runBlock(
  state: RunnerState,
  blockIndex: number,
): import('@hoop-rush/data-contracts').SeasonCandidateCheckpoint {
  const input = pipelineInput(state.run, state.catalog, blockIndex, state.summaries, state.effects);
  const checkpoint = simulateSeasonBlock(input);
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.effects = checkpoint.effects;
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
  return { run, catalog, summaries: [] as SeasonGameSummary[], effects: zeroEffectsOf(run) };
}
