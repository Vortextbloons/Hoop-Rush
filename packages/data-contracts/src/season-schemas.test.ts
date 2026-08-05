import { describe, expect, it } from 'vitest';
import {
  seasonCursorSchema,
  seasonGameSchema,
  seasonLeagueSchema,
  seasonPostseasonStateSchema,
  playoffSeriesSchema,
  seasonRunSchema,
  seasonScheduleSchema,
  seasonStandingsSchema,
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonDraftCommandSchema,
  seasonDraftCommandRecordSchema,
  seasonRotationSchema,
  seasonAiAssignmentSchema,
  seasonGenerationDiagnosticsSchema,
  seasonLeagueGenerationResultSchema,
  seasonRosterTargetsSchema,
  seasonDraftRejectedRecordSchema,
  type SeasonGame,
  type SeasonLeague,
  type SeasonPostseasonState,
  type SeasonRun,
  type SeasonSchedule,
} from './index.ts';

/**
 * Season Run contract tests (M2.0): every runtime schema round-trips valid
 * state and rejects wrong versions, invalid team counts, duplicate
 * ownership, malformed rosters, invalid cursors, and corrupt postseason
 * states. Fixtures here are self-contained so the contract layer stays
 * dependency-free.
 */

const CONFERENCE_TEAMS: Record<'east' | 'west', string[]> = {
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

const DIVISION_OF: Record<string, string> = {
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

function buildLeague(): SeasonLeague {
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

function buildSchedule(): SeasonSchedule {
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

function buildGames(schedule: SeasonSchedule): SeasonGame[] {
  return schedule.games.map((game) => ({
    ...game,
    status: 'scheduled' as const,
    homeScore: null,
    awayScore: null,
    forfeitLoserFranchiseId: null,
  }));
}

function buildPostseason(seed: string): SeasonPostseasonState {
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

const SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

function buildRun(): SeasonRun {
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
    schemaVersion: 3,
    runId: 'fixture-run-1',
    rootSeed: SEED,
    versions: {
      runSchemaVersion: 3,
      leagueVersion: 'league-v1',
      scheduleVersion: 'schedule-v1',
      scheduleFormulaVersion: 'schedule-formula-v1',
      standingsVersion: 'standings-v1',
      postseasonVersion: 'postseason-v1',
      seedDerivationVersion: 'season-seeds-v1',
      playerVersionIdVersion: 'player-version-id-v1',
      draftVersion: 'season-draft-v1',
      rosterRulesVersion: 'season-roster-v1',
      rosterGenerationVersion: 'roster-generation-v1',
      aiVersion: 'season-ai-v1',
      rotationVersion: 'season-rotation-v2',
      rotationPlannerVersion: 'rotation-planner-v1',
      gameVersion: 'season-game-v1',
      gameTargetsVersion: 'season-game-targets-v1',
      rosterTargetsVersion: 'roster-targets-v1',
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
      draftVersion: 'season-draft-v1',
      participants: [
        {
          participantId: 'p1',
          franchiseId: 'hawks',
          rolls: [{ franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: true }],
          claims: [{ franchiseId: 'lakers', eraId: '1990s' }],
          picks: [
            {
              round: 1,
              playerVersionId: `pv-${'0'.repeat(32)}`,
              franchiseId: 'lakers',
              eraId: '1990s',
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

function roundTrip<T>(schema: { parse: (input: unknown) => T }, value: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

describe('season league schema', () => {
  it('round-trips a valid league', () => {
    const league = roundTrip(seasonLeagueSchema, buildLeague());
    expect(league.teams).toHaveLength(30);
    expect(league.teams.filter((t) => t.conference === 'east')).toHaveLength(15);
    expect(league.teams.filter((t) => t.conference === 'west')).toHaveLength(15);
    for (const division of [
      'atlantic',
      'central',
      'southeast',
      'northwest',
      'pacific',
      'southwest',
    ]) {
      expect(league.teams.filter((t) => t.division === division)).toHaveLength(5);
    }
    expect(league.teams[0]?.control).toBe('human');
  });

  it('rejects a wrong league version', () => {
    expect(() =>
      seasonLeagueSchema.parse({ ...buildLeague(), leagueVersion: 'league-v2' }),
    ).toThrow();
  });

  it('rejects a wrong schema version', () => {
    expect(() => seasonLeagueSchema.parse({ ...buildLeague(), schemaVersion: 2 })).toThrow();
  });

  it('rejects invalid team counts', () => {
    const league = buildLeague();
    expect(() =>
      seasonLeagueSchema.parse({ ...league, teams: league.teams.slice(0, 29) }),
    ).toThrow();
    const duplicated = [...league.teams, { ...league.teams[0], franchiseId: 'extra' }];
    expect(() => seasonLeagueSchema.parse({ ...league, teams: duplicated })).toThrow();
  });

  it('rejects an unknown franchise id and division', () => {
    const league = buildLeague();
    const bad = {
      ...league,
      teams: league.teams.map((t, i) => (i === 0 ? { ...t, franchiseId: 'Expansion' } : t)),
    };
    expect(() => seasonLeagueSchema.parse(bad)).toThrow();
    expect(() =>
      seasonLeagueSchema.parse({
        ...league,
        teams: league.teams.map((t, i) => (i === 0 ? { ...t, division: 'north' } : t)),
      }),
    ).toThrow();
  });
});

describe('season schedule schema', () => {
  it('round-trips the full schedule artifact', () => {
    const schedule = roundTrip(seasonScheduleSchema, buildSchedule());
    expect(schedule.games).toHaveLength(1230);
    expect(schedule.rounds).toBe(82);
    expect(schedule.games[0]?.gameId).toBe('s000001');
  });

  it('rejects wrong versions and wrong counts', () => {
    const schedule = buildSchedule();
    expect(() =>
      seasonScheduleSchema.parse({ ...schedule, scheduleVersion: 'schedule-v9' }),
    ).toThrow();
    expect(() => seasonScheduleSchema.parse({ ...schedule, formulaVersion: 'old' })).toThrow();
    expect(() => seasonScheduleSchema.parse({ ...schedule, leagueVersion: 'league-v2' })).toThrow();
    expect(() => seasonScheduleSchema.parse({ ...schedule, rounds: 81 })).toThrow();
    expect(() =>
      seasonScheduleSchema.parse({ ...schedule, games: schedule.games.slice(0, 1229) }),
    ).toThrow();
  });

  it('rejects malformed game records', () => {
    const schedule = buildSchedule();
    const games = [...schedule.games];
    const first = games[0];
    if (!first) throw new Error('no games');
    games[0] = {
      ...first,
      homeFranchiseId: first.awayFranchiseId,
      awayFranchiseId: first.homeFranchiseId,
    };
    expect(() => seasonScheduleSchema.parse({ ...schedule, games })).not.toThrow();
    games[0] = { ...first, round: 83 };
    expect(() => seasonScheduleSchema.parse({ ...schedule, games })).toThrow();
    games[0] = { ...first, gameId: 's-00001' };
    expect(() => seasonScheduleSchema.parse({ ...schedule, games })).toThrow();
  });
});

describe('season game schema', () => {
  it('round-trips scheduled, final, and forfeit games', () => {
    const scheduled = roundTrip(seasonGameSchema, {
      gameId: 's000001',
      round: 1,
      homeFranchiseId: 'lakers',
      awayFranchiseId: 'celtics',
      status: 'scheduled',
      homeScore: null,
      awayScore: null,
      forfeitLoserFranchiseId: null,
    });
    expect(scheduled.status).toBe('scheduled');
    const final = roundTrip(seasonGameSchema, {
      ...scheduled,
      status: 'final',
      homeScore: 104,
      awayScore: 99,
    });
    expect(final.homeScore).toBe(104);
    const forfeit = {
      ...scheduled,
      status: 'forfeit' as const,
      forfeitLoserFranchiseId: 'celtics',
    };
    expect(forfeit.forfeitLoserFranchiseId).toBe('celtics');
    const roundTrippedForfeit = roundTrip(seasonGameSchema, forfeit);
    expect(roundTrippedForfeit.status).toBe('forfeit');
  });

  it('rejects corrupt game states', () => {
    const base = {
      gameId: 's000001',
      round: 1,
      homeFranchiseId: 'lakers',
      awayFranchiseId: 'celtics',
      status: 'final' as const,
      homeScore: 104,
      awayScore: 99,
      forfeitLoserFranchiseId: null,
    };
    expect(() => seasonGameSchema.parse({ ...base, status: 'overtime' })).toThrow();
    expect(() => seasonGameSchema.parse({ ...base, homeScore: -1 })).toThrow();
    expect(() => seasonGameSchema.parse({ ...base, awayScore: null })).toThrow();
    // A forfeit without a named loser, or carrying scores, is corrupt.
    expect(() => seasonGameSchema.parse({ ...base, status: 'forfeit' })).toThrow();
    const forfeit = { ...base, status: 'forfeit' as const, homeScore: null, awayScore: null };
    expect(() => seasonGameSchema.parse(forfeit)).toThrow();
    expect(() =>
      seasonGameSchema.parse({ ...forfeit, forfeitLoserFranchiseId: 'celtics' }),
    ).not.toThrow();
    // The forfeit loser must be one of the two teams.
    expect(() =>
      seasonGameSchema.parse({ ...forfeit, forfeitLoserFranchiseId: 'bulls' }),
    ).toThrow();
    // A scheduled game carrying any result is corrupt.
    expect(() =>
      seasonGameSchema.parse({ ...base, status: 'scheduled', homeScore: null, awayScore: null }),
    ).not.toThrow();
    expect(() => seasonGameSchema.parse({ ...base, status: 'scheduled', homeScore: 5 })).toThrow();
  });
});

describe('season standings schema', () => {
  it('round-trips a standings table', () => {
    const run = buildRun();
    const standings = roundTrip(seasonStandingsSchema, run.standings);
    expect(standings.rows).toHaveLength(30);
    expect(standings.rows[0]?.headToHead).toHaveLength(29);
  });

  it('rejects wrong versions and team counts', () => {
    const run = buildRun();
    const standings = run.standings;
    expect(() =>
      seasonStandingsSchema.parse({ ...standings, standingsVersion: 'standings-v2' }),
    ).toThrow();
    expect(() =>
      seasonStandingsSchema.parse({ ...standings, rows: standings.rows.slice(0, 29) }),
    ).toThrow();
  });

  it('carries accounting invariants as domain facts, not schema rules', () => {
    // The schema validates shape; reconciling wins/losses with game records
    // is the standings audit's job (engine season/standings tests).
    const run = buildRun();
    const standings = run.standings;
    const rows = standings.rows.map((row, index) =>
      index === 0 ? { ...row, wins: 5, losses: 2, gamesPlayed: 6 } : row,
    );
    expect(() => seasonStandingsSchema.parse({ ...standings, rows })).not.toThrow();
  });
});

describe('season cursor schema', () => {
  it('round-trips every cursor position', () => {
    for (const completedRounds of [0, 1, 10, 80, 81, 82]) {
      const cursor = roundTrip(seasonCursorSchema, { schemaVersion: 1, completedRounds });
      expect(cursor.completedRounds).toBe(completedRounds);
    }
  });

  it('rejects invalid cursors', () => {
    expect(() => seasonCursorSchema.parse({ schemaVersion: 1, completedRounds: -1 })).toThrow();
    expect(() => seasonCursorSchema.parse({ schemaVersion: 1, completedRounds: 83 })).toThrow();
    expect(() => seasonCursorSchema.parse({ schemaVersion: 2, completedRounds: 0 })).toThrow();
  });
});

describe('season postseason schema', () => {
  it('round-trips an empty postseason state', () => {
    const state = roundTrip(seasonPostseasonStateSchema, buildPostseason(SEED));
    expect(state.bracket).toBeNull();
    expect(state.playIn.east.playoffSeeds).toBeNull();
    expect(state.playIn.west.ranking).toBeNull();
  });

  it('rejects corrupt play-in states', () => {
    const state = buildPostseason(SEED);
    const bad = {
      ...state,
      playIn: {
        ...state.playIn,
        east: {
          ...state.playIn.east,
          ranking: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        },
      },
    };
    expect(() => seasonPostseasonStateSchema.parse(bad)).toThrow();
    // A final play-in game whose winner is not a participant is corrupt.
    const winnerNotInGame = {
      ...state,
      playIn: {
        ...state.playIn,
        east: {
          ...state.playIn.east,
          ranking: Array.from({ length: 10 }, (_, i) => `team-${String(i + 1)}`),
          games: {
            sevenEight: {
              gameId: 'seven-eight',
              status: 'final',
              homeFranchiseId: 'team-7',
              awayFranchiseId: 'team-8',
              winnerFranchiseId: 'team-99',
              loserFranchiseId: 'team-8',
              homeScore: 100,
              awayScore: 90,
            },
            nineTen: {
              gameId: 'nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'final',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
          },
        },
      },
    };
    expect(() => seasonPostseasonStateSchema.parse(winnerNotInGame)).toThrow();
    // A final play-in game naming only participating teams is valid.
    const winnerParticipates = {
      ...winnerNotInGame,
      playIn: {
        ...winnerNotInGame.playIn,
        east: {
          ...winnerNotInGame.playIn.east,
          games: {
            sevenEight: {
              gameId: 'seven-eight',
              status: 'final',
              homeFranchiseId: 'team-7',
              awayFranchiseId: 'team-8',
              winnerFranchiseId: 'team-7',
              loserFranchiseId: 'team-8',
              homeScore: 100,
              awayScore: 90,
            },
            nineTen: {
              gameId: 'nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'final',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
          },
        },
      },
    };
    expect(() => seasonPostseasonStateSchema.parse(winnerParticipates)).not.toThrow();
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...state,
        playIn: {
          ...state.playIn,
          east: { ...state.playIn.east, playoffSeeds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
        },
      }),
    ).toThrow();
  });

  it('rejects a wrong postseason version', () => {
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...buildPostseason(SEED),
        postseasonVersion: 'postseason-v2',
      }),
    ).toThrow();
  });

  it('round-trips unpaired and paired playoff series slots', () => {
    const pending = {
      seriesId: 'east-semifinal-1',
      round: 'conference-semifinal' as const,
      conference: 'east' as const,
      higherSeed: null,
      lowerSeed: null,
      homeCourtFranchiseId: null,
      challengerFranchiseId: null,
      homeCourtWins: 0,
      challengerWins: 0,
      games: [],
      winnerFranchiseId: null,
    };
    expect(playoffSeriesSchema.safeParse(pending).success).toBe(true);
    const paired = {
      seriesId: 'east-first-round-1',
      round: 'first-round' as const,
      conference: 'east' as const,
      higherSeed: 1,
      lowerSeed: 8,
      homeCourtFranchiseId: 'team-1',
      challengerFranchiseId: 'team-8',
      homeCourtWins: 3,
      challengerWins: 2,
      games: [
        {
          gameNumber: 1,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 100,
          awayScore: 90,
          winnerFranchiseId: 'team-1',
        },
        {
          gameNumber: 2,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 110,
          awayScore: 95,
          winnerFranchiseId: 'team-1',
        },
        {
          gameNumber: 3,
          homeFranchiseId: 'team-8',
          awayFranchiseId: 'team-1',
          status: 'final',
          homeScore: 99,
          awayScore: 101,
          winnerFranchiseId: 'team-1',
        },
        {
          gameNumber: 4,
          homeFranchiseId: 'team-8',
          awayFranchiseId: 'team-1',
          status: 'final',
          homeScore: 102,
          awayScore: 100,
          winnerFranchiseId: 'team-8',
        },
        {
          gameNumber: 5,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 105,
          awayScore: 98,
          winnerFranchiseId: 'team-1',
        },
      ],
      winnerFranchiseId: null,
    };
    expect(playoffSeriesSchema.safeParse(paired).success).toBe(true);
  });

  it('rejects corrupt playoff series records', () => {
    const base = {
      seriesId: 'east-first-round-1',
      round: 'first-round' as const,
      conference: 'east' as const,
      higherSeed: 1,
      lowerSeed: 8,
      homeCourtFranchiseId: 'team-1',
      challengerFranchiseId: 'team-8',
      homeCourtWins: 0,
      challengerWins: 0,
      games: [],
      winnerFranchiseId: null,
    };
    const schema = playoffSeriesSchema;
    // A started series must name both teams.
    expect(
      schema.safeParse({
        ...base,
        games: [
          {
            gameNumber: 1,
            homeFranchiseId: 'team-1',
            awayFranchiseId: 'team-8',
            status: 'final',
            homeScore: 100,
            awayScore: 90,
            winnerFranchiseId: 'team-1',
          },
        ],
        homeCourtWins: 1,
        homeCourtFranchiseId: null,
      }).success,
    ).toBe(false);
    // A winner requires four wins.
    expect(schema.safeParse({ ...base, winnerFranchiseId: 'team-1' }).success).toBe(false);
    // A seven-game series must name a winner.
    expect(
      schema.safeParse({
        ...base,
        games: Array.from({ length: 7 }, (_, i) => ({
          gameNumber: i + 1,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 100,
          awayScore: 90,
          winnerFranchiseId: 'team-1',
        })),
        homeCourtWins: 4,
        challengerWins: 3,
      }).success,
    ).toBe(false);
    // Wins must equal played games.
    expect(schema.safeParse({ ...base, homeCourtWins: 2 }).success).toBe(false);
  });
});

describe('season run schema', () => {
  it('round-trips a complete snapshot', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.rosters).toHaveLength(30);
    expect(run.ownership).toHaveLength(300);
    expect(run.games).toHaveLength(1230);
  });

  it('rejects duplicate ownership rows', () => {
    const run = buildRun();
    const duplicated = [...run.ownership];
    const first = duplicated[0];
    if (!first) throw new Error('no ownership rows');
    duplicated.push({ ...first });
    expect(() => seasonRunSchema.parse({ ...run, ownership: duplicated })).toThrow();
  });

  it('rejects malformed rosters', () => {
    const run = buildRun();
    const rosters = run.rosters.map((roster, index) =>
      index === 0 ? { ...roster, players: roster.players.slice(0, 9) } : roster,
    );
    expect(() => seasonRunSchema.parse({ ...run, rosters })).toThrow();
  });

  it('rejects a roster entry with an undecodable playerVersionId', () => {
    const run = buildRun();
    const rosters = run.rosters.map((roster, index) =>
      index === 0
        ? {
            ...roster,
            players: roster.players.map((player, slot) =>
              slot === 0 ? { ...player, playerVersionId: 'pv-nothex' } : player,
            ),
          }
        : roster,
    );
    expect(() => seasonRunSchema.parse({ ...run, rosters })).toThrow();
  });

  it('rejects mismatched version boundaries', () => {
    const run = buildRun();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, seedDerivationVersion: 'season-seeds-v9' },
      }),
    ).toThrow();
  });

  it('rejects an invalid cursor and wrong game count', () => {
    const run = buildRun();
    expect(() =>
      seasonRunSchema.parse({ ...run, cursor: { schemaVersion: 1, completedRounds: 99 } }),
    ).toThrow();
    expect(() => seasonRunSchema.parse({ ...run, games: run.games.slice(0, 100) })).toThrow();
  });
});

describe('player version identity', () => {
  it('is deterministic and field-sensitive', async () => {
    const mod = await import('./index.ts');
    const { playerVersionId } = mod;
    const a = playerVersionId('p-1', 'lakers', '1990s', '1996-97');
    const b = playerVersionId('p-1', 'lakers', '1990s', '1996-97');
    expect(a).toBe(b);
    expect(a).toMatch(/^pv-[0-9a-f]{32}$/);
    expect(playerVersionId('p-2', 'lakers', '1990s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'celtics', '1990s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'lakers', '1980s', '1996-97')).not.toBe(a);
    expect(playerVersionId('p-1', 'lakers', '1990s', '1986-87')).not.toBe(a);
  });

  it('derives distinct ids for two versions of the same person', async () => {
    const mod = await import('./index.ts');
    const { playerVersionId } = mod;
    const peak = playerVersionId('p-23', 'bulls', '1990s', '1997-98');
    const second = playerVersionId('p-23', 'bulls', '1990s', '1996-97');
    expect(peak).not.toBe(second);
  });
});

describe('season seed derivation', () => {
  it('is deterministic, namespaced, and order-independent', async () => {
    const mod = await import('./index.ts');
    const { seasonNamespaceSeed, SEASON_SEED_NAMESPACES } = mod;
    const seed = 'c0ffee1a2b3c4d5e6f708192a3b4c5d6e';
    const draft = seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.draft);
    expect(draft).toBe(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.draft));
    expect(draft).toMatch(/^[0-9a-f]{32}$/);
    const ai = seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.aiRosters);
    expect(ai).not.toBe(draft);
    const games = seasonNamespaceSeed(
      seed,
      SEASON_SEED_NAMESPACES.scheduleGames,
      'lakers',
      'celtics',
    );
    const gamesSwapped = seasonNamespaceSeed(
      seed,
      SEASON_SEED_NAMESPACES.scheduleGames,
      'celtics',
      'lakers',
    );
    expect(games).not.toBe(gamesSwapped);
    expect(games).toBe(
      seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.scheduleGames, 'lakers', 'celtics'),
    );
    for (const namespace of Object.values(SEASON_SEED_NAMESPACES)) {
      const derived = seasonNamespaceSeed(seed, namespace);
      expect(derived).toMatch(/^[0-9a-f]{32}$/);
      expect(derived).not.toBe(seed);
    }
  });

  it('pins stable derivation vectors for the committed run seed', async () => {
    const mod = await import('./index.ts');
    const { seasonNamespaceSeed, SEASON_SEED_NAMESPACES, playerVersionId } = mod;
    const seed = 'c0ffee2026a1b2c3d4e5f60718293a4b';
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.draft)).toBe(
      'bf6f373420fee6f04bf1da36074ce784',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.aiRosters)).toBe(
      'd5edcf36a61755a2ff9f80582bb5ee46',
    );
    expect(
      seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.scheduleGames, 'lakers', 'celtics'),
    ).toBe('c70523e788d2756bde47e3a90fadf0d7');
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.postseasonTies)).toBe(
      'cc022296a9b3989a9ea1d1943d6e5186',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.injuries)).toBe(
      '3c4fc7a600628bba49f5d95c9815f3f6',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.trades)).toBe(
      '5a0b6036864e4e3a80a4a8b460544a46',
    );
    expect(seasonNamespaceSeed(seed, SEASON_SEED_NAMESPACES.upgrades)).toBe(
      '4b8c47c4507c7a30616462d624a142f4',
    );
    expect(playerVersionId('p-synth-1', 'lakers', '1990s', '1995-96')).toBe(
      'pv-345baf6811b5d914c163685a20974538',
    );
  });
});

