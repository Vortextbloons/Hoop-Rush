import { describe, expect, it } from 'bun:test';
import type {
  CapRushDraftPick,
  CapRushPlayoffApplied,
  CapRushPlayoffGamePlan,
  CapRushPlayoffObserved,
  PlayoffPerformance,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_PLAYOFF_CAPS,
  CAP_RUSH_PLAYOFF_FORMULA_VERSION,
  CAP_RUSH_PLAYOFF_SAMPLE_MINUTES,
  capRushLockedInputsSchema,
  capRushPlayoffGameSeed,
  capRushPlayoffPerformanceSchema,
  havocTeamInputSchema,
  playerIdSchema,
  playerVersionId,
} from '@hoop-rush/data-contracts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import { buildCapRushLockedInputs } from './lock.ts';
import {
  CAP_RUSH_PLAYOFF_FORMULA,
  capRushPlayoffAppliedOf,
  capRushPlayoffPerformanceOf,
  capRushPlayoffSampleWeight,
  capRushPlayoffTeam,
} from './playoff.ts';
import { simulateCapRushPlayoffGame } from './playoff-sim.ts';
import { simulateCapRushGame } from './season.ts';
import { createEngineContext } from '../../sim/kernel.ts';

const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`test fixture is missing ${label}`);
  return value;
}

function profile(input: {
  season: string;
  tsPct?: number | null;
  pointsPer36?: number | null;
  assistsPer36?: number | null;
  reboundsPer36?: number | null;
  turnoversPer36?: number | null;
  playoffMinutes?: number;
  playoffGames?: number;
}): PlayoffPerformance {
  const regular = {
    gamesPlayed: 70,
    minutes: 2400,
    points: 1400,
    assists: 350,
    rebounds: 500,
    turnovers: 200,
    fga: 1100,
    fta: 400,
    tsPct: 0.56,
  };
  const minutes = input.playoffMinutes ?? 400;
  return {
    season: input.season,
    regularSeason: regular,
    playoffs: {
      playerExternalId: '2544',
      gamesPlayed: input.playoffGames ?? 12,
      minutes,
      points: (regular.points / regular.minutes) * minutes,
      assists: (regular.assists / regular.minutes) * minutes,
      rebounds: (regular.rebounds / regular.minutes) * minutes,
      offensiveRebounds: null,
      defensiveRebounds: null,
      steals: null,
      blocks: null,
      turnovers: (regular.turnovers / regular.minutes) * minutes,
      fga: (regular.fga / regular.minutes) * minutes,
      fta: (regular.fta / regular.minutes) * minutes,
      tsPct: regular.tsPct + (input.tsPct ?? 0),
    },
    differences: {
      tsPct: input.tsPct ?? 0,
      pointsPer36: input.pointsPer36 ?? 0,
      assistsPer36: input.assistsPer36 ?? 0,
      reboundsPer36: input.reboundsPer36 ?? 0,
      turnoversPer36: input.turnoversPer36 ?? null,
    },
  };
}

function observed(input: Partial<CapRushPlayoffObserved> = {}): CapRushPlayoffObserved {
  return {
    tsPct: input.tsPct ?? null,
    pointsPer36: input.pointsPer36 ?? null,
    assistsPer36: input.assistsPer36 ?? null,
    reboundsPer36: input.reboundsPer36 ?? null,
    turnoversPer36: input.turnoversPer36 ?? null,
  };
}

function appliedOf(
  values: Partial<CapRushPlayoffObserved>,
  weight = 0.7,
  extra: {
    observedFieldGoalAttemptsPerGame?: number | null;
    authoritativeChannels?: string[];
  } = {},
): CapRushPlayoffApplied {
  return capRushPlayoffAppliedOf({
    observed: observed(values),
    weight,
    observedFieldGoalAttemptsPerGame: extra.observedFieldGoalAttemptsPerGame ?? null,
    authoritativeChannels: extra.authoritativeChannels ?? [],
  });
}

