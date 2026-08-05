import {
  playerVersionId,
  SEASON_AI_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_COUNT,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  PLAYER_VERSION_ID_VERSION,
  seasonEffectsStateSchema,
  seasonGameSimulationResultSchema,
  seasonRunSchema,
  type SeasonAiAssignment,
  type SeasonBlockRecap,
  type SeasonCompactPlayerLine,
  type SeasonEffectsState,
  type SeasonGame,
  type SeasonGameSimulationResult,
  type SeasonGameSummary,
  type SeasonDraftState,
  type SeasonLeague,
  type SeasonLeagueGenerationResult,
  type SeasonPairChemistryState,
  type SeasonPlayerAggregate,
  type SeasonPostseasonState,
  type SeasonRetainedGameDetail,
  type SeasonRoster,
  type SeasonRotation,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
  type SeasonTeamAggregate,
  type SeasonTeamBox,
  seasonDigestHex,
} from '@hoop-rush/data-contracts';
import { reduceSeasonStandings } from '@hoop-rush/engine';
import type { SeasonRunEngineSeam } from '../season/engine-seam-types.ts';
import { SEASON_DRAFT_RECORD_ID, type StoredSeasonDraft } from '../schemas/season-draft-record.ts';

/**
 * Synthetic-but-schema-valid Season Run fixtures for the persistence tests
 * and the `benchmarkSeasonRunPersistence` harness (spec/2.0/10 M2.3, M2.4).
 * The builders are self-contained (no @hoop-rush/test-fixtures dependency)
 * so the persistence package never depends on fixture package state. All
 * values derive deterministically from integer arithmetic — no Math.random,
 * no clocks — and the fold helpers mirror the documented engine semantics
 * (season-aggregates-v1: every aggregate is a pure fold over compact
 * completed-game summaries), so the reload reconciliation audit passes
 * exactly whether the production engine seam or the stub seam is used.
 * Fixture runs are schema-5 (M2.4) with the stamina, chemistry, and
 * effect-targets material versions frozen and a valid zero `SeasonEffectsState`
 * (300 player load states, 1,350 canonical pair states) available for any
 * roster set through `buildFixtureEffectsState`.
 */

/** Accepted 30-franchise alignment; conference/division follow league-v1. */
const ALIGNMENT: ReadonlyArray<{
  franchiseId: string;
  conference: 'east' | 'west';
  division: 'atlantic' | 'central' | 'southeast' | 'northwest' | 'pacific' | 'southwest';
}> = [
  { franchiseId: 'hawks', conference: 'east', division: 'southeast' },
  { franchiseId: 'celtics', conference: 'east', division: 'atlantic' },
  { franchiseId: 'nets', conference: 'east', division: 'atlantic' },
  { franchiseId: 'hornets', conference: 'east', division: 'southeast' },
  { franchiseId: 'bulls', conference: 'east', division: 'central' },
  { franchiseId: 'cavaliers', conference: 'east', division: 'central' },
  { franchiseId: 'mavericks', conference: 'west', division: 'southwest' },
  { franchiseId: 'nuggets', conference: 'west', division: 'northwest' },
  { franchiseId: 'pistons', conference: 'east', division: 'central' },
  { franchiseId: 'warriors', conference: 'west', division: 'pacific' },
  { franchiseId: 'rockets', conference: 'west', division: 'southwest' },
  { franchiseId: 'pacers', conference: 'east', division: 'central' },
  { franchiseId: 'clippers', conference: 'west', division: 'pacific' },
  { franchiseId: 'lakers', conference: 'west', division: 'pacific' },
  { franchiseId: 'grizzlies', conference: 'west', division: 'southwest' },
  { franchiseId: 'heat', conference: 'east', division: 'southeast' },
  { franchiseId: 'bucks', conference: 'east', division: 'central' },
  { franchiseId: 'timberwolves', conference: 'west', division: 'northwest' },
  { franchiseId: 'pelicans', conference: 'west', division: 'southwest' },
  { franchiseId: 'knicks', conference: 'east', division: 'atlantic' },
  { franchiseId: 'thunder', conference: 'west', division: 'northwest' },
  { franchiseId: 'magic', conference: 'east', division: 'southeast' },
  { franchiseId: 'sixers', conference: 'east', division: 'atlantic' },
  { franchiseId: 'suns', conference: 'west', division: 'pacific' },
  { franchiseId: 'blazers', conference: 'west', division: 'northwest' },
  { franchiseId: 'kings', conference: 'west', division: 'pacific' },
  { franchiseId: 'spurs', conference: 'west', division: 'southwest' },
  { franchiseId: 'raptors', conference: 'east', division: 'atlantic' },
  { franchiseId: 'jazz', conference: 'west', division: 'northwest' },
  { franchiseId: 'wizards', conference: 'east', division: 'southeast' },
];

const FRANCHISE_ORDER = ALIGNMENT.map((entry) => entry.franchiseId);

/** Deterministic 32-bit FNV-1a; fixture randomness only (not domain logic). */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic 32-hex seed from any string. */
export function fixtureSeedFromString(value: string): string {
  return fnv1a32(value).toString(16).padStart(8, '0').repeat(4);
}

