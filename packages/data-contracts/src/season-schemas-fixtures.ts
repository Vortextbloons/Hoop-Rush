import type {
  SeasonGame,
  SeasonGamePlayerInput,
  SeasonLeague,
  SeasonPostseasonState,
  SeasonRun,
  SeasonSchedule,
} from './index.ts';

/**
 * Self-contained Season Run contract fixtures shared by the data-contracts
 * schema tests. Kept in a plain module (not a test file) so multiple test
 * files reuse the builders without re-executing describe blocks.
 */

export const CONFERENCE_TEAMS: Record<'east' | 'west', string[]> = {
  east: [
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
  ],
  west: [
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
  ],
};

export const DIVISION_OF: Record<string, string> = {
  hawks: 'southeast',
  celtics: 'atlantic',
  nets: 'atlantic',
  hornets: 'southeast',
  bulls: 'central',
  cavaliers: 'central',
  pistons: 'central',
  pacers: 'central',
  heat: 'southeast',
  bucks: 'central',
  knicks: 'atlantic',
  magic: 'southeast',
  sixers: 'atlantic',
  raptors: 'atlantic',
  wizards: 'southeast',
  mavericks: 'southwest',
  nuggets: 'northwest',
  warriors: 'pacific',
  rockets: 'southwest',
  clippers: 'pacific',
  lakers: 'pacific',
  grizzlies: 'southwest',
  timberwolves: 'northwest',
  pelicans: 'southwest',
  thunder: 'northwest',
  suns: 'pacific',
  blazers: 'northwest',
  kings: 'pacific',
  spurs: 'southwest',
  jazz: 'northwest',
};

export const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

export function buildLeague(): SeasonLeague {
  return {
    schemaVersion: 1,
    leagueVersion: 'league-v1',
    teams: [...CONFERENCE_TEAMS.east, ...CONFERENCE_TEAMS.west].map((franchiseId, index) => ({
      franchiseId,
      control: index === 0 ? ('human' as const) : ('ai' as const),
      conference: index < 15 ? ('east' as const) : ('west' as const),
      division: DIVISION_OF[franchiseId] as SeasonLeague['teams'][number]['division'],
    })),
  };
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
        gameId: `s${String(sequence).padStart(6, '0')}`,
        round,
        homeFranchiseId: home,
        awayFranchiseId: away,
      });
    }
  }
  return {
    schemaVersion: 1,
    scheduleVersion: 'schedule-v1',
    formulaVersion: 'schedule-formula-v1',
    leagueVersion: 'league-v1',
    generationSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    rounds: 82,
    games,
  };
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

export function buildPostseason(seed: string): SeasonPostseasonState {
  const conferenceState = (conference: 'east' | 'west') => ({
    conference,
    ranking: null,
    games: {
      sevenEight: {
        gameId: 'seven-eight' as const,
        status: 'scheduled' as const,
        homeFranchiseId: null,
        awayFranchiseId: null,
        winnerFranchiseId: null,
        loserFranchiseId: null,
        homeScore: null,
        awayScore: null,
      },
      nineTen: {
        gameId: 'nine-ten' as const,
        status: 'scheduled' as const,
        homeFranchiseId: null,
        awayFranchiseId: null,
        winnerFranchiseId: null,
        loserFranchiseId: null,
        homeScore: null,
        awayScore: null,
      },
      final: {
        gameId: 'final' as const,
        status: 'scheduled' as const,
        homeFranchiseId: null,
        awayFranchiseId: null,
        winnerFranchiseId: null,
        loserFranchiseId: null,
        homeScore: null,
        awayScore: null,
      },
    },
    playoffSeeds: null,
  });
  return {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v1',
    seed,
    playIn: { east: conferenceState('east'), west: conferenceState('west') },
    bracket: null,
    championFranchiseId: null,
  };
}

export function buildRun(): SeasonRun {
  const league = buildLeague();
  const schedule = buildSchedule();
  const rosters = league.teams.map((team, teamIndex) => ({
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
  }));
  return {
    schemaVersion: 5,
    runId: 'fixture-run-1',
    rootSeed: SEED,
    versions: {
      runSchemaVersion: 5,
      leagueVersion: 'league-v1',
      scheduleVersion: 'schedule-v1',
      scheduleFormulaVersion: 'schedule-formula-v1',
      standingsVersion: 'standings-v1',
      postseasonVersion: 'postseason-v1',
      seedDerivationVersion: 'season-seeds-v1',
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: 'season-draft-v2',
      rosterRulesVersion: 'season-roster-v1',
      rosterGenerationVersion: 'roster-generation-v1',
      aiVersion: 'season-ai-v1',
      rotationVersion: 'season-rotation-v2',
      rotationPlannerVersion: 'rotation-planner-v1',
      gameVersion: 'season-game-v3',
      gameTargetsVersion: 'season-game-targets-v3',
      rosterTargetsVersion: 'roster-targets-v1',
      blockVersion: 'season-block-v2',
      summaryVersion: 'season-game-summary-v2',
      aggregatesVersion: 'season-aggregates-v1',
      recapVersion: 'season-recap-v2',
      leadersVersion: 'season-leaders-v1',
      homeCourtVersion: 'season-home-court-v1',
      checkpointVersion: 'season-checkpoint-v2',
      staminaVersion: 'season-stamina-v1',
      chemistryVersion: 'season-chemistry-v1',
      effectsTargetsVersion: 'season-effect-targets-v1',
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
    postseason: buildPostseason(SEED),
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
    aiAssignments: league.teams.map((team, index) => ({
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
    })),
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
        rotationVersion: 'season-rotation-v2',
      };
    }),
    generationAudit: {
      seed: SEED,
      aiVersion: 'season-ai-v1',
      rosterGenerationVersion: 'roster-generation-v1',
      rotationVersion: 'season-rotation-v2',
      rosterTargetsVersion: 'roster-targets-v1',
      digest: '0'.repeat(32),
      diagnostics: {
        seed: SEED,
        aiVersion: 'season-ai-v1',
        rosterGenerationVersion: 'roster-generation-v1',
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
  };
}

/** Minimal valid simulation ratings (matches `simulationRatingsSchema`). */
export const SIMULATION_RATINGS: SeasonGamePlayerInput['ratings'] = {
  insideScoring: 70,
  closeShot: 68,
  midrange: 66,
  threePoint: 62,
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

/** Minimal valid simulation tendencies (matches `simulationTendenciesSchema`). */
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