function buildPicks(setup: ReturnType<typeof capRushTestSetup>): CapRushDraftPick[] {
  return SLOTS.map((slot, index) => {
    const source = required(setup.index.bySlot.get(slot)?.[0], `a ${slot} candidate`);
    return {
      pickOrdinal: index,
      slot,
      card: {
        cardId: `crc-${String(index).padStart(32, '0')}`,
        offerId: 'cro-00000000000000000000000000000000',
        cardIndex: index,
        slot,
        bucket: 'strong',
        source,
        salaryDollars: 4_000_000,
      },
    };
  });
}

/**
 * The packaged historical field stamps every AI lineup player with the exact catalog version and
 * season it came from; the bare fixture bracket carries neither, so stamp a self-consistent
 * version here to exercise the AI path the way a new run does.
 */
function versionedBracket(
  setup: ReturnType<typeof capRushTestSetup>,
): ReturnType<typeof capRushTestSetup>['lockSources']['bracket'] {
  const bracket = setup.lockSources.bracket;
  const seasonKey = required(setup.catalog.candidates[0], 'a catalog candidate').seasonKey;
  return {
    ...bracket,
    opponents: bracket.opponents.map((opponent) => ({
      ...opponent,
      seasonKey,
      players: opponent.players.map((player) => ({
        ...player,
        playerVersionId: playerVersionId(
          playerIdSchema.parse(player.playerId),
          opponent.teamId,
          setup.lockSources.profile.eraId,
          seasonKey,
        ),
      })),
    })),
  };
}

function lockedOf(
  playoffProfileAt?: (seasonKey: string | null) => PlayoffPerformance | undefined,
  options: { versioned?: boolean } = {},
) {
  const setup = capRushTestSetup();
  const picks = buildPicks(setup);
  const bracket =
    options.versioned === true || playoffProfileAt !== undefined
      ? versionedBracket(setup)
      : setup.lockSources.bracket;
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: 'clash',
    versionSet: setup.versionSet,
    catalog: setup.source,
    picks,
    spin: null,
    bracket,
    profile: setup.lockSources.profile,
    ...(playoffProfileAt === undefined
      ? {}
      : { playoffProfiles: profilesFor(setup, bracket, picks, playoffProfileAt) }),
  });
}

function profilesFor(
  setup: ReturnType<typeof capRushTestSetup>,
  bracket: ReturnType<typeof capRushTestSetup>['lockSources']['bracket'],
  picks: readonly CapRushDraftPick[],
  playoffProfileAt: (seasonKey: string | null) => PlayoffPerformance | undefined,
): Map<string, PlayoffPerformance> {
  const entries: { playerVersionId: string; seasonKey: string | null }[] = [
    ...picks.map((pick) => ({
      playerVersionId: pick.card.source.playerVersionId,
      seasonKey: pick.card.source.seasonKey,
    })),
    ...bracket.opponents.flatMap((opponent) =>
      opponent.players.map((player) => ({
        playerVersionId: player.playerVersionId ?? '',
        seasonKey: opponent.seasonKey,
      })),
    ),
  ];
  return new Map(
    entries.flatMap((entry) => {
      const evidence = playoffProfileAt(entry.seasonKey);
      return evidence === undefined ? [] : ([[entry.playerVersionId, evidence]] as const);
    }),
  );
}

function planOf(locked: ReturnType<typeof lockedOf>): CapRushPlayoffGamePlan {
  return {
    seriesId: 'crs-1-0',
    round: 1,
    seriesSlot: 0,
    gameOrdinal: 1,
    homeTeamId: locked.human.teamId,
    awayTeamId: required(locked.opponents[0], 'an opponent').team.teamId,
    homeSeed: 1,
    awaySeed: 8,
    userSide: 'home',
    isFinals: false,
    seed: capRushPlayoffGameSeed(locked.runSeed, 1, 0, 1),
  };
}

function humanOf() {
  return lockedOf().human;
}