/** The frozen league manifest: 30 teams, one human franchise (default lakers). */
export function buildFixtureLeague(humanFranchiseId = 'lakers'): SeasonLeague {
  return {
    schemaVersion: 1,
    leagueVersion: SEASON_LEAGUE_VERSION,
    teams: ALIGNMENT.map((entry) => ({
      franchiseId: entry.franchiseId,
      control: entry.franchiseId === humanFranchiseId ? ('human' as const) : ('ai' as const),
      conference: entry.conference,
      division: entry.division,
    })),
  };
}

/**
 * Deterministic schema-valid 1,230-game schedule: each round pairs
 * consecutive franchise pairs, home/away flips every round, every team plays
 * exactly once per round (41 home / 41 away). Matchup variety is irrelevant
 * to the persistence contract; identity and round coverage are what matter.
 */
export function buildFixtureSchedule(seed: string): SeasonSchedule {
  const offset = fnv1a32(`schedule-${seed}`) % 30;
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
        gameId: `s${String(gameNumber).padStart(6, '0')}`,
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
    generationSeed: seed,
    rounds: 82,
    games,
  };
}

/** Deterministic ten-player rosters with unique derived player-version ids. */
export function buildFixtureRosters(league: SeasonLeague): SeasonRoster[] {
  return league.teams.map((team) => ({
    franchiseId: team.franchiseId,
    players: Array.from({ length: SEASON_ROSTER_SIZE }, (_, slot) => {
      const playerId = `p-synth-${String(slot + 1)}-${team.franchiseId}`;
      return {
        playerVersionId: playerVersionId(playerId, team.franchiseId, '1990s', '1995-96'),
        playerId,
        franchiseId: team.franchiseId,
        eraId: '1990s',
        seasonKey: '1995-96',
        displayName: `Fixture ${team.franchiseId} ${String(slot + 1)}`,
      };
    }),
  }));
}

/**
 * Deterministic M2.4 effects state for an arbitrary roster set: one load
 * state per rostered version (unique, sorted by playerVersionId) and the
 * canonical a<b pairs per roster (45 per ten-player roster), all with zero
 * load / zero shared possessions by default. Pass `options` to raise every
 * player/pair value uniformly (the benchmark folds monotonically increasing
 * values across blocks). Exported for other lanes' tests.
 */
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
    schemaVersion: 1,
    playerStates,
    pairStates,
  });
}

/** Sorted unique player-version ids across every roster (stub seam helper). */
export function fixtureRosterPlayerVersionIds(rosters: readonly SeasonRoster[]): string[] {
  return [
    ...new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId))),
  ].sort();
}

/** Canonical 'a\u0000b' pair key with a < b (stub seam helper). */
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

function emptyPostseason(seed: string): SeasonPostseasonState {
  const game = () => ({
    gameId: 'seven-eight' as const,
    status: 'scheduled' as const,
    homeFranchiseId: null,
    awayFranchiseId: null,
    winnerFranchiseId: null,
    loserFranchiseId: null,
    homeScore: null,
    awayScore: null,
  });
  return {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    seed,
    playIn: {
      east: {
        conference: 'east',
        ranking: null,
        games: {
          sevenEight: game(),
          nineTen: { ...game(), gameId: 'nine-ten' as const },
          final: { ...game(), gameId: 'final' as const },
        },
        playoffSeeds: null,
      },
      west: {
        conference: 'west',
        ranking: null,
        games: {
          sevenEight: game(),
          nineTen: { ...game(), gameId: 'nine-ten' as const },
          final: { ...game(), gameId: 'final' as const },
        },
        playoffSeeds: null,
      },
    },
    bracket: null,
    championFranchiseId: null,
  };
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

/** Complete schema-v4 Season Run fixture with all 1,230 scheduled games. */
export function buildFixtureRun(input: {
  seed?: string;
  humanFranchiseId?: string;
  schedule?: SeasonSchedule;
  runId?: string;
}): SeasonRun {
  const seed = input.seed ?? fixtureSeedFromString('fixture-season-run');
  const league = buildFixtureLeague(input.humanFranchiseId);
  const schedule = input.schedule ?? buildFixtureSchedule(seed);
  const rosters = buildFixtureRosters(league);
  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: input.runId ?? 'fixture-season-run-1',
    rootSeed: seed,
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
    },
    league,
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
      contentHash: '0'.repeat(64),
    },
    games: scheduledGames(schedule),
    standings: zeroStandings(league),
    cursor: { schemaVersion: 1, completedRounds: 0 },
    postseason: emptyPostseason(fixtureSeedFromString(`${seed}:postseason`)),
    draft: buildFixtureSeasonDraftFacts(seed),
    aiAssignments: fixtureAiAssignments(league),
    rotations: rosters.map(fixtureRotation),
    generationAudit: {
      seed,
      aiVersion: SEASON_AI_VERSION,
      rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      rosterTargetsVersion: SEASON_ROSTER_TARGETS_VERSION,
      digest: fnv1a32(`generation-${seed}`).toString(16).padStart(8, '0').repeat(4),
      diagnostics: {
        seed,
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
  };
  return seasonRunSchema.parse(run);
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

/** One deterministic compact player line for the given version and seed. */
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
    franchiseId,
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

/**
 * Deterministic compact summaries for the rounds of one block. Player lines
 * come from the rosters of both franchises, so the fold helpers can always
 * reconcile. The home side receives a small deterministic scoring edge so no
 * score ties occur.
 */
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
    });
  }
  return summaries;
}

