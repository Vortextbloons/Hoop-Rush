import { describe, expect, it } from 'bun:test';
import type { FullCourtTactics, ShotZone, SimulationPlayer } from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../../domain/zones.ts';
import type { EffectsHook } from '../../game/effects.ts';
import { createEngineContext } from '../../sim/kernel.ts';
import { prepareTeam } from '../../sim/prepare.ts';
import {
  checkFullCourtGameResult,
  fullCourtGameDigest,
  simulateFullCourtGame,
  type FullCourtGameResult,
} from './game.ts';
import { fullCourtTestInput, fullCourtTestRoster } from './game-test-support.ts';
import {
  applyFullCourtTacticsToPrep,
  fullCourtPaceMultiplier,
  fullCourtPressureEnergyScale,
  fullCourtProfiledPace,
  fullCourtTacticsEffects,
  resolveFullCourtTactics,
} from './tactics.ts';

const ctx = createEngineContext();
const homeRoster = fullCourtTestRoster('tactics-home', 5, () => ({ rating: 76 }));
const awayRoster = fullCourtTestRoster('tactics-away', 5, () => ({ rating: 76 }));
const SEEDS = Array.from({ length: 128 }, (_value, index) => `tactics-${String(index)}`);

const BALANCED: FullCourtTactics = {
  pace: 'balanced',
  offense: 'balanced',
  defense: 'balanced',
};
const FAST: FullCourtTactics = { ...BALANCED, pace: 'fast' };
const SLOW: FullCourtTactics = { ...BALANCED, pace: 'slow' };
const PERIMETER: FullCourtTactics = { ...BALANCED, offense: 'perimeter' };
const INTERIOR: FullCourtTactics = { ...BALANCED, offense: 'interior' };
const BALL_MOVEMENT: FullCourtTactics = { ...BALANCED, offense: 'ball-movement' };
const PRESSURE: FullCourtTactics = { ...BALANCED, defense: 'pressure' };
const PROTECT_PAINT: FullCourtTactics = { ...BALANCED, defense: 'protect-paint' };
const MIXED: FullCourtTactics = {
  pace: 'fast',
  offense: 'ball-movement',
  defense: 'pressure',
};
const SLOW_PAINT: FullCourtTactics = { ...PROTECT_PAINT, pace: 'slow' };
const ALL_SETTINGS = [
  FAST,
  SLOW,
  PERIMETER,
  INTERIOR,
  BALL_MOVEMENT,
  PRESSURE,
  PROTECT_PAINT,
  MIXED,
] as const;

const STAT_KEYS = [
  'points',
  'possessions',
  'threeAttempts',
  'threeShare',
  'freeThrowAttempts',
  'turnovers',
  'assists',
  'steals',
  'blocks',
  'defensiveRebounds',
  'rimAttempts',
  'energyRemaining',
] as const;
type StatKey = (typeof STAT_KEYS)[number];
type SideStats = Record<StatKey, number>;

const baselines = new Map<string, { home: SideStats; away: SideStats }>();

function simulateTactical(
  seed: string,
  homeTactics: FullCourtTactics,
  awayTactics: FullCourtTactics,
): FullCourtGameResult {
  const input = fullCourtTestInput({ seed, homeRoster, awayRoster });
  return simulateFullCourtGame(
    {
      ...input,
      home: { ...input.home, tactics: homeTactics },
      away: { ...input.away, tactics: awayTactics },
    },
    ctx,
  );
}

function baseline(seed: string): { home: SideStats; away: SideStats } {
  const cached = baselines.get(seed);
  if (cached !== undefined) return cached;
  const result = simulateFullCourtGame(fullCourtTestInput({ seed, homeRoster, awayRoster }), ctx);
  const stats = { home: sideStats(result, 'home'), away: sideStats(result, 'away') };
  baselines.set(seed, stats);
  return stats;
}