describe('cap rush playoff formula', () => {
  it('maps a measured difference into every bounded gameplay channel', () => {
    const applied = appliedOf({
      tsPct: 0.05,
      pointsPer36: 4,
      assistsPer36: 3,
      reboundsPer36: 3,
      turnoversPer36: 2,
    });
    const f = CAP_RUSH_PLAYOFF_FORMULA;
    expect(applied.fieldGoalPct).toBeCloseTo(f.tsPctSlope * 0.05 * 0.7, 10);
    expect(applied.threePointPct).toBe(applied.fieldGoalPct);
    expect(applied.fieldGoalAttemptsPerGame).toBeCloseTo(f.pointsPer36Slope * 4 * 0.7, 10);
    expect(applied.assistsPerGame).toBeCloseTo(f.assistsPer36AnchorSlope * 3 * 0.7, 10);
    expect(applied.passRate).toBeCloseTo(f.assistsPer36PassRateSlope * 3 * 0.7, 10);
    const rebounds = f.reboundsPer36Slope * 3 * 0.7;
    expect(applied.offensiveReboundsPerGame).toBeCloseTo(rebounds * f.offensiveReboundShare, 10);
    expect(applied.defensiveReboundsPerGame).toBeCloseTo(
      rebounds * (1 - f.offensiveReboundShare),
      10,
    );
    expect(applied.turnoverRate).toBeCloseTo(f.turnoversPer36Slope * 2 * 0.7, 10);
  });

  it('keeps both directions inside the published caps', () => {
    const extremes = {
      tsPct: 4,
      pointsPer36: 60,
      assistsPer36: 40,
      reboundsPer36: 40,
      turnoversPer36: 40,
    };
    const up = appliedOf(extremes, 1);
    const down = appliedOf(
      {
        tsPct: -extremes.tsPct,
        pointsPer36: -extremes.pointsPer36,
        assistsPer36: -extremes.assistsPer36,
        reboundsPer36: -extremes.reboundsPer36,
        turnoversPer36: -extremes.turnoversPer36,
      },
      1,
    );
    for (const applied of [up, down]) {
      expect(Math.abs(applied.fieldGoalPct)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct,
      );
      expect(Math.abs(applied.threePointPct)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.threePointPct,
      );
      expect(Math.abs(applied.fieldGoalAttemptsPerGame)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.fieldGoalAttemptsPerGame,
      );
      expect(Math.abs(applied.passRate)).toBeLessThanOrEqual(CAP_RUSH_PLAYOFF_CAPS.passRate);
      expect(Math.abs(applied.assistsPerGame)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.assistsPerGame,
      );
      expect(Math.abs(applied.offensiveReboundsPerGame)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.offensiveReboundsPerGame,
      );
      expect(Math.abs(applied.defensiveReboundsPerGame)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.defensiveReboundsPerGame,
      );
      expect(Math.abs(applied.turnoverRate)).toBeLessThanOrEqual(
        CAP_RUSH_PLAYOFF_CAPS.turnoverRate,
      );
    }
    expect(up.fieldGoalPct).toBe(CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct);
    expect(down.fieldGoalPct).toBe(-CAP_RUSH_PLAYOFF_CAPS.fieldGoalPct);
  });

  it('treats a positive turnover difference as a cost', () => {
    expect(appliedOf({ turnoversPer36: 1.5 }, 1).turnoverRate).toBeGreaterThan(0);
    expect(appliedOf({ turnoversPer36: -1.5 }, 1).turnoverRate).toBeLessThan(0);
  });

  it('leaves unrecorded measurements out instead of reading them as zero change', () => {
    const applied = appliedOf({ tsPct: 0.02, turnoversPer36: null }, 0.8);
    expect(applied.fieldGoalPct).toBeGreaterThan(0);
    expect(applied.turnoverRate).toBe(0);
    expect(appliedOf({}, 1).fieldGoalPct).toBe(0);
  });

  it('shrinks small samples toward neutral without discarding them', () => {
    expect(capRushPlayoffSampleWeight(0)).toBe(0);
    const tiny = capRushPlayoffSampleWeight(9);
    const anchor = capRushPlayoffSampleWeight(CAP_RUSH_PLAYOFF_SAMPLE_MINUTES);
    const large = capRushPlayoffSampleWeight(900);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(0.06);
    expect(anchor).toBeCloseTo(0.5, 10);
    expect(large).toBeGreaterThan(anchor);
    expect(large).toBeLessThan(1);
    expect(appliedOf({ tsPct: 0.05 }, tiny).fieldGoalPct).toBeLessThan(
      appliedOf({ tsPct: 0.05 }, large).fieldGoalPct,
    );
  });

  it('never moves shot volume more than half a player’s own attempt rate', () => {
    const limited = appliedOf({ pointsPer36: 40 }, 1, {
      observedFieldGoalAttemptsPerGame: 4,
    });
    expect(limited.fieldGoalAttemptsPerGame).toBeCloseTo(2, 10);
    expect(appliedOf({ pointsPer36: 40 }, 1).fieldGoalAttemptsPerGame).toBe(
      CAP_RUSH_PLAYOFF_CAPS.fieldGoalAttemptsPerGame,
    );
  });

  it('respects channels a mutation already owns', () => {
    const applied = appliedOf(
      { tsPct: 0.05, pointsPer36: 3, assistsPer36: 2, reboundsPer36: 2, turnoversPer36: 2 },
      1,
      {
        authoritativeChannels: [
          'two-point-accuracy',
          'three-point-accuracy',
          'assist-anchor',
          'rebound-weights',
          'turnover-blend',
          'offensive-allocation',
        ],
      },
    );
    expect(Object.values(applied).every((value) => value === 0)).toBe(true);
  });
});