describe('season draft catalog schema (M2.1)', () => {
  function buildCatalog() {
    const candidate = (n: number, positions: string[]) => ({
      playerVersionId: `pv-${String(n).padStart(32, '0')}`,
      playerId: `p-${String(n)}`,
      franchiseId: 'lakers',
      eraId: '1990s',
      seasonKey: '1995-96',
      displayName: `Candidate ${String(n)}`,
      playerExternalId: '101',
      positions: {
        primary: 'SG',
        secondary: [],
        playable: positions,
        normalizationVersion: 'position-v3',
      },
      heightInches: 79,
      weightLbs: 215,
      summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
      detailedRatings: {
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
      },
      tendencies: {
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
      },
    });
    const candidates = [candidate(1, ['PG']), candidate(2, ['SG']), candidate(3, ['SF'])];
    return {
      schemaVersion: 1,
      catalogVersion: 'season-draft-v1',
      dataVersion: 'm10-ratings-v3.4',
      ratingsVersion: 'ratings-v3.4',
      positionNormalizationVersion: 'position-v3',
      playerVersionIdVersion: 'player-version-id-v1',
      pools: [
        {
          franchiseId: 'lakers',
          eraId: '1990s',
          playerVersionIds: candidates.map((c) => c.playerVersionId),
        },
      ],
      candidates,
    };
  }

  it('round-trips a valid catalog', () => {
    const catalog = roundTrip(seasonDraftCatalogSchema, buildCatalog());
    expect(catalog.pools).toHaveLength(1);
    expect(catalog.candidates).toHaveLength(3);
  });

  it('rejects wrong catalog and identity versions', () => {
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), catalogVersion: 'season-draft-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), playerVersionIdVersion: 'pv-v2' }),
    ).toThrow();
  });

  it('rejects duplicate candidate version ids', () => {
    const catalog = buildCatalog();
    const duplicated = [...catalog.candidates, catalog.candidates[0]];
    expect(() => seasonDraftCatalogSchema.parse({ ...catalog, candidates: duplicated })).toThrow();
  });
});