function zoneAttempts(result: FullCourtGameResult, side: 'home' | 'away', zone: ShotZone): number {
  return result[side].players.reduce(
    (sum, player) =>
      sum + (player.diagnostics.shotZones.find((entry) => entry.zone === zone)?.attempts ?? 0),
    0,
  );
}

function sideStats(result: FullCourtGameResult, side: 'home' | 'away'): SideStats {
  const team = result[side];
  const box = team.box;
  const seconds = team.players.reduce((sum, player) => sum + player.seconds, 0);
  const energy = team.players.reduce(
    (sum, player) => sum + player.energyRemaining * player.seconds,
    0,
  );
  return {
    points: box.points,
    possessions: box.possessions,
    threeAttempts: box.threes.attempted,
    threeShare: box.threes.attempted / Math.max(1, box.fieldGoals.attempted),
    freeThrowAttempts: box.freeThrows.attempted,
    turnovers: box.turnovers,
    assists: box.assists,
    steals: box.steals,
    blocks: box.blocks,
    defensiveRebounds: box.rebounds.defensive,
    rimAttempts: zoneAttempts(result, side, 'rim'),
    energyRemaining: energy / Math.max(1, seconds),
  };
}

function tacticalDeltas(
  homeTactics: FullCourtTactics,
  awayTactics: FullCourtTactics,
  games: number,
): { home: SideStats; away: SideStats } {
  const home = emptyStats();
  const away = emptyStats();
  for (const seed of SEEDS.slice(0, games)) {
    const before = baseline(seed);
    const after = simulateTactical(seed, homeTactics, awayTactics);
    addDelta(home, before.home, sideStats(after, 'home'));
    addDelta(away, before.away, sideStats(after, 'away'));
  }
  divide(home, games);
  divide(away, games);
  return { home, away };
}

function emptyStats(): SideStats {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as SideStats;
}

function addDelta(target: SideStats, before: SideStats, after: SideStats): void {
  for (const key of STAT_KEYS) target[key] += after[key] - before[key];
}

function divide(stats: SideStats, count: number): void {
  for (const key of STAT_KEYS) stats[key] /= count;
}

const tacticsProfile = fullCourtTestInput({
  seed: 'tactics-profile',
  homeRoster,
  awayRoster,
}).profile;
const tacticTeam = { teamId: 'tactics', displayName: 'Tactics', players: homeRoster };
const basePrep = prepareTeam(tacticTeam, tacticsProfile);

function zoneShareOfPrep(prep: ReturnType<typeof prepareTeam>, zone: ShotZone): number {
  const index = SHOT_ZONES.indexOf(zone);
  let zoneWeight = 0;
  let total = 0;
  for (const zones of prep.zonePrep.values()) {
    zoneWeight += zones.base[index] ?? 0;
    total += zones.base.reduce((sum, value) => sum + value, 0);
  }
  return zoneWeight / Math.max(1e-9, total);
}

function passValues(prep: ReturnType<typeof prepareTeam>): number[] {
  return [...prep.passP.values()].flat();
}

const ACTION_INDEX_NAMES = [
  'isolation',
  'pickAndRoll',
  'pickAndRollRoll',
  'postUp',
  'spotUp',
  'cut',
  'transition',
] as const;

function initiatorWeightOf(
  prep: ReturnType<typeof prepareTeam>,
  players: readonly SimulationPlayer[],
  index: number,
): number {
  const player = players[index];
  if (player === undefined) return 0;
  const slot = prep.slotByPlayerId.get(prep.keyOf(player));
  return slot === undefined ? 0 : (prep.initiatorWeights[slot] ?? 0);
}

function finishingWeightOf(
  prep: ReturnType<typeof prepareTeam>,
  players: readonly SimulationPlayer[],
  initiatorIndex: number,
  targetIndex: number,
  action: (typeof ACTION_INDEX_NAMES)[number] = 'spotUp',
): number {
  const initiator = players[initiatorIndex];
  const target = players[targetIndex];
  if (initiator === undefined || target === undefined) return 0;
  const entry = prep.teammateShots.get(prep.keyOf(initiator))?.byAction[
    ACTION_INDEX_NAMES.indexOf(action)
  ];
  if (entry === undefined) return 0;
  const position = entry.teammates.findIndex((mate) => prep.keyOf(mate) === prep.keyOf(target));
  return position < 0 ? 0 : (entry.weights[position] ?? 0);
}

