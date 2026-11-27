import { describe, expect, it } from 'bun:test';
import type { FullCourtDefensiveMatchups, SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildCapRushTestCatalog,
  capRushTestCatalogSource,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_FRANCHISE_ALIGNMENT,
  FULL_COURT_DEFAULT_MONEY,
  FULL_COURT_HEALTH_VERSION,
  commandIdSchema,
  franchiseIdSchema,
  fullCourtCreateDraftCommandSchema,
  playerVersionId,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { prepareTeam } from '../../sim/prepare.ts';
import { applyFullCourtCommand, createFullCourtDraftState } from './draft-commands.ts';
import { fullCourtDraftIndexOf } from './draft-catalog.ts';
import {
  checkFullCourtGameResult,
  fullCourtGameDigest,
  simulateFullCourtGame,
  simulateRecordedFullCourtGame,
  type FullCourtGameResult,
} from './game.ts';
import {
  fullCourtTestInput,
  fullCourtTestPlayer,
  fullCourtTestRoster,
} from './game-test-support.ts';
import {
  applyFullCourtDefensiveMatchupsToPrep,
  assertFullCourtDefensiveMatchups,
  resolveFullCourtDefensiveMatchups,
  validateFullCourtDefensiveMatchups,
} from './matchups.ts';
import {
  createFullCourtPlayoffCheckpoint,
  fullCourtPlayoffView,
  lockFullCourtPlayoffs,
  simulateFullCourtPlayoffGame,
} from './playoffs.ts';
import { buildFullCourtRegularSeason } from './regular-season.ts';
import {
  createFullCourtSeasonCheckpoint,
  lockFullCourtRegularSeason,
  simulateFullCourtSeasonSlot,
} from './season-slot.ts';

const ctx = createEngineContext();

function must<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function customPlayer(
  index: number,
  prefix: string,
  ratingOverrides: Partial<SimulationPlayer['ratings']>,
  tendencyOverrides: Partial<SimulationPlayer['tendencies']> = {},
): SimulationPlayer {
  const base = fullCourtTestPlayer({ index, prefix, rating: 72 });
  return {
    ...base,
    ratings: {
      ...base.ratings,
      ...ratingOverrides,
    },
    tendencies: {
      ...base.tendencies,
      ...tendencyOverrides,
    },
  };
}

function contestCount(
  result: FullCourtGameResult,
  side: 'home' | 'away',
  playerId: string,
): number {
  return (
    result[side].players.find((player) => player.playerId === playerId)?.diagnostics
      .contestedShots ?? 0
  );
}

function buildTestSeasonLock() {
  const field = CAP_RUSH_FRANCHISE_ALIGNMENT.map(({ franchiseId }) => ({
    teamId: franchiseId,
    displayName: franchiseId,
  }));
  const base = buildCapRushTestCatalog({ overalls: [70, 71, 72, 73, 74, 75] });
  const catalog = {
    ...base,
    candidates: field.flatMap(({ teamId }) =>
      base.candidates.map((player) => ({
        ...player,
        franchiseId: franchiseIdSchema.parse(teamId),
        playerVersionId: playerVersionId(player.playerId, teamId, player.eraId, player.seasonKey),
      })),
    ),
  };
  const catalogSource = capRushTestCatalogSource(catalog);
  const index = fullCourtDraftIndexOf(catalog, catalogSource);
  let draft = createFullCourtDraftState(
    fullCourtCreateDraftCommandSchema.parse({
      command: 'create-full-court-draft',
      commandId: commandIdSchema.parse('fc-matchups-create'),
      runId: 'fc-matchups-run',
      runSeed: seedSchema.parse(seedFromString('fc-matchups-season')),
      variant: 'standard',
      catalog: catalogSource,
      money: { ...FULL_COURT_DEFAULT_MONEY, capLineDollars: 0, firstApronDollars: 0 },
    }),
    index,
    { pool: 'open' },
  );
  for (const candidate of base.candidates.filter((player) => player.positions.primary === 'PG')) {
    draft = applyFullCourtCommand(
      draft,
      {
        command: 'pick-full-court-player',
        commandId: commandIdSchema.parse(`fc-matchups-pick-${String(draft.revision)}`),
        runId: draft.runId,
        expectedRevision: draft.revision,
        playerVersionId: candidate.playerVersionId,
      },
      { index },
    ).state;
  }
  draft = applyFullCourtCommand(
    draft,
    {
      command: 'finish-full-court-draft',
      commandId: commandIdSchema.parse('fc-matchups-finish'),
      runId: draft.runId,
      expectedRevision: draft.revision,
    },
    { index },
  ).state;
  const season = buildFullCourtRegularSeason({
    draft,
    field,
    catalog,
    catalogSource,
    profile: DEFAULT_ERA_SIM_PROFILE,
  });
  return lockFullCourtRegularSeason(season);
}

describe('full court defensive matchups', () => {
  it('validates against both locked rosters and rejects stale or conflicting targets', () => {
    const userRoster = fullCourtTestRoster('usr', 6);
    const opponentRoster = fullCourtTestRoster('opp', 6);

    expect(
      validateFullCourtDefensiveMatchups({
        userRoster,
        opponentTeamId: 'opp',
        opponentRoster,
        gameId: 'g1',
        matchups: {
          gameId: 'g1',
          opponentTeamId: 'opp',
          assignments: [{ opponentPlayerId: 'opp-0', defenderPlayerId: 'usr-2' }],
        },
      }),
    ).toEqual([]);

    expect(() =>
      assertFullCourtDefensiveMatchups({
        userRoster,
        opponentTeamId: 'opp',
        opponentRoster,
        gameId: 'g1',
        matchups: {
          gameId: 'g1',
          opponentTeamId: 'wrong-team',
          assignments: [{ opponentPlayerId: 'opp-0', defenderPlayerId: 'usr-2' }],
        },
      }),
    ).toThrow('different opponent');

    expect(
      validateFullCourtDefensiveMatchups({
        userRoster,
        opponentTeamId: 'opp',
        opponentRoster,
        matchups: {
          opponentTeamId: 'opp',
          assignments: [
            { opponentPlayerId: 'opp-0', defenderPlayerId: 'usr-2' },
            { opponentPlayerId: 'opp-1', defenderPlayerId: 'usr-2' },
          ],
        },
      }),
    ).toContain('Each defender can guard at most one assigned opponent.');

    expect(
      validateFullCourtDefensiveMatchups({
        userRoster,
        opponentTeamId: 'opp',
        opponentRoster,
        matchups: {
          opponentTeamId: 'opp',
          assignments: [{ opponentPlayerId: 'missing-opp', defenderPlayerId: 'usr-2' }],
        },
      }),
    ).toContain('A matchup target is outside the opponent roster.');
  });

  it('preserves exact seeded baseline when matchups are absent, stale, or on the bench', () => {
    const homeRoster = fullCourtTestRoster('hm', 7);
    const awayRoster = fullCourtTestRoster('aw', 7);
    const baseInput = fullCourtTestInput({ seed: 'noop-matchups', homeRoster, awayRoster });
    const baseDigest = fullCourtGameDigest(simulateFullCourtGame(baseInput, ctx));

    const emptyMatchups: FullCourtDefensiveMatchups = {
      opponentTeamId: baseInput.away.teamId,
      assignments: [],
    };
    const staleOpponent: FullCourtDefensiveMatchups = {
      opponentTeamId: 'different-team',
      assignments: [
        {
          opponentPlayerId: must(awayRoster[0]).playerId,
          defenderPlayerId: must(homeRoster[2]).playerId,
        },
      ],
    };
    expect(
      fullCourtGameDigest(
        simulateFullCourtGame(
          { ...baseInput, home: { ...baseInput.home, defensiveMatchups: emptyMatchups } },
          ctx,
        ),
      ),
    ).toBe(baseDigest);
    expect(
      fullCourtGameDigest(
        simulateFullCourtGame(
          { ...baseInput, home: { ...baseInput.home, defensiveMatchups: staleOpponent } },
          ctx,
        ),
      ),
    ).toBe(baseDigest);
    const benchOnly: FullCourtDefensiveMatchups = {
      opponentTeamId: baseInput.away.teamId,
      assignments: [
        {
          opponentPlayerId: must(awayRoster[0]).playerId,
          defenderPlayerId: must(homeRoster[6]).playerId,
        },
      ],
    };
    const zeroMinutes = Object.fromEntries(
      homeRoster.map((player, index) => [player.playerId, index < 5 ? 48 : 0]),
    );
    const zeroMinutesRotation = {
      startingFive: homeRoster.slice(0, 5).map((player) => player.playerId),
      minuteTargets: zeroMinutes,
    };
    const zeroMinutesDigest = fullCourtGameDigest(
      simulateFullCourtGame(
        {
          ...baseInput,
          home: { ...baseInput.home, rotation: zeroMinutesRotation },
        },
        ctx,
      ),
    );
    expect(
      fullCourtGameDigest(
        simulateFullCourtGame(
          {
            ...baseInput,
            home: {
              ...baseInput.home,
              rotation: zeroMinutesRotation,
              defensiveMatchups: benchOnly,
            },
          },
          ctx,
        ),
      ),
    ).toBe(zeroMinutesDigest);
  });

  it('shifts contested opportunities and defense metrics without changing ratings and keeps recording parity', () => {
    const homeRoster = [
      customPlayer(0, 'home', {
        perimeterDefense: 54,
        interiorDefense: 54,
        speed: 62,
        defensiveIq: 58,
      }),
      customPlayer(1, 'home', { perimeterDefense: 72, interiorDefense: 72, speed: 72 }),
      customPlayer(2, 'home', {
        perimeterDefense: 95,
        interiorDefense: 82,
        speed: 92,
        defensiveIq: 94,
        block: 76,
      }),
      customPlayer(3, 'home', { perimeterDefense: 72, interiorDefense: 74 }),
      customPlayer(4, 'home', { perimeterDefense: 62, interiorDefense: 80 }),
    ];
    const awayBaseStar = customPlayer(
      0,
      'away',
      { threePoint: 88, midrange: 85, ballHandling: 86, speed: 84 },
      {
        usageRate: 38,
        threePointRate: 52,
        cornerThreeFrequency: 20,
        aboveBreakThreeFrequency: 40,
        longMidFrequency: 18,
        rimFrequency: 14,
        shortMidFrequency: 8,
      },
    );
    const awayStar: SimulationPlayer = {
      ...awayBaseStar,
      anchors: {
        ...must(awayBaseStar.anchors),
        pointsPerGame: 32,
        threePointAttemptRate: 0.45,
      },
    };
    const rolePlayer = (
      index: number,
      ratings: Partial<SimulationPlayer['ratings']>,
    ): SimulationPlayer => {
      const base = customPlayer(index, 'away', ratings, { usageRate: 10 });
      return {
        ...base,
        anchors: {
          ...must(base.anchors),
          pointsPerGame: 8,
        },
      };
    };
    const awayRoster = [
      awayStar,
      rolePlayer(1, { threePoint: 68 }),
      rolePlayer(2, { threePoint: 68 }),
      rolePlayer(3, { insideScoring: 68 }),
      rolePlayer(4, { insideScoring: 68 }),
    ];

    const defenderZero = must(homeRoster[0]).playerId;
    const stopper = must(homeRoster[2]).playerId;
    const oppStar = must(awayRoster[0]).playerId;

    let defaultStopperContests = 0;
    let assignedStopperContests = 0;
    let defaultPgContests = 0;
    let assignedPgContests = 0;
    let defaultStarMakes = 0;
    let assignedStarMakes = 0;
    let defaultStarAttempts = 0;
    let assignedStarAttempts = 0;

    for (let seedIndex = 0; seedIndex < 30; seedIndex += 1) {
      const seed = `matchup-shift-${String(seedIndex)}`;
      const baseInput = fullCourtTestInput({ seed, homeRoster, awayRoster });
      const matchedInput = {
        ...baseInput,
        home: {
          ...baseInput.home,
          defensiveMatchups: {
            opponentTeamId: baseInput.away.teamId,
            assignments: [{ opponentPlayerId: oppStar, defenderPlayerId: stopper }],
          },
        },
      };

      const baseline = simulateFullCourtGame(baseInput, ctx);
      const matched = simulateFullCourtGame(matchedInput, ctx);
      expect(checkFullCourtGameResult(matched)).toEqual([]);

      if (seedIndex === 0) {
        const recorded = simulateRecordedFullCourtGame(matchedInput, ctx);
        expect(fullCourtGameDigest(recorded.result)).toBe(fullCourtGameDigest(matched));
      }

      defaultStopperContests += contestCount(baseline, 'home', stopper);
      assignedStopperContests += contestCount(matched, 'home', stopper);
      defaultPgContests += contestCount(baseline, 'home', defenderZero);
      assignedPgContests += contestCount(matched, 'home', defenderZero);

      const baseStar = must(baseline.away.players.find((player) => player.playerId === oppStar));
      const matchedStar = must(matched.away.players.find((player) => player.playerId === oppStar));
      defaultStarMakes += baseStar.fieldGoals.made;
      defaultStarAttempts += baseStar.fieldGoals.attempted;
      assignedStarMakes += matchedStar.fieldGoals.made;
      assignedStarAttempts += matchedStar.fieldGoals.attempted;
    }

    expect(assignedStopperContests).toBeGreaterThan(defaultStopperContests * 1.15);
    expect(assignedPgContests).toBeLessThan(defaultPgContests);
    expect(assignedStarMakes / assignedStarAttempts).toBeLessThan(
      defaultStarMakes / defaultStarAttempts,
    );
  });

  it('falls back cleanly when an assigned defender is resting, injured, or fouls out', () => {
    const homeRoster = fullCourtTestRoster('fb-home', 8, (index) => ({
      rating: 74,
      ...(index === 2 ? { foulRate: 28 } : {}),
    }));
    const awayRoster = fullCourtTestRoster('fb-away', 8, () => ({ rating: 74 }));
    const stopperId = must(homeRoster[2]).playerId;
    const oppTargetId = must(awayRoster[0]).playerId;

    const baseInput = fullCourtTestInput({
      seed: 'matchup-fallback',
      homeRoster,
      awayRoster,
      homeAvailability: homeRoster.map((player) => ({
        playerId: player.playerId,
        available: player.playerId !== stopperId,
        ...(player.playerId === stopperId ? { reason: 'rest' as const } : {}),
      })),
    });
    const restingMatchup = simulateFullCourtGame(
      {
        ...baseInput,
        home: {
          ...baseInput.home,
          defensiveMatchups: {
            opponentTeamId: baseInput.away.teamId,
            assignments: [{ opponentPlayerId: oppTargetId, defenderPlayerId: stopperId }],
          },
        },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(restingMatchup)).toEqual([]);
    expect(contestCount(restingMatchup, 'home', stopperId)).toBe(0);

    const foulOutResult = simulateFullCourtGame(
      {
        ...fullCourtTestInput({ seed: 'matchup-foulout', homeRoster, awayRoster }),
        home: {
          ...baseInput.home,
          availability: undefined,
          defensiveMatchups: {
            opponentTeamId: baseInput.away.teamId,
            assignments: [{ opponentPlayerId: oppTargetId, defenderPlayerId: stopperId }],
          },
        },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(foulOutResult)).toEqual([]);
  });

  it('never overloads one defender onto incompatible simultaneous targets in TeamPrep', () => {
    const homeRoster = fullCourtTestRoster('prep-h', 5);
    const awayRoster = fullCourtTestRoster('prep-a', 5);
    const resolved = resolveFullCourtDefensiveMatchups({
      ownRoster: homeRoster,
      opponentTeamId: 'away',
      opponentRoster: awayRoster,
      matchups: {
        opponentTeamId: 'away',
        assignments: [
          {
            opponentPlayerId: must(awayRoster[0]).playerId,
            defenderPlayerId: must(homeRoster[2]).playerId,
          },
          {
            opponentPlayerId: must(awayRoster[1]).playerId,
            defenderPlayerId: must(homeRoster[2]).playerId,
          },
        ],
      },
    });
    expect(resolved?.size).toBe(1);
    const profile = fullCourtTestInput({ seed: 'prep', homeRoster, awayRoster }).profile;
    const basePrep = prepareTeam(
      { teamId: 'home', displayName: 'Home', players: homeRoster },
      profile,
    );
    const adjusted = applyFullCourtDefensiveMatchupsToPrep(basePrep, [[0, 2]]);
    expect(adjusted).not.toBe(basePrep);
    // Displaced PG (slot 0) takes SF (slot 2) instead of SF (slot 2) guarding both 0 and 2.
    const sfTableWeights = adjusted.defenderBase.pickTables[4]?.[2];
    expect(sfTableWeights).toBeDefined();
  });

  it('applies matchups only to matching regular-season and playoff user fixtures', () => {
    const lock = buildTestSeasonLock();
    const checkpoint = createFullCourtSeasonCheckpoint(lock);
    const userTeam = must(lock.season.teams.find((team) => team.teamId === lock.season.userTeamId));
    const slot1UserFixture = must(
      lock.season.games.find(
        (game) =>
          game.slot === 1 &&
          (game.homeTeamId === userTeam.teamId || game.awayTeamId === userTeam.teamId),
      ),
    );
    const slot1OpponentId =
      slot1UserFixture.homeTeamId === userTeam.teamId
        ? slot1UserFixture.awayTeamId
        : slot1UserFixture.homeTeamId;
    const slot1Opponent = must(lock.season.teams.find((team) => team.teamId === slot1OpponentId));

    const baselineSlot = simulateFullCourtSeasonSlot(lock, checkpoint, ctx, {});
    const staleSlot = simulateFullCourtSeasonSlot(lock, checkpoint, ctx, {
      defensiveMatchups: {
        gameId: 'wrong-game-id',
        opponentTeamId: slot1OpponentId,
        assignments: [
          {
            opponentPlayerId: must(slot1Opponent.roster[0]).playerId,
            defenderPlayerId: must(userTeam.roster[2]).playerId,
          },
        ],
      },
    });
    expect(baselineSlot.kind).toBe('simulated');
    expect(staleSlot.kind).toBe('simulated');
    if (baselineSlot.kind === 'simulated' && staleSlot.kind === 'simulated') {
      expect(staleSlot.scores).toEqual(baselineSlot.scores);
    }

    const matchedSlot = simulateFullCourtSeasonSlot(lock, checkpoint, ctx, {
      defensiveMatchups: {
        gameId: slot1UserFixture.gameId,
        opponentTeamId: slot1OpponentId,
        assignments: [
          {
            opponentPlayerId: must(slot1Opponent.roster[0]).playerId,
            defenderPlayerId: must(userTeam.roster[2]).playerId,
          },
        ],
      },
    });
    expect(matchedSlot.kind).toBe('simulated');

    const regular = createFullCourtSeasonCheckpoint(lock);
    regular.completedThroughSlot = CAP_RUSH_CONFERENCE_GAMES_PER_TEAM;
    const scores = lock.season.games.map((fixture) => {
      if (fixture.slot === regular.completedThroughSlot) {
        for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
          regular.healthByTeam[teamId] = {
            teamId,
            version: FULL_COURT_HEALTH_VERSION,
            throughDay: fixture.dayOffset,
            players: {},
          };
        }
      }
      const homeWins = fixture.awayTeamId !== lock.season.userTeamId;
      return {
        ...fixture,
        outcome: {
          kind: 'played' as const,
          homePoints: homeWins ? 100 : 90,
          awayPoints: homeWins ? 90 : 100,
        },
      };
    });
    const playoffLock = lockFullCourtPlayoffs(lock, regular, scores);
    const playoffCheckpoint = createFullCourtPlayoffCheckpoint(playoffLock);
    const view = fullCourtPlayoffView(playoffLock, playoffCheckpoint);
    const next = must(view.nextGame);
    const playoffOpponentId = next.userSide === 'home' ? next.awayTeamId : next.homeTeamId;
    const playoffOpponent = must(
      lock.season.teams.find((team) => team.teamId === playoffOpponentId),
    );

    const playoffOutcome = simulateFullCourtPlayoffGame(playoffLock, playoffCheckpoint, ctx, {
      defensiveMatchups: {
        gameId: next.gameId,
        opponentTeamId: playoffOpponentId,
        assignments: [
          {
            opponentPlayerId: must(playoffOpponent.roster[0]).playerId,
            defenderPlayerId: must(userTeam.roster[1]).playerId,
          },
        ],
      },
    });
    expect(playoffOutcome.kind).toBe('simulated');
  });
});
