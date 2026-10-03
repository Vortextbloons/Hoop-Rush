import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_AI_VERSION,
  SEASON_ALMANAC_VERSION,
  SEASON_AUTHORITY_VERSION,
  SEASON_AWARDS_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_VERSION,
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
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TIEBREAK_VERSION,
  SEASON_TRADE_GRADE_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
  franchiseIdSchema,
  seasonGameIdSchema,
  type SeasonEffectsState,
  type SeasonGameSummary,
  type SeasonLeague,
  type SeasonRoster,
  type SeasonRun,
} from '@hoop-rush/data-contracts';

export const SEASON_TEST_SEED = 'b1d2e3f405162738495a6b7c8d9e0f11';

export function seasonTestPairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export function seasonTestPairIsCanonical(a: string, b: string): boolean {
  return a < b;
}

export function seasonTestRosterIds(rosters: readonly SeasonRoster[]): string[] {
  return [
    ...new Set(rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId))),
  ].sort();
}

export function seasonTestZeroEffects(rosters: readonly SeasonRoster[]): SeasonEffectsState {
  const playerStates = seasonTestRosterIds(rosters).map((playerVersionId) => ({
    playerVersionId,
    fatigueBasisPoints: 0,
    recentLoadBasisPoints: 0,
    lastCompletedRound: 0,
  }));
  const pairStates: SeasonEffectsState['pairStates'] = [];
  for (const roster of rosters) {
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

export function seasonTestVersions(): SeasonRun['versions'] {
  return {
    runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
    leagueVersion: SEASON_LEAGUE_VERSION,
    scheduleVersion: SEASON_SCHEDULE_VERSION,
    scheduleFormulaVersion: SEASON_SCHEDULE_FORMULA_VERSION,
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
    challengeVersion: SEASON_CHALLENGE_VERSION,
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
  };
}

export function seasonTestZeroStandings(league: SeasonLeague): SeasonRun['standings'] {
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

export function seasonTestEmptyObjective(): SeasonRun['objectives'] {
  return {
    schemaVersion: 1,
    objectiveVersion: SEASON_OBJECTIVE_VERSION,
    catalog: [...SEASON_OBJECTIVE_CATALOG],
    selections: {},
  };
}

export function seasonTestFixtureSummary(
  gameId: string,
  homeFranchiseId: string,
  awayFranchiseId: string,
  homeScore: number,
  awayScore: number,
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
  const box = (franchiseId: string, points: number): SeasonGameSummary['homeBox'] => ({
    franchiseId: franchiseIdSchema.parse(franchiseId),
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
  });
  return {
    schemaVersion: 1,
    summaryVersion: SEASON_GAME_SUMMARY_VERSION,
    gameId: seasonGameIdSchema.parse(gameId),
    round: 1,
    homeFranchiseId: franchiseIdSchema.parse(homeFranchiseId),
    awayFranchiseId: franchiseIdSchema.parse(awayFranchiseId),
    status: 'final',
    overtimePeriods: 0,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: null,
    homeBox: box(homeFranchiseId, homeScore),
    awayBox: box(awayFranchiseId, awayScore),
    homePlayers: Array.from({ length: 10 }, (_, index) =>
      zeroLine(`pv-${String(index).padStart(32, '0')}`),
    ),
    awayPlayers: Array.from({ length: 10 }, (_, index) =>
      zeroLine(`pv-${String(index + 100).padStart(32, '0')}`),
    ),
    injuryEvents: [],
  };
}

export function seasonTestAuthority(humanFranchiseId: string): SeasonRun['authority'] {
  return {
    kind: 'local-solo',
    soloFranchiseId: franchiseIdSchema.parse(humanFranchiseId),
    authorityVersion: SEASON_AUTHORITY_VERSION,
  };
}
