import {
  SEASON_AGGREGATES_VERSION,
  SEASON_AI_VERSION,
  SEASON_ALIGNMENT,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  buildInitialPostseasonState,
  seasonEffectsStateSchema,
  seasonRunSchema,
  type SeasonCheckpointVersions,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonHealthState,
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
  deriveSeasonPostBlockState,
  rosterPlayerIdsOf,
  simulateSeasonBlock,
  type SeasonBlockSimulationInput,
} from './block.ts';
import { seasonRotationSetDigest } from './rotation.ts';
import { createInitialSeasonInfluenceState } from './influence.ts';

/**
 * Deterministic full-league test support for the M2.3 block pipeline: a
 * synthetic 30-franchise draft catalog, AI-generated rosters and rotations,
 * the committed-format schedule, and a schema-valid run snapshot. The league
 * build runs AI generation, so the result is cached per test file; run
 * states are cheap clones.
 */

export const TEST_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

/**
 * The 30 franchise ids in the engine fixtures' frozen order (east
 * conference first, then west, each in canonical SEASON_ALIGNMENT order).
 * Derived from the canonical alignment in `@hoop-rush/data-contracts` so
 * the fixture ids cannot drift from the league fact; the explicit
 * east-then-west ordering is frozen because generation outputs (catalog,
 * rosters, schedule) are order-sensitive.
 */
export const ALL_FRANCHISES: readonly string[] = [
  ...SEASON_ALIGNMENT.filter((entry) => entry.conference === 'east').map(
    (entry) => entry.franchiseId,
  ),
  ...SEASON_ALIGNMENT.filter((entry) => entry.conference === 'west').map(
    (entry) => entry.franchiseId,
  ),
];

export const VERSIONS: SeasonCheckpointVersions = {
  blockVersion: SEASON_BLOCK_VERSION,
  summaryVersion: SEASON_GAME_SUMMARY_VERSION,
  aggregatesVersion: SEASON_AGGREGATES_VERSION,
  recapVersion: SEASON_RECAP_VERSION,
  leadersVersion: 'season-leaders-v1',
  homeCourtVersion: 'season-home-court-v1',
  gameVersion: SEASON_GAME_VERSION,
  gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
  seedDerivationVersion: 'season-seeds-v1',
  staminaVersion: SEASON_STAMINA_VERSION,
  chemistryVersion: SEASON_CHEMISTRY_VERSION,
  effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
  healthVersion: SEASON_HEALTH_VERSION,
  tradeVersion: SEASON_TRADE_VERSION,
  influenceVersion: SEASON_INFLUENCE_VERSION,
  objectiveVersion: SEASON_OBJECTIVE_VERSION,
  injuryTargetsVersion: SEASON_INJURY_TARGETS_VERSION,
  tradeTargetsVersion: SEASON_TRADE_TARGETS_VERSION,
  influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
  freeAgencyVersion: 'season-free-agency-v1',
  freeAgencyIndexVersion: 'free-agency-index-v1',
  freeAgencyTargetsVersion: 'free-agency-targets-v1',
};

export interface TestRun {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  generation: SeasonLeagueGenerationResult;
}