describe('cap rush playoff rows', () => {
  it('uses only the exact player season and rejects a borrowed reputation', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    expect(
      capRushPlayoffPerformanceOf({
        human,
        opponents: [],
        profileOf: () => profile({ season: '1999-00', tsPct: 0.09 }),
      }).players,
    ).toHaveLength(0);
    const matched = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, tsPct: 0.09 }),
    });
    expect(matched.players).toHaveLength(human.starters.length);
    expect(matched.players[0]?.seasonKey).toBe(seasonKey);
  });

  it('records the observed difference beside the effective adjustment', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    const performance = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, tsPct: 0.06, pointsPer36: 3 }),
    });
    const row = required(performance.players[0], 'a pinned row');
    expect(row.observed.tsPct).toBeCloseTo(0.06, 10);
    expect(row.applied.fieldGoalPct).toBeGreaterThan(0);
    expect(row.applied.fieldGoalPct).toBeLessThan(0.06);
    expect(row.regularSeason.tsPct).not.toBeNull();
    expect(row.playoffs.tsPct).not.toBeNull();
    expect(row.weight).toBeGreaterThan(0);
    expect(row.weight).toBeLessThan(1);
    capRushPlayoffPerformanceSchema.parse(performance);
  });

  it('retains a negligible sample instead of dropping it', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    const performance = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, playoffMinutes: 0.01, tsPct: 0.4 }),
    });
    expect(performance.players.length).toBe(human.starters.length);
    expect(required(performance.players[0], 'a row').weight).toBeLessThan(0.001);
  });
});

