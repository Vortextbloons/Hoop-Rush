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
  seasonDraftLegacyStateSchema,
  storedSeasonDraftStateSchema,
  seasonDraftCommandSchema,
  seasonDraftCommandRecordSchema,
  seasonRotationSchema,
  seasonAiAssignmentSchema,
  seasonAiPoolSchema,
  seasonGenerationDiagnosticsSchema,
  seasonLeagueGenerationResultSchema,
  seasonRosterTargetsSchema,
  seasonDraftRejectedRecordSchema,
} from './index.ts';
import {
  buildLeague,
  buildPostseason,
  buildRun,
  buildSchedule,
  SEED,
} from './season-schemas-fixtures.ts';

/**
 * Season Run contract tests (M2.0): every runtime schema round-trips valid
 * state and rejects wrong versions, invalid team counts, duplicate
 * ownership, malformed rosters, invalid cursors, and corrupt postseason
 * states. Fixtures come from the shared season-schemas-fixtures module so
 * the contract layer stays dependency-free.
 */

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
      stamina: {
        rating: 45 + n,
        historicalMpg: (30 + n) / 2,
        derivationVersion: 'season-stamina-v1',
      },
    });
    const candidates = [candidate(1, ['PG']), candidate(2, ['SG']), candidate(3, ['SF'])];
    return {
      schemaVersion: 1,
      catalogVersion: 'season-draft-catalog-v2',
      dataVersion: 'm10-ratings-v3.4',
      ratingsVersion: 'ratings-v3.4',
      positionNormalizationVersion: 'position-v3',
      playerVersionIdVersion: 'player-version-id-v1',
      staminaVersion: 'season-stamina-v1',
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
    expect(catalog.catalogVersion).toBe('season-draft-catalog-v2');
    expect(catalog.staminaVersion).toBe('season-stamina-v1');
    for (const candidate of catalog.candidates) {
      expect(candidate.stamina.rating).toBeGreaterThanOrEqual(45);
      expect(candidate.stamina.rating).toBeLessThanOrEqual(95);
      expect(candidate.stamina.derivationVersion).toBe('season-stamina-v1');
    }
  });

  it('rejects wrong catalog and identity versions', () => {
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), catalogVersion: 'season-draft-v1' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), catalogVersion: 'season-draft-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), playerVersionIdVersion: 'pv-v2' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), staminaVersion: 'season-stamina-v2' }),
    ).toThrow();
  });

  it('rejects duplicate candidate version ids', () => {
    const catalog = buildCatalog();
    const duplicated = [...catalog.candidates, catalog.candidates[0]];
    expect(() => seasonDraftCatalogSchema.parse({ ...catalog, candidates: duplicated })).toThrow();
  });

  it('rejects a candidate without a valid stamina profile', () => {
    const catalog = buildCatalog();
    const candidates = catalog.candidates.map((candidate, index) =>
      index === 0 ? { ...candidate, stamina: { ...candidate.stamina, rating: 44 } } : candidate,
    );
    expect(() => seasonDraftCatalogSchema.parse({ ...catalog, candidates })).toThrow();
  });
});

