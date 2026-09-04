import { describe, expect, it } from 'vitest';
import {
  franchiseIdSchema,
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
  seasonHealthStateSchema,
  seasonInjuryRecordSchema,
  seasonTransactionEntrySchema,
  seasonInfluenceStateSchema,
  seasonInfluenceLedgerEntrySchema,
  seasonObjectiveStateSchema,
  seasonObjectiveEvaluationSchema,
  seasonTradeOfferSchema,
  seasonPendingBlockCandidateSchema,
  seasonInvalidRosterInterruptionSchema,
  seasonSelectBlockObjectiveCommandSchema,
  seasonSpendInfluenceCommandSchema,
  seasonAcceptTradeOfferCommandSchema,
  seasonDeclineTradeOfferCommandSchema,
  seasonResumeSeasonBlockCommandSchema,
  seasonForfeitInterruptedGameCommandSchema,
  seasonStartPostseasonCommandSchema,
  seasonAdvancePostseasonCommandSchema,
  seasonSubmitPostseasonRotationCommandSchema,
  seasonSpectatePostseasonGameCommandSchema,
  seasonFastForwardPostseasonCommandSchema,
  seasonRunCommandSchema,
  seasonRunCommandRejectionSchema,
  seasonSelectBlockObjectiveResultSchema,
  seasonSpendInfluenceResultSchema,
  seasonAcceptTradeOfferResultSchema,
  seasonSubmitBlockCommandSchema,
  seasonInvalidObjectiveRejectionSchema,
  seasonSubmitBlockRejectionSchema,
  seasonCandidateCheckpointSchema,
  seasonAcceptedBlockSchema,
  seasonCheckpointStateSchema,
  seasonWorkerStartRequestSchema,
  seasonWorkerCancelRequestSchema,
  seasonWorkerCompleteMessageSchema,
  seasonGameSummarySchema,
  seasonCompactInjuryEventSchema,
  seasonBlockRecapSchema,
  SEASON_NEUTRAL_HOME_COURT,
  RATINGS_VERSION,
  seasonMinutePolicySchema,
} from './index.ts';
import {
  buildEmptyHealth,
  buildInitialInfluence,
  buildCheckpointFixture,
  buildPendingBlockFixture,
  buildLeague,
  buildPostseason,
  buildRun,
  buildSchedule,
  buildSummaryFixture,
  fixturePlayerId,
  SEED,
} from './season-schemas-fixtures.ts';
function roundTrip<T>(
  schema: {
    parse: (input: unknown) => T;
  },
  value: unknown,
): T {
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
    expect(() =>
      seasonScheduleSchema.parse({
        ...schedule,
        games: [{ ...first, gameId: 's-00001' }, ...schedule.games.slice(1)],
      }),
    ).toThrow();
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
    expect(() => seasonGameSchema.parse({ ...base, status: 'forfeit' })).toThrow();
    const forfeit = { ...base, status: 'forfeit' as const, homeScore: null, awayScore: null };
    expect(() => seasonGameSchema.parse(forfeit)).toThrow();
    expect(() =>
      seasonGameSchema.parse({ ...forfeit, forfeitLoserFranchiseId: 'celtics' }),
    ).not.toThrow();
    expect(() =>
      seasonGameSchema.parse({ ...forfeit, forfeitLoserFranchiseId: 'bulls' }),
    ).toThrow();
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
describe('season postseason schema (M2.6 postseason-v2)', () => {
  it('round-trips an empty postseason state', () => {
    const state = roundTrip(seasonPostseasonStateSchema, buildPostseason(SEED));
    expect(state.bracket).toBeNull();
    expect(state.playIn.east.playoffSeeds).toBeNull();
    expect(state.playIn.west.ranking).toBeNull();
    expect(state.tiebreakResolutions).toEqual([]);
    expect(state.finalsHomeCourtDrawSeed).toMatch(/^[0-9a-f]{32}$/);
    expect(state.playIn.east.games.sevenEight.gameId).toBe('pi-east-seven-eight');
    expect(state.playIn.west.games.final.gameId).toBe('pi-west-final');
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
    const wrongGameId = {
      ...state,
      playIn: {
        ...state.playIn,
        east: {
          ...state.playIn.east,
          games: {
            ...state.playIn.east.games,
            nineTen: { ...state.playIn.east.games.nineTen, gameId: 'pi-west-nine-ten' },
          },
        },
      },
    };
    expect(() => seasonPostseasonStateSchema.parse(wrongGameId)).toThrow();
    const winnerNotInGame = {
      ...state,
      playIn: {
        ...state.playIn,
        east: {
          ...state.playIn.east,
          ranking: Array.from({ length: 10 }, (_, i) => `team-${String(i + 1)}`),
          games: {
            sevenEight: {
              gameId: 'pi-east-seven-eight',
              status: 'final',
              homeFranchiseId: 'team-7',
              awayFranchiseId: 'team-8',
              winnerFranchiseId: 'team-99',
              loserFranchiseId: 'team-8',
              homeScore: 100,
              awayScore: 90,
            },
            nineTen: {
              gameId: 'pi-east-nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'pi-east-final',
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
    const winnerParticipates = {
      ...winnerNotInGame,
      playIn: {
        ...winnerNotInGame.playIn,
        east: {
          ...winnerNotInGame.playIn.east,
          games: {
            sevenEight: {
              gameId: 'pi-east-seven-eight',
              status: 'final',
              homeFranchiseId: 'team-7',
              awayFranchiseId: 'team-8',
              winnerFranchiseId: 'team-7',
              loserFranchiseId: 'team-8',
              homeScore: 100,
              awayScore: 90,
            },
            nineTen: {
              gameId: 'pi-east-nine-ten',
              status: 'scheduled',
              homeFranchiseId: null,
              awayFranchiseId: null,
              winnerFranchiseId: null,
              loserFranchiseId: null,
              homeScore: null,
              awayScore: null,
            },
            final: {
              gameId: 'pi-east-final',
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
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...state,
        playIn: {
          ...state.playIn,
          east: {
            ...state.playIn.east,
            playoffSeeds: Array.from({ length: 8 }, (_, i) => `team-${String(i + 1)}`),
          },
        },
        bracket: { ...emptyBracketFixture() },
      }),
    ).toThrow();
    expect(() =>
      seasonPostseasonStateSchema.parse({ ...state, championFranchiseId: 'lakers' }),
    ).toThrow();
  });
  it('rejects a wrong postseason version', () => {
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...buildPostseason(SEED),
        postseasonVersion: 'postseason-v1',
      }),
    ).toThrow();
    expect(() =>
      seasonPostseasonStateSchema.parse({
        ...buildPostseason(SEED),
        tiebreakVersion: 'tiebreaker-v2',
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
          gameId: 'po-east-first-round-1-g1',
          gameNumber: 1,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 100,
          awayScore: 90,
          winnerFranchiseId: 'team-1',
        },
        {
          gameId: 'po-east-first-round-1-g2',
          gameNumber: 2,
          homeFranchiseId: 'team-1',
          awayFranchiseId: 'team-8',
          status: 'final',
          homeScore: 110,
          awayScore: 95,
          winnerFranchiseId: 'team-1',
        },
        {
          gameId: 'po-east-first-round-1-g3',
          gameNumber: 3,
          homeFranchiseId: 'team-8',
          awayFranchiseId: 'team-1',
          status: 'final',
          homeScore: 99,
          awayScore: 101,
          winnerFranchiseId: 'team-1',
        },
        {
          gameId: 'po-east-first-round-1-g4',
          gameNumber: 4,
          homeFranchiseId: 'team-8',
          awayFranchiseId: 'team-1',
          status: 'final',
          homeScore: 102,
          awayScore: 100,
          winnerFranchiseId: 'team-8',
        },
        {
          gameId: 'po-east-first-round-1-g5',
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
    expect(
      schema.safeParse({
        ...base,
        games: [
          {
            gameId: 'po-east-first-round-1-g1',
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
    expect(schema.safeParse({ ...base, winnerFranchiseId: 'team-1' }).success).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        games: Array.from({ length: 7 }, (_, i) => ({
          gameId: `po-east-first-round-1-g${String(i + 1)}`,
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
    expect(schema.safeParse({ ...base, homeCourtWins: 2 }).success).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        games: [
          {
            gameId: 'po-east-first-round-1-g9',
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
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        games: [
          {
            gameId: 'po-east-first-round-1-g2',
            gameNumber: 2,
            homeFranchiseId: 'team-1',
            awayFranchiseId: 'team-8',
            status: 'final',
            homeScore: 100,
            awayScore: 90,
            winnerFranchiseId: 'team-1',
          },
        ],
        homeCourtWins: 1,
      }).success,
    ).toBe(false);
  });
});
function emptyBracketFixture() {
  const pending = (seriesId: string, round: string, conference: 'east' | 'west') => ({
    seriesId,
    round,
    conference,
    higherSeed: null,
    lowerSeed: null,
    homeCourtFranchiseId: null,
    challengerFranchiseId: null,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  });
  const conferenceBracket = (conference: 'east' | 'west') => ({
    conference,
    seeds: Array.from({ length: 8 }, (_, i) => `team-${String(i + 1)}`),
    firstRound: [1, 2, 3, 4].map((n) =>
      pending(`${conference}-first-round-${String(n)}`, 'first-round', conference),
    ),
    semifinals: [1, 2].map((n) =>
      pending(`${conference}-semifinal-${String(n)}`, 'conference-semifinal', conference),
    ),
    conferenceFinal: pending(`${conference}-conference-final`, 'conference-final', conference),
  });
  return {
    schemaVersion: 1,
    postseasonVersion: 'postseason-v2',
    east: conferenceBracket('east'),
    west: conferenceBracket('west'),
    finals: {
      seriesId: 'finals',
      round: 'finals',
      conference: null,
      higherSeed: null,
      lowerSeed: null,
      homeCourtFranchiseId: 'team-1',
      challengerFranchiseId: null,
      homeCourtWins: 0,
      challengerWins: 0,
      games: [],
      winnerFranchiseId: null,
    },
    championFranchiseId: null,
  };
}
describe('season run schema', () => {
  it('round-trips a complete snapshot', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.rosters).toHaveLength(30);
    expect(run.ownership).toHaveLength(300);
    expect(run.games).toHaveLength(1230);
  });
  it('round-trips the M2.5 state chain fields', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.health.injuries).toEqual([]);
    expect(run.transactions).toEqual([]);
    expect(Object.keys(run.influence.balances)).toHaveLength(30);
    for (const balance of Object.values(run.influence.balances)) {
      expect(balance).toBe(2);
    }
    expect(run.influence.ledger).toHaveLength(30);
    expect(run.influence.ledger.every((entry) => entry.source === 'initial-grant')).toBe(true);
    expect(run.influence.ledger.every((entry) => entry.balanceAfter === 2)).toBe(true);
    expect(run.checkpointState).toBeNull();
    expect(run.stateRevision).toBe(0);
    expect(run.stateDigest).toBe('0'.repeat(32));
  });
  it('accepts 300-450 ownership rows; uniqueness is an engine-level audit', () => {
    const run = buildRun();
    const duplicated = [...run.ownership];
    const first = duplicated[0];
    if (!first) throw new Error('no ownership rows');
    expect(() =>
      seasonRunSchema.parse({ ...run, ownership: [...duplicated, { ...first }] }),
    ).not.toThrow();
    expect(() => seasonRunSchema.parse({ ...run, ownership: duplicated.slice(0, 299) })).toThrow();
  });
  it('rejects malformed rosters', () => {
    const run = buildRun();
    const rosters = run.rosters.map((roster, index) =>
      index === 0 ? { ...roster, players: roster.players.slice(0, 9) } : roster,
    );
    expect(() => seasonRunSchema.parse({ ...run, rosters })).toThrow();
  });
  it('accepts two versions of the same person on one roster', () => {
    const run = buildRun();
    const rosters = run.rosters.map((roster, index) => {
      if (index !== 0) return roster;
      const first = roster.players[0];
      if (first === undefined) throw new Error('need a player');
      return {
        ...roster,
        players: roster.players.map((player, slot) =>
          slot === 1 ? { ...player, playerId: first.playerId } : player,
        ),
      };
    });
    expect(() => seasonRunSchema.parse({ ...run, rosters })).not.toThrow();
  });
  it('rejects duplicate player versions on one roster', () => {
    const run = buildRun();
    const rosters = run.rosters.map((roster, index) => {
      if (index !== 0) return roster;
      const first = roster.players[0];
      if (first === undefined) throw new Error('need a player');
      return {
        ...roster,
        players: roster.players.map((player, slot) =>
          slot === 1 ? { ...player, playerVersionId: first.playerVersionId } : player,
        ),
      };
    });
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
      durability: {
        rating: 45 + n,
        derivationVersion: 'durability-v1',
      },
    });
    const candidates = [candidate(1, ['PG']), candidate(2, ['SG']), candidate(3, ['SF'])];
    return {
      schemaVersion: 1,
      catalogVersion: 'season-draft-catalog-v3',
      dataVersion: `m10-${RATINGS_VERSION}`,
      ratingsVersion: RATINGS_VERSION,
      positionNormalizationVersion: 'position-v3',
      playerVersionIdVersion: 'player-version-id-v1',
      staminaVersion: 'season-stamina-v1',
      durabilityVersion: 'durability-v1',
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
    expect(catalog.catalogVersion).toBe('season-draft-catalog-v3');
    expect(catalog.staminaVersion).toBe('season-stamina-v1');
    expect(catalog.durabilityVersion).toBe('durability-v1');
    for (const candidate of catalog.candidates) {
      expect(candidate.stamina.rating).toBeGreaterThanOrEqual(45);
      expect(candidate.stamina.rating).toBeLessThanOrEqual(95);
      expect(candidate.stamina.derivationVersion).toBe('season-stamina-v1');
      expect(candidate.durability.rating).toBeGreaterThanOrEqual(45);
      expect(candidate.durability.rating).toBeLessThanOrEqual(95);
      expect(candidate.durability.derivationVersion).toBe('durability-v1');
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
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), staminaVersion: 'season-stamina-v3' }),
    ).toThrow();
    expect(() =>
      seasonDraftCatalogSchema.parse({ ...buildCatalog(), durabilityVersion: 'durability-v2' }),
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
  it('rejects a candidate without a valid durability rating', () => {
    const catalog = buildCatalog();
    const candidates = catalog.candidates.map((candidate, index) =>
      index === 0
        ? { ...candidate, durability: { ...candidate.durability, rating: 96 } }
        : candidate,
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
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: { ...baseState.currentOffer, cards: cards.slice(0, 7) },
      }),
    ).toThrow();
    expect(() =>
      seasonDraftStateSchema.parse({
        ...baseState,
        currentOffer: {
          ...baseState.currentOffer,
          cards: [...cards.slice(0, 7), { ...cards[0] }],
        },
      }),
    ).toThrow();
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
    minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
    rotationVersion: 'season-rotation-v3',
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
  it('round-trips the minute policy and rejects bad strategies or versions', () => {
    const parsed = roundTrip(seasonMinutePolicySchema, {
      policyVersion: 'minute-policy-v1',
      strategy: 'starter-heavy',
    });
    expect(parsed.strategy).toBe('starter-heavy');
    expect(() =>
      seasonMinutePolicySchema.parse({
        policyVersion: 'minute-policy-v1',
        strategy: 'tight',
      }),
    ).toThrow();
    expect(() =>
      seasonMinutePolicySchema.parse({
        policyVersion: 'minute-policy-v2',
        strategy: 'balanced',
      }),
    ).toThrow();
  });
  it('requires a minute policy on every rotation', () => {
    const withoutPolicy = { ...rotation } as Record<string, unknown>;
    delete withoutPolicy.minutePolicy;
    expect(() => seasonRotationSchema.parse(withoutPolicy)).toThrow();
    expect(() =>
      seasonRotationSchema.parse({ ...rotation, rotationVersion: 'season-rotation-v2' }),
    ).toThrow();
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
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        playerVersionIds: [...pool.playerVersionIds.slice(0, 19), pool.playerVersionIds[0]],
      }),
    ).toThrow();
    expect(() =>
      seasonAiPoolSchema.parse({
        ...pool,
        selections: [...pool.selections.slice(0, 9), member(20)],
      }),
    ).toThrow();
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
      rotationVersion: 'season-rotation-v3',
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
    expect(() => seasonRosterTargetsSchema.parse(v1Targets)).toThrow();
    expect(() => seasonRosterTargetsSchema.parse({ ...v1Targets, schemaVersion: 2 })).toThrow();
    expect(() =>
      seasonRosterTargetsSchema.parse({
        schemaVersion: 2,
        targetsVersion: 'roster-targets-v1',
      }),
    ).toThrow();
    expect(() => seasonRosterTargetsSchema.parse(null)).toThrow();
    expect(seasonRosterTargetsSchema.safeParse(undefined).success).toBe(false);
  });
  it('round-trips a schema-11 run with its aiPools and M2.5.5 state', () => {
    const run = roundTrip(seasonRunSchema, buildRun());
    expect(run.schemaVersion).toBe(13);
    expect(run.versions.runSchemaVersion).toBe(13);
    expect(run.versions.rosterGenerationVersion).toBe('roster-generation-v2');
    expect(run.versions.aiVersion).toBe('season-ai-v2');
    expect(run.versions.rosterTargetsVersion).toBe('roster-targets-v2');
    expect(run.versions.rotationVersion).toBe('season-rotation-v3');
    expect(run.versions.minutePolicyVersion).toBe('minute-policy-v1');
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
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, rotationVersion: 'season-rotation-v2' },
      }),
    ).toThrow();
    expect(() =>
      seasonRunSchema.parse({
        ...run,
        versions: { ...run.versions, minutePolicyVersion: 'minute-policy-v2' },
      }),
    ).toThrow();
  });
  it('rejects schema-7 and schema-8 snapshots (older runs cannot continue)', () => {
    const run = buildRun();
    for (const older of [7, 8]) {
      const stale = {
        ...run,
        schemaVersion: older,
        versions: { ...run.versions, runSchemaVersion: older },
      };
      expect(() => seasonRunSchema.parse(stale)).toThrow();
    }
  });
});
describe('season health family (M2.5, season-health-v2)', () => {
  it('round-trips an empty health state and rejects wrong versions', () => {
    const state = roundTrip(seasonHealthStateSchema, buildEmptyHealth());
    expect(state.injuries).toEqual([]);
    expect(state.schemaVersion).toBe(1);
    expect(() =>
      seasonHealthStateSchema.parse({ ...buildEmptyHealth(), healthVersion: 'season-health-v1' }),
    ).toThrow();
    expect(() =>
      seasonHealthStateSchema.parse({ ...buildEmptyHealth(), schemaVersion: 2 }),
    ).toThrow();
  });
  it('round-trips an injury record and rejects corrupt shapes', () => {
    const record = {
      injuryId: `inj-${'a'.repeat(32)}`,
      playerVersionId: fixturePlayerId(0),
      franchiseId: 'lakers',
      gameId: 's000001',
      type: 'soft-tissue',
      severity: 'moderate',
      occurredBeforeHalftime: true,
      sameGameReturn: false,
      sameGameReturned: null,
      missedGamesTotal: 4,
      missedGamesRemaining: 4,
      actualReturnRound: null,
      seasonEnding: false,
      rehabModifier: 0,
      recurrenceWindowRoundsRemaining: 0,
      seedPath: ['injuries', 'occurrence', 's000001', 'lakers'],
    };
    const parsed = roundTrip(seasonInjuryRecordSchema, record);
    expect(parsed.severity).toBe('moderate');
    expect(() => seasonInjuryRecordSchema.parse({ ...record, injuryId: 'inj-not-hex' })).toThrow();
    expect(() => seasonInjuryRecordSchema.parse({ ...record, gameId: 's00000' })).toThrow();
    expect(() => seasonInjuryRecordSchema.parse({ ...record, rehabModifier: 2 })).toThrow();
    expect(() => seasonInjuryRecordSchema.parse({ ...record, severity: 'debilitating' })).toThrow();
    expect(() => seasonInjuryRecordSchema.parse({ ...record, seedPath: [] })).toThrow();
    expect(() =>
      seasonInjuryRecordSchema.parse({ ...record, missedGamesRemaining: 10001 }),
    ).toThrow();
  });
});
describe('season transaction family (M2.5)', () => {
  it('round-trips an entry and rejects corrupt shapes', () => {
    const entry = {
      transactionId: 'tx-trade-1',
      commandId: 'cmd-accept-1',
      franchiseId: 'lakers',
      type: 'trade',
      blockIndex: 2,
      appliedAtStateRevision: 3,
      payload: { offerId: 'off-abc', moved: ['pv-00000000000000000000000000000000'] },
      explanation: 'Accepted offer off-abc',
    };
    const parsed = roundTrip(seasonTransactionEntrySchema, entry);
    expect(parsed.type).toBe('trade');
    expect(() =>
      seasonTransactionEntrySchema.parse({ ...entry, transactionId: 'Tx-Bad' }),
    ).toThrow();
    expect(() =>
      seasonTransactionEntrySchema.parse({ ...entry, explanation: 'x'.repeat(513) }),
    ).toThrow();
    expect(() => seasonTransactionEntrySchema.parse({ ...entry, blockIndex: 9 })).toThrow();
    expect(() => seasonTransactionEntrySchema.parse({ ...entry, type: 'salary-dump' })).toThrow();
  });
  it('round-trips an initial-grant entry with null command and block', () => {
    const entry = {
      transactionId: 'tx-initial-hawks',
      commandId: null,
      franchiseId: 'hawks',
      type: 'initial-grant',
      blockIndex: null,
      appliedAtStateRevision: 0,
      payload: {},
      explanation: 'Initial +2 Influence grant at run creation',
    };
    expect(roundTrip(seasonTransactionEntrySchema, entry).commandId).toBeNull();
  });
});
describe('season influence family (M2.5, season-influence-v2)', () => {
  it('round-trips the initial state (30 franchises at +2)', () => {
    const state = roundTrip(seasonInfluenceStateSchema, buildInitialInfluence());
    expect(Object.keys(state.balances)).toHaveLength(30);
    expect(state.ledger).toHaveLength(30);
    expect(state.ledger[0]?.balanceAfter).toBe(2);
    expect(state.ledger.every((entry) => entry.appliedDelta === entry.requestedDelta)).toBe(true);
    expect(state.windows).toEqual({});
    expect(state.rehabs).toEqual({});
  });
  it('rejects missing franchises, wrong versions, and out-of-range balances', () => {
    const state = buildInitialInfluence();
    const balances = { ...state.balances };
    delete balances[franchiseIdSchema.parse('lakers')];
    expect(() => seasonInfluenceStateSchema.parse({ ...state, balances })).toThrow();
    expect(() =>
      seasonInfluenceStateSchema.parse({ ...state, influenceVersion: 'season-influence-v1' }),
    ).toThrow();
    expect(() =>
      seasonInfluenceStateSchema.parse({
        ...state,
        balances: { ...state.balances, lakers: 9 },
      }),
    ).toThrow();
    expect(() =>
      seasonInfluenceStateSchema.parse({
        ...state,
        balances: { ...state.balances, lakers: -4 },
      }),
    ).toThrow();
  });
  it('round-trips windows and rehabs state', () => {
    const state = buildInitialInfluence();
    const withSpends = {
      ...state,
      windows: { lakers: [{ windowIndex: 0, extraOfferSpent: true }] },
      rehabs: {
        [`inj-${'b'.repeat(32)}`]: {
          franchiseId: 'lakers',
          outcome: 'success',
          commandId: 'cmd-rehab-1',
        },
      },
    };
    const parsed = roundTrip(seasonInfluenceStateSchema, withSpends);
    expect(parsed.windows[franchiseIdSchema.parse('lakers')]?.[0]?.extraOfferSpent).toBe(true);
    expect(parsed.rehabs[`inj-${'b'.repeat(32)}`]?.outcome).toBe('success');
    expect(() =>
      seasonInfluenceStateSchema.parse({
        ...withSpends,
        rehabs: {
          [`inj-${'b'.repeat(32)}`]: {
            franchiseId: 'lakers',
            outcome: 'maybe',
            commandId: 'cmd-rehab-1',
          },
        },
      }),
    ).toThrow();
  });
  it('rejects a ledger entry that would not reconcile its balance', () => {
    const entry = {
      entryId: 'influence-block-0-lakers',
      franchiseId: 'lakers',
      source: 'block-grant',
      blockIndex: 0,
      commandId: 'cmd-submit-1',
      requestedDelta: 1,
      appliedDelta: 1,
      balanceAfter: 99,
      explanation: 'Block grant',
    };
    expect(() => seasonInfluenceLedgerEntrySchema.parse(entry)).not.toThrow();
  });
});
describe('season objective family (M2.5, season-objective-v1)', () => {
  function buildObjectiveState() {
    return {
      schemaVersion: 1,
      objectiveVersion: 'season-objective-v1',
      catalog: [
        {
          objectiveId: 'win-six',
          name: 'Win Six',
          description: "Win at least 6 of the block's team games.",
          measure: "wins >= 6 across the block's team games",
        },
        {
          objectiveId: 'defense-108',
          name: 'Defense 108',
          description: 'Allow at most 1,080 total points across the block.',
          measure: 'pointsAllowed <= 1080 across the block',
        },
        {
          objectiveId: 'rebound-plus-20',
          name: 'Rebound +20',
          description: 'Finish the block with at least a +20 total rebound margin.',
          measure: 'reboundMargin >= 20 across the block',
        },
        {
          objectiveId: 'availability-eight',
          name: 'Availability Eight',
          description: 'Field at least 8 available players at every tipoff.',
          measure: 'tipsWithAtLeastEightAvailable == tipsTotal',
        },
        {
          objectiveId: 'bench-320',
          name: 'Bench 320',
          description: 'Non-starters record at least 320 total minutes.',
          measure: 'benchMinutes >= 320 across the block',
        },
        {
          objectiveId: 'turnover-130',
          name: 'Turnover 130',
          description: 'Commit at most 130 turnovers across the block.',
          measure: 'turnovers <= 130 across the block',
        },
      ],
      selections: {
        '0': { objectiveId: 'win-six', selectedByCommandId: 'cmd-obj-1', success: null },
        '3': { objectiveId: 'bench-320', selectedByCommandId: 'cmd-obj-2', success: true },
      },
    };
  }
  it('round-trips a state with all six objectives and numeric-key selections', () => {
    const state = roundTrip(seasonObjectiveStateSchema, buildObjectiveState());
    expect(state.catalog).toHaveLength(6);
    expect(Object.keys(state.selections)).toHaveLength(2);
    expect(state.selections['0']?.objectiveId).toBe('win-six');
    expect(state.selections['3']?.success).toBe(true);
  });
  it('rejects a wrong version, an incomplete catalog, and duplicate objectives', () => {
    expect(() =>
      seasonObjectiveStateSchema.parse({
        ...buildObjectiveState(),
        objectiveVersion: 'season-objective-v99',
      }),
    ).toThrow();
    const state = buildObjectiveState();
    expect(() =>
      seasonObjectiveStateSchema.parse({ ...state, catalog: state.catalog.slice(0, 5) }),
    ).toThrow();
    expect(() =>
      seasonObjectiveStateSchema.parse({
        ...state,
        catalog: [...state.catalog, state.catalog[0]],
      }),
    ).toThrow();
    expect(() =>
      seasonObjectiveStateSchema.parse({
        ...state,
        selections: { '8': { objectiveId: 'win-six', selectedByCommandId: 'c', success: null } },
      }),
    ).toThrow();
  });
  it('round-trips an evaluation with recorded facts', () => {
    const evaluation = {
      objectiveId: 'defense-108',
      blockIndex: 1,
      success: true,
      facts: {
        games: 10,
        wins: 7,
        pointsAllowed: 1042,
        reboundMargin: 28,
        tipsWithAtLeastEightAvailable: 9,
        tipsTotal: 10,
        benchMinutes: 356,
        turnovers: 112,
      },
      tipCountedGames: 9,
    };
    expect(roundTrip(seasonObjectiveEvaluationSchema, evaluation).success).toBe(true);
  });
});
describe('season trade family (M2.5, season-trade-v1)', () => {
  function buildOffer() {
    return {
      offerId: `off-${'c'.repeat(32)}`,
      windowIndex: 0,
      seedPath: ['trades', 'window', '0', 'offer', '0'],
      toFranchiseId: 'hawks',
      fromFranchiseId: 'lakers',
      outgoingPlayerVersionIds: [fixturePlayerId(0), fixturePlayerId(1)],
      incomingPlayerVersionIds: [fixturePlayerId(30), fixturePlayerId(31)],
      outgoingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: false, activeInjuryIds: [`inj-${'d'.repeat(32)}`] },
      ],
      incomingHealth: [
        { available: true, activeInjuryIds: [] },
        { available: true, activeInjuryIds: [] },
      ],
      valueBand: { ratioBasisPoints: 950, band: '80-120', qualified: true },
      roleFit: {
        outgoingRoles: ['perimeter-defense', 'interior-defense'],
        incomingRoles: ['primary-creation'],
        notes: 'Fills the creation gap',
      },
      rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 1, notes: 'Thin at guard' },
      projectedRotationChanges: 'Bench 6 moves to the closing five.',
      projectedChemistryDisruption: { removedPairs: 15, newPairs: 17 },
      status: 'open',
    };
  }
  it('round-trips a 2-for-2 offer and rejects shape violations', () => {
    const offer = roundTrip(seasonTradeOfferSchema, buildOffer());
    expect(offer.valueBand.band).toBe('80-120');
    expect(offer.outgoingHealth).toHaveLength(2);
    expect(() =>
      seasonTradeOfferSchema.parse({
        ...buildOffer(),
        incomingPlayerVersionIds: [fixturePlayerId(30)],
      }),
    ).toThrow();
    expect(() =>
      seasonTradeOfferSchema.parse({
        ...buildOffer(),
        outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      }),
    ).toThrow();
    expect(() => seasonTradeOfferSchema.parse({ ...buildOffer(), status: 'pending' })).toThrow();
    expect(() => seasonTradeOfferSchema.parse({ ...buildOffer(), offerId: 'off-x' })).toThrow();
    expect(() =>
      seasonTradeOfferSchema.parse({ ...buildOffer(), projectedRotationChanges: 'x'.repeat(513) }),
    ).toThrow();
  });
  it('round-trips a 1-for-1 offer in the 85-115 band', () => {
    const offer = {
      ...buildOffer(),
      outgoingPlayerVersionIds: [fixturePlayerId(0)],
      incomingPlayerVersionIds: [fixturePlayerId(30)],
      outgoingHealth: [{ available: true, activeInjuryIds: [] }],
      incomingHealth: [{ available: true, activeInjuryIds: [] }],
      valueBand: { ratioBasisPoints: 1080, band: '85-115', qualified: true },
    };
    expect(roundTrip(seasonTradeOfferSchema, offer).valueBand.qualified).toBe(true);
  });
});
describe('season pending block family (M2.5)', () => {
  it('round-trips a pending candidate', () => {
    const pending = roundTrip(seasonPendingBlockCandidateSchema, buildPendingBlockFixture());
    expect(pending.summaries).toEqual([]);
    expect(pending.teamAggregates).toHaveLength(0);
    expect(pending.playerAggregates).toHaveLength(0);
    expect(pending.nextGameId).toBe('s000001');
    expect(pending.blockVersion).toBe('season-block-v6');
    expect(pending.objectiveId).toBeNull();
  });
  it('rejects wrong versions and corrupt fields', () => {
    const pending = buildPendingBlockFixture();
    expect(() =>
      seasonPendingBlockCandidateSchema.parse({ ...pending, blockVersion: 'season-block-v2' }),
    ).toThrow();
    expect(() =>
      seasonPendingBlockCandidateSchema.parse({ ...pending, nextGameId: 'not-a-game' }),
    ).toThrow();
    expect(() =>
      seasonPendingBlockCandidateSchema.parse({
        ...pending,
        summaries: Array.from({ length: 151 }, () => buildSummaryFixture()),
      }),
    ).toThrow();
    expect(() =>
      seasonPendingBlockCandidateSchema.parse({ ...pending, rotationDigest: 'x'.repeat(32) }),
    ).toThrow();
  });
  it('round-trips an invalid-roster interruption', () => {
    const interruption = {
      code: 'invalid-roster',
      runId: 'fixture-run-1',
      blockIndex: 1,
      commandId: 'submit-b1',
      nextGameId: 's000016',
      humanFranchiseId: 'hawks',
      unavailablePlayerVersionIds: [fixturePlayerId(0), fixturePlayerId(1), fixturePlayerId(2)],
    };
    expect(roundTrip(seasonInvalidRosterInterruptionSchema, interruption).code).toBe(
      'invalid-roster',
    );
    expect(() =>
      seasonInvalidRosterInterruptionSchema.parse({
        ...interruption,
        unavailablePlayerVersionIds: [],
      }),
    ).toThrow();
    expect(() =>
      seasonInvalidRosterInterruptionSchema.parse({ ...interruption, code: 'invalid-rotation' }),
    ).toThrow();
  });
});
describe('season commands (M2.5/M2.6, schema 11)', () => {
  const base = {
    schemaVersion: 11,
    commandId: 'cmd-1',
    runId: 'fixture-run-1',
    expectedStateRevision: 3,
    expectedStateDigest: '0'.repeat(32),
  };
  it('validates the base shape on every command', () => {
    const commands = [
      { ...base, command: 'select-block-objective', blockIndex: 0, objectiveId: 'win-six' },
      {
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
        windowIndex: 0,
      },
      {
        ...base,
        command: 'accept-trade-offer',
        windowIndex: 0,
        offerId: `off-${'c'.repeat(32)}`,
      },
      {
        ...base,
        command: 'decline-trade-offer',
        windowIndex: 1,
        offerId: `off-${'d'.repeat(32)}`,
      },
      { ...base, command: 'resume-season-block', blockIndex: 1, rotationDigest: '0'.repeat(32) },
      { ...base, command: 'forfeit-interrupted-game', blockIndex: 1, nextGameId: 's000016' },
      { ...base, command: 'start-postseason' },
      { ...base, command: 'advance-postseason' },
      {
        ...base,
        command: 'advance-postseason',
        targetGameId: 'pi-east-seven-eight',
      },
      {
        ...base,
        command: 'submit-postseason-rotation',
        targetGameId: 'pi-east-seven-eight',
        rotation: {
          franchiseId: 'hawks',
          rotation: {
            franchiseId: 'hawks',
            starters: Array.from({ length: 5 }, (_, i) => fixturePlayerId(i)),
            benchOrder: Array.from({ length: 5 }, (_, i) => fixturePlayerId(5 + i)),
            targetMinutes: [
              ...Array.from({ length: 5 }, (_, i) => ({
                playerVersionId: fixturePlayerId(i),
                minutes: 32,
              })),
              ...Array.from({ length: 5 }, (_, i) => ({
                playerVersionId: fixturePlayerId(5 + i),
                minutes: 16,
              })),
            ],
            closingFive: Array.from({ length: 5 }, (_, i) => fixturePlayerId(i)),
            minutePolicy: { policyVersion: 'minute-policy-v1', strategy: 'balanced' },
            rotationVersion: 'season-rotation-v3',
          },
        },
      },
      { ...base, command: 'spectate-postseason-game', targetGameId: 'po-finals-g7' },
      { ...base, command: 'fast-forward-postseason' },
    ];
    const individual = [
      seasonSelectBlockObjectiveCommandSchema,
      seasonSpendInfluenceCommandSchema,
      seasonAcceptTradeOfferCommandSchema,
      seasonDeclineTradeOfferCommandSchema,
      seasonResumeSeasonBlockCommandSchema,
      seasonForfeitInterruptedGameCommandSchema,
      seasonStartPostseasonCommandSchema,
      seasonAdvancePostseasonCommandSchema,
      seasonAdvancePostseasonCommandSchema,
      seasonSubmitPostseasonRotationCommandSchema,
      seasonSpectatePostseasonGameCommandSchema,
      seasonFastForwardPostseasonCommandSchema,
    ];
    for (let index = 0; index < commands.length; index += 1) {
      const command = commands[index];
      const schema = individual[index];
      if (!schema) throw new Error('command schema pair missing');
      expect(schema.safeParse(command).success).toBe(true);
      expect(seasonRunCommandSchema.safeParse(command).success).toBe(true);
    }
    expect(() =>
      seasonRunCommandSchema.parse({
        command: 'start-postseason',
        runId: 'fixture-run-1',
        expectedStateRevision: 3,
        expectedStateDigest: '0'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'submit-postseason-rotation',
        targetGameId: 'pi-east-seven-eight',
        rotation: { franchiseId: 'hawks' },
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spectate-postseason-game',
        targetGameId: 's000001',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'select-block-objective',
        blockIndex: 8,
        objectiveId: 'win-six',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'select-block-objective',
        blockIndex: 0,
        objectiveId: 'clutch',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'risky-rehab',
        windowIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
        injuryId: `inj-${'e'.repeat(32)}`,
        windowIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'spend-influence',
        franchiseId: 'hawks',
        purpose: 'extra-trade-offer',
      }),
    ).toThrow();
    expect(() => seasonRunCommandSchema.parse({ ...base, command: 'unknown-command' })).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'resume-season-block',
        blockIndex: 1,
        rotationDigest: 'bad',
      }),
    ).toThrow();
    expect(() =>
      seasonRunCommandSchema.parse({
        ...base,
        command: 'accept-trade-offer',
        windowIndex: 3,
        offerId: `off-${'c'.repeat(32)}`,
      }),
    ).toThrow();
  });
  it('round-trips every rejection shape in the combined union', () => {
    const rejections = [
      { code: 'run-mismatch', expectedRunId: 'fixture-run-1' },
      { code: 'duplicate-command', commandId: 'cmd-1' },
      {
        code: 'stale-state',
        expectedStateRevision: 3,
        expectedStateDigest: '0'.repeat(32),
        currentStateRevision: 5,
        currentStateDigest: '1'.repeat(32),
      },
      { code: 'not-at-boundary', blockIndex: 2, nextUnselectedBlockIndex: 0 },
      {
        code: 'objective-not-offered',
        blockIndex: 0,
        objectiveId: 'win-six',
        offeredObjectiveIds: ['defense-108', 'bench-320', 'turnover-130'],
      },
      { code: 'objective-already-selected', blockIndex: 0, objectiveId: 'win-six' },
      {
        code: 'insufficient-balance',
        franchiseId: 'hawks',
        balance: -2,
        requestedDelta: -2,
        floor: -3,
      },
      { code: 'window-not-open', franchiseId: null, windowIndex: 0 },
      { code: 'already-spent', franchiseId: 'hawks', windowIndex: 0 },
      { code: 'injury-not-active', injuryId: `inj-${'e'.repeat(32)}` },
      { code: 'already-rehabbed', injuryId: `inj-${'e'.repeat(32)}` },
      { code: 'no-window', franchiseId: 'hawks' },
      { code: 'offer-unknown', windowIndex: 0, offerId: `off-${'f'.repeat(32)}` },
      { code: 'offer-not-open', windowIndex: 0, offerId: `off-${'f'.repeat(32)}` },
      {
        code: 'roster-illegal',
        windowIndex: 0,
        offerId: `off-${'f'.repeat(32)}`,
        reasons: ['resulting roster has 9 players'],
      },
      {
        code: 'ownership-conflict',
        windowIndex: 0,
        offerId: `off-${'f'.repeat(32)}`,
        playerVersionIds: [fixturePlayerId(0)],
      },
      { code: 'no-pending-block', blockIndex: 1 },
      { code: 'block-mismatch', blockIndex: 1, pendingBlockIndex: 2 },
      {
        code: 'rotation-digest-mismatch',
        rotationDigest: '0'.repeat(32),
        pendingRotationDigest: '1'.repeat(32),
      },
      { code: 'game-mismatch', nextGameId: 's000016', pendingNextGameId: 's000017' },
    ];
    for (const rejection of rejections) {
      expect(() => seasonRunCommandRejectionSchema.parse(rejection)).not.toThrow();
    }
    expect(() => seasonRunCommandRejectionSchema.parse({ code: 'nope' })).toThrow();
  });
  it('parses per-command rejection unions and result envelopes', () => {
    const acceptedObjective = seasonSelectBlockObjectiveResultSchema.parse({
      status: 'accepted',
      commandId: 'cmd-1',
      blockIndex: 0,
      objectiveId: 'win-six',
    });
    if (acceptedObjective.status !== 'accepted') throw new Error('expected accepted');
    expect(acceptedObjective.objectiveId).toBe('win-six');
    const rejectedObjective = seasonSelectBlockObjectiveResultSchema.parse({
      status: 'rejected',
      commandId: 'cmd-1',
      rejection: { code: 'not-at-boundary', blockIndex: 1, nextUnselectedBlockIndex: 0 },
    });
    if (rejectedObjective.status !== 'rejected') throw new Error('expected rejected');
    expect(rejectedObjective.rejection.code).toBe('not-at-boundary');
    const acceptedSpend = seasonSpendInfluenceResultSchema.parse({
      status: 'accepted',
      commandId: 'cmd-1',
      franchiseId: 'hawks',
      purpose: 'extra-trade-offer',
      ledgerEntry: {
        entryId: 'influence-spend-hawks-0',
        franchiseId: 'hawks',
        source: 'extra-trade-offer',
        blockIndex: 2,
        commandId: 'cmd-1',
        requestedDelta: -1,
        appliedDelta: -1,
        balanceAfter: 1,
        explanation: 'Extra trade offer',
      },
      generatedOffer: null,
    });
    if (acceptedSpend.status !== 'accepted') throw new Error('expected accepted');
    expect(acceptedSpend.ledgerEntry.balanceAfter).toBe(1);
    const acceptedTrade = seasonAcceptTradeOfferResultSchema.parse({
      status: 'accepted',
      commandId: 'cmd-1',
      trade: {
        offerId: `off-${'c'.repeat(32)}`,
        windowIndex: 0,
        seedPath: ['trades', 'window', '0', 'offer', '0'],
        toFranchiseId: 'hawks',
        fromFranchiseId: 'lakers',
        outgoingPlayerVersionIds: [fixturePlayerId(0)],
        incomingPlayerVersionIds: [fixturePlayerId(30)],
        outgoingHealth: [{ available: true, activeInjuryIds: [] }],
        incomingHealth: [{ available: true, activeInjuryIds: [] }],
        valueBand: { ratioBasisPoints: 1000, band: '85-115', qualified: true },
        roleFit: {
          outgoingRoles: ['perimeter-defense'],
          incomingRoles: ['primary-creation'],
          notes: '',
        },
        rosterNeedFacts: { outgoingDepth: 4, incomingDepth: 1, notes: '' },
        projectedRotationChanges: '',
        projectedChemistryDisruption: { removedPairs: 8, newPairs: 8 },
        status: 'accepted',
      },
      rosterChanges: [
        { franchiseId: 'hawks', added: [fixturePlayerId(30)], removed: [fixturePlayerId(0)] },
        { franchiseId: 'lakers', added: [fixturePlayerId(0)], removed: [fixturePlayerId(30)] },
      ],
    });
    if (acceptedTrade.status !== 'accepted') throw new Error('expected accepted');
    expect(acceptedTrade.rosterChanges).toHaveLength(2);
  });
  it('parses submit-season-block with the M2.5 objective and state fields', () => {
    const command = {
      schemaVersion: 11,
      blockVersion: 'season-block-v5',
      command: 'submit-season-block',
      commandId: 'cmd-submit-1',
      runId: 'fixture-run-1',
      expectedRevision: 0,
      blockIndex: 0,
      rotationDigest: '0'.repeat(32),
      objectiveId: 'win-six',
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
    };
    expect(seasonSubmitBlockCommandSchema.safeParse(command).success).toBe(true);
    expect(seasonRunCommandSchema.safeParse(command).success).toBe(true);
    expect(() =>
      seasonSubmitBlockCommandSchema.parse({ ...command, blockVersion: 'season-block-v2' }),
    ).toThrow();
    expect(() =>
      seasonSubmitBlockCommandSchema.parse({ ...command, expectedStateDigest: 'bad' }),
    ).toThrow();
  });
  it('parses the invalid-objective rejection on the submit rejection union', () => {
    expect(() =>
      seasonInvalidObjectiveRejectionSchema.parse({
        code: 'invalid-objective',
        expected: 'required',
        objectiveId: 'win-six',
        blockIndex: 0,
      }),
    ).not.toThrow();
    expect(() =>
      seasonInvalidObjectiveRejectionSchema.parse({
        code: 'invalid-objective',
        expected: 'none',
        blockIndex: 8,
      }),
    ).not.toThrow();
    expect(() =>
      seasonInvalidObjectiveRejectionSchema.parse({
        code: 'invalid-objective',
        expected: 'maybe',
        blockIndex: 0,
      }),
    ).toThrow();
    expect(() =>
      seasonSubmitBlockRejectionSchema.parse({
        code: 'invalid-objective',
        expected: 'not-offered',
        objectiveId: 'win-six',
        blockIndex: 2,
      }),
    ).not.toThrow();
  });
});
describe('season checkpoint M2.5 facts', () => {
  it('round-trips a candidate checkpoint with health, influence, transactions, and the state chain', () => {
    const checkpoint = roundTrip(seasonCandidateCheckpointSchema, buildCheckpointFixture());
    expect(checkpoint.health.injuries).toEqual([]);
    expect(checkpoint.transactions).toEqual([]);
    expect(Object.keys(checkpoint.influence.balances)).toHaveLength(30);
    expect(checkpoint.objective.objectiveId).toBeNull();
    expect(checkpoint.objective.success).toBeNull();
    expect(checkpoint.expectedStateRevision).toBe(0);
    expect(checkpoint.stateDigest).toBe('0'.repeat(32));
    expect(checkpoint.versions.healthVersion).toBe('season-health-v2');
    expect(checkpoint.versions.tradeTargetsVersion).toBe('trade-targets-v3');
    expect(checkpoint.freeAgency.windows).toEqual([]);
  });
  it('rejects a season-checkpoint-v2 candidate and missing M2.5 facts', () => {
    const checkpoint = buildCheckpointFixture();
    expect(() =>
      seasonCandidateCheckpointSchema.parse({
        ...checkpoint,
        checkpointVersion: 'season-checkpoint-v2',
      }),
    ).toThrow();
    expect(() =>
      seasonCandidateCheckpointSchema.parse({ ...checkpoint, health: undefined }),
    ).toThrow();
    expect(() =>
      seasonCandidateCheckpointSchema.parse({ ...checkpoint, stateRevision: undefined }),
    ).toThrow();
    expect(() =>
      seasonCandidateCheckpointSchema.parse({
        ...checkpoint,
        objective: { ...checkpoint.objective, objectiveId: 'win-six' },
      }),
    ).not.toThrow();
  });
  it('round-trips an accepted block with the state chain and a checkpoint state', () => {
    const accepted = {
      runId: 'fixture-run-1',
      blockIndex: 0,
      completedRounds: 10,
      revision: 0,
      commandId: 'cmd-submit-1',
      rotationDigest: '0'.repeat(32),
      checkpointDigest: '0'.repeat(32),
      summaryCount: 150,
      stateRevision: 1,
      stateDigest: '0'.repeat(32),
    };
    expect(roundTrip(seasonAcceptedBlockSchema, accepted).stateRevision).toBe(1);
    const checkpointState = {
      runId: 'fixture-run-1',
      blockIndex: 0,
      completedRounds: 10,
      revision: 0,
      commandId: 'cmd-submit-1',
      rotationDigest: '0'.repeat(32),
      checkpointDigest: '0'.repeat(32),
    };
    expect(roundTrip(seasonCheckpointStateSchema, checkpointState).blockIndex).toBe(0);
    expect(() =>
      seasonCheckpointStateSchema.parse({ ...checkpointState, checkpointDigest: 'bad' }),
    ).toThrow();
  });
});
describe('season worker wire v7 (M2.5.5)', () => {
  function buildStartRequest() {
    const run = buildRun();
    return {
      schemaVersion: 7,
      type: 'season-block-start',
      requestId: 'req-1',
      runId: run.runId,
      rootSeed: run.rootSeed,
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: '0'.repeat(32),
      commandId: 'cmd-1',
      run,
      schedule: buildSchedule(),
      homeCourt: SEASON_NEUTRAL_HOME_COURT,
      humanFranchiseId: null,
      catalogUrl: 'https://example.test/season/draft-catalog.json',
      catalogHash: '0'.repeat(64),
      profileUrl: 'https://example.test/season/era-sim.json',
      profileHash: '0'.repeat(64),
      priorSummaries: [],
      priorEffects: null,
      priorHealth: null,
      startGameId: null,
      objectiveId: null,
      priorInfluence: buildInitialInfluence(),
      expectedStateRevision: 0,
      expectedStateDigest: '0'.repeat(32),
    };
  }
  it('rejects wire schema 3 requests and messages', () => {
    const start = buildStartRequest();
    expect(() => seasonWorkerStartRequestSchema.parse({ ...start, schemaVersion: 3 })).toThrow();
    expect(() =>
      seasonWorkerCancelRequestSchema.parse({
        schemaVersion: 3,
        type: 'season-block-cancel',
        requestId: 'req-1',
      }),
    ).toThrow();
  });
  it('round-trips a start request with the M2.5 fields', () => {
    const request = roundTrip(seasonWorkerStartRequestSchema, buildStartRequest());
    expect(request.priorHealth).toBeNull();
    expect(request.startGameId).toBeNull();
    expect(request.objectiveId).toBeNull();
    expect(request.priorInfluence).not.toBeNull();
    expect(request.expectedStateRevision).toBe(0);
    const withResume = seasonWorkerStartRequestSchema.parse({
      ...buildStartRequest(),
      startGameId: 's000016',
      objectiveId: 'win-six',
      priorHealth: buildEmptyHealth(),
      priorSummaries: undefined,
      newSummaries: [buildSummaryFixture()],
    });
    expect(withResume.startGameId).toBe('s000016');
    expect(withResume.objectiveId).toBe('win-six');
    expect(() =>
      seasonWorkerStartRequestSchema.parse({
        ...buildStartRequest(),
        startGameId: 'not-a-game',
      }),
    ).toThrow();
  });
  it('round-trips complete messages with committed and interrupted results', () => {
    const committed = roundTrip(seasonWorkerCompleteMessageSchema, {
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId: 'req-1',
      result: { status: 'committed', checkpoint: buildCheckpointFixture() },
    });
    expect(committed.result.status).toBe('committed');
    const interrupted = roundTrip(seasonWorkerCompleteMessageSchema, {
      schemaVersion: 7,
      type: 'season-block-complete',
      requestId: 'req-1',
      result: { status: 'interrupted', pending: buildPendingBlockFixture() },
    });
    expect(interrupted.result.status).toBe('interrupted');
    expect(() =>
      seasonWorkerCompleteMessageSchema.parse({
        schemaVersion: 7,
        type: 'season-block-complete',
        requestId: 'req-1',
        result: { status: 'committed', pending: buildPendingBlockFixture() },
      }),
    ).toThrow();
  });
});
describe('season game summary injury events (M2.5)', () => {
  it('round-trips a summary with compact injury events', () => {
    const withEvents = seasonGameSummarySchema.parse({
      ...buildSummaryFixture(),
      injuryEvents: [
        {
          playerVersionId: fixturePlayerId(0),
          side: 'home',
          type: 'soft-tissue',
          severity: 'minor',
          removedClock: { period: 2, seconds: 300 },
          returned: true,
          returnClock: { period: 3, seconds: 480 },
        },
        {
          playerVersionId: fixturePlayerId(20),
          side: 'away',
          type: 'lower-body',
          severity: 'major',
          removedClock: { period: 1, seconds: 600 },
          returned: false,
          returnClock: null,
        },
      ],
    });
    expect(withEvents.injuryEvents).toHaveLength(2);
    expect(withEvents.injuryEvents[1]?.returnClock).toBeNull();
    expect(() =>
      seasonGameSummarySchema.parse({ ...buildSummaryFixture(), injuryEvents: undefined }),
    ).toThrow();
    expect(() =>
      seasonCompactInjuryEventSchema.parse({
        playerVersionId: fixturePlayerId(0),
        side: 'away',
        type: 'soft-tissue',
        severity: 'minor',
        removedClock: { period: 2, seconds: 300 },
        returned: true,
        returnClock: { period: 3, seconds: 480 },
      }),
    ).not.toThrow();
    expect(() =>
      seasonCompactInjuryEventSchema.parse({
        playerVersionId: fixturePlayerId(0),
        side: 'home',
        type: 'soft-tissue',
        severity: 'minor',
        removedClock: { period: 2, seconds: 300 },
        returned: true,
        returnClock: { period: 13, seconds: 0 },
      }),
    ).toThrow();
  });
});
describe('season block recap M2.5.5 evidence', () => {
  it('round-trips injury, objective, trade, and influence evidence', () => {
    const run = buildRun();
    const recap = {
      schemaVersion: 1,
      recapVersion: 'season-recap-v5',
      runId: run.runId,
      blockIndex: 1,
      completedRounds: 10,
      humanRecord: null,
      standingsMovement: [],
      notablePerformances: [],
      streaks: [],
      versionSpotlights: [],
      upcomingHumanGames: [],
      injuryEvidence: {
        injuries: 3,
        bySeverity: { minor: 2, moderate: 0, major: 1, 'season-ending': 0 },
        sameGameReturns: 1,
        seasonEnding: 0,
        returnedThisBlock: 2,
        activeAtBlockEnd: 1,
        humanTeamInjuries: [
          {
            playerVersionId: fixturePlayerId(0),
            side: 'home',
            type: 'upper-body',
            severity: 'moderate',
            removedClock: { period: 2, seconds: 400 },
            returned: false,
            returnClock: null,
          },
        ],
      },
      objectiveEvidence: {
        objectiveId: 'defense-108',
        success: true,
        evaluationFacts: {
          games: 10,
          wins: 6,
          pointsAllowed: 1050,
          reboundMargin: 15,
          tipsWithAtLeastEightAvailable: 10,
          tipsTotal: 10,
          benchMinutes: 340,
          turnovers: 120,
        },
      },
      campaignEvidence: null,
      tradeEvidence: { tradesAccepted: 1, influenceDelta: 2 },
      freeAgencyEvidence: {
        windowIndex: 0,
        signings: [],
        influenceDelta: 0,
        seasonSignings: 0,
        seasonSpend: 0,
      },
      influenceBalance: { humanBalance: 5 },
    };
    const parsed = roundTrip(seasonBlockRecapSchema, recap);
    expect(parsed.injuryEvidence.bySeverity.major).toBe(1);
    expect(parsed.objectiveEvidence?.evaluationFacts.pointsAllowed).toBe(1050);
    expect(parsed.tradeEvidence.tradesAccepted).toBe(1);
    expect(parsed.freeAgencyEvidence.windowIndex).toBe(0);
    expect(parsed.influenceBalance.humanBalance).toBe(5);
    expect(() => seasonBlockRecapSchema.parse({ ...recap, objectiveEvidence: null })).not.toThrow();
  });
});
