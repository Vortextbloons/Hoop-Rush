import {
  SEASON_ALIGNMENT,
  SEASON_AI_VERSION,
  SEASON_AGGREGATES_VERSION,
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
  SEASON_ROSTER_SIZE,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SEED_NAMESPACES,
  SEASON_STAMINA_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  buildInitialPostseasonState,
  playerVersionId,
  seasonNamespaceSeed,
  type SeasonGame,
  type SeasonHealthState,
  type SeasonInfluenceState,
  type SeasonLeague,
  type SeasonRoster,
  type SeasonRun,
  type SeasonSchedule,
  type SeasonStandings,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureEvaluations,
  buildFixtureGenerationAudit,
  buildFixtureSeasonDraftFacts,
  buildSeasonAiAssignments,
  buildSeasonAiPools,
  buildSeasonRotation,
} from './season-draft.ts';

/**
 * Deterministic Season Run fixture builders (spec/2.0 M2.0, M2.1). Every
 * builder returns schema-valid records so engine tests and CLI fixtures can
 * rely on the frozen contracts. Rosters are synthetic: ten peak
 * player-versions per team with derived, unique playerVersionIds, plus the
 * M2.1 draft facts, AI assignments, rotations, evaluations, and audit fields.
 */

/** Accepted NBA conference/division alignment (league-v1, canonical in
 * `@hoop-rush/data-contracts`). The record keeps the canonical team order. */
const ALIGNMENT: Record<
  string,
  {
    conference: 'east' | 'west';
    division: 'atlantic' | 'central' | 'southeast' | 'northwest' | 'pacific' | 'southwest';
  }
> = Object.fromEntries(
  SEASON_ALIGNMENT.map((entry) => [
    entry.franchiseId,
    { conference: entry.conference, division: entry.division },
  ]),
);

const FRANCHISE_ORDER = SEASON_ALIGNMENT.map((entry) => entry.franchiseId);

/** M2.5 empty health state: no injury records yet (schema-valid). */
function emptyHealth(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: SEASON_HEALTH_VERSION,
    injuries: [],
  };
}

/** M2.6.5 empty free-agency state: no windows, zero signings/spend (30 teams). */
function emptyFreeAgency(): SeasonRun['freeAgency'] {
  return {
    schemaVersion: 1,
    freeAgencyVersion: 'season-free-agency-v1',
    windows: [],
    canonicalCandidates: {},
    signingCounts: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
    seasonSpend: Object.fromEntries(FRANCHISE_ORDER.map((franchiseId) => [franchiseId, 0])),
  };
}

/**
 * M2.5 initial Influence state for the fixture league: every franchise at
 * +2 with its recorded `initial-grant` ledger entry (blockIndex/commandId
 * null), no windows, no rehabs (mirror of the data-contracts fixture
 * builder `buildInitialInfluence`).
 */
