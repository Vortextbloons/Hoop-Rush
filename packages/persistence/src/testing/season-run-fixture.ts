import {
  playerVersionId,
  commandIdSchema,
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  seasonGameIdSchema,
  seasonKeySchema,
  seedSchema,
  SEASON_ALIGNMENT,
  SEASON_AI_VERSION,
  SEASON_AUTHORITY_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_ALMANAC_VERSION,
  SEASON_AWARDS_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_DRAFT_SAVE_SCHEMA_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_GAME_COUNT,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_SUMMARY_VERSION,
  SEASON_POSTSEASON_TARGETS_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_REPLAY_EXPORT_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_TIEBREAK_VERSION,
  SEASON_TRADE_GRADE_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_CAMPAIGN_TARGETS_VERSION,
  PLAYER_VERSION_ID_VERSION,
  buildEmptyHealth,
  buildInitialPostseasonState,
  seasonEffectsStateSchema,
  seasonFreeAgencyStateSchema,
  seasonGameSimulationResultSchema,
  seasonHealthStateSchema,
  seasonObjectiveStateSchema,
  seasonRunSchema,
  type SeasonAiAssignment,
  type SeasonBlockRecap,
  type SeasonCheckpointState,
  type SeasonCompactPlayerLine,
  type SeasonEffectsState,
  type SeasonGame,
  type SeasonGameSimulationResult,
  type SeasonGameSummary,
  type SeasonDraftState,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonInvalidRosterInterruption,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonObjectiveState,
  type SeasonPairChemistryState,
  type SeasonPendingBlockCandidate,
  type SeasonPlayerAggregate,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonTeamAggregate,
  type SeasonTeamBox,
  fnv1a32,
  buildEmptyCampaignState,
  seasonDigestHex,
  seedFromString,
} from '@hoop-rush/data-contracts';
import {
  WINDOW_BLOCK_INDEX_TO_INDEX,
  reduceSeasonStandings,
  seasonRunStateDigest as engineSeasonRunStateDigest,
} from '@hoop-rush/engine';
import type {
  createInitialSeasonInfluenceState as engineCreateInitialSeasonInfluenceState,
  foldSeasonPlayerAggregates as engineFoldSeasonPlayerAggregates,
  foldSeasonTeamAggregates as engineFoldSeasonTeamAggregates,
  reconstructSeasonGames as engineReconstructSeasonGames,
  seasonRotationSetDigest as engineSeasonRotationSetDigest,
  seasonRunStateDigest as engineSeasonRunStateDigestFn,
} from '@hoop-rush/engine';
import type { SeasonRunStateDigestFacts } from '../season/engine-seam-types.ts';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { SEASON_RUN_RECORD_ID, type StoredSeasonRunRecord } from '../schemas/season-run-record.ts';
import { SEASON_DRAFT_RECORD_ID, type StoredSeasonDraft } from '../schemas/season-draft-record.ts';
const ALIGNMENT = SEASON_ALIGNMENT;
const FRANCHISE_ORDER = SEASON_ALIGNMENT.map((entry) => franchiseIdSchema.parse(entry.franchiseId));
export function fixtureSeedFromString(value: string): ReturnType<typeof seedSchema.parse> {
  return seedSchema.parse(seedFromString(value));
}
export function buildFixtureLeague(humanFranchiseId = 'lakers'): SeasonLeague {
  return {
    schemaVersion: 1,
    leagueVersion: SEASON_LEAGUE_VERSION,
    teams: ALIGNMENT.map((entry) => ({
      franchiseId: franchiseIdSchema.parse(entry.franchiseId),
      control: entry.franchiseId === humanFranchiseId ? ('human' as const) : ('ai' as const),
      conference: entry.conference,
      division: entry.division,
    })),
  };
}
export function buildFixtureHealthState(): SeasonHealthState {
  return seasonHealthStateSchema.parse(buildEmptyHealth());
}
export function buildFixtureFreeAgencyState(): SeasonRun['freeAgency'] {
  return seasonFreeAgencyStateSchema.parse({
    schemaVersion: 1,
    freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
    windows: [],
    canonicalCandidates: {},
    signingCounts: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
    seasonSpend: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
  });
}
export function buildFixtureInfluenceState(league: SeasonLeague): SeasonInfluenceState {
  const balances: Record<string, number> = {};
  const ledger: SeasonInfluenceState['ledger'] = [];
  const windows: SeasonInfluenceState['windows'] = {};
  for (const team of league.teams) {
    balances[team.franchiseId] = 2;
    ledger.push({
      entryId: idSchema.parse(`influence-initial-${team.franchiseId}`),
      franchiseId: team.franchiseId,
      source: 'initial-grant',
      blockIndex: null,
      commandId: null,
      requestedDelta: 2,
      appliedDelta: 2,
      balanceAfter: 2,
      explanation: 'Initial +2 Influence grant at run creation',
    });
    windows[team.franchiseId] = [];
  }
  return {
    schemaVersion: 1,
    influenceVersion: SEASON_INFLUENCE_VERSION,
    balances,
    ledger,
    windows,
    rehabs: {},
  };
}
export function buildFixtureObjectiveState(): SeasonObjectiveState {
  return seasonObjectiveStateSchema.parse({
    schemaVersion: 1,
    objectiveVersion: SEASON_OBJECTIVE_VERSION,
    catalog: [...SEASON_OBJECTIVE_CATALOG],
    selections: {},
  });
}
export function buildFixtureSchedule(seed: string): SeasonSchedule {
  const parsedSeed = seedSchema.parse(seed);
  const offset = fnv1a32(`schedule-${parsedSeed}`) % 30;
  const games = [];
  for (let round = 1; round <= 82; round += 1) {
    for (let g = 0; g < 15; g += 1) {
      const homeIndex = (round * 15 + g + offset) % 30;
      const awayIndex = (homeIndex + 15) % 30;
      const home = FRANCHISE_ORDER[homeIndex];
      const away = FRANCHISE_ORDER[awayIndex];
      if (home === undefined || away === undefined) {
        throw new Error('fixture schedule index out of range');
      }
      const gameNumber = (round - 1) * 15 + g + 1;
      const homeTeam = round % 2 === 1 ? home : away;
      const awayTeam = round % 2 === 1 ? away : home;
      games.push({
        gameId: seasonGameIdSchema.parse(`s${String(gameNumber).padStart(6, '0')}`),
        round,
        homeFranchiseId: homeTeam,
        awayFranchiseId: awayTeam,
      });
    }
  }
  if (games.length !== SEASON_GAME_COUNT) {
    throw new Error(`fixture schedule produced ${String(games.length)} games`);
  }
  return {
    schemaVersion: 1,
    scheduleVersion: SEASON_SCHEDULE_VERSION,
    formulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
    leagueVersion: SEASON_LEAGUE_VERSION,
    generationSeed: parsedSeed,
    rounds: 82,
    games,
  };
}
export function buildFixtureRosters(league: SeasonLeague): SeasonRoster[] {
  return league.teams.map((team) => ({
    franchiseId: team.franchiseId,
    players: Array.from({ length: SEASON_ROSTER_SIZE }, (_, slot) => {
      const rawPlayerId = `p-synth-${String(slot + 1)}-${team.franchiseId}`;
      const parsedPlayerId = playerIdSchema.parse(rawPlayerId);
      const parsedEraId = eraIdSchema.parse('1990s');
      const parsedSeasonKey = seasonKeySchema.parse('1995-96');
      return {
        playerVersionId: playerVersionId(rawPlayerId, team.franchiseId, '1990s', '1995-96'),
        playerId: parsedPlayerId,
        franchiseId: team.franchiseId,
        eraId: parsedEraId,
        seasonKey: parsedSeasonKey,
        displayName: `Fixture ${team.franchiseId} ${String(slot + 1)}`,
      };
    }),
  }));
}
export function buildFixtureEffectsState(
  rosters: readonly SeasonRoster[],
  options: {
    fatigueBasisPoints?: number;
    recentLoadBasisPoints?: number;
    lastCompletedRound?: number;
    sharedPossessions?: number;
  } = {},
): SeasonEffectsState {
  const fatigueBasisPoints = options.fatigueBasisPoints ?? 0;
  const recentLoadBasisPoints = options.recentLoadBasisPoints ?? 0;
  const lastCompletedRound = options.lastCompletedRound ?? 0;
  const sharedPossessions = options.sharedPossessions ?? 0;
  const playerStates = rosters
    .flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        fatigueBasisPoints,
        recentLoadBasisPoints,
        lastCompletedRound,
      })),
    )
    .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  const pairStates: SeasonPairChemistryState[] = [];
  for (const roster of rosters) {
    const ids = roster.players.map((player) => player.playerVersionId).sort();
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = ids[j];
        if (b === undefined) continue;
        pairStates.push({ a, b, sharedPossessions });
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
export function fixtureRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[] {
  return [
    ...new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId))),
  ].sort();
}
export function fixtureRotationPlayerVersionIds(rotations: readonly SeasonRotation[]): string[] {
  return [
    ...new Set(rotations.flatMap((rotation) => [...rotation.starters, ...rotation.benchOrder])),
  ].sort();
}
export function fixtureSeasonPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
function fixtureRotation(roster: SeasonRoster): SeasonRotation {
  const ids = roster.players.map((player) => player.playerVersionId);
  const starters = [ids[0], ids[1], ids[2], ids[3], ids[4]].filter(
    (id): id is string => id !== undefined,
  );
  const bench = [ids[5], ids[6], ids[7], ids[8], ids[9]].filter(
    (id): id is string => id !== undefined,
  );
  return {
    franchiseId: roster.franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      { playerVersionId: ids[0] as string, minutes: 32 },
      { playerVersionId: ids[1] as string, minutes: 32 },
      { playerVersionId: ids[2] as string, minutes: 32 },
      { playerVersionId: ids[3] as string, minutes: 32 },
      { playerVersionId: ids[4] as string, minutes: 32 },
      { playerVersionId: ids[5] as string, minutes: 16 },
      { playerVersionId: ids[6] as string, minutes: 16 },
      { playerVersionId: ids[7] as string, minutes: 16 },
      { playerVersionId: ids[8] as string, minutes: 16 },
      { playerVersionId: ids[9] as string, minutes: 16 },
    ],
    closingFive: starters,
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}
function fixtureAiAssignments(league: SeasonLeague): SeasonAiAssignment[] {
  const bands = ['contender', 'playoff', 'average', 'weaker'] as const;
  const identities = [
    'star-chaser',
    'depth-builder',
    'defense-first',
    'shooting-first',
    'continuity',
    'active-trader',
  ] as const;
  return league.teams.map((team, index) => ({
    franchiseId: team.franchiseId,
    band: bands[index % bands.length] as SeasonAiAssignment['band'],
    identity: identities[index % identities.length] as SeasonAiAssignment['identity'],
  }));
}
function fixtureAiPools(league: SeasonLeague): SeasonRun['aiPools'] {
  return league.teams
    .filter((team) => team.control === 'ai')
    .map((team, poolIndex) => {
      const playerVersionIds = Array.from({ length: 20 }, (_, slot) => {
        const hex = `${String(poolIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
          32,
          '0',
        );
        return `pv-${hex}`;
      });
      const selections = playerVersionIds.slice(0, 10);
      return {
        franchiseId: team.franchiseId,
        band: ['contender', 'playoff', 'average', 'weaker'][
          poolIndex % 4
        ] as SeasonAiAssignment['band'],
        identity: [
          'star-chaser',
          'depth-builder',
          'defense-first',
          'shooting-first',
          'continuity',
          'active-trader',
        ][poolIndex % 6] as SeasonAiAssignment['identity'],
        playerVersionIds,
        anchors: [],
        selections,
        allocationSeedPaths: selections.map((_version, slot) => [
          'ai',
          'selection',
          team.franchiseId,
          String(slot),
        ]),
        repairCount: 0,
      };
    });
}
function emptyPostseason(seed: string): SeasonRun['postseason'] {
  return buildInitialPostseasonState(seedSchema.parse(seed));
}
function scheduledGames(schedule: SeasonSchedule): SeasonGame[] {
  return schedule.games.map((game) => ({
    gameId: game.gameId,
    round: game.round,
    homeFranchiseId: game.homeFranchiseId,
    awayFranchiseId: game.awayFranchiseId,
    status: 'scheduled' as const,
    homeScore: null,
    awayScore: null,
    forfeitLoserFranchiseId: null,
  }));
}
export function buildFixtureRun(input: {
  seed?: string;
  humanFranchiseId?: string;
  schedule?: SeasonSchedule;
  runId?: string;
}): SeasonRun {
  const rawSeed = input.seed ?? fixtureSeedFromString('fixture-season-run');
  const parsedSeed = seedSchema.parse(rawSeed);
  const rawRunId = input.runId ?? 'fixture-season-run-1';
  const parsedRunId = idSchema.parse(rawRunId);
  const league = buildFixtureLeague(input.humanFranchiseId);
  const schedule = input.schedule ?? buildFixtureSchedule(parsedSeed);
  const rosters = buildFixtureRosters(league);
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: parsedRunId,
    rootSeed: parsedSeed,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: SEASON_LEAGUE_VERSION,
      scheduleVersion: schedule.scheduleVersion,
      scheduleFormulaVersion: schedule.formulaVersion,
      standingsVersion: SEASON_STANDINGS_VERSION,
      postseasonVersion: SEASON_POSTSEASON_VERSION,
      seedDerivationVersion: SEASON_SEED_DERIVATION_VERSION,
      playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
      draftVersion: SEASON_DRAFT_VERSION,
      rosterRulesVersion: SEASON_ROSTER_RULES_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      aiVersion: SEASON_AI_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
      rotationPlannerVersion: SEASON_ROTATION_PLANNER_VERSION,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      blockVersion: SEASON_BLOCK_VERSION,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      aggregatesVersion: SEASON_AGGREGATES_VERSION,
      recapVersion: SEASON_RECAP_VERSION,
      leadersVersion: SEASON_LEADERS_VERSION,
      homeCourtVersion: SEASON_HOME_COURT_VERSION,
      checkpointVersion: SEASON_CHECKPOINT_VERSION,
      staminaVersion: SEASON_STAMINA_VERSION,
      chemistryVersion: SEASON_CHEMISTRY_VERSION,
      effectsTargetsVersion: SEASON_EFFECT_TARGETS_VERSION,
      healthVersion: SEASON_HEALTH_VERSION,
      tradeVersion: SEASON_TRADE_VERSION,
      influenceVersion: SEASON_INFLUENCE_VERSION,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      campaignVersion: SEASON_CAMPAIGN_VERSION,
      campaignTargetsVersion: SEASON_CAMPAIGN_TARGETS_VERSION,
      injuryTargetsVersion: SEASON_INJURY_TARGETS_VERSION,
      tradeTargetsVersion: SEASON_TRADE_TARGETS_VERSION,
      influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
      tiebreakVersion: SEASON_TIEBREAK_VERSION,
      postseasonSummaryVersion: SEASON_POSTSEASON_SUMMARY_VERSION,
      awardsVersion: SEASON_AWARDS_VERSION,
      tradeGradeVersion: SEASON_TRADE_GRADE_VERSION,
      commandLogVersion: SEASON_COMMAND_LOG_VERSION,
      almanacVersion: SEASON_ALMANAC_VERSION,
      replayExportVersion: SEASON_REPLAY_EXPORT_VERSION,
      postseasonTargetsVersion: SEASON_POSTSEASON_TARGETS_VERSION,
      freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
      freeAgencyIndexVersion: SEASON_FREE_AGENCY_INDEX_VERSION,
      freeAgencyTargetsVersion: SEASON_FREE_AGENCY_TARGETS_VERSION,
    },
    league,
    authority: {
      kind: 'local-solo',
      soloFranchiseId: league.teams.find((t) => t.control === 'human')?.franchiseId ?? null,
      authorityVersion: SEASON_AUTHORITY_VERSION,
    },
    rosters,
    ownership: rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
      })),
    ),
    schedule: {
      leagueVersion: schedule.leagueVersion,
      scheduleVersion: schedule.scheduleVersion,
      formulaVersion: schedule.formulaVersion,
      generationSeed: schedule.generationSeed,
      contentHash: contentHashSchema.parse('0'.repeat(64)),
    },
    games: scheduledGames(schedule),
    standings: zeroStandings(league),
    cursor: { schemaVersion: 1, completedRounds: 0 },
    stage: 'regular-season',
    postseason: emptyPostseason(fixtureSeedFromString(`${parsedSeed}:postseason`)),
    awards: null,
    completion: null,
    draft: buildFixtureSeasonDraftFacts(parsedSeed),
    aiAssignments: fixtureAiAssignments(league),
    aiPools: fixtureAiPools(league),
    rotations: rosters.map(fixtureRotation),
    generationAudit: {
      seed: parsedSeed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      minutePolicyVersion: SEASON_MINUTE_POLICY_VERSION,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      digest: fnv1a32(`generation-${parsedSeed}`).toString(16).padStart(8, '0').repeat(4),
      diagnostics: {
        seed: parsedSeed,
        aiVersion: SEASON_AI_VERSION,
        rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
        teamsGenerated: 30,
        teamsRepaired: 0,
        backtracks: 0,
        nodesVisited: 30,
        nodeBudget: 100000,
        failedTeams: [],
        unmetConstraints: [],
      },
    },
    evaluations: league.teams.map((team, index) => ({
      franchiseId: team.franchiseId,
      band: ['contender', 'playoff', 'average', 'weaker'][index % 4] as SeasonAiAssignment['band'],
      identity: [
        'star-chaser',
        'depth-builder',
        'defense-first',
        'shooting-first',
        'continuity',
        'active-trader',
      ][index % 6] as SeasonAiAssignment['identity'],
      strengthScore: 50 + (index % 40),
      roleScores: {
        'primary-creation': 50,
        'secondary-creation': 50,
        'perimeter-shooting': 50,
        'rim-finishing-interior-scoring': 50,
        'perimeter-defense': 50,
        'interior-defense': 50,
        'offensive-rebounding': 50,
        'defensive-rebounding': 50,
      },
      rolesCovered: [
        'primary-creation',
        'secondary-creation',
        'perimeter-shooting',
        'rim-finishing-interior-scoring',
        'perimeter-defense',
        'interior-defense',
        'offensive-rebounding',
        'defensive-rebounding',
      ],
      overallReport: null,
    })),
    trade: null,
    freeAgency: buildFixtureFreeAgencyState(),
    objectives: buildFixtureObjectiveState(),
    campaign: buildEmptyCampaignState(),
    health: buildFixtureHealthState(),
    transactions: [],
    influence: buildFixtureInfluenceState(league),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
  };
  return seasonRunSchema.parse({
    ...run,
    stateDigest: seasonRunStateDigestFixture({
      stateRevision: 0,
      stage: 'regular-season',
      postseason: run.postseason,
      awards: null,
      completion: null,
      checkpointState: null,
      health: run.health,
      influence: run.influence,
      transactions: run.transactions,
      trade: run.trade,
      objectives: run.objectives,
      campaign: run.campaign,
      rosters: run.rosters,
      ownership: run.ownership,
      rotations: run.rotations,
      effects: buildFixtureEffectsState(run.rosters),
      freeAgency: run.freeAgency,
      authority: run.authority,
    }),
  });
}
export function seasonRunStateDigestFixture(facts: SeasonRunStateDigestFacts): string {
  return engineSeasonRunStateDigest(facts);
}
function zeroStandings(league: SeasonLeague): SeasonStandings {
  return {
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
  };
}
function fixturePlayerLine(
  playerVersionIdValue: string,
  seedKey: string,
  slot: number,
): SeasonCompactPlayerLine {
  const h = fnv1a32(`${seedKey}:${playerVersionIdValue}:${String(slot)}`);
  const seconds = 1440 + (h % 600);
  const fieldGoalsMade = h % 9;
  const fieldGoalsAttempted = fieldGoalsMade + (h % 6) + 2;
  const threePointersMade = h % 4;
  const threePointersAttempted = threePointersMade + (h % 4) + 1;
  const freeThrowsMade = h % 6;
  const freeThrowsAttempted = freeThrowsMade + (h % 3);
  return {
    playerVersionId: playerVersionIdValue,
    seconds,
    started: slot < 5,
    points: fieldGoalsMade * 2 + threePointersMade + freeThrowsMade,
    fieldGoalsMade,
    fieldGoalsAttempted,
    threePointersMade,
    threePointersAttempted,
    freeThrowsMade,
    freeThrowsAttempted,
    offensiveRebounds: h % 4,
    defensiveRebounds: 2 + (h % 6),
    assists: h % 8,
    steals: h % 3,
    blocks: h % 3,
    turnovers: h % 5,
    fouls: 1 + (h % 4),
  };
}
function boxOfLines(
  franchiseId: string,
  lines: readonly SeasonCompactPlayerLine[],
  possessions: number,
): SeasonTeamBox {
  const sum = (pick: (line: SeasonCompactPlayerLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
    points: sum((line) => line.points),
    fieldGoalsMade: sum((line) => line.fieldGoalsMade),
    fieldGoalsAttempted: sum((line) => line.fieldGoalsAttempted),
    threePointersMade: sum((line) => line.threePointersMade),
    threePointersAttempted: sum((line) => line.threePointersAttempted),
    freeThrowsMade: sum((line) => line.freeThrowsMade),
    freeThrowsAttempted: sum((line) => line.freeThrowsAttempted),
    offensiveRebounds: sum((line) => line.offensiveRebounds),
    defensiveRebounds: sum((line) => line.defensiveRebounds),
    assists: sum((line) => line.assists),
    steals: sum((line) => line.steals),
    blocks: sum((line) => line.blocks),
    turnovers: sum((line) => line.turnovers),
    fouls: sum((line) => line.fouls),
    possessions,
  };
}
export function buildFixtureSummaries(input: {
  runId: string;
  schedule: SeasonSchedule;
  rosters: readonly SeasonRoster[];
  fromRound: number;
  toRound: number;
}): SeasonGameSummary[] {
  const rostersByFranchise = new Map(input.rosters.map((roster) => [roster.franchiseId, roster]));
  const linesByFranchise = new Map(
    [...rostersByFranchise].map(([franchiseId, roster]) => [
      franchiseId,
      roster.players.map((player) => player.playerVersionId),
    ]),
  );
  const summaries: SeasonGameSummary[] = [];
  for (const game of input.schedule.games) {
    if (game.round < input.fromRound || game.round > input.toRound) continue;
    const homeIds = linesByFranchise.get(game.homeFranchiseId);
    const awayIds = linesByFranchise.get(game.awayFranchiseId);
    if (homeIds === undefined || awayIds === undefined) {
      throw new Error(`no fixture roster for ${game.homeFranchiseId}/${game.awayFranchiseId}`);
    }
    const seedKey = `${input.runId}:${game.gameId}`;
    const homeLines = homeIds.map((id, slot) => fixturePlayerLine(id, seedKey, slot * 2));
    const awayLines = awayIds.map((id, slot) => fixturePlayerLine(id, seedKey, slot * 2 + 1));
    const homeBox = boxOfLines(game.homeFranchiseId, homeLines, 96);
    const awayBox = boxOfLines(game.awayFranchiseId, awayLines, 95);
    const homeScore = homeBox.points + 3;
    const awayScore = awayBox.points;
    summaries.push({
      schemaVersion: 1,
      summaryVersion: SEASON_GAME_SUMMARY_VERSION,
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
      status: 'final',
      overtimePeriods: 0,
      homeScore,
      awayScore,
      forfeitLoserFranchiseId: null,
      homeBox,
      awayBox,
      homePlayers: homeLines,
      awayPlayers: awayLines,
      injuryEvents: [],
    });
  }
  return summaries;
}
export function buildFixtureFullSeasonSummaries(input: {
  runId: string;
  schedule: SeasonSchedule;
  rosters: readonly SeasonRoster[];
}): SeasonGameSummary[] {
  return buildFixtureSummaries({
    runId: input.runId,
    schedule: input.schedule,
    rosters: input.rosters,
    fromRound: 1,
    toRound: 82,
  });
}
export function reconstructSeasonGamesFixture(
  schedule: SeasonSchedule,
  summaries: readonly SeasonGameSummary[],
): SeasonGame[] {
  const byId = new Map(summaries.map((summary) => [summary.gameId, summary]));
  return schedule.games.map((game) => {
    const summary = byId.get(game.gameId);
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
        gameId: summary.gameId,
        round: summary.round,
        homeFranchiseId: summary.homeFranchiseId,
        awayFranchiseId: summary.awayFranchiseId,
        status: 'forfeit' as const,
        homeScore: null,
        awayScore: null,
        forfeitLoserFranchiseId: summary.forfeitLoserFranchiseId,
      };
    }
    return {
      gameId: summary.gameId,
      round: summary.round,
      homeFranchiseId: summary.homeFranchiseId,
      awayFranchiseId: summary.awayFranchiseId,
      status: 'final' as const,
      homeScore: summary.homeScore,
      awayScore: summary.awayScore,
      forfeitLoserFranchiseId: null,
    };
  });
}
function winnerOf(summary: SeasonGameSummary): string {
  if (summary.status === 'forfeit') {
    const loser = summary.forfeitLoserFranchiseId;
    if (loser === null) {
      throw new Error(`forfeit summary ${summary.gameId} does not name the losing team`);
    }
    return loser === summary.homeFranchiseId ? summary.awayFranchiseId : summary.homeFranchiseId;
  }
  return summary.homeScore > summary.awayScore ? summary.homeFranchiseId : summary.awayFranchiseId;
}
export function foldTeamAggregatesFixture(
  league: SeasonLeague,
  summaries: readonly SeasonGameSummary[],
): SeasonTeamAggregate[] {
  const zeroRow = (franchiseId: string): SeasonTeamAggregate => ({
    franchiseId: franchiseIdSchema.parse(franchiseId),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
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
  });
  const totals = new Map(
    league.teams.map((team) => [team.franchiseId, zeroRow(team.franchiseId)] as const),
  );
  for (const summary of summaries) {
    for (const side of ['home', 'away'] as const) {
      const franchiseId = side === 'home' ? summary.homeFranchiseId : summary.awayFranchiseId;
      const row = totals.get(franchiseId);
      if (row === undefined) continue;
      const box = side === 'home' ? summary.homeBox : summary.awayBox;
      row.gamesPlayed += 1;
      row.points += box.points;
      row.fieldGoalsMade += box.fieldGoalsMade;
      row.fieldGoalsAttempted += box.fieldGoalsAttempted;
      row.threePointersMade += box.threePointersMade;
      row.threePointersAttempted += box.threePointersAttempted;
      row.freeThrowsMade += box.freeThrowsMade;
      row.freeThrowsAttempted += box.freeThrowsAttempted;
      row.offensiveRebounds += box.offensiveRebounds;
      row.defensiveRebounds += box.defensiveRebounds;
      row.assists += box.assists;
      row.steals += box.steals;
      row.blocks += box.blocks;
      row.turnovers += box.turnovers;
      row.fouls += box.fouls;
      row.possessions += box.possessions;
      if (winnerOf(summary) === franchiseId) row.wins += 1;
      else row.losses += 1;
    }
  }
  return [...totals.values()].sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1));
}
export function foldPlayerAggregatesFixture(
  rosters: readonly SeasonRoster[],
  summaries: readonly SeasonGameSummary[],
): SeasonPlayerAggregate[] {
  const ownerOf = new Map(
    rosters.flatMap((roster) =>
      roster.players.map((player) => [player.playerVersionId, roster.franchiseId] as const),
    ),
  );
  const zeroRow = (playerVersionIdValue: string): SeasonPlayerAggregate => {
    const ownerRaw = ownerOf.get(playerVersionIdValue);
    const parsedOwner = ownerRaw === undefined ? franchiseIdSchema.parse('lakers') : ownerRaw;
    return {
      playerVersionId: playerVersionIdValue,
      franchiseId: parsedOwner,
      gamesPlayed: 0,
      appearances: 0,
      started: 0,
      seconds: 0,
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
    };
  };
  const totals = new Map(
    rosters.flatMap((roster) =>
      roster.players.map(
        (player) => [player.playerVersionId, zeroRow(player.playerVersionId)] as const,
      ),
    ),
  );
  for (const summary of summaries) {
    if (summary.status === 'forfeit') continue;
    for (const side of ['home', 'away'] as const) {
      const lines = side === 'home' ? summary.homePlayers : summary.awayPlayers;
      for (const line of lines) {
        const row = totals.get(line.playerVersionId);
        if (row === undefined) continue;
        row.gamesPlayed += 1;
        row.appearances += line.seconds > 0 ? 1 : 0;
        row.started += line.started === true ? 1 : 0;
        row.seconds += line.seconds;
        row.points += line.points;
        row.fieldGoalsMade += line.fieldGoalsMade;
        row.fieldGoalsAttempted += line.fieldGoalsAttempted;
        row.threePointersMade += line.threePointersMade;
        row.threePointersAttempted += line.threePointersAttempted;
        row.freeThrowsMade += line.freeThrowsMade;
        row.freeThrowsAttempted += line.freeThrowsAttempted;
        row.offensiveRebounds += line.offensiveRebounds;
        row.defensiveRebounds += line.defensiveRebounds;
        row.assists += line.assists;
        row.steals += line.steals;
        row.blocks += line.blocks;
        row.turnovers += line.turnovers;
        row.fouls += line.fouls;
      }
    }
  }
  return [...totals.values()].sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
}
export function buildFixtureRetainedDetail(input: {
  runId: string;
  summary: SeasonGameSummary;
  rosters: readonly SeasonRoster[];
}): SeasonRetainedGameDetail {
  const byFranchise = new Map(input.rosters.map((roster) => [roster.franchiseId, roster]));
  const side = (summary: SeasonGameSummary, which: 'home' | 'away') => {
    const franchiseId = which === 'home' ? summary.homeFranchiseId : summary.awayFranchiseId;
    const box = which === 'home' ? summary.homeBox : summary.awayBox;
    const lines = which === 'home' ? summary.homePlayers : summary.awayPlayers;
    const roster = byFranchise.get(franchiseId);
    const players = lines.map((line) => {
      const rosterEntry = roster?.players.find(
        (player) => player.playerVersionId === line.playerVersionId,
      );
      const parsedPlayerId = rosterEntry?.playerId ?? playerIdSchema.parse(line.playerVersionId);
      return {
        playerVersionId: line.playerVersionId,
        playerId: parsedPlayerId,
        minutes: line.seconds / 60,
        seconds: line.seconds,
        points: line.points,
        fieldGoals: { made: line.fieldGoalsMade, attempted: line.fieldGoalsAttempted },
        threes: { made: line.threePointersMade, attempted: line.threePointersAttempted },
        freeThrows: { made: line.freeThrowsMade, attempted: line.freeThrowsAttempted },
        rebounds: {
          total: line.offensiveRebounds + line.defensiveRebounds,
          offensive: line.offensiveRebounds,
          defensive: line.defensiveRebounds,
        },
        assists: line.assists,
        steals: line.steals,
        blocks: line.blocks,
        turnovers: line.turnovers,
        fouls: line.fouls,
        diagnostics: {
          usage: 0,
          shotZones: [],
          assistOpportunities: 0,
          offensiveReboundChances: 0,
          defensiveReboundChances: 0,
          contestedShots: 0,
        },
      };
    });
    return {
      teamId: franchiseId,
      displayName: `Fixture ${franchiseId}`,
      franchiseId,
      score: which === 'home' ? summary.homeScore : summary.awayScore,
      periodScores: [25, 25, 25, 25],
      returns: [],
      box: {
        points: box.points,
        fieldGoals: { made: box.fieldGoalsMade, attempted: box.fieldGoalsAttempted },
        threes: { made: box.threePointersMade, attempted: box.threePointersAttempted },
        freeThrows: { made: box.freeThrowsMade, attempted: box.freeThrowsAttempted },
        rebounds: {
          total: box.offensiveRebounds + box.defensiveRebounds,
          offensive: box.offensiveRebounds,
          defensive: box.defensiveRebounds,
          team: 0,
        },
        assists: box.assists,
        steals: box.steals,
        blocks: box.blocks,
        turnovers: box.turnovers,
        fouls: box.fouls,
        possessions: box.possessions,
        diagnostics: {
          assistedFieldGoals: 0,
          unassistedFieldGoals: box.fieldGoalsMade,
          reboundOpportunities: 0,
          contestedShots: 0,
        },
      },
      players,
      shotZones: [],
    };
  };
  const result: SeasonGameSimulationResult = {
    schemaVersion: 1,
    seed: fixtureSeedFromString(`detail-${input.runId}:${input.summary.gameId}`),
    gameNumber: Number(input.summary.gameId.slice(1)),
    dataVersion: 'fixture-data-v1',
    engineVersion: 'fixture-engine-v1',
    profileVersion: 'fixture-profile-v1',
    winner: 'home',
    outcome: 'completed',
    overtimePeriods: 0,
    home: side(input.summary, 'home'),
    away: side(input.summary, 'away'),
    substitutions: [],
    unitStints: [],
    deviations: [],
    foulOuts: [],
    removals: [],
  };
  seasonGameSimulationResultSchema.parse(result);
  return {
    schemaVersion: 1,
    runId: input.runId,
    gameId: input.summary.gameId,
    round: input.summary.round,
    homeFranchiseId: input.summary.homeFranchiseId,
    awayFranchiseId: input.summary.awayFranchiseId,
    result,
    injuryEvents: [],
  };
}
export function buildFixtureRecap(input: {
  runId: string;
  blockIndex: number;
  completedRounds: number;
}): SeasonBlockRecap {
  return {
    schemaVersion: 1,
    recapVersion: SEASON_RECAP_VERSION,
    runId: input.runId,
    blockIndex: input.blockIndex,
    completedRounds: input.completedRounds,
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
  };
}
export function buildFixtureInfluenceStateFromIds(
  franchiseIds: readonly string[],
): SeasonInfluenceState {
  const balances: Record<string, number> = {};
  const ledger: SeasonInfluenceState['ledger'] = [];
  const windows: SeasonInfluenceState['windows'] = {};
  for (const franchiseId of franchiseIds) {
    const fid = franchiseIdSchema.parse(franchiseId);
    balances[fid] = 2;
    ledger.push({
      entryId: idSchema.parse(`influence-initial-${franchiseId}`),
      franchiseId: fid,
      source: 'initial-grant',
      blockIndex: null,
      commandId: null,
      requestedDelta: 2,
      appliedDelta: 2,
      balanceAfter: 2,
      explanation: 'Initial +2 Influence grant at run creation',
    });
    windows[fid] = [];
  }
  return {
    schemaVersion: 1,
    influenceVersion: SEASON_INFLUENCE_VERSION,
    balances,
    ledger,
    windows,
    rehabs: {},
  };
}
export function buildStubSeasonEngineSeam(): SeasonRunEngineSeam {
  return {
    reconstructSeasonGames: reconstructSeasonGamesFixture,
    foldSeasonTeamAggregates: foldTeamAggregatesFixture,
    foldSeasonPlayerAggregates: foldPlayerAggregatesFixture,
    reduceSeasonStandings,
    seasonRotationSetDigest: seasonRotationSetDigestFixture,
    seasonRosterPlayerVersionIds: fixtureRosterPlayerVersionIds,
    seasonRotationPlayerVersionIds: fixtureRotationPlayerVersionIds,
    zeroSeasonEffectsState: (rosters) => buildFixtureEffectsState(rosters),
    seasonPairKey: fixtureSeasonPairKey,
    seasonPairIsCanonical: (a, b) => a < b,
    seasonRunStateDigest: seasonRunStateDigestFixture,
    createInitialSeasonInfluenceState: buildFixtureInfluenceStateFromIds,
    windowBlockIndexToIndex: WINDOW_BLOCK_INDEX_TO_INDEX,
  };
}
export function seasonRotationSetDigestFixture(rotations: readonly SeasonRotation[]): string {
  const canonical = JSON.stringify(
    [...rotations]
      .sort((a, b) => (a.franchiseId < b.franchiseId ? -1 : 1))
      .map((rotation) => ({
        franchiseId: rotation.franchiseId,
        starters: rotation.starters,
        benchOrder: rotation.benchOrder,
        targetMinutes: [...rotation.targetMinutes].sort((a, b) =>
          a.playerVersionId < b.playerVersionId ? -1 : 1,
        ),
        closingFive: rotation.closingFive,
        rotationVersion: rotation.rotationVersion,
      })),
  );
  return seasonDigestHex(canonical);
}
type EngineDigestFactsParity = Parameters<typeof engineSeasonRunStateDigestFn>[0];
type EngineDigestReturnParity = ReturnType<typeof engineSeasonRunStateDigestFn>;
type FixtureDigestFactsParity = Parameters<typeof seasonRunStateDigestFixture>[0];
type FixtureDigestReturnParity = ReturnType<typeof seasonRunStateDigestFixture>;
type EngineReconstructParamsParity = Parameters<typeof engineReconstructSeasonGames>;
type FixtureReconstructParamsParity = Parameters<typeof reconstructSeasonGamesFixture>;
type EngineRotationDigestParamsParity = Parameters<typeof engineSeasonRotationSetDigest>;
type FixtureRotationDigestParamsParity = Parameters<typeof seasonRotationSetDigestFixture>;
type EngineCreateInfluenceParamsParity = Parameters<typeof engineCreateInitialSeasonInfluenceState>;
type FixtureCreateInfluenceParamsParity = Parameters<typeof buildFixtureInfluenceStateFromIds>;
type EngineFoldTeamReturnParity = ReturnType<typeof engineFoldSeasonTeamAggregates>;
type FixtureFoldTeamReturnParity = ReturnType<typeof foldTeamAggregatesFixture>;
type EngineFoldPlayerReturnParity = ReturnType<typeof engineFoldSeasonPlayerAggregates>;
type FixtureFoldPlayerReturnParity = ReturnType<typeof foldPlayerAggregatesFixture>;
const _digestFactsParity: EngineDigestFactsParity extends FixtureDigestFactsParity ? true : never =
  true;
const _digestReturnParity: FixtureDigestReturnParity extends EngineDigestReturnParity
  ? true
  : never = true;
const _reconstructParamsParity: EngineReconstructParamsParity extends FixtureReconstructParamsParity
  ? true
  : never = true;
const _rotationDigestParamsParity: EngineRotationDigestParamsParity extends FixtureRotationDigestParamsParity
  ? true
  : never = true;
const _createInfluenceParamsParity: EngineCreateInfluenceParamsParity extends FixtureCreateInfluenceParamsParity
  ? true
  : never = true;
const _foldTeamReturnParity: FixtureFoldTeamReturnParity extends EngineFoldTeamReturnParity
  ? true
  : never = true;
const _foldPlayerReturnParity: FixtureFoldPlayerReturnParity extends EngineFoldPlayerReturnParity
  ? true
  : never = true;
export function buildFixtureStateDigest(
  run: SeasonRun,
  overrides: Partial<SeasonRunStateDigestFacts> = {},
): string {
  return seasonRunStateDigestFixture({
    stateRevision: overrides.stateRevision ?? run.stateRevision,
    stage: overrides.stage ?? run.stage,
    postseason: overrides.postseason ?? run.postseason,
    awards: overrides.awards ?? run.awards,
    completion: overrides.completion ?? run.completion,
    checkpointState: overrides.checkpointState ?? run.checkpointState,
    health: overrides.health ?? run.health,
    influence: overrides.influence ?? run.influence,
    transactions: overrides.transactions ?? run.transactions,
    trade: overrides.trade ?? run.trade,
    objectives: overrides.objectives ?? run.objectives,
    campaign: overrides.campaign ?? run.campaign ?? buildEmptyCampaignState(),
    rosters: overrides.rosters ?? run.rosters,
    ownership: overrides.ownership ?? run.ownership,
    rotations: overrides.rotations ?? run.rotations,
    effects: overrides.effects ?? buildFixtureEffectsState(run.rosters),
    freeAgency: overrides.freeAgency ?? run.freeAgency,
    authority: overrides.authority ?? run.authority,
  });
}
export function buildFixtureCheckpointState(input: {
  runId: string;
  blockIndex: number;
  completedRounds: number;
  revision: number;
  commandId: string;
  rotationDigest: string;
  checkpointDigest: string;
}): SeasonCheckpointState {
  return {
    runId: input.runId,
    blockIndex: input.blockIndex,
    completedRounds: input.completedRounds,
    revision: input.revision,
    commandId: input.commandId,
    rotationDigest: input.rotationDigest,
    checkpointDigest: input.checkpointDigest,
  };
}
export function buildFixtureInterruption(input: {
  runId: string;
  blockIndex: number;
  commandId: string;
  nextGameId: string;
  humanFranchiseId?: string;
  unavailablePlayerVersionIds?: string[];
}): SeasonInvalidRosterInterruption {
  return {
    code: 'invalid-roster',
    runId: idSchema.parse(input.runId),
    blockIndex: input.blockIndex,
    commandId: commandIdSchema.parse(input.commandId),
    nextGameId: seasonGameIdSchema.parse(input.nextGameId),
    humanFranchiseId: franchiseIdSchema.parse(input.humanFranchiseId ?? 'lakers'),
    unavailablePlayerVersionIds: input.unavailablePlayerVersionIds ?? [`pv-${'1'.repeat(32)}`],
  };
}
export function buildFixturePendingBlock(input: {
  run: SeasonRun;
  commandId: string;
  blockIndex: number;
  expectedRevision: number;
  expectedStateRevision: number;
  expectedStateDigest: string;
  objectiveId?: SeasonPendingBlockCandidate['objectiveId'];
  nextGameId: string;
  summaries?: readonly SeasonGameSummary[];
  retainedDetails?: readonly SeasonRetainedGameDetail[];
  effects?: SeasonEffectsState;
  health?: SeasonHealthState;
  rotationDigest?: string;
}): SeasonPendingBlockCandidate {
  const summaries = input.summaries ?? [];
  const retainedDetails = input.retainedDetails ?? [];
  const schedule = buildFixtureSchedule(input.run.rootSeed);
  const played = reconstructSeasonGamesFixture(schedule, summaries).filter(
    (game) => game.status !== 'scheduled',
  );
  const standings = reduceSeasonStandings(input.run.league, played);
  return {
    schemaVersion: 1,
    blockVersion: SEASON_BLOCK_VERSION,
    runId: input.run.runId,
    commandId: commandIdSchema.parse(input.commandId),
    blockIndex: input.blockIndex,
    expectedRevision: input.expectedRevision,
    expectedStateRevision: input.expectedStateRevision,
    expectedStateDigest: input.expectedStateDigest,
    objectiveId: input.objectiveId ?? null,
    nextGameId: seasonGameIdSchema.parse(input.nextGameId),
    summaries: [...summaries],
    retainedDetails: [...retainedDetails],
    effects: input.effects ?? buildFixtureEffectsState(input.run.rosters),
    health: input.health ?? buildFixtureHealthState(),
    standings,
    teamAggregates: foldTeamAggregatesFixture(input.run.league, summaries),
    playerAggregates: foldPlayerAggregatesFixture(input.run.rosters, summaries),
    rotationDigest: input.rotationDigest ?? seasonRotationSetDigestFixture(input.run.rotations),
  };
}
export function buildFixtureCheckpointRow(
  run: SeasonRun,
  overrides: Partial<StoredSeasonRunRecord> = {},
): StoredSeasonRunRecord {
  const { games: _games, ...runWithoutGames } = run;
  return {
    recordId: SEASON_RUN_RECORD_ID,
    saveSchemaVersion: SEASON_RUN_SAVE_SCHEMA_VERSION,
    run: runWithoutGames,
    completedRounds: 0,
    revision: 0,
    lastCommandId: null,
    lastRotationDigest: null,
    lastCheckpointDigest: null,
    standings: run.standings,
    teamAggregates: foldTeamAggregatesFixture(run.league, []),
    playerAggregates: foldPlayerAggregatesFixture(run.rosters, []),
    recap: null,
    effects: buildFixtureEffectsState(run.rosters),
    health: buildFixtureHealthState(),
    transactions: [],
    influence: buildFixtureInfluenceState(run.league),
    trade: null,
    objectives: buildFixtureObjectiveState(),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: run.stateDigest,
    ...overrides,
  };
}
export function buildFixtureSeasonDraftFacts(seed: string): SeasonRun['draft'] {
  const seedPath = (participantId: string, round: number, pickOrdinal: number): string[] => [
    'draft',
    'offer',
    participantId,
    String(round),
    String(pickOrdinal),
    'safe-order',
    'sample-order',
  ];
  const card = (n: number, selectable = true) => ({
    playerVersionId: `pv-${String(n).padStart(32, '0')}`,
    selectable,
    coverageReason: selectable
      ? null
      : 'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
  });
  void seed;
  return {
    draftVersion: SEASON_DRAFT_VERSION,
    participants: [
      {
        participantId: 'human-1',
        franchiseId: franchiseIdSchema.parse('lakers'),
        offers: [
          {
            round: 1,
            pickOrdinal: 1,
            seedPath: seedPath('human-1', 1, 1),
            cards: [card(1), card(2), card(3), card(4), card(5, false), card(6), card(7), card(8)],
          },
        ],
        picks: [
          {
            round: 1,
            playerVersionId: `pv-${'1'.padStart(32, '0')}`,
            franchiseId: franchiseIdSchema.parse('lakers'),
            eraId: eraIdSchema.parse('1990s'),
            seedPath: seedPath('human-1', 1, 1),
          },
        ],
      },
      {
        participantId: 'human-2',
        franchiseId: franchiseIdSchema.parse('celtics'),
        offers: [],
        picks: [],
      },
    ],
  };
}
export function buildSeasonDraftState(
  overrides: Partial<SeasonDraftState> & {
    revision?: number;
  } = {},
): SeasonDraftState {
  const seedPath = (participantId: string, round: number, pickOrdinal: number): string[] => [
    'draft',
    'offer',
    participantId,
    String(round),
    String(pickOrdinal),
    'safe-order',
    'sample-order',
  ];
  const card = (n: number, selectable = true) => ({
    playerVersionId: `pv-${String(n).padStart(32, '0')}`,
    selectable,
    coverageReason: selectable
      ? null
      : 'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
  });
  const cards = [card(1), card(2), card(3), card(4), card(5, false), card(6), card(7), card(8)];
  const league = buildFixtureLeague('lakers');
  const rootSeed = fixtureSeedFromString('fixture-season-draft');
  return {
    schemaVersion: 2,
    draftVersion: SEASON_DRAFT_VERSION,
    runId: idSchema.parse('fixture-draft-1'),
    rootSeed,
    league,
    catalogVersion: SEASON_DRAFT_VERSION,
    participants: [
      { participantId: 'human-1', franchiseId: franchiseIdSchema.parse('lakers') },
      { participantId: 'human-2', franchiseId: franchiseIdSchema.parse('celtics') },
    ],
    firstPickParticipantId: 'human-1',
    round: 2,
    currentTurnParticipantId: 'human-2',
    status: 'drafting',
    revision: overrides.revision ?? 3,
    currentOffer: {
      participantId: 'human-2',
      round: 2,
      pickOrdinal: 2,
      seedPath: seedPath('human-2', 2, 2),
      cards,
    },
    offers: [
      {
        participantId: 'human-1',
        round: 1,
        pickOrdinal: 1,
        seedPath: seedPath('human-1', 1, 1),
        cards,
      },
    ],
    picks: [
      {
        participantId: 'human-1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'1'.padStart(32, '0')}`,
        franchiseId: franchiseIdSchema.parse('lakers'),
        eraId: eraIdSchema.parse('1990s'),
        seedPath: seedPath('human-1', 1, 1),
      },
    ],
    commandLog: [],
    ...overrides,
  };
}
export function buildFixtureStoredDraft(
  run: SeasonRun,
  generation: SeasonLeagueGenerationResult | null = null,
): StoredSeasonDraft {
  const draft = buildSeasonDraftState();
  return {
    recordId: SEASON_DRAFT_RECORD_ID,
    saveSchemaVersion: SEASON_DRAFT_SAVE_SCHEMA_VERSION,
    draft: {
      ...draft,
      runId: run.runId,
      rootSeed: run.rootSeed,
      league: run.league,
    },
    generation,
  };
}