describe('season draft state schema (M2.3.5 season-draft-v2)', () => {
  const seedPath = ['draft', 'offer', 'p1', '1', '1', 'safe-order', 'sample-order'];
  const cards = [
    { playerVersionId: `pv-${'1'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'2'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'3'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'4'.repeat(32)}`, selectable: true, coverageReason: null },
    {
      playerVersionId: `pv-${'5'.repeat(32)}`,
      selectable: false,
      coverageReason: 'disabled fixture card',
    },
    { playerVersionId: `pv-${'6'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'7'.repeat(32)}`, selectable: true, coverageReason: null },
    { playerVersionId: `pv-${'8'.repeat(32)}`, selectable: true, coverageReason: null },
  ];
  const baseState = {
    schemaVersion: 2,
    draftVersion: 'season-draft-v2',
    runId: 'run-1',
    rootSeed: 'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    league: buildLeague(),
    catalogVersion: 'season-draft-v2',
    participants: [
      { participantId: 'p1', franchiseId: 'lakers' },
      { participantId: 'p2', franchiseId: 'celtics' },
    ],
    firstPickParticipantId: 'p1',
    round: 2,
    currentTurnParticipantId: 'p2',
    status: 'drafting',
    revision: 4,
    currentOffer: {
      participantId: 'p2',
      round: 2,
      pickOrdinal: 2,
      seedPath: ['draft', 'offer', 'p2', '2', '2', 'safe-order', 'sample-order'],
      cards,
    },
    offers: [
      {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        seedPath,
        cards,
      },
    ],
    picks: [
      {
        participantId: 'p1',
        round: 1,
        pickOrdinal: 1,
        playerVersionId: `pv-${'1'.repeat(32)}`,
        franchiseId: 'lakers',
        eraId: '1990s',
        seedPath,
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
            catalogVersion: 'season-draft-v2',
          },
        },
      },
    ],
  };

  it('round-trips a valid drafting state', () => {
    const state = roundTrip(seasonDraftStateSchema, baseState);
    expect(state.participants).toHaveLength(2);
    expect(state.picks).toHaveLength(1);
    expect(state.currentOffer).not.toBeNull();
    expect(state.offers).toHaveLength(1);
    expect(state.schemaVersion).toBe(2);
    expect(state.catalogVersion).toBe('season-draft-v2');
  });

  it('rejects wrong draft versions and malformed offers', () => {
    expect(() =>
      seasonDraftStateSchema.parse({ ...baseState, draftVersion: 'season-draft-v1' }),
    ).toThrow();
    expect(() =>
      seasonDraftStateSchema.parse({ ...baseState, catalogVersion: 'season-draft-v1' }),
    ).toThrow();
    // Fewer than eight cards fails the offer contract.
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: { ...baseState.currentOffer, cards: cards.slice(0, 7) },
      }),
    ).toThrow();
    // Duplicate cards fail the distinctness refinement.
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: {
          ...baseState.currentOffer,
          cards: [...cards.slice(0, 7), { ...cards[0] }],
        },
      }),
    ).toThrow();
    // A selectable card with a coverage reason is corrupt.
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: {
          ...baseState.currentOffer,
          cards: cards.map((card, index) =>
            index === 0 ? { ...card, coverageReason: 'must be null' } : card,
          ),
        },
      }),
    ).toThrow();
    // A disabled card without a coverage reason is corrupt.
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: {
          ...baseState.currentOffer,
          cards: cards.map((card, index) =>
            index === 4 ? { ...card, coverageReason: null } : card,
          ),
        },
      }),
    ).toThrow();
  });

  it('reads legacy season-draft-v1 states through the legacy schema and the stored union', () => {
    const legacy = {
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
      commandLog: [],
    };
    expect(roundTrip(seasonDraftLegacyStateSchema, legacy).draftVersion).toBe('season-draft-v1');
    // The v2 schema rejects legacy states; the stored union accepts both.
    expect(() => seasonDraftStateSchema.parse(legacy)).toThrow();
    expect(roundTrip(storedSeasonDraftStateSchema, legacy).schemaVersion).toBe(1);
    expect(roundTrip(storedSeasonDraftStateSchema, baseState).schemaVersion).toBe(2);
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
          catalogVersion: 'season-draft-v2',
        },
      }),
    ).not.toThrow();
    // Legacy v1 command envelopes still parse (stored-record reads).
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
          kind: 'draw-season-offer',
          participantId: 'p1',
        },
      }),
    ).not.toThrow();
  });
});