describe('season draft state schema (M2.1)', () => {
  const baseState = {
    schemaVersion: 1,
    draftVersion: 'season-draft-v1',
    runId: 'run-1',
    rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    league: buildLeague(),
    catalogVersion: 'season-draft-v1',
    participants: [
      { participantId: 'p1', franchiseId: 'lakers' },
      { participantId: 'p2', franchiseId: 'celtics' },
    ],
    firstPickParticipantId: 'p1',
    round: 2,
    currentTurnParticipantId: 'p2',
    status: 'drafting',
    revision: 4,
    currentReveal: {
      participantId: 'p2',
      round: 2,
      pickOrdinal: 2,
      attempts: [
        { franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: false },
        { franchiseId: 'celtics', eraId: '1980s', attemptIndex: 1, usable: true },
      ],
    },
    rolls: [
      { franchiseId: 'lakers', eraId: '1990s', attemptIndex: 0, usable: false },
      { franchiseId: 'celtics', eraId: '1980s', attemptIndex: 1, usable: true },
    ],
    claims: [{ participantId: 'p1', franchiseId: 'lakers', eraId: '1990s' }],
    picks: [
      {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'0'.repeat(32)}`,
        franchiseId: 'lakers',
        eraId: '1990s',
        rollAttempts: 1,
      },
    ],
    commandLog: [
      {
        status: 'accepted',
        commandId: 'c1',
        revisionBefore: 0,
        revisionAfter: 1,
        stateDigest: '0'.repeat(32),
        command: {
          commandId: 'c1',
          expectedRevision: 0,
          payload: {
            kind: 'create-season-draft',
            runId: 'run-1',
            rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
            league: buildLeague(),
            humanParticipantIds: ['p1', 'p2'],
            catalogVersion: 'season-draft-v1',
          },
        },
      },
    ],
  };

  it('round-trips a valid drafting state', () => {
    const state = roundTrip(seasonDraftStateSchema, baseState);
    expect(state.participants).toHaveLength(2);
    expect(state.picks).toHaveLength(1);
  });

  it('rejects wrong draft version and malformed rolls', () => {
    expect(() =>
      seasonDraftStateSchema.parse({ ...baseState, draftVersion: 'season-draft-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentReveal: { ...baseState.currentReveal, attempts: [] },
      }),
    ).toThrow();
  });
});

describe('season draft command records (M2.1)', () => {
  const command = {
    commandId: 'c-claim-1',
    expectedRevision: 2,
    payload: {
      kind: 'claim-draft-pool',
      participantId: 'p1',
      franchiseId: 'lakers',
      eraId: '1990s',
    },
  };

  it('round-trips an accepted record and rejects mismatched kinds', () => {
    const record = {
      status: 'accepted',
      commandId: 'c-claim-1',
      revisionBefore: 2,
      revisionAfter: 3,
      stateDigest: '0'.repeat(32),
      command,
    };
    const parsed = seasonDraftCommandRecordSchema.parse(record);
    expect(parsed.status).toBe('accepted');
    expect(() =>
      seasonDraftCommandRecordSchema.parse({
        status: 'accepted',
        commandId: 'x',
        revisionBefore: 0,
        revisionAfter: 1,
        stateDigest: 'not-a-digest',
        command,
      }),
    ).toThrow();
  });

  it('round-trips a rejected record with a typed error code', () => {
    const record = {
      status: 'rejected',
      commandId: 'c-bad',
      revision: 2,
      errorCode: 'GENERATION_EXHAUSTED',
      message: 'node budget exhausted',
      command,
    };
    expect(roundTrip(seasonDraftRejectedRecordSchema, record).errorCode).toBe(
      'GENERATION_EXHAUSTED',
    );
    expect(() =>
      seasonDraftRejectedRecordSchema.parse({ ...record, errorCode: 'NOT_A_CODE' }),
    ).toThrow();
  });

  it('validates command envelope shapes', () => {
    expect(() => seasonDraftCommandSchema.parse({ ...command, expectedRevision: -1 })).toThrow();
    expect(() =>
      seasonDraftCommandSchema.parse({
        ...command,
        payload: { kind: 'reveal-draft-roll', participantId: 'p1' },
      }),
    ).not.toThrow();
    expect(() =>
      seasonDraftCommandSchema.parse({
        ...command,
        payload: {
          kind: 'create-season-draft',
          runId: 'r',
          rootSeed: 'a1b2c3d4e5f60718',
          league: buildLeague(),
          humanParticipantIds: ['p1'],
          catalogVersion: 'season-draft-v1',
        },
      }),
    ).not.toThrow();
  });
});

describe('season rotation schema (M2.1)', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `pv-${String(i).padStart(32, '0')}`);
  const rotation = {
    franchiseId: 'lakers',
    starters: ids.slice(0, 5),
    benchOrder: ids.slice(5),
    targetMinutes: [
      ...ids.slice(0, 5).map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...ids.slice(5).map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: ids.slice(0, 5),
    rotationVersion: 'season-rotation-v2',
  };

  it('round-trips a legal rotation', () => {
    expect(roundTrip(seasonRotationSchema, rotation).starters).toHaveLength(5);
  });

  it('rejects illegal rotations', () => {
    expect(() =>
      seasonRotationSchema.parse({
        ...rotation,
        targetMinutes: rotation.targetMinutes.slice(0, 9),
      }),
    ).toThrow();
    expect(() =>
      seasonRotationSchema.parse({ ...rotation, rotationVersion: 'season-rotation-v1' }),
    ).toThrow();
    expect(() =>
      seasonRotationSchema.parse({
        ...rotation,
        targetMinutes: rotation.targetMinutes.map((m, i) => ({
          ...m,
          minutes: i === 0 ? 8 : m.minutes,
        })),
      }),
    ).not.toThrow();
  });
});

describe('season AI contracts (M2.1)', () => {
  it('round-trips assignments and diagnostics', () => {
    const assignment = {
      franchiseId: 'lakers',
      band: 'contender',
      identity: 'star-chaser',
    };
    expect(roundTrip(seasonAiAssignmentSchema, assignment).band).toBe('contender');
    expect(() => seasonAiAssignmentSchema.parse({ ...assignment, band: 'super' })).toThrow();
    const diagnostics = {
      seed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
      aiVersion: 'season-ai-v1',
      rosterGenerationVersion: 'roster-generation-v1',
      teamsGenerated: 29,
      teamsRepaired: 1,
      backtracks: 2,
      nodesVisited: 500,
      nodeBudget: 100000,
      failedTeams: [],
      unmetConstraints: [],
    };
    expect(roundTrip(seasonGenerationDiagnosticsSchema, diagnostics).backtracks).toBe(2);
  });

  it('rejects wrong versions in the generation result and targets', () => {
    const run = buildRun();
    const rosters = run.rosters;
    const rotations = run.rotations;
    const aiAssignments = run.aiAssignments;
    const evaluations = run.evaluations;
    const ownership = run.ownership;
    const result = {
      schemaVersion: 1,
      seed: SEED,
      aiVersion: 'season-ai-v1',
      rosterGenerationVersion: 'roster-generation-v1',
      rotationVersion: 'season-rotation-v2',
      rosters,
      ownership,
      rotations,
      aiAssignments,
      evaluations,
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
      digest: '0'.repeat(32),
    };
    expect(roundTrip(seasonLeagueGenerationResultSchema, result).rosters).toHaveLength(30);
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({ ...result, aiVersion: 'season-ai-v2' }),
    ).toThrow();
    const targets = {
      schemaVersion: 1,
      targetsVersion: 'roster-targets-v1',
      calibration: {
        calibrationSeedCount: 256,
        validationSeedCount: 64,
        generatedAtIso: '2026-08-04T00:00:00.000Z',
        aiVersion: 'season-ai-v1',
        rosterGenerationVersion: 'roster-generation-v1',
      },
      bands: {
        contender: { range: [50, 90], median: 72 },
        playoff: { range: [44, 80], median: 63 },
        average: { range: [38, 70], median: 55 },
        weaker: { range: [30, 62], median: 47 },
      },
      identities: {
        'star-chaser': { range: [40, 85], median: 62 },
        'depth-builder': { range: [40, 85], median: 62 },
        'defense-first': { range: [40, 85], median: 62 },
        'shooting-first': { range: [40, 85], median: 62 },
        continuity: { range: [40, 85], median: 62 },
        'active-trader': { range: [40, 85], median: 62 },
      },
      roleCoverageMinimum: 8,
      heldOutPassShare: 0.95,
      quotas: {
        soloBands: { contender: 4, playoff: 8, average: 10, weaker: 7 },
        duoBands: { contender: 4, playoff: 8, average: 9, weaker: 7 },
      },
    };
    expect(roundTrip(seasonRosterTargetsSchema, targets).roleCoverageMinimum).toBe(8);
    expect(() =>
      seasonRosterTargetsSchema.parse({ ...targets, targetsVersion: 'roster-targets-v2' }),
    ).toThrow();
  });
});