/** Full synthetic dataset: summaries for the entire 1,230-game season. */
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

/** Reconstructs the full 1,230-game array from the schedule and summaries. */
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

/** Winner franchise of a completed summary (scores are never tied). */
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

/**
 * Team aggregate fold over compact summaries (mirrors the documented engine
 * semantics: wins and losses from the official result, every box field
 * summed, full 30-row table with zero rows for franchises with no completed
 * games, sorted by franchiseId).
 */
export function foldTeamAggregatesFixture(
  league: SeasonLeague,
  summaries: readonly SeasonGameSummary[],
): SeasonTeamAggregate[] {
  const zeroRow = (franchiseId: string): SeasonTeamAggregate => ({
    franchiseId,
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

/**
 * Player aggregate fold over compact summaries (mirrors the documented
 * engine semantics: sums of the player lines, owning franchise from the side
 * box, full 300-row table with zero rows for versions with no completed
 * games, sorted by playerVersionId).
 */
export function foldPlayerAggregatesFixture(
  rosters: readonly SeasonRoster[],
  summaries: readonly SeasonGameSummary[],
): SeasonPlayerAggregate[] {
  const ownerOf = new Map(
    rosters.flatMap((roster) =>
      roster.players.map((player) => [player.playerVersionId, roster.franchiseId] as const),
    ),
  );
  const zeroRow = (playerVersionIdValue: string): SeasonPlayerAggregate => ({
    playerVersionId: playerVersionIdValue,
    franchiseId: ownerOf.get(playerVersionIdValue) ?? 'lakers',
    gamesPlayed: 0,
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
  });
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

/** Minimal schema-valid retained detail for one human-team game. */
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
      return {
        playerVersionId: line.playerVersionId,
        playerId: rosterEntry?.playerId ?? line.playerVersionId,
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
  };
}

/** Minimal schema-valid recap for one accepted block. */
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
  };
}

/** Stub engine seam mirroring the documented pure engine semantics. */
export function buildStubSeasonEngineSeam(): SeasonRunEngineSeam {
  return {
    reconstructSeasonGames: reconstructSeasonGamesFixture,
    foldSeasonTeamAggregates: foldTeamAggregatesFixture,
    foldSeasonPlayerAggregates: foldPlayerAggregatesFixture,
    reduceSeasonStandings,
    seasonRotationSetDigest: seasonRotationSetDigestFixture,
    seasonRosterPlayerVersionIds: fixtureRosterPlayerVersionIds,
    zeroSeasonEffectsState: (rosters) => buildFixtureEffectsState(rosters),
    seasonPairKey: fixtureSeasonPairKey,
    seasonPairIsCanonical: (a, b) => a < b,
  };
}

/** Canonical 30-rotation set digest for fixture runs (sorted, FNV digest). */
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

/**
 * Synthetic-but-schema-valid M2.3.5 global-eight draft facts (season-draft-v2)
 * for fixture runs: two human participants, one drawn eight-card offer with
 * at least three selectable cards, and one pick. Deterministic and
 * self-contained (no engine dependency).
 */
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
        franchiseId: 'lakers',
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
            franchiseId: 'lakers',
            eraId: '1990s',
            seedPath: seedPath('human-1', 1, 1),
          },
        ],
      },
      {
        participantId: 'human-2',
        franchiseId: 'celtics',
        offers: [],
        picks: [],
      },
    ],
  };
}

/**
 * Synthetic-but-schema-valid M2.3.5 mid-draft state (season-draft-v2) for
 * fixture runs: one drawn eight-card offer (at least three selectable cards)
 * and one pick. Self-contained; overrides apply shallowly.
 */
export function buildSeasonDraftState(
  overrides: Partial<SeasonDraftState> & { revision?: number } = {},
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
    runId: 'fixture-draft-1',
    rootSeed,
    league,
    catalogVersion: SEASON_DRAFT_VERSION,
    participants: [
      { participantId: 'human-1', franchiseId: 'lakers' },
      { participantId: 'human-2', franchiseId: 'celtics' },
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
        franchiseId: 'lakers',
        eraId: '1990s',
        seedPath: seedPath('human-1', 1, 1),
      },
    ],
    commandLog: [],
    ...overrides,
  };
}

/** Valid stored Season draft record for promotion fixtures (v2 state). */
export function buildFixtureStoredDraft(
  run: SeasonRun,
  generation: SeasonLeagueGenerationResult | null = null,
): StoredSeasonDraft {
  const draft = buildSeasonDraftState();
  return {
    recordId: SEASON_DRAFT_RECORD_ID,
    saveSchemaVersion: 2,
    draft: {
      ...draft,
      runId: run.runId,
      rootSeed: run.rootSeed,
      league: run.league,
    },
    generation,
  };
}