describe('season run draft facts union (M2.3.5)', () => {
  it('accepts legacy season-draft-v1 run facts alongside v2 versions', () => {
    const run = buildRun();
    const legacyFacts = {
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
    };
    const parsed = roundTrip(seasonRunSchema, {
      ...run,
      versions: { ...run.versions, draftVersion: 'season-draft-v1' },
      draft: legacyFacts,
    });
    expect(parsed.draft.draftVersion).toBe('season-draft-v1');
  });

  it('rejects draft facts that do not match either variant', () => {
    const run = buildRun();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        draft: { draftVersion: 'season-draft-v3', participants: [] },
      }),
    ).toThrow();
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

describe('season AI contracts (M2.1, M2.4 roster-generation-v2)', () => {
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
      aiVersion: 'season-ai-v2',
      rosterGenerationVersion: 'roster-generation-v2',
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

  it('round-trips a pool and rejects duplicate versions, outside selections, and invalid anchors', () => {
    const member = (n: number) => `pv-${String(n).padStart(32, '0')}`;
    const pool = {
      franchiseId: 'lakers',
      band: 'contender',
      identity: 'star-chaser',
      playerVersionIds: Array.from({ length: 20 }, (_, n) => member(n)),
      anchors: [
        {
          playerVersionId: member(0),
          qualifyingRole: 'primary-creation',
          percentileTier: 'elite',
          roleScore: 92,
          percentileThreshold: 88,
          seedPath: ['ai', 'anchors', 'lakers', '0'],
        },
      ],
      selections: Array.from({ length: 10 }, (_, n) => member(n)),
      allocationSeedPaths: Array.from({ length: 10 }, (_, n) => [
        'ai',
        'selection',
        'lakers',
        String(n),
      ]),
      repairCount: 1,
    };
    expect(roundTrip(seasonAiPoolSchema, pool).selections).toHaveLength(10);
    // 19 and 21 member pools are rejected.
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        playerVersionIds: pool.playerVersionIds.slice(0, 19),
        selections: pool.selections.slice(0, 9),
        allocationSeedPaths: pool.allocationSeedPaths.slice(0, 9),
      }),
    ).toThrow();
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        playerVersionIds: [...pool.playerVersionIds, member(20), member(21)],
      }),
    ).toThrow();
    // Duplicate pool versions are rejected.
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        playerVersionIds: [...pool.playerVersionIds.slice(0, 19), pool.playerVersionIds[0]],
      }),
    ).toThrow();
    // Selections outside the pool are rejected.
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        selections: [...pool.selections.slice(0, 9), member(20)],
      }),
    ).toThrow();
    // Invalid anchors are rejected (member outside the pool, wrong tier).
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        anchors: [{ ...pool.anchors[0], playerVersionId: member(20) }],
      }),
    ).toThrow();
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        anchors: [{ ...pool.anchors[0], percentileTier: 'strong' }],
      }),
    ).toThrow();
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        anchors: [{ ...pool.anchors[0], roleScore: 101 }],
      }),
    ).toThrow();
  });

  it('rejects wrong versions in the generation result and targets', () => {
    const run = buildRun();
    const rosters = run.rosters;
    const rotations = run.rotations;
    const aiAssignments = run.aiAssignments;
    const evaluations = run.evaluations;
    const ownership = run.ownership;
    const aiPools = run.aiPools;
    const result = {
      schemaVersion: 2,
      seed: SEED,
      aiVersion: 'season-ai-v2',
      rosterGenerationVersion: 'roster-generation-v2',
      rotationVersion: 'season-rotation-v2',
      rosters,
      ownership,
      rotations,
      aiAssignments,
      aiPools,
      evaluations,
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
      digest: '0'.repeat(32),
    };
    expect(roundTrip(seasonLeagueGenerationResultSchema, result).rosters).toHaveLength(30);
    expect(roundTrip(seasonLeagueGenerationResultSchema, result).aiPools).toHaveLength(29);
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({ ...result, aiVersion: 'season-ai-v1' }),
    ).toThrow();
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({ ...result, schemaVersion: 1 }),
    ).toThrow();
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({
        ...result,
        aiPools: result.aiPools.slice(0, 28),
      }),
    ).not.toThrow();
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({
        ...result,
        aiPools: result.aiPools.slice(0, 27),
      }),
    ).toThrow();
    expect(() =>
      seasonLeagueGenerationResultSchema.parse({
        ...result,
        aiPools: [...result.aiPools, result.aiPools[0]],
      }),
    ).toThrow();
  });

  it('round-trips the frozen roster-targets-v2 artifact', () => {
    const targets = {
      schemaVersion: 2,
      targetsVersion: 'roster-targets-v2',
      policy: {
        bandQuotas: {
          solo: { contender: 4, playoff: 8, average: 10, weaker: 7 },
          duo: { contender: 4, playoff: 8, average: 9, weaker: 7 },
        },
        guaranteedAnchors: { contender: 2, playoff: 1, average: 0, weaker: 0 },
        extraEliteRollProbability: { contender: 0.65, playoff: 0.35, average: 0.2, weaker: 0.08 },
        tierRanges: {
          contender: { elite: [2, 4], strong: [5, 8], useful: [6, 10] },
          playoff: { elite: [1, 2], strong: [4, 7], useful: [7, 10] },
          average: { elite: [0, 1], strong: [3, 6], useful: [8, 11] },
          weaker: { elite: [0, 1], strong: [1, 4], useful: [7, 10] },
        },
        identityPriorityRoles: {
          'star-chaser': [
            'primary-creation',
            'secondary-creation',
            'rim-finishing-interior-scoring',
          ],
          'shooting-first': ['perimeter-shooting'],
          'defense-first': ['perimeter-defense', 'interior-defense'],
          'depth-builder': [
            'primary-creation',
            'secondary-creation',
            'perimeter-shooting',
            'rim-finishing-interior-scoring',
            'perimeter-defense',
            'interior-defense',
            'offensive-rebounding',
            'defensive-rebounding',
          ],
          continuity: [
            'primary-creation',
            'secondary-creation',
            'perimeter-shooting',
            'rim-finishing-interior-scoring',
            'perimeter-defense',
            'interior-defense',
            'offensive-rebounding',
            'defensive-rebounding',
          ],
          'active-trader': [
            'primary-creation',
            'secondary-creation',
            'perimeter-shooting',
            'rim-finishing-interior-scoring',
            'perimeter-defense',
            'interior-defense',
            'offensive-rebounding',
            'defensive-rebounding',
          ],
        },
        roleCoverageThreshold: 35,
        completionTargets: { guards: 4, forwards: 4, centers: 3 },
        poolSize: 20,
        rosterSize: 10,
        percentileTiers: { elite: 0.9, strong: 0.75, useful: 0.5 },
        bandPoolScoreCaps: { contender: 100, playoff: 92, average: 84, weaker: 74 },
        maxPoolStrengthOutliers: 4,
        maxRosterStrengthOutliers: 2,
        nodeBudgets: { anchorMatching: 20000, poolRepair: 40000, rosterSelection: 600000 },
      },
      calibration: {
        calibrationSeedCount: 256,
        validationSeedCount: 64,
        generatedAtIso: '2026-08-04T00:00:00.000Z',
        aiVersion: 'season-ai-v2',
        rosterGenerationVersion: 'roster-generation-v2',
        gates: {
          failureRateMax: 0,
          minBandSeparation: 3,
          anchorFulfillmentMin: 1,
          extraEliteRateTolerance: 0.05,
          heldOutPassShare: 0.95,
          orderInvarianceFailuresMax: 0,
          superTeamIncidenceMax: 0.08,
        },
      },
      measured: {
        bands: {
          contender: {
            range: [52, 92],
            median: 74,
            eliteShare: 0.7,
            strongShare: 0.3,
            usefulShare: 0,
          },
          playoff: {
            range: [46, 82],
            median: 65,
            eliteShare: 0.4,
            strongShare: 0.6,
            usefulShare: 0.1,
          },
          average: {
            range: [40, 72],
            median: 57,
            eliteShare: 0.1,
            strongShare: 0.5,
            usefulShare: 0.6,
          },
          weaker: {
            range: [32, 64],
            median: 49,
            eliteShare: 0.05,
            strongShare: 0.3,
            usefulShare: 0.8,
          },
        },
        identities: {
          'star-chaser': { range: [40, 88], median: 64 },
          'depth-builder': { range: [40, 85], median: 62 },
          'defense-first': { range: [40, 85], median: 62 },
          'shooting-first': { range: [40, 85], median: 62 },
          continuity: { range: [40, 85], median: 62 },
          'active-trader': { range: [40, 85], median: 62 },
        },
        anchorFulfillment: 1,
        extraEliteRate: 0.4,
        superTeamIncidence: 0.02,
        poolLegalityFailures: 0,
        selectionFailures: 0,
        generationFailures: 0,
      },
    };
    const parsed = roundTrip(seasonRosterTargetsSchema, targets);
    expect(parsed.policy.bandQuotas.solo.contender).toBe(4);
    expect(parsed.measured.bands.contender.median).toBe(74);
    expect(parsed.calibration.gates.minBandSeparation).toBe(3);
  });

  it('rejects the v1 targets artifact, wrong target versions, and malformed v2 policy', () => {
    const v1Targets = {
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
    // The v1 artifact is rejected outright (never produced or read by v2).
    expect(() => seasonRosterTargetsSchema.parse(v1Targets)).toThrow();
    expect(() => seasonRosterTargetsSchema.parse({ ...v1Targets, schemaVersion: 2 })).toThrow();
    // Wrong target versions are rejected.
    expect(() =>
      seasonRosterTargetsSchema.parse({
        schemaVersion: 2,
        targetsVersion: 'roster-targets-v1',
      }),
    ).toThrow();
    // Null targets are rejected (the artifact is required, never nullable).
    expect(() => seasonRosterTargetsSchema.parse(null)).toThrow();
    expect(seasonRosterTargetsSchema.safeParse(undefined).success).toBe(false);
  });

  it('round-trips a schema-6 run with its aiPools', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.schemaVersion).toBe(6);
    expect(run.versions.runSchemaVersion).toBe(6);
    expect(run.versions.rosterGenerationVersion).toBe('roster-generation-v2');
    expect(run.versions.aiVersion).toBe('season-ai-v2');
    expect(run.versions.rosterTargetsVersion).toBe('roster-targets-v2');
    expect(run.aiPools).toHaveLength(29);
    expect(run.aiPools.every((pool) => pool.selections.length === 10)).toBe(true);
    expect(() =>
      seasonRunSchema.parse({ ...run, aiPools: run.aiPools.slice(0, 28) }),
    ).not.toThrow();
    expect(() => seasonRunSchema.parse({ ...run, aiPools: run.aiPools.slice(0, 27) })).toThrow();
    expect(() => seasonRunSchema.parse({ ...run, aiPools: [] })).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, aiVersion: 'season-ai-v1' },
      }),
    ).toThrow();
  });
});
