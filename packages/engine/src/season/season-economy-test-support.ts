import {
  SEASON_AGGREGATES_VERSION,
  SEASON_AI_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_OBJECTIVE_CATALOG,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  buildInitialPostseasonState,
  seasonNamespaceSeed,
  seasonRunSchema,
  type SeasonDraftCatalog,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonRoster,
  type SeasonRosterEntry,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureEvaluations,
  buildFixtureGenerationAudit,
  buildFixtureSeasonDraftFacts,
  buildSeasonAiAssignments,
  buildSeasonAiPools,
  buildSeasonDraftCatalog,
  buildSeasonLeague,
} from '@hoop-rush/test-fixtures';
import { buildMinimalRotation } from './rotation.ts';
import { validateSeasonRoster, type SeasonRosterMemberInput } from './roster-rules.ts';
import { createInitialSeasonInfluenceState } from './influence.ts';

/**
 * Deterministic M2.5 Season Run fixtures for the trade/economy tests
 * (season-economy test support). Builds a schema-7 run (health, influence,
 * transactions, trade, objectives, checkpointState, stateRevision,
 * stateDigest) over the compact fixture catalog: every franchise's ten-player
 * roster is a pre-verified LEGAL pick from its own pool (fixed index
 * patterns that satisfy the 4/4/3 coverage targets, chosen per franchise by
 * a hash so value profiles vary), rotations are the deterministic minimal
 * rotations, and the effects state is the canonical zero state (300 loads,
 * 1,350 zero pairs). The whole snapshot parses with `seasonRunSchema`.
 */

/** Seed used by the fixtures; callers override with their own hex seed. */
export const ECONOMY_TEST_SEED = 'b1d2e3f405162738495a6b7c8d9e0f11';

/** M2.6 schema-9 version set for the fixture runs. */
export const SEASON_VERSIONS_M25: SeasonRun['versions'] = {
  runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
  leagueVersion: 'league-v1',
  scheduleVersion: 'schedule-v1',
  scheduleFormulaVersion: 'schedule-formula-v1',
  standingsVersion: 'standings-v1',
  postseasonVersion: SEASON_POSTSEASON_VERSION,
  seedDerivationVersion: 'season-seeds-v1',
  playerVersionIdVersion: 'player-version-id-v1',
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
  injuryTargetsVersion: SEASON_INJURY_TARGETS_VERSION,
  tradeTargetsVersion: SEASON_TRADE_TARGETS_VERSION,
  influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
  tiebreakVersion: 'tiebreaker-v1',
  postseasonSummaryVersion: 'postseason-summary-v1',
  awardsVersion: 'awards-v1',
  tradeGradeVersion: 'trade-grade-v1',
  commandLogVersion: 'command-log-v1',
  almanacVersion: 'almanac-v1',
  replayExportVersion: 'replay-export-v1',
  postseasonTargetsVersion: 'postseason-targets-v1',
  freeAgencyVersion: 'season-free-agency-v1',
  freeAgencyIndexVersion: 'free-agency-index-v1',
  freeAgencyTargetsVersion: 'free-agency-targets-v1',
};

/**
 * Pre-verified legal ten-player index patterns into a two-cycle (40
 * candidate) pool. Every pattern covers 4+ guard-, 4+ forward-, and 3+
 * center-capable players (the roster-generation completion targets, which
 * imply every single-removal legal-five rule), so any pattern is a legal
 * roster; the builder asserts this before use.
 */
const LEGAL_ROSTER_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 17, 18],
  [1, 2, 6, 7, 8, 9, 16, 17, 18, 19],
  [0, 2, 3, 4, 6, 7, 8, 9, 17, 18],
  [0, 1, 2, 3, 6, 7, 8, 9, 17, 18],
  [1, 2, 3, 5, 6, 7, 8, 9, 17, 18],
];

/** Deterministic pattern index per franchise (stable across calls). */
function patternIndexOf(franchiseId: string): number {
  const hash = seasonNamespaceSeed('0'.repeat(32), 'economy-test-patterns', franchiseId);
  return Number.parseInt(hash.slice(0, 8), 16) % LEGAL_ROSTER_PATTERNS.length;
}