function passProbabilityOf(
  prep: ReturnType<typeof prepareTeam>,
  players: readonly SimulationPlayer[],
  index: number,
): number {
  const player = players[index];
  if (player === undefined) return 0;
  return prep.passP.get(prep.keyOf(player))?.[ACTION_INDEX_NAMES.indexOf('isolation')] ?? 0;
}

describe('full court tactics API', () => {
  it('defaults absent or partial tactics to balanced', () => {
    expect(resolveFullCourtTactics(undefined)).toEqual(BALANCED);
    expect(resolveFullCourtTactics({} as FullCourtTactics)).toEqual(BALANCED);
    expect(resolveFullCourtTactics(MIXED)).toEqual(MIXED);
  });

  it('rejects unknown tactical values from external input', () => {
    const invalid = {
      pace: 'warp',
      offense: 'balanced',
      defense: 'balanced',
    } as unknown as FullCourtTactics;
    expect(() => resolveFullCourtTactics(invalid)).toThrow(/unknown pace tactic/);
  });

  it('combines both teams into a negotiated pace without mutating the profile', () => {
    expect(fullCourtPaceMultiplier([FAST, FAST])).toBeCloseTo(1.06, 12);
    expect(fullCourtPaceMultiplier([SLOW, SLOW])).toBeCloseTo(0.94, 12);
    expect(fullCourtPaceMultiplier([FAST, SLOW])).toBeCloseTo(1, 12);
    expect(fullCourtPaceMultiplier([FAST, BALANCED])).toBeCloseTo(1.03, 12);

    expect(fullCourtProfiledPace(tacticsProfile, 1)).toBe(tacticsProfile);
    const fast = fullCourtProfiledPace(tacticsProfile, 1.06);
    const slow = fullCourtProfiledPace(tacticsProfile, 0.94);
    expect(fast.parameters.pace).toBeGreaterThan(tacticsProfile.parameters.pace);
    expect(slow.parameters.pace).toBeLessThan(tacticsProfile.parameters.pace);
    expect(tacticsProfile.parameters.pace).toBe(95);
    expect(fast.profileVersion).toBe(tacticsProfile.profileVersion);
  });

  it('changes only the prepared lineup, never the players themselves', () => {
    const snapshot = JSON.stringify(homeRoster);
    const balanced = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
    );
    expect(balanced).toBe(basePrep);

    const perimeter = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      PERIMETER,
      'balanced',
    );
    const interior = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      INTERIOR,
      'balanced',
    );
    expect(zoneShareOfPrep(perimeter, 'cornerThree')).toBeGreaterThan(
      zoneShareOfPrep(basePrep, 'cornerThree'),
    );
    expect(zoneShareOfPrep(perimeter, 'rim')).toBeLessThan(zoneShareOfPrep(basePrep, 'rim'));
    expect(zoneShareOfPrep(interior, 'rim')).toBeGreaterThan(zoneShareOfPrep(basePrep, 'rim'));
    expect(zoneShareOfPrep(interior, 'aboveBreakThree')).toBeLessThan(
      zoneShareOfPrep(basePrep, 'aboveBreakThree'),
    );
    expect(JSON.stringify(homeRoster)).toBe(snapshot);
  });

  it('applies the defensive tradeoffs to the prepared lineup', () => {
    const pressure = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      PRESSURE,
      'balanced',
    );
    expect(pressure.pressure).toBeGreaterThan(basePrep.pressure);
    expect(pressure.stealAbility).toBeGreaterThan(basePrep.stealAbility);
    expect(pressure.defensiveReboundMean).toBeLessThan(basePrep.defensiveReboundMean);

    const paint = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      PROTECT_PAINT,
      'balanced',
    );
    expect(paint.pressure).toBeLessThan(basePrep.pressure);
    expect(paint.stealAbility).toBeLessThan(basePrep.stealAbility);
    expect(paint.defensiveReboundMean).toBeGreaterThan(basePrep.defensiveReboundMean);

    const faced = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'protect-paint',
    );
    expect(zoneShareOfPrep(faced, 'rim')).toBeLessThan(zoneShareOfPrep(basePrep, 'rim'));
    expect(zoneShareOfPrep(faced, 'aboveBreakThree')).toBeGreaterThan(
      zoneShareOfPrep(basePrep, 'aboveBreakThree'),
    );
  });

  it('moves ball movement probabilities without touching ratings', () => {
    const movement = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALL_MOVEMENT,
      'balanced',
    );
    const before = passValues(basePrep);
    const after = passValues(movement);
    expect(after).toHaveLength(before.length);
    for (const [index, value] of after.entries()) {
      expect(value).toBeGreaterThanOrEqual(before[index] ?? 0);
    }
    expect(movement.zonePrep).toBe(basePrep.zonePrep);
    expect(movement.twoPointAnchor).toBe(basePrep.twoPointAnchor);
  });

  it('leaves the prepared lineup untouched when no offensive hierarchy is assigned', () => {
    const prep = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
      undefined,
    );
    expect(prep).toBe(basePrep);
    const absent = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
      { primaryPlayerId: 'not-in-this-lineup' },
    );
    expect(absent).toBe(basePrep);
  });

  it('combines shot emphasis with ball movement', () => {
    const hybrid = { ...PERIMETER, ballMovement: true } as const;
    const perimeter = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      PERIMETER,
      'balanced',
    );
    const combined = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      hybrid,
      'balanced',
    );
    expect(zoneShareOfPrep(combined, 'rim')).toBe(zoneShareOfPrep(perimeter, 'rim'));
    expect(passValues(combined)[0] ?? 0).toBeGreaterThan(passValues(perimeter)[0] ?? 0);
    expect(
      fullCourtTacticsEffects(undefined, [hybrid, BALANCED])?.turnoverAdjustment({
        handlerVersion: 'h',
        offenseSide: 0,
      }),
    ).toBe(20_000);
  });

  it('weights ordered passing reads only for the selected handler and applies active unit roles', () => {
    const [handler, first, second, scorer, initiator] = homeRoster;
    if (!handler || !first || !second || !scorer || !initiator)
      throw new Error('Expected five players');
    const prepared = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
      {
        passingReads: { [handler.playerId]: [first.playerId, second.playerId] },
        unitRoles: [
          {
            playerIds: homeRoster.map((player) => player.playerId),
            primaryPlayerId: scorer.playerId,
            floorGeneralPlayerId: initiator.playerId,
          },
        ],
      },
    );
    expect(finishingWeightOf(prepared, homeRoster, 0, 1)).toBeCloseTo(
      finishingWeightOf(basePrep, homeRoster, 0, 1) * 1.6,
    );
    expect(finishingWeightOf(prepared, homeRoster, 0, 2)).toBeCloseTo(
      finishingWeightOf(basePrep, homeRoster, 0, 2) * 1.3,
    );
    expect(finishingWeightOf(prepared, homeRoster, 2, 1)).toBe(
      finishingWeightOf(basePrep, homeRoster, 2, 1),
    );
    expect(finishingWeightOf(prepared, homeRoster, 0, 3)).toBeGreaterThan(
      finishingWeightOf(basePrep, homeRoster, 0, 3),
    );
    expect(initiatorWeightOf(prepared, homeRoster, 4)).toBeGreaterThan(
      initiatorWeightOf(basePrep, homeRoster, 4),
    );
  });

  it('shifts opportunity weight to a primary option without changing ratings', () => {
    const snapshot = JSON.stringify(homeRoster);
    const hierarchy = { primaryPlayerId: homeRoster[1]?.playerId };
    const primary = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
      hierarchy,
    );

    expect(primary).not.toBe(basePrep);
    expect(initiatorWeightOf(primary, homeRoster, 1)).toBeGreaterThan(
      initiatorWeightOf(basePrep, homeRoster, 1),
    );
    expect(finishingWeightOf(primary, homeRoster, 0, 1)).toBeGreaterThan(
      finishingWeightOf(basePrep, homeRoster, 0, 1),
    );
    expect(passProbabilityOf(primary, homeRoster, 1)).toBeLessThan(
      passProbabilityOf(basePrep, homeRoster, 1),
    );
    expect(initiatorWeightOf(primary, homeRoster, 0)).toBe(
      initiatorWeightOf(basePrep, homeRoster, 0),
    );
    expect(JSON.stringify(homeRoster)).toBe(snapshot);
    expect(primary.zonePrep).toBe(basePrep.zonePrep);
  });

  it('gives a floor general creation and passing weight instead of shots', () => {
    const hierarchy = { floorGeneralPlayerId: homeRoster[0]?.playerId };
    const general = applyFullCourtTacticsToPrep(
      basePrep,
      homeRoster,
      tacticsProfile,
      BALANCED,
      'balanced',
      hierarchy,
    );

    expect(initiatorWeightOf(general, homeRoster, 0)).toBeGreaterThan(
      initiatorWeightOf(basePrep, homeRoster, 0),
    );
    expect(passProbabilityOf(general, homeRoster, 0)).toBeGreaterThan(
      passProbabilityOf(basePrep, homeRoster, 0),
    );
    expect(finishingWeightOf(general, homeRoster, 1, 0)).toBeLessThan(
      finishingWeightOf(basePrep, homeRoster, 1, 0),
    );
  });

  it('bounds the hierarchy shift and tempers it against a paint-packing matchup', () => {
    const rimHeavy: SimulationPlayer[] = homeRoster.map((player, index) =>
      index === 0
        ? {
            ...player,
            tendencies: {
              ...player.tendencies,
              rimFrequency: 90,
              shortMidFrequency: 10,
              longMidFrequency: 0,
              cornerThreeFrequency: 0,
              aboveBreakThreeFrequency: 0,
            },
          }
        : player,
    );
    const rimTeam = { teamId: 'rim', displayName: 'Rim', players: rimHeavy };
    const rimPrep = prepareTeam(rimTeam, tacticsProfile);
    const hierarchy = { primaryPlayerId: rimHeavy[0]?.playerId };
    const open = applyFullCourtTacticsToPrep(
      rimPrep,
      rimHeavy,
      tacticsProfile,
      BALANCED,
      'balanced',
      hierarchy,
    );
    const packed = applyFullCourtTacticsToPrep(
      rimPrep,
      rimHeavy,
      tacticsProfile,
      BALANCED,
      'protect-paint',
      hierarchy,
    );
    const before = finishingWeightOf(rimPrep, rimHeavy, 1, 0);
    const openAfter = finishingWeightOf(open, rimHeavy, 1, 0);
    const packedAfter = finishingWeightOf(packed, rimHeavy, 1, 0);

    expect(openAfter / before).toBeLessThanOrEqual(1.35);
    expect(openAfter / before).toBeGreaterThan(1);
    expect(packedAfter / before).toBeLessThan(openAfter / before);
    expect(packedAfter).toBeGreaterThan(before);
  });

  it('layers tactical effects over an optional caller hook', () => {
    expect(fullCourtTacticsEffects(undefined, [BALANCED, BALANCED])).toBeUndefined();
    const base: EffectsHook = {
      makeAdjustment: () => 111,
      turnoverAdjustment: () => 222,
      assistAdjustment: () => 333,
      setActiveUnits: () => {},
      recordStintSeconds: () => {},
      recordTrip: () => {},
      halftime: () => {},
    };
    expect(fullCourtTacticsEffects(base, [BALANCED, BALANCED])).toBe(base);
    expect(fullCourtPressureEnergyScale(PRESSURE)).toBeGreaterThan(1);
    expect(fullCourtPressureEnergyScale(BALANCED)).toBe(1);

    const layered = fullCourtTacticsEffects(base, [BALL_MOVEMENT, PRESSURE]);
    expect(layered).toBeDefined();
    if (layered === undefined) return;
    expect(layered.makeAdjustment({ shooterVersion: 's', offenseSide: 0, defenseSide: 1 })).toBe(
      111 + 6_000,
    );
    expect(layered.makeAdjustment({ shooterVersion: 's', offenseSide: 1, defenseSide: 0 })).toBe(
      111,
    );
    expect(layered.turnoverAdjustment({ handlerVersion: 'h', offenseSide: 0 })).toBe(222 + 20_000);
    expect(layered.turnoverAdjustment({ handlerVersion: 'h', offenseSide: 1 })).toBe(222);
    expect(layered.assistAdjustment({ offenseSide: 0 })).toBe(333 + 25_000);
    expect(layered.assistAdjustment({ offenseSide: 1 })).toBe(333);
  });
});

