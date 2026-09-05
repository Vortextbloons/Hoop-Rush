import type {
  SeasonCandidateCheckpoint,
  SeasonEffectsState,
  SeasonGame,
  SeasonGamePlayerInput,
  SeasonGameSummary,
  SeasonHealthState,
  SeasonInfluenceState,
  SeasonLeague,
  SeasonPairChemistryState,
  SeasonPendingBlockCandidate,
  SeasonPlayerLoadState,
  SeasonRun,
  SeasonSchedule,
  SeasonTeamAggregate,
  SeasonPlayerAggregate,
} from './index.ts';
import { buildInitialPostseasonState } from './season-postseason.ts';
import { SEASON_OBJECTIVE_CATALOG } from './season-objective.ts';
import { buildEmptyChallengeState } from './season-challenge.ts';
import { SEASON_ALIGNMENT } from './season-alignment.ts';
import {
  SEASON_BLOCK_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHALLENGE_TARGETS_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_REPLAY_EXPORT_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
} from './season-versions.ts';
import {
  commandIdSchema,
  franchiseIdSchema,
  idSchema,
  seasonGameIdSchema,
  seedSchema,
} from './ids.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonRosterSchema } from './season-roster.ts';
import { seasonScheduleSchema } from './season-schedule.ts';
import { seasonRunSchema } from './season-run.ts';
import { seasonGameSummarySchema } from './season-game-summary.ts';
export const CONFERENCE_TEAMS: Record<'east' | 'west', string[]> = {
  east: SEASON_ALIGNMENT.filter((entry) => entry.conference === 'east').map(
    (entry) => entry.franchiseId,
  ),
  west: SEASON_ALIGNMENT.filter((entry) => entry.conference === 'west').map(
    (entry) => entry.franchiseId,
  ),
};
export const DIVISION_OF: Record<string, string> = Object.fromEntries(
  SEASON_ALIGNMENT.map((entry) => [entry.franchiseId, entry.division]),
);
export const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';
export function buildLeague(): SeasonLeague {
  return seasonLeagueSchema.parse({
    schemaVersion: 1,
    leagueVersion: 'league-v1',
    teams: [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west].map((franchiseId, index) => ({
      franchiseId,
      control: index === 0 ? ('human' as const) : ('ai' as const),
      conference: index < 15 ? ('east' as const) : ('west' as const),
      division: DIVISION_OF[franchiseId] as SeasonLeague['teams'][number]['division'],
    })),
  });
}
export function buildSchedule(): SeasonSchedule {
  const games: SeasonSchedule['games'] = [];
  const teams = [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west];
  let sequence = 0;
  for (let round = 1; round <= 82; round += 1) {
    for (let g = 0; g < 15; g += 1) {
      const home = teams[g];
      const away = teams[g + 15];
      if (home === undefined || away === undefined) throw new Error('fixture teams out of range');
      sequence += 1;
      games.push({
        gameId: seasonGameIdSchema.parse(`s${String(sequence).padStart(6, '0')}`),
        round,
        homeFranchiseId: franchiseIdSchema.parse(home),
        awayFranchiseId: franchiseIdSchema.parse(away),
      });
    }
  }
  return seasonScheduleSchema.parse({
    schemaVersion: 1,
    scheduleVersion: 'schedule-v1',
    formulaVersion: 'schedule-formula-v1',
    leagueVersion: 'league-v1',
    generationSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    rounds: 82,
    games,
  });
}
export function buildGames(schedule: SeasonSchedule): SeasonGame[] {
  return schedule.games.map((game) => ({
    ...game,
    status: 'scheduled' as const,
    homeScore: null,
    awayScore: null,
    forfeitLoserFranchiseId: null,
  }));
}
export function buildPostseason(seed: string): SeasonRun['postseason'] {
  return buildInitialPostseasonState(seedSchema.parse(seed));
}
export function buildEmptyHealth(): SeasonHealthState {
  return {
    schemaVersion: 1,
    healthVersion: 'season-health-v2',
    injuries: [],
  };
}
export function buildEmptyCampaign() {
  return {
    schemaVersion: 1 as const,
    campaignVersion: SEASON_CAMPAIGN_VERSION as typeof SEASON_CAMPAIGN_VERSION,
    startingIdentity: null,
    startingFocus: null,
    offers: {},
    selections: {},
    evaluations: [],
    branchState: {},
    evolutionOffers: null,
    evolutionSelection: null,
    rewardEntitlements: {
      influenceEarned: 0,
      inquiryCredits: 0,
      informationBenefits: 0,
      followUpUnlocks: [] as string[],
    },
    appliedRewardIds: [] as string[],
  };
}
export function buildEmptyFreeAgency(): SeasonRun['freeAgency'] {
  const franchises = [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west];
  return {
    schemaVersion: 1,
    freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
    windows: [],
    canonicalCandidates: {},
    signingCounts: Object.fromEntries(franchises.map((franchiseId) => [franchiseId, 0])),
    seasonSpend: Object.fromEntries(franchises.map((franchiseId) => [franchiseId, 0])),
  };
}
export function buildEmptyChallenge() {
  return buildEmptyChallengeState();
}
export function buildInitialInfluence(): SeasonInfluenceState {
  const franchises = [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west];
  return {
    schemaVersion: 1,
    influenceVersion: SEASON_INFLUENCE_VERSION,
    balances: Object.fromEntries(franchises.map((franchiseId) => [franchiseId, 2])),
    ledger: franchises.map((franchiseId) => ({
      entryId: idSchema.parse(`influence-initial-${franchiseId}`),
      franchiseId: franchiseIdSchema.parse(franchiseId),
      source: 'initial-grant' as const,
      blockIndex: null,
      commandId: null,
      requestedDelta: 2,
      appliedDelta: 2,
      balanceAfter: 2,
      explanation: 'Initial +2 Influence grant at run creation',
    })),
    windows: {},
    rehabs: {},
  };
}
export function buildRun(): SeasonRun {
  const league = buildLeague();
  const schedule = buildSchedule();
  const rosters = league.teams.map((team, teamIndex) =>
    seasonRosterSchema.parse({
      franchiseId: team.franchiseId,
      players: Array.from({ length: 10 }, (_, slot) => ({
        playerVersionId:
          `pv-${String(teamIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
            3 + 32,
            '0',
          ),
        playerId: `p-synth-${String(teamIndex + 1)}-${String(slot + 1)}`,
        franchiseId: team.franchiseId,
        eraId: '1990s',
        seasonKey: '1995-96',
        displayName: `Synthetic ${String(slot + 1)}`,
      })),
    }),
  );
  const aiAssignments = league.teams.map((team, index) => ({
    franchiseId: team.franchiseId,
    band:
      index < 4
        ? ('contender' as const)
        : index < 12
          ? ('playoff' as const)
          : index < 22
            ? ('average' as const)
            : ('weaker' as const),
    identity:
      index < 5
        ? ('star-chaser' as const)
        : index < 10
          ? ('depth-builder' as const)
          : index < 15
            ? ('defense-first' as const)
            : index < 20
              ? ('shooting-first' as const)
              : index < 25
                ? ('continuity' as const)
                : ('active-trader' as const),
  }));
  return seasonRunSchema.parse({
    schemaVersion: SEASON_RUN_SCHEMA_VERSION,
    runId: 'fixture-run-1',
    rootSeed: SEED,
    versions: {
      runSchemaVersion: SEASON_RUN_SCHEMA_VERSION,
      leagueVersion: 'league-v1',
      scheduleVersion: 'schedule-v1',
      scheduleFormulaVersion: 'schedule-formula-v1',
      standingsVersion: 'standings-v1',
      postseasonVersion: 'postseason-v2',
      seedDerivationVersion: 'season-seeds-v1',
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: 'season-draft-v2',
      rosterRulesVersion: 'season-roster-v2',
      rosterGenerationVersion: 'roster-generation-v2',
      aiVersion: 'season-ai-v2',
      rotationVersion: 'season-rotation-v3',
      minutePolicyVersion: 'minute-policy-v1',
      rotationPlannerVersion: 'rotation-planner-v1',
      gameVersion: 'season-game-v4',
      gameTargetsVersion: 'season-game-targets-v4',
      rosterTargetsVersion: 'roster-targets-v2',
      blockVersion: SEASON_BLOCK_VERSION,
      summaryVersion: 'season-game-summary-v4',
      aggregatesVersion: 'season-aggregates-v3',
      recapVersion: SEASON_RECAP_VERSION,
      leadersVersion: 'season-leaders-v1',
      homeCourtVersion: 'season-home-court-v1',
      checkpointVersion: SEASON_CHECKPOINT_VERSION,
      staminaVersion: 'season-stamina-v1',
      chemistryVersion: 'season-chemistry-v2',
      effectsTargetsVersion: 'season-effect-targets-v1',
      healthVersion: 'season-health-v2',
      tradeVersion: 'season-trade-v4',
      influenceVersion: SEASON_INFLUENCE_VERSION,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      challengeVersion: SEASON_CHALLENGE_VERSION,
      challengeTargetsVersion: SEASON_CHALLENGE_TARGETS_VERSION,
      campaignVersion: SEASON_CAMPAIGN_VERSION,
      campaignTargetsVersion: 'campaign-targets-v1',
      injuryTargetsVersion: 'injury-targets-v2',
      tradeTargetsVersion: 'trade-targets-v3',
      influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
      tiebreakVersion: 'tiebreaker-v1',
      postseasonSummaryVersion: 'postseason-summary-v1',
      awardsVersion: 'awards-v1',
      tradeGradeVersion: 'trade-grade-v1',
      commandLogVersion: SEASON_COMMAND_LOG_VERSION,
      almanacVersion: 'almanac-v2',
      replayExportVersion: SEASON_REPLAY_EXPORT_VERSION,
      postseasonTargetsVersion: 'postseason-targets-v1',
      freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
      freeAgencyIndexVersion: 'free-agency-index-v1',
      freeAgencyTargetsVersion: 'free-agency-targets-v1',
    },
    league,
    authority: {
      kind: 'local-solo',
      soloFranchiseId: league.teams.find((t) => t.control === 'human')?.franchiseId ?? null,
      authorityVersion: 'season-authority-v1',
    },
    rosters,
    ownership: rosters.flatMap((roster) =>
      roster.players.map((player) => ({
        playerVersionId: player.playerVersionId,
        ownerFranchiseId: roster.franchiseId,
      })),
    ),
    schedule: {
      leagueVersion: 'league-v1',
      scheduleVersion: 'schedule-v1',
      formulaVersion: 'schedule-formula-v1',
      generationSeed: SEED,
      contentHash: '0'.repeat(64),
    },
    games: buildGames(schedule),
    standings: {
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
    },
    cursor: { schemaVersion: 1, completedRounds: 0 },
    stage: 'regular-season',
    postseason: buildPostseason(SEED),
    awards: null,
    completion: null,
    draft: {
      draftVersion: 'season-draft-v2',
      participants: [
        {
          participantId: 'p1',
          franchiseId: 'hawks',
          offers: [
            {
              round: 1,
              pickOrdinal: 1,
              seedPath: ['draft', 'offer', 'p1', '1', '1', 'safe-order', 'sample-order'],
              cards: [
                { playerVersionId: `pv-${'1'.repeat(32)}`, selectable: true, coverageReason: null },
                { playerVersionId: `pv-${'2'.repeat(32)}`, selectable: true, coverageReason: null },
                { playerVersionId: `pv-${'3'.repeat(32)}`, selectable: true, coverageReason: null },
                { playerVersionId: `pv-${'4'.repeat(32)}`, selectable: true, coverageReason: null },
                { playerVersionId: `pv-${'5'.repeat(32)}`, selectable: true, coverageReason: null },
                {
                  playerVersionId: `pv-${'6'.repeat(32)}`,
                  selectable: false,
                  coverageReason:
                    'Selecting this version would leave the 4G/4F/3C completion targets unreachable with the remaining picks',
                },
                { playerVersionId: `pv-${'7'.repeat(32)}`, selectable: true, coverageReason: null },
                { playerVersionId: `pv-${'8'.repeat(32)}`, selectable: true, coverageReason: null },
              ],
            },
          ],
          picks: [
            {
              round: 1,
              playerVersionId: `pv-${'1'.repeat(32)}`,
              franchiseId: 'lakers',
              eraId: '1990s',
              seedPath: ['draft', 'offer', 'p1', '1', '1', 'safe-order', 'sample-order'],
            },
          ],
        },
      ],
    },
    aiAssignments,
    aiPools: buildFixtureAiPools(league, aiAssignments),
    rotations: league.teams.map((team, teamIndex) => {
      const players = rosters[teamIndex]?.players;
      if (!players) throw new Error('missing roster');
      const ids = players.map((p) => p.playerVersionId);
      if (ids.length !== 10) throw new Error('roster size');
      return {
        franchiseId: team.franchiseId,
        starters: ids.slice(0, 5),
        benchOrder: ids.slice(5),
        targetMinutes: [
          ...ids.slice(0, 5).map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
          ...ids.slice(5).map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
        ],
        closingFive: ids.slice(0, 5),
        minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
        rotationVersion: 'season-rotation-v3',
      };
    }),
    generationAudit: {
      seed: SEED,
      aiVersion: 'season-ai-v2',
      rosterGenerationVersion: 'roster-generation-v2',
      rotationVersion: 'season-rotation-v3',
      minutePolicyVersion: 'minute-policy-v1',
      rosterTargetsVersion: 'roster-targets-v2',
      digest: '0'.repeat(32),
      diagnostics: {
        seed: SEED,
        aiVersion: 'season-ai-v2',
        rosterGenerationVersion: 'roster-generation-v2',
        teamsGenerated: 29,
        teamsRepaired: 0,
        backtracks: 0,
        nodesVisited: 29,
        nodeBudget: 100000,
        failedTeams: [],
        unmetConstraints: [],
      },
    },
    evaluations: league.teams.map((team, index) => ({
      franchiseId: team.franchiseId,
      band:
        index < 4
          ? ('contender' as const)
          : index < 12
            ? ('playoff' as const)
            : index < 22
              ? ('average' as const)
              : ('weaker' as const),
      identity:
        index < 5
          ? ('star-chaser' as const)
          : index < 10
            ? ('depth-builder' as const)
            : index < 15
              ? ('defense-first' as const)
              : index < 20
                ? ('shooting-first' as const)
                : index < 25
                  ? ('continuity' as const)
                  : ('active-trader' as const),
      strengthScore: 60,
      roleScores: {
        'primary-creation': 60,
        'secondary-creation': 60,
        'perimeter-shooting': 60,
        'rim-finishing-interior-scoring': 60,
        'perimeter-defense': 60,
        'interior-defense': 60,
        'offensive-rebounding': 60,
        'defensive-rebounding': 60,
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
      overallReport: 80,
    })),
    health: buildEmptyHealth(),
    transactions: [],
    influence: buildInitialInfluence(),
    trade: null,
    freeAgency: buildEmptyFreeAgency(),
    objectives: {
      schemaVersion: 1,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      catalog: [...SEASON_OBJECTIVE_CATALOG],
      selections: {},
    },
    challenges: buildEmptyChallenge(),
    campaign: buildEmptyCampaign(),
    checkpointState: null,
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
  });
}
function buildFixtureAiPools(
  league: SeasonLeague,
  aiAssignments: SeasonRun['aiAssignments'],
): SeasonRun['aiPools'] {
  return aiAssignments
    .filter((assignment) => assignment.franchiseId !== league.teams[0]?.franchiseId)
    .map((assignment, poolIndex) => {
      const playerVersionIds = Array.from({ length: 20 }, (_, slot) => {
        const hex = `${String(poolIndex).padStart(2, '0')}${String(slot).padStart(2, '0')}`.padEnd(
          32,
          '0',
        );
        return `pv-${hex}`;
      });
      const anchor = playerVersionIds[0];
      if (anchor === undefined) throw new Error('fixture pool too small');
      const selections = playerVersionIds.slice(0, 10);
      const seedPath = (slot: number) => ['ai', 'selection', assignment.franchiseId, String(slot)];
      return {
        franchiseId: assignment.franchiseId,
        band: assignment.band,
        identity: assignment.identity,
        playerVersionIds,
        anchors: [
          {
            playerVersionId: anchor,
            qualifyingRole: 'primary-creation' as const,
            percentileTier: 'elite' as const,
            roleScore: 92,
            percentileThreshold: 88,
            seedPath: ['ai', 'anchors', assignment.franchiseId, '0'],
          },
        ],
        selections,
        allocationSeedPaths: selections.map((_version, slot) => seedPath(slot)),
        repairCount: 0,
      };
    });
}
export function fixturePlayerId(index: number): string {
  return `pv-${String(index).padStart(32, '0')}`;
}
export function buildEffectsStateFixture(): SeasonEffectsState {
  const playerStates: SeasonPlayerLoadState[] = Array.from({ length: 300 }, (_, index) => ({
    playerVersionId: fixturePlayerId(index),
    fatigueBasisPoints: 0,
    recentLoadBasisPoints: 0,
    lastCompletedRound: 0,
  }));
  const pairStates: SeasonPairChemistryState[] = [];
  for (let roster = 0; roster < 30; roster += 1) {
    for (let a = 0; a < 10; a += 1) {
      for (let b = a + 1; b < 10; b += 1) {
        pairStates.push({
          a: fixturePlayerId(roster * 10 + a),
          b: fixturePlayerId(roster * 10 + b),
          sharedPossessions: 0,
        });
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
export function buildFixturePlayerLine(
  playerVersionId: string,
): SeasonGameSummary['homePlayers'][number] {
  return {
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
  };
}
export function buildFixtureTeamBox(franchiseId: string): SeasonGameSummary['homeBox'] {
  return {
    franchiseId: franchiseIdSchema.parse(franchiseId),
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
  };
}
export function buildSummaryFixture(): SeasonGameSummary {
  return seasonGameSummarySchema.parse({
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v4',
    gameId: 's000001',
    round: 1,
    homeFranchiseId: 'lakers',
    awayFranchiseId: 'celtics',
    status: 'final',
    overtimePeriods: 0,
    homeScore: 0,
    awayScore: 0,
    forfeitLoserFranchiseId: null,
    homeBox: buildFixtureTeamBox('lakers'),
    awayBox: buildFixtureTeamBox('celtics'),
    homePlayers: Array.from({ length: 10 }, (_, index) =>
      buildFixturePlayerLine(fixturePlayerId(index)),
    ),
    awayPlayers: Array.from({ length: 10 }, (_, index) =>
      buildFixturePlayerLine(fixturePlayerId(10 + index)),
    ),
    injuryEvents: [],
  });
}
function buildTeamAggregateRows(): SeasonTeamAggregate[] {
  return [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west].map((franchiseId) => ({
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
  }));
}
function buildPlayerAggregateRows(): SeasonPlayerAggregate[] {
  return Array.from({ length: 300 }, (_, index) => ({
    playerVersionId: fixturePlayerId(index),
    franchiseId: franchiseIdSchema.parse('lakers'),
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
  }));
}
function buildRecapFixture(run: SeasonRun): SeasonCandidateCheckpoint['recap'] {
  return {
    schemaVersion: 1,
    recapVersion: SEASON_RECAP_VERSION,
    runId: run.runId,
    blockIndex: 0,
    completedRounds: 0,
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
    campaignEvidence: null,
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
export function buildCheckpointFixture(): SeasonCandidateCheckpoint {
  const run = buildRun();
  return {
    schemaVersion: 1,
    checkpointVersion: SEASON_CHECKPOINT_VERSION,
    runId: run.runId,
    rootSeed: run.rootSeed,
    versions: {
      blockVersion: SEASON_BLOCK_VERSION,
      summaryVersion: 'season-game-summary-v4',
      aggregatesVersion: 'season-aggregates-v3',
      recapVersion: SEASON_RECAP_VERSION,
      leadersVersion: 'season-leaders-v1',
      homeCourtVersion: 'season-home-court-v1',
      gameVersion: 'season-game-v4',
      gameTargetsVersion: 'season-game-targets-v4',
      seedDerivationVersion: 'season-seeds-v1',
      staminaVersion: 'season-stamina-v1',
      chemistryVersion: 'season-chemistry-v2',
      effectsTargetsVersion: 'season-effect-targets-v1',
      healthVersion: 'season-health-v2',
      tradeVersion: 'season-trade-v4',
      influenceVersion: SEASON_INFLUENCE_VERSION,
      objectiveVersion: SEASON_OBJECTIVE_VERSION,
      challengeVersion: SEASON_CHALLENGE_VERSION,
      challengeTargetsVersion: SEASON_CHALLENGE_TARGETS_VERSION,
      campaignVersion: SEASON_CAMPAIGN_VERSION,
      campaignTargetsVersion: 'campaign-targets-v1',
      injuryTargetsVersion: 'injury-targets-v2',
      tradeTargetsVersion: 'trade-targets-v3',
      influenceTargetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
      freeAgencyVersion: SEASON_FREE_AGENCY_VERSION,
      freeAgencyIndexVersion: 'free-agency-index-v1',
      freeAgencyTargetsVersion: 'free-agency-targets-v1',
    },
    blockIndex: 0,
    completedRounds: 0,
    revision: 0,
    rotationDigest: '0'.repeat(32),
    standings: run.standings,
    teamAggregates: buildTeamAggregateRows(),
    playerAggregates: buildPlayerAggregateRows(),
    gameSummaries: [buildSummaryFixture()],
    retainedDetails: [],
    recap: buildRecapFixture(run),
    effects: buildEffectsStateFixture(),
    health: buildEmptyHealth(),
    influence: buildInitialInfluence(),
    freeAgency: buildEmptyFreeAgency(),
    transactions: [],
    challengeIds: ['protect-glass', 'take-care', 'winning-block'] as const,
    challenges: {
      blockIndex: 0,
      results: [
        {
          challengeId: 'protect-glass',
          blockIndex: 0,
          success: false,
          facts: {
            games: 0,
            wins: 0,
            threePointersMade: 0,
            threePointersAttempted: 0,
            threePointPct: null,
            reboundMargin: 0,
            turnovers: 0,
            turnoversPerGame: null,
            beatLeader: null,
            beatHigher: null,
            sweptBlock: false,
          },
        },
        {
          challengeId: 'take-care',
          blockIndex: 0,
          success: false,
          facts: {
            games: 0,
            wins: 0,
            threePointersMade: 0,
            threePointersAttempted: 0,
            threePointPct: null,
            reboundMargin: 0,
            turnovers: 0,
            turnoversPerGame: null,
            beatLeader: null,
            beatHigher: null,
            sweptBlock: false,
          },
        },
        {
          challengeId: 'winning-block',
          blockIndex: 0,
          success: false,
          facts: {
            games: 0,
            wins: 0,
            threePointersMade: 0,
            threePointersAttempted: 0,
            threePointPct: null,
            reboundMargin: 0,
            turnovers: 0,
            turnoversPerGame: null,
            beatLeader: null,
            beatHigher: null,
            sweptBlock: false,
          },
        },
      ],
    },
    campaign: {
      opportunityId: null,
      outcome: null,
      evaluation: null,
    },
    expectedStateRevision: 0,
    expectedStateDigest: '0'.repeat(32),
    stateRevision: 0,
    stateDigest: '0'.repeat(32),
    digest: '0'.repeat(32),
  };
}
export function buildPendingBlockFixture(): SeasonPendingBlockCandidate {
  const run = buildRun();
  return {
    schemaVersion: 1,
    blockVersion: SEASON_BLOCK_VERSION,
    runId: run.runId,
    commandId: commandIdSchema.parse('submit-b0'),
    blockIndex: 0,
    expectedRevision: 0,
    expectedStateRevision: 0,
    expectedStateDigest: '0'.repeat(32),
    objectiveId: null,
    campaignOpportunityId: null,
    nextGameId: seasonGameIdSchema.parse('s000001'),
    summaries: [],
    retainedDetails: [],
    effects: buildEffectsStateFixture(),
    health: buildEmptyHealth(),
    standings: run.standings,
    teamAggregates: [],
    playerAggregates: [],
    rotationDigest: '0'.repeat(32),
  };
}
export const SIMULATION_RATINGS: SeasonGamePlayerInput['ratings'] = {
  insideScoring: 78,
  closeShot: 70,
  midrange: 68,
  threePoint: 65,
  freeThrow: 74,
  ballHandling: 70,
  passing: 70,
  offensiveIq: 70,
  offensiveRebound: 60,
  defensiveRebound: 65,
  perimeterDefense: 62,
  interiorDefense: 62,
  steal: 60,
  block: 60,
  defensiveIq: 62,
  speed: 70,
  strength: 65,
  vertical: 66,
};
export const SIMULATION_TENDENCIES: SeasonGamePlayerInput['tendencies'] = {
  usageRate: 20,
  passRate: 30,
  shotRate: 25,
  driveRate: 18,
  postUpRate: 5,
  rimFrequency: 30,
  shortMidFrequency: 20,
  longMidFrequency: 14,
  cornerThreeFrequency: 8,
  aboveBreakThreeFrequency: 12,
  threePointRate: 20,
  freeThrowRate: 22,
  turnoverRate: 12,
  isolationRate: 10,
  pickAndRollBallHandlerRate: 25,
  pickAndRollRollManRate: 10,
  spotUpRate: 20,
  transitionRate: 15,
  cutRate: 10,
  foulRate: 2,
  stealAttemptRate: 8,
  blockAttemptRate: 10,
  crashOffensiveGlassRate: 12,
};