function rosterOf(catalog: SeasonDraftCatalog, franchiseId: string): SeasonRosterEntry[] {
  const pool = catalog.pools.find((entry) => entry.franchiseId === franchiseId);
  if (pool === undefined) throw new Error(`no catalog pool for ${franchiseId}`);
  const pattern = LEGAL_ROSTER_PATTERNS[patternIndexOf(franchiseId)];
  if (pattern === undefined) throw new Error(`no pattern for ${franchiseId}`);
  const versions = pattern.map((index) => {
    const version = pool.playerVersionIds[index];
    if (version === undefined)
      throw new Error(`pool ${franchiseId} has no version at index ${String(index)}`);
    return version;
  });
  return versions.map((playerVersionId) => {
    const candidate = catalog.candidates.find((entry) => entry.playerVersionId === playerVersionId);
    if (candidate === undefined) throw new Error(`catalog lacks ${playerVersionId}`);
    return {
      playerVersionId: candidate.playerVersionId,
      playerId: candidate.playerId,
      franchiseId,
      eraId: candidate.eraId,
      seasonKey: candidate.seasonKey,
      displayName: candidate.displayName,
    };
  });
}

/** The fixture effects state: 300 zero loads + 1,350 zero canonical pairs. */
export function zeroEffectsOf(run: SeasonRun): SeasonEffectsState {
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
  const pairStates: SeasonEffectsState['pairStates'] = [];
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
  return {
    schemaVersion: 2,
    playerStates,
    inactivePlayerStates: [],
    pairStates,
    archivedPairs: [],
  };
}

export function economyTestCatalog(): SeasonDraftCatalog {
  const league = buildSeasonLeague();
  return buildSeasonDraftCatalog({
    franchiseIds: league.teams.map((team) => team.franchiseId),
    eras: ['1990s'],
    playersPerPool: 40,
  });
}

/**
 * Builds a schema-valid M2.5 run fixture. The catalog must be the 30-team
 * fixture catalog (it carries the candidates the rosters reference). The run
 * starts at revision 0 with the placeholder digest (fixtures do not run the
 * reload audit); command/trade tests advance the chain themselves.
 */