describe('cap rush playoff application', () => {
  it('applies stored deltas to a copy without mutating the locked team', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    const performance = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, tsPct: 0.06, assistsPer36: 2 }),
    });
    const base = required(human.starters[0], 'a starter').source.profile;
    const baseAnchors = { ...required(base.anchors, 'anchors') };
    const baseTendencies = { ...base.tendencies };
    const adjusted = capRushPlayoffTeam({ team: human, performance });
    expect(human.starters[0]?.source.profile.anchors).toEqual(baseAnchors);
    expect(human.starters[0]?.source.profile.tendencies).toEqual(baseTendencies);
    const changed = required(adjusted.starters[0], 'an adjusted starter');
    expect(changed.source.profile.tendencies.passRate).not.toBe(baseTendencies.passRate);
    expect(changed.source.profile.anchors?.assistsPerGame).not.toBe(baseAnchors.assistsPerGame);
    expect(changed.effective.tendencies).toEqual(changed.source.profile.tendencies);
    havocTeamInputSchema.parse(adjusted);
  });

  it('takes each tendency shift from its own base so a mutation keeps its effect', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    const performance = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, assistsPer36: 2, turnoversPer36: 1 }),
    });
    const row = required(performance.players[0], 'a pinned row');
    const starter = required(human.starters[0], 'a starter');
    const mutatedStarter = {
      ...starter,
      effective: {
        ...starter.effective,
        tendencies: { ...starter.effective.tendencies, passRate: 88, turnoverRate: 40 },
      },
    };
    const mutated = { ...human, starters: [mutatedStarter, ...human.starters.slice(1)] };
    const adjusted = required(
      capRushPlayoffTeam({ team: mutated, performance }).starters[0],
      'an adjusted starter',
    );
    expect(adjusted.source.profile.tendencies.passRate).toBeCloseTo(
      Math.min(100, starter.source.profile.tendencies.passRate + row.applied.passRate),
      10,
    );
    expect(adjusted.effective.tendencies.passRate).not.toBe(
      adjusted.source.profile.tendencies.passRate,
    );
    expect(adjusted.effective.tendencies.turnoverRate).toBeCloseTo(
      40 + row.applied.turnoverRate,
      10,
    );
  });

  it('is idempotent when applied to the same base team repeatedly', () => {
    const human = humanOf();
    const seasonKey = required(required(human.starters[0], 'a starter').source.seasonKey, 'season');
    const performance = capRushPlayoffPerformanceOf({
      human,
      opponents: [],
      profileOf: () => profile({ season: seasonKey, tsPct: 0.06, turnoversPer36: 1 }),
    });
    expect(capRushPlayoffTeam({ team: human, performance })).toEqual(
      capRushPlayoffTeam({ team: human, performance }),
    );
  });

  it('returns the base team untouched with no pinned rows', () => {
    const human = humanOf();
    expect(capRushPlayoffTeam({ team: human, performance: undefined })).toBe(human);
  });
});

describe('cap rush playoff simulation', () => {
  it('leaves every regular-season game identical', () => {
    const plain = lockedOf(undefined, { versioned: true });
    const withEvidence = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.08, pointsPer36: 3 }),
    );
    expect(withEvidence.playoffPerformance?.players.length).toBeGreaterThan(0);
    const context = createEngineContext();
    for (const gameNumber of [1, 2, 41, 82]) {
      const before = simulateCapRushGame({ locked: plain, gameNumber, context });
      const after = simulateCapRushGame({ locked: withEvidence, gameNumber, context });
      expect(after.result).toEqual(before.result);
      expect(after.summary.resultDigest).toBe(before.summary.resultDigest);
    }
  });

  it('changes playoff games deterministically and audits cleanly', () => {
    const plain = lockedOf();
    const withEvidence = lockedOf((season) =>
      profile({
        season: required(season, 'season'),
        tsPct: 0.12,
        pointsPer36: 6,
        assistsPer36: 2,
        turnoversPer36: 1,
      }),
    );
    const context = createEngineContext();
    const plan = planOf(plain);
    const base = simulateCapRushPlayoffGame({ locked: plain, plan, context });
    const adjusted = simulateCapRushPlayoffGame({ locked: withEvidence, plan, context });
    expect(base.game.audit.ok).toBe(true);
    expect(adjusted.game.audit.ok).toBe(true);
    expect(adjusted.resultDigest).not.toBe(base.resultDigest);
    const replay = simulateCapRushPlayoffGame({ locked: withEvidence, plan, context });
    expect(replay.resultDigest).toBe(adjusted.resultDigest);
    expect(replay.game.result).toEqual(adjusted.game.result);
  });

  it('applies to AI-versus-AI series as well as the user team', () => {
    const plain = lockedOf();
    const withEvidence = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.15, pointsPer36: 8 }),
    );
    const second = required(plain.opponents[1], 'a second opponent');
    const third = required(plain.opponents[2], 'a third opponent');
    const plans: CapRushPlayoffGamePlan[] = [
      planOf(plain),
      {
        seriesId: 'crs-1-1',
        round: 1,
        seriesSlot: 1,
        gameOrdinal: 1,
        homeTeamId: second.team.teamId,
        awayTeamId: third.team.teamId,
        homeSeed: 4,
        awaySeed: 5,
        userSide: null,
        isFinals: false,
        seed: capRushPlayoffGameSeed(plain.runSeed, 1, 1, 1),
      },
    ];
    const context = createEngineContext();
    for (const plan of plans) {
      const base = simulateCapRushPlayoffGame({ locked: plain, plan, context });
      const adjusted = simulateCapRushPlayoffGame({ locked: withEvidence, plan, context });
      expect(base.game.audit.ok).toBe(true);
      expect(adjusted.game.audit.ok).toBe(true);
      expect(adjusted.resultDigest).not.toBe(base.resultDigest);
    }
  });

  it('keeps the home and away swap consistent', () => {
    const plain = lockedOf();
    const withEvidence = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.1, pointsPer36: 5 }),
    );
    const plan = planOf(plain);
    const swapped: CapRushPlayoffGamePlan = {
      ...plan,
      homeTeamId: plan.awayTeamId,
      awayTeamId: plan.homeTeamId,
      homeSeed: plan.awaySeed,
      awaySeed: plan.homeSeed,
      userSide: 'away',
      gameOrdinal: 2,
      seed: capRushPlayoffGameSeed(plain.runSeed, 1, 0, 2),
    };
    const context = createEngineContext();
    for (const candidate of [plan, swapped]) {
      const base = simulateCapRushPlayoffGame({ locked: plain, plan: candidate, context });
      const adjusted = simulateCapRushPlayoffGame({
        locked: withEvidence,
        plan: candidate,
        context,
      });
      expect(base.game.audit.ok).toBe(true);
      expect(adjusted.game.audit.ok).toBe(true);
      expect(adjusted.resultDigest).not.toBe(base.resultDigest);
    }
  });
});