describe('full court tactics game behavior', () => {
  it('reproduces the default game exactly when every setting is balanced', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const base = simulateFullCourtGame(fullCourtTestInput({ seed, homeRoster, awayRoster }), ctx);
      const explicit = simulateTactical(seed, BALANCED, BALANCED);
      expect(fullCourtGameDigest(explicit)).toBe(fullCourtGameDigest(base));
      expect(explicit).toEqual(base);
    }
  });

  it('is deterministic and leaves the input rosters and profile untouched', () => {
    const input = fullCourtTestInput({ seed: 'tactics-immutable', homeRoster, awayRoster });
    const tactical = {
      ...input,
      home: { ...input.home, tactics: MIXED },
      away: { ...input.away, tactics: SLOW_PAINT },
    };
    const snapshot = structuredClone(tactical);
    const first = simulateFullCourtGame(tactical, ctx);
    const second = simulateFullCourtGame(tactical, ctx);
    expect(fullCourtGameDigest(first)).toBe(fullCourtGameDigest(second));
    expect(tactical).toEqual(snapshot);
  });

  it('keeps exact accounting under every setting', () => {
    for (const tactics of ALL_SETTINGS) {
      const result = simulateTactical(SEEDS[0] ?? 'tactics-accounting', tactics, BALANCED);
      expect(checkFullCourtGameResult(result)).toEqual([]);
      expect(result.home.teamSeconds).toBe(result.home.liveSeconds * 5);
      expect(result.away.teamSeconds).toBe(result.away.liveSeconds * 5);
    }
  });

  it('degrades effects-only tactics safely for rosters without player versions', () => {
    const legacyHome = homeRoster.map((player) => ({ ...player, playerVersionId: undefined }));
    const legacyAway = awayRoster.map((player) => ({ ...player, playerVersionId: undefined }));
    const input = fullCourtTestInput({
      seed: 'tactics-legacy',
      homeRoster: legacyHome,
      awayRoster: legacyAway,
    });
    const result = simulateFullCourtGame(
      {
        ...input,
        home: { ...input.home, tactics: MIXED },
        away: { ...input.away, tactics: SLOW_PAINT },
      },
      ctx,
    );
    expect(checkFullCourtGameResult(result)).toEqual([]);
  });

  it('trades possessions with pace', () => {
    const fast = tacticalDeltas(FAST, FAST, 32);
    const slow = tacticalDeltas(SLOW, SLOW, 32);
    expect(fast.home.possessions + fast.away.possessions).toBeGreaterThan(1.5);
    expect(slow.home.possessions + slow.away.possessions).toBeLessThan(-2);
  }, 30_000);

  it('moves perimeter offenses toward threes and away from the rim', () => {
    const deltas = tacticalDeltas(PERIMETER, BALANCED, 48);
    expect(deltas.home.threeShare).toBeGreaterThan(0.04);
    expect(deltas.home.threeAttempts).toBeGreaterThan(3);
    expect(deltas.home.rimAttempts).toBeLessThan(-1.2);
    expect(Math.abs(deltas.away.threeShare)).toBeLessThan(0.04);
  }, 30_000);

  it('moves interior offenses toward the rim and away from threes', () => {
    const deltas = tacticalDeltas(INTERIOR, BALANCED, 128);
    expect(deltas.home.rimAttempts).toBeGreaterThan(4.5);
    expect(deltas.home.threeShare).toBeLessThan(-0.03);
    expect(deltas.home.threeAttempts).toBeLessThan(-2);
    expect(deltas.away.blocks).toBeGreaterThan(0.2);
    expect(Math.abs(deltas.away.rimAttempts)).toBeLessThan(2);
  }, 30_000);

  it('buys ball movement with assists and turnovers', () => {
    const deltas = tacticalDeltas(BALL_MOVEMENT, BALANCED, 96);
    expect(deltas.home.assists).toBeGreaterThan(0.4);
    expect(deltas.home.turnovers).toBeGreaterThan(0.3);
  }, 30_000);

  it('trades pressure energy and rebounding position for opponent turnovers', () => {
    const deltas = tacticalDeltas(PRESSURE, BALANCED, 128);
    expect(deltas.away.turnovers).toBeGreaterThan(0.25);
    expect(deltas.home.steals).toBeGreaterThan(0.2);
    expect(deltas.home.energyRemaining).toBeLessThan(-0.04);
    expect(deltas.home.defensiveRebounds).toBeLessThan(-0.6);
  }, 30_000);

  it('takes away the paint while conceding threes', () => {
    const deltas = tacticalDeltas(BALANCED, PROTECT_PAINT, 128);
    expect(deltas.home.rimAttempts).toBeLessThan(-1.5);
    expect(deltas.home.threeShare).toBeGreaterThan(0.02);
    expect(deltas.home.threeAttempts).toBeGreaterThan(1.5);
  }, 30_000);

  it('counterplays interior and perimeter offenses differently', () => {
    const interior = tacticalDeltas(INTERIOR, BALANCED, 32);
    const interiorVsPaint = tacticalDeltas(INTERIOR, PROTECT_PAINT, 32);
    const perimeter = tacticalDeltas(PERIMETER, BALANCED, 32);
    const perimeterVsPaint = tacticalDeltas(PERIMETER, PROTECT_PAINT, 32);
    expect(interiorVsPaint.home.rimAttempts).toBeLessThan(interior.home.rimAttempts - 2);
    expect(perimeterVsPaint.home.threeAttempts).toBeGreaterThan(perimeter.home.threeAttempts + 2);
  }, 30_000);
});

describe.skipIf(process.env.HOOP_RUSH_PERF_STRICT !== '1')('full court tactics performance', () => {
  it('keeps tactical lineup preparation well inside the full-court budget', () => {
    const input = fullCourtTestInput({ seed: 'tactics-perf', homeRoster, awayRoster });
    const tactical = {
      ...input,
      home: { ...input.home, tactics: MIXED },
      away: { ...input.away, tactics: SLOW_PAINT },
    };
    simulateFullCourtGame(tactical, ctx);
    const samples: number[] = [];
    for (let index = 0; index < 40; index += 1) {
      // eslint-disable-next-line no-restricted-globals -- perf-gated timing probe only
      const start = performance.now();
      simulateFullCourtGame(tactical, ctx);
      // eslint-disable-next-line no-restricted-globals -- perf-gated timing probe only
      samples.push(performance.now() - start);
    }
    samples.sort((left, right) => left - right);
    const median = samples[20];
    const p95 = samples[38];
    if (median === undefined || p95 === undefined) throw new Error('missing perf samples');
    expect(median).toBeLessThan(30);
    expect(p95).toBeLessThan(75);
  });
});