export function buildEconomyTestRun(
  input: {
    seed?: string;
    catalog?: SeasonDraftCatalog;
    humanFranchiseId?: string;
    runId?: string;
  } = {},
): { run: SeasonRun; catalog: SeasonDraftCatalog } {
  const seed = input.seed ?? ECONOMY_TEST_SEED;
  const catalog = input.catalog ?? economyTestCatalog();
  const humanFranchiseId = input.humanFranchiseId ?? 'lakers';
  const runId = input.runId ?? 'economy-test-run-1';
  const league = buildSeasonLeague({}, { humanFranchiseId });
  const rosterRows: SeasonRoster[] = league.teams.map((team) => ({
    franchiseId: team.franchiseId,
    players: rosterOf(catalog, team.franchiseId),
  }));

  // Fail fast: every fixture roster must be a legal ten-player roster.
  for (const roster of rosterRows) {
    const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      playable:
        catalog.candidates.find((entry) => entry.playerVersionId === player.playerVersionId)
          ?.positions.playable ?? [],
    }));
    const failures = validateSeasonRoster(members);
    if (failures.length > 0) {
      throw new Error(`fixture roster ${roster.franchiseId} is illegal: ${failures.join('; ')}`);
    }
  }

  const aiAssignments = buildSeasonAiAssignments(league);
  const rotations = rosterRows.map((roster) =>
    buildMinimalRotation({
      franchiseId: roster.franchiseId,
      members: roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        playable:
          catalog.candidates.find((entry) => entry.playerVersionId === player.playerVersionId)
            ?.positions.playable ?? [],
      })),
    }),
  );
  const ownership = rosterRows.flatMap((roster) =>
    roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      ownerFranchiseId: roster.franchiseId,
    })),
  );
  const games = Array.from({ length: 1230 }, (_, index) => {
    const gameNumber = index + 1;
    const home = league.teams[gameNumber % league.teams.length];
    const away = league.teams[(gameNumber * 7 + 11) % league.teams.length];
    return {
      gameId: `s${String(gameNumber).padStart(6, '0')}`,
      round: Math.floor(index / 15) + 1,
      homeFranchiseId: home?.franchiseId ?? 'lakers',
      awayFranchiseId: away?.franchiseId ?? 'celtics',
      status: 'scheduled' as const,
      homeScore: null,
      awayScore: null,
      forfeitLoserFranchiseId: null,
    };
  });
  const standings: SeasonRun['standings'] = {
    schemaVersion: 1,
    standingsVersion: 'standings-v1',
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
  const postseason = buildInitialPostseasonState(seed);
  const franchiseIds = league.teams.map((team) => team.franchiseId);

  const run: SeasonRun = {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId,
    rootSeed: seed,
    versions: SEASON_VERSIONS_M25,
    league,
    rosters: rosterRows,
    ownership,
    schedule: {
      leagueVersion: 'league-v1',
      scheduleVersion: 'schedule-v1',
      formulaVersion: 'schedule-formula-v1',
      generationSeed: seed,
      contentHash: '0'.repeat(64),
    },
    games,
    standings,
    cursor: { schemaVersion: 1, completedRounds: 0 },
    stage: 'regular-season',
    postseason,
    awards: null,
    completion: null,
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments,
    aiPools: buildSeasonAiPools(aiAssignments, humanFranchiseId),
    rotations,
    generationAudit: buildFixtureGenerationAudit(seed),
    evaluations: buildFixtureEvaluations(rosterRows, aiAssignments),
    trade: null,
    freeAgency: {
      schemaVersion: 1,
      freeAgencyVersion: 'season-free-agency-v1',
      windows: [],
      canonicalCandidates: {},
      signingCounts: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
      seasonSpend: Object.fromEntries(franchiseIds.map((franchiseId) => [franchiseId, 0])),
    },
    objectives: {
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    },
    health: { schemaVersion: 1, healthVersion: SEASON_HEALTH_VERSION, injuries: [] },
    transactions: [],
    influence: createInitialSeasonInfluenceState(franchiseIds),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
  };
  const parsed = seasonRunSchema.safeParse(run);
  if (!parsed.success) {
    throw new Error(
      `economy test run fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { run, catalog };
}

export function withInjury(
  run: SeasonRun,
  injury: SeasonRun['health']['injuries'][number],
): SeasonRun {
  return {
    ...run,
    health: {
      ...run.health,
      injuries: [...run.health.injuries, injury],
    },
  };
}

/** The injury id derived from a seed path (matches the /^inj-.../ contract). */
export function injuryIdOf(seed: string): `inj-${string}` {
  return `inj-${seasonNamespaceSeed(seed, 'injuries', 'test')}`;
}

export function aiTradeCountOf(run: SeasonRun, humanFranchiseId: string): number {
  let count = 0;
  for (const window of run.trade?.windows ?? []) {
    for (const offer of window.offers) {
      if (
        offer.toFranchiseId !== humanFranchiseId &&
        offer.fromFranchiseId !== humanFranchiseId &&
        offer.status === 'accepted'
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** A minimal final-game summary helper for objective tests. */
export function fixtureSummary(
  gameId: string,
  homeFranchiseId: string,
  awayFranchiseId: string,
  homeScore: number,
  awayScore: number,
  opts: {
    homeLines?: SeasonGameSummary['homePlayers'];
    awayLines?: SeasonGameSummary['awayPlayers'];
    homeBox?: SeasonGameSummary['homeBox'];
    awayBox?: SeasonGameSummary['awayBox'];
  } = {},
): SeasonGameSummary {
  const zeroLine = (playerVersionId: string): SeasonGameSummary['homePlayers'][number] => ({
    playerVersionId,
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
  const box = (
    franchiseId: string,
    points: number,
    overrides: Partial<SeasonGameSummary['homeBox']> = {},
  ): SeasonGameSummary['homeBox'] => ({
    franchiseId,
    points,
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
    ...overrides,
  });
  return {
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v3',
    gameId,
    round: 1,
    homeFranchiseId,
    awayFranchiseId,
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: opts.homeBox ?? box(homeFranchiseId, homeScore),
    awayBox: opts.awayBox ?? box(awayFranchiseId, awayScore),
    homePlayers:
      opts.homeLines ??
      Array.from({ length: 10 }, (_, index) => zeroLine(`pv-${String(index).padStart(32, '0')}`)),
    awayPlayers:
      opts.awayLines ??
      Array.from({ length: 10 }, (_, index) =>
        zeroLine(`pv-${String(index + 100).padStart(32, '0')}`),
      ),
    injuryEvents: [],
  };
}

export function allFixtureFranchiseIds(league: SeasonRun['league']): string[] {
  return league.teams.map((team) => team.franchiseId);
}