describe('cap rush playoff pinning', () => {
  it('serializes the pinned rows through the locked contract', () => {
    const locked = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.07, pointsPer36: 2 }),
    );
    const roundTrip = capRushLockedInputsSchema.parse(
      JSON.parse(JSON.stringify(locked)) as unknown,
    );
    expect(roundTrip.playoffPerformance).toEqual(locked.playoffPerformance);
    expect(roundTrip.playoffPerformance?.formulaVersion).toBe(CAP_RUSH_PLAYOFF_FORMULA_VERSION);
    expect(roundTrip.playoffPerformance?.sampleMinutesAnchor).toBe(CAP_RUSH_PLAYOFF_SAMPLE_MINUTES);
  });

  it('rejects pinned rows that name another season', () => {
    const locked = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.07 }),
    );
    const pinned = required(locked.playoffPerformance, 'pinned rows');
    const tampered = {
      ...locked,
      playoffPerformance: {
        ...pinned,
        players: pinned.players.map((row) => ({ ...row, seasonKey: '1999-00' })),
      },
    };
    expect(capRushLockedInputsSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects a row for a player who is not in the locked field', () => {
    const locked = lockedOf((season) =>
      profile({ season: required(season, 'season'), tsPct: 0.07 }),
    );
    const pinned = required(locked.playoffPerformance, 'pinned rows');
    const tampered = {
      ...locked,
      playoffPerformance: {
        ...pinned,
        players: [
          ...pinned.players,
          { ...required(pinned.players[0], 'a row'), playerVersionId: `pv-${'f'.repeat(32)}` },
        ],
      },
    };
    expect(capRushLockedInputsSchema.safeParse(tampered).success).toBe(false);
  });

  it('leaves a locked run without rows unadjusted', () => {
    const locked = lockedOf();
    expect(locked.playoffPerformance).toBeUndefined();
    const context = createEngineContext();
    expect(
      simulateCapRushPlayoffGame({ locked, plan: planOf(locked), context }).game.audit.ok,
    ).toBe(true);
  });
});