function initialInfluence(league: SeasonLeague): SeasonInfluenceState {
  const balances: Record<string, number> = {};
  const ledger: SeasonInfluenceState['ledger'] = [];
  const windows: SeasonInfluenceState['windows'] = {};
  for (const team of league.teams) {
    balances[team.franchiseId] = 2;
    ledger.push({
      entryId: `influence-initial-${team.franchiseId}`,
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

/** The frozen league: 30 teams; one human franchise (default lakers), rest AI. */
export function buildSeasonLeague(
  overrides: Partial<SeasonLeague> = {},
  options: { humanFranchiseId?: string } = {},
): SeasonLeague {
  const human = options.humanFranchiseId ?? 'lakers';
  return {
    schemaVersion: 1,
    leagueVersion: 'league-v1',
    teams: FRANCHISE_ORDER.map((franchiseId) => {
      const alignment = ALIGNMENT[franchiseId];
      if (!alignment) throw new Error(`no alignment for ${franchiseId}`);
      return {
        franchiseId,
        control: franchiseId === human ? 'human' : 'ai',
        conference: alignment.conference,
        division: alignment.division,
      };
    }),
    ...overrides,
  };
}

/**
 * Deterministic ten-player rosters for every team: playerVersionIds derived
 * from synthetic identity fields, unique across the league.
 */
export function buildSeasonRosters(league: SeasonLeague, seed: string): SeasonRoster[] {
  const seeded = seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.aiRosters);
  return league.teams.map((team, teamIndex) => ({
    franchiseId: team.franchiseId,
    players: Array.from({ length: SEASON_ROSTER_SIZE }, (_, slot) => {
      const playerId = `p-synth-${seeded.slice(0, 6)}-${String(teamIndex + 1)}-${String(slot + 1)}`;
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

function zeroStandings(league: SeasonLeague): SeasonStandings {
  return {
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

function emptyPostseason(rootSeed: string): SeasonRun['postseason'] {
  return buildInitialPostseasonState(rootSeed);
}

/**
 * Complete 30-team Season Run snapshot: committed schedule (caller-supplied
 * schedule — use the packaged artifact or regenerate it with
 * SEASON_COMMITTED_SCHEDULE_SEED), empty results, initial standings, block
 * cursor at round 0, postseason-ready derived seeds, and schema-v7 M2.5
 * fields (synthetic draft facts, assignments, roster-generation-v2 AI
 * pools, rotations, evaluations, the generation audit, the frozen
 * block/summary/aggregates/recap/leaders/home-court/checkpoint/stamina/
 * chemistry/effect-targets versions plus the seven new M2.5 material
 * versions, and the M2.5 mutable run state: empty health, initial
 * Influence, empty transaction log, null trade state, fixed objective
 * catalog, null checkpoint state, and stateRevision 0).
 *
 * The `stateDigest` parameter defaults to the zero digest (32 zeros) and is
 * documented for callers that run the persistence reload audit: the audit
 * recomputes the digest through the engine seam, so such callers must pass
 * the real digest (`seam.seasonRunStateDigest` over the initial facts).
 */
export function buildSeasonRunFixture(input: {
  schedule: SeasonSchedule;
  league?: SeasonLeague;
  seed?: string;
  humanFranchiseId?: string;
  /** SHA-256 of the schedule artifact; fixtures default to a placeholder. */
  scheduleContentHash?: string;
  /**
   * M2.5 run state digest. Defaults to '0'.repeat(32) for callers that do
   * not run the reload audit; persistence callers must pass the digest the
   * engine seam computes over the initial mutable state.
   */
  stateDigest?: string;
}): SeasonRun {
  const seed = input.seed ?? 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
  const league =
    input.league ?? buildSeasonLeague({}, { humanFranchiseId: input.humanFranchiseId });
  const rosters = buildSeasonRosters(league, seed);
  const aiAssignments = buildSeasonAiAssignments(league);
  const rotations = rosters.map((roster) =>
    buildSeasonRotation(
      roster.franchiseId,
      roster.players.map((player) => player.playerVersionId),
    ),
  );
  return {
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: 'fixture-season-run-1',
    rootSeed: seed,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: league.leagueVersion,
      scheduleVersion: input.schedule.scheduleVersion,
      scheduleFormulaVersion: input.schedule.formulaVersion,
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
      leagueVersion: input.schedule.leagueVersion,
      scheduleVersion: input.schedule.scheduleVersion,
      formulaVersion: input.schedule.formulaVersion,
      generationSeed: input.schedule.generationSeed,
      contentHash: input.scheduleContentHash ?? '0'.repeat(64),
    },
    games: scheduledGames(input.schedule),
    standings: zeroStandings(league),
    cursor: { schemaVersion: 1, completedRounds: 0 },
    stage: 'regular-season',
    postseason: emptyPostseason(seed),
    awards: null,
    completion: null,
    draft: buildFixtureSeasonDraftFacts(),
    aiAssignments,
    aiPools: buildSeasonAiPools(aiAssignments, 'lakers'),
    rotations,
    generationAudit: buildFixtureGenerationAudit(seed),
    evaluations: buildFixtureEvaluations(rosters, aiAssignments),
    // M2.5 mutable run state: promotion-time initial values (mirror of the
    // data-contracts fixture builders `buildEmptyHealth` /
    // `buildInitialInfluence`; the fixed objective catalog from
    // SEASON_OBJECTIVE_CATALOG with no selections).
    trade: null,
    freeAgency: emptyFreeAgency(),
    objectives: {
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    },
    health: emptyHealth(),
    transactions: [],
    influence: initialInfluence(league),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: input.stateDigest ?? '0'.repeat(32),
  };
}