let cachedRun: TestRun | null = null;

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
      minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
      rotationPlannerVersion: SEASON_ROTATION_PLANNER_VERSION,
      gameVersion: VERSIONS.gameVersion,
      gameTargetsVersion: VERSIONS.gameTargetsVersion,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      checkpointVersion: SEASON_CHECKPOINT_VERSION,
      blockVersion: VERSIONS.blockVersion,
      summaryVersion: VERSIONS.summaryVersion,
      aggregatesVersion: VERSIONS.aggregatesVersion,
      recapVersion: VERSIONS.recapVersion,
      leadersVersion: VERSIONS.leadersVersion,
      homeCourtVersion: VERSIONS.homeCourtVersion,
      staminaVersion: VERSIONS.staminaVersion,
      chemistryVersion: VERSIONS.chemistryVersion,
      effectsTargetsVersion: VERSIONS.effectsTargetsVersion,
      healthVersion: VERSIONS.healthVersion,
      tradeVersion: VERSIONS.tradeVersion,
      influenceVersion: VERSIONS.influenceVersion,
      objectiveVersion: VERSIONS.objectiveVersion,
      injuryTargetsVersion: VERSIONS.injuryTargetsVersion,
      tradeTargetsVersion: VERSIONS.tradeTargetsVersion,
      influenceTargetsVersion: VERSIONS.influenceTargetsVersion,
      tiebreakVersion: 'tiebreaker-v1',
      postseasonSummaryVersion: 'postseason-summary-v1',
      awardsVersion: 'awards-v1',
      tradeGradeVersion: 'trade-grade-v1',
      commandLogVersion: 'command-log-v1',
      almanacVersion: 'almanac-v1',
      replayExportVersion: 'replay-export-v1',
      postseasonTargetsVersion: 'postseason-targets-v1',
      freeAgencyVersion: VERSIONS.freeAgencyVersion,
      freeAgencyIndexVersion: VERSIONS.freeAgencyIndexVersion,
      freeAgencyTargetsVersion: VERSIONS.freeAgencyTargetsVersion,
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
    stage: 'regular-season',
    postseason: emptyPostseason(TEST_SEED),
    awards: null,
    completion: null,
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments: generation.aiAssignments,
    aiPools: fixtureAiPools(generation.aiAssignments),
    rotations: generation.rotations,
    generationAudit: buildFixtureGenerationAudit(TEST_SEED),
    evaluations: generation.evaluations,
    // M2.5: run-scoped state chain and economy facts (schema 7).
    trade: null,
    freeAgency: {
      schemaVersion: 1,
      freeAgencyVersion: 'season-free-agency-v1',
      windows: [],
      canonicalCandidates: {},
      signingCounts: Object.fromEntries(league.teams.map((team) => [team.franchiseId, 0])),
      seasonSpend: Object.fromEntries(league.teams.map((team) => [team.franchiseId, 0])),
    },
    objectives: {
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    },
    health: emptyHealthState(),
    transactions: [],
    influence: createInitialSeasonInfluenceState(league.teams.map((team) => team.franchiseId)),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
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

/** The league-wide empty health state (M2.5; block 0 / fresh runs). */
export function emptyHealthState(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  };
}

function emptyPostseason(rootSeed: string): SeasonRun['postseason'] {
  return buildInitialPostseasonState(rootSeed);
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
    blockVersion: SEASON_BLOCK_VERSION,
    command: 'submit-season-block',
    commandId: `block-${String(blockIndex)}-${String(expectedRevision)}`,
    runId: run.runId,
    expectedRevision,
    blockIndex,
    rotationDigest: seasonRotationSetDigest(run.rotations),
    // M2.5: fixture-driven commands carry no locked objective and assert the
    // run's state chain facts (the pipeline's objective seam is absent, so
    // the invalid-objective validation is skipped for these inputs).
    objectiveId: null,
    expectedStateRevision: run.stateRevision,
    expectedStateDigest: run.stateDigest,
  };
}

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
    // M2.5: the pre-block health state and the locked objective (null for
    // fixture-driven runs); the pre-block influence and transaction log
    // ride the run.
    health: run.health,
    objectiveId: null,
    influence: run.influence,
    transactions: run.transactions,
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
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  });
}

export interface RunnerState {
  run: SeasonRun;
  catalog: SeasonDraftCatalog;
  summaries: SeasonGameSummary[];
  effects: SeasonEffectsState;
}

export function runBlock(
  state: RunnerState,
  blockIndex: number,
): import('@hoop-rush/data-contracts').SeasonCandidateCheckpoint {
  const command = blockCommand(state.run, blockIndex, blockIndex);
  const input = pipelineInput(state.run, state.catalog, blockIndex, state.summaries, state.effects);
  const checkpoint = simulateSeasonBlock(input);
  state.summaries = [...state.summaries, ...checkpoint.gameSummaries];
  state.effects = checkpoint.effects;
  // M2.5: fold the candidate facts into the run snapshot exactly like the
  // CLI's runBlockThroughHandler: health/influence/transactions ride the
  // checkpoint, and the run state chain derives through the engine seam.
  const stateFacts = deriveSeasonPostBlockState({
    run: state.run,
    candidate: checkpoint,
    commandId: command.commandId,
    rotationDigest: command.rotationDigest,
  });
  state.run = {
    ...state.run,
    cursor: { schemaVersion: 1, completedRounds: checkpoint.completedRounds },
    standings: checkpoint.standings,
    health: checkpoint.health,
    influence: checkpoint.influence,
    transactions: checkpoint.transactions,
    checkpointState: stateFacts.checkpointState,
    stateRevision: stateFacts.stateRevision,
    stateDigest: stateFacts.stateDigest,
  };
  return checkpoint;
}

export function freshState(): RunnerState {
  const { run, catalog } = buildTestRun();
  return { run, catalog, summaries: [] as SeasonGameSummary[], effects: zeroEffectsOf(run) };
}
