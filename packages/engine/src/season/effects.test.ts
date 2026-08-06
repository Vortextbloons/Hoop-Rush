import { describe, expect, it } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  playerVersionId,
  type Position,
  type SeasonEffectsState,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonStaminaInput,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import type { Rng } from '../sim/rng.ts';
import { createEngineContext, type EngineContext } from '../sim/context.ts';
import { simulateSeasonGame, simulateSeasonGameWithEffects } from './season-game.ts';
import {
  applySeasonGameEffectsTransition,
  createSeasonEffectsBuffer,
  createSeasonEffectsState,
  SEASON_EFFECTS_MECHANISM_CAPS,
} from './effects.ts';
import { pairChemistryBasisPoints, unitChemistryBasisPoints, unitPairs } from './chemistry.ts';
import {
  applySeasonRecoveryTick,
  onCourtFatigueBp,
  recentLoadAfterGame,
  regulationShareBp,
  stintMultiplierBp,
} from './stamina.ts';

const ctx = createEngineContext();

/** Same ten-slot position plan as season-game.test.ts (legal everywhere). */
const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['SG', 'SF'],
  ['C'],
  ['PF', 'C'],
];

function buildStaminaRoster(side: 'home' | 'away', offset = 0): StaminaRoster {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = `p-ef-${side}-${String(index + 1 + offset)}`;
    const base = buildSimulationPlayer();
    return {
      playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
      playerId,
      displayName: `${side} player ${String(index + 1 + offset)}`,
      positions: [...positions],
      heightInches: 76,
      weightLbs: 200,
      ratings: { ...base.ratings },
      tendencies: { ...base.tendencies },
    };
  });
  const staminaInputs: SeasonStaminaInput[] = players.map((player, index) => ({
    schemaVersion: 1,
    playerVersionId: player.playerVersionId,
    // Starters (0-4) high-stamina, bench (5-9) medium: rating varies.
    rating: index < 5 ? 80 : 65,
    historicalMpg: index < 5 ? 28 : 16,
    derivationVersion: 'season-stamina-v1',
  }));
  return {
    teamId: side === 'home' ? 'home-team' : 'away-team',
    displayName: side === 'home' ? 'Home Team' : 'Away Team',
    franchiseId,
    players: players.map((player, index) => ({
      ...player,
      stamina: staminaInputs[index],
    })),
    staminaInputs,
  };
}

function buildRotation(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((p) => p.playerVersionId);
  const starters = ids.slice(0, 5);
  const bench = ids.slice(5);
  const targets = SEASON_ROTATION_PRESET_TARGETS.balanced;
  return {
    franchiseId: team.franchiseId,
    starters,
    benchOrder: bench,
    targetMinutes: [
      ...starters.map((playerVersionId) => ({ playerVersionId, minutes: targets.starters })),
      ...bench.map((playerVersionId, index) => ({
        playerVersionId,
        minutes: targets.bench[index] ?? 0,
      })),
    ],
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => {
      if (id === undefined) throw new Error('fixture closing five missing player');
      return id;
    }),
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}

function buildGameInput(
  home: SeasonGameTeamInput,
  away: SeasonGameTeamInput,
  seed = 'season-effects-1',
): SeasonGameSimulationInput {
  return {
    schemaVersion: 1,
    seed: seedFromString(seed),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: buildRotation(home),
    awayRotation: buildRotation(away),
    availability: [...home.players, ...away.players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: true,
    })),
    removals: [],
    returns: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
  };
}

/** A ten-player roster with its stamina inputs (return type of buildStaminaRoster). */
type StaminaRoster = SeasonGameTeamInput & { staminaInputs: SeasonStaminaInput[] };

/** Builds a 300-input league state: rosters 0-1 are home/away, 2-29 filler. */
function buildLeagueState(
  home: StaminaRoster,
  away: StaminaRoster,
): {
  state: SeasonEffectsState;
  homeStamina: Map<string, SeasonStaminaInput>;
  awayStamina: Map<string, SeasonStaminaInput>;
} {
  const allInputs: SeasonStaminaInput[] = [];
  for (let roster = 0; roster < 30; roster += 1) {
    for (let slot = 0; slot < 10; slot += 1) {
      if (roster === 0) {
        const input = home.staminaInputs[slot];
        if (input !== undefined) allInputs.push(input);
      } else if (roster === 1) {
        const input = away.staminaInputs[slot];
        if (input !== undefined) allInputs.push(input);
      } else {
        const fillerId = playerVersionId(
          `p-filler-${String(roster)}-${String(slot)}`,
          `filler-${String(roster)}`,
          '1990s',
          '1995-96',
        );
        allInputs.push({
          schemaVersion: 1,
          playerVersionId: fillerId,
          rating: 60 + ((roster + slot) % 20),
          historicalMpg: 12 + ((roster + slot) % 20),
          derivationVersion: 'season-stamina-v1',
        });
      }
    }
  }
  const state = createSeasonEffectsState(allInputs);
  return {
    state,
    homeStamina: new Map(home.staminaInputs.map((s) => [s.playerVersionId, s])),
    awayStamina: new Map(away.staminaInputs.map((s) => [s.playerVersionId, s])),
  };
}

/** Counting RNG wrapper: proves effects consume no additional draws. */
function countingContext(): { engine: EngineContext; draws: () => number } {
  let draws = 0;
  const base = createEngineContext();
  const engine = createEngineContext({
    rngFactory: (seed) => {
      const inner = base.rngFactory(seed);
      const counted: Rng = {
        ...inner,
        chance: (probability) => {
          draws += 1;
          return inner.chance(probability);
        },
        nextInt: (min, max) => {
          draws += 1;
          return inner.nextInt(min, max);
        },
        weightedPick: (items, weights) => {
          draws += 1;
          return inner.weightedPick(items, weights);
        },
      };
      return counted;
    },
  });
  return { engine, draws: () => draws };
}

function fatigueOf(state: SeasonEffectsState, version: string): number {
  const player = state.playerStates.find((p) => p.playerVersionId === version);
  if (player === undefined) throw new Error(`no load state for ${version}`);
  return player.fatigueBasisPoints;
}

describe('M2.4 effects zero-profile identity', () => {
  it('consumes no additional RNG draws and starts from exact-zero adjustments', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const input = buildGameInput(home, away, 'effects-zero-identity');
    const { state } = buildLeagueState(home, away);

    const neutral = countingContext();
    simulateSeasonGame(input, neutral.engine);

    const effects = countingContext();
    const { result, transition } = simulateSeasonGameWithEffects(input, effects.engine, state);
    // The effects hook adds no draws to the possession pipeline.
    expect(effects.draws()).toBe(neutral.draws());
    expect(result.outcome).toBe('completed');
    expect(transition.pregamePlayerStates).toHaveLength(300);
    expect(transition.postgamePlayerStates).toHaveLength(300);
    expect(transition.pairIncrements.length).toBeGreaterThan(0);
    // With a zero carried state, every recorded input is at the zero floor
    // and every delta stays inside its declared cap.
    for (const row of transition.evidence) {
      const cap = SEASON_EFFECTS_MECHANISM_CAPS[row.mechanism];
      expect(Math.abs(row.deltaMax)).toBeLessThanOrEqual(cap);
      expect(Math.abs(row.deltaMin)).toBeLessThanOrEqual(cap);
      expect(Math.abs(row.deltaTotals)).toBeLessThanOrEqual(cap * row.opportunities);
    }
  });

  it('returns exactly +0 from every adjustment query on a zero-state buffer', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const buffer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    const homeUnit = home.players.slice(0, 5).map((p) => p.playerVersionId);
    const awayUnit = away.players.slice(0, 5).map((p) => p.playerVersionId);
    buffer.hook.setActiveUnits(homeUnit, awayUnit);
    const shooter = homeUnit[0] ?? '';
    const handler = homeUnit[1] ?? '';
    expect(
      buffer.hook.makeAdjustment({ shooterVersion: shooter, offenseSide: 0, defenseSide: 1 }),
    ).toBe(0);
    expect(buffer.hook.turnoverAdjustment({ handlerVersion: handler, offenseSide: 0 })).toBe(0);
    expect(buffer.hook.assistAdjustment({ offenseSide: 0 })).toBe(0);
    expect(
      buffer.hook.makeAdjustment({
        shooterVersion: homeUnit[2] ?? '',
        offenseSide: 0,
        defenseSide: 1,
      }),
    ).toBe(0);
  });

  it('round-trips deterministically for the same input, state, and seed', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const input = buildGameInput(home, away, 'effects-determinism');
    const { state } = buildLeagueState(home, away);
    const first = simulateSeasonGameWithEffects(input, ctx, state);
    const second = simulateSeasonGameWithEffects(input, ctx, state);
    expect(JSON.stringify(first.result)).toBe(JSON.stringify(second.result));
    expect(JSON.stringify(first.transition)).toBe(JSON.stringify(second.transition));
  });
});

describe('M2.4 fixed-point fatigue mechanics', () => {
  it('accumulates on court proportionally to elapsed seconds and inversely to stamina', () => {
    const rating = 70;
    const base = onCourtFatigueBp(600, rating, 600, 0);
    const more = onCourtFatigueBp(900, rating, 900, 0);
    expect(more).toBeGreaterThan(base);
    const lowStamina = onCourtFatigueBp(600, 50, 600, 0);
    const highStamina = onCourtFatigueBp(600, 90, 600, 0);
    expect(lowStamina).toBeGreaterThan(highStamina);
    expect(base).toBeGreaterThan(0);
  });

  it('applies the consecutive-stint multiplier ramp from 6 to 12 minutes', () => {
    expect(stintMultiplierBp(0)).toBe(10_000);
    expect(stintMultiplierBp(360)).toBe(10_000);
    expect(stintMultiplierBp(720)).toBe(12_500);
    expect(stintMultiplierBp(540)).toBe(11_250);
    expect(stintMultiplierBp(800)).toBe(12_500);
  });

  it('never reduces fatigue when minutes, stint length, or recent load increase', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const version = home.players[0]?.playerVersionId ?? '';
    const unit = home.players.slice(0, 5).map((p) => p.playerVersionId);

    const fresh = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    fresh.hook.setActiveUnits(
      unit,
      away.players.slice(0, 5).map((p) => p.playerVersionId),
    );
    fresh.hook.recordStintSeconds(0, 600, unit);
    const afterShort = fatigueOf(
      applySeasonGameEffectsTransition(state, {
        schemaVersion: 1,
        pregamePlayerStates: state.playerStates,
        postgamePlayerStates: fresh.finishGame(new Map(), new Map()).postgamePlayerStates,
        pairIncrements: [],
        evidence: [],
      }),
      version,
    );

    const longer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    longer.hook.setActiveUnits(
      unit,
      away.players.slice(0, 5).map((p) => p.playerVersionId),
    );
    longer.hook.recordStintSeconds(0, 1200, unit);
    const afterLong = fatigueOf(
      applySeasonGameEffectsTransition(state, {
        schemaVersion: 1,
        pregamePlayerStates: state.playerStates,
        postgamePlayerStates: longer.finishGame(new Map(), new Map()).postgamePlayerStates,
        pairIncrements: [],
        evidence: [],
      }),
      version,
    );
    expect(afterLong).toBeGreaterThanOrEqual(afterShort);

    // Uninterrupted stint accumulates no less than a broken one of equal total.
    const broken = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    broken.hook.setActiveUnits(
      unit,
      away.players.slice(0, 5).map((p) => p.playerVersionId),
    );
    broken.hook.recordStintSeconds(0, 600, unit);
    broken.hook.recordStintSeconds(0, 0, []);
    broken.hook.recordStintSeconds(0, 600, unit);
    const afterBroken = fatigueOf(
      applySeasonGameEffectsTransition(state, {
        schemaVersion: 1,
        pregamePlayerStates: state.playerStates,
        postgamePlayerStates: broken.finishGame(new Map(), new Map()).postgamePlayerStates,
        pairIncrements: [],
        evidence: [],
      }),
      version,
    );
    expect(afterLong).toBeGreaterThanOrEqual(afterBroken);
  });

  it('applies the halftime removal exactly once', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const buffer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    buffer.hook.halftime();
    expect(() => {
      buffer.hook.halftime();
    }).toThrow();
  });

  it('updates recent load as 60% previous + 40% regulation-minute share', () => {
    expect(regulationShareBp(0)).toBe(0);
    expect(regulationShareBp(1440)).toBe(5000);
    expect(regulationShareBp(2880)).toBe(10_000);
    expect(recentLoadAfterGame(4000, 1440)).toBe(Math.round(0.6 * 4000 + 0.4 * 5000));
    expect(recentLoadAfterGame(10_000, 2880)).toBe(10_000);
  });
});

describe('M2.4 between-game recovery tick', () => {
  it('reduces every positive fatigue state, never below zero, capped rounds', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina } = buildLeagueState(home, away);
    const fatigueState = applySeasonGameEffectsTransition(state, {
      schemaVersion: 1,
      pregamePlayerStates: state.playerStates,
      postgamePlayerStates: state.playerStates.map((player) => ({
        ...player,
        fatigueBasisPoints: Math.min(10_000, player.fatigueBasisPoints + 3000),
      })),
      pairIncrements: [],
      evidence: [],
    });
    const staminaByVersion = new Map<string, number>();
    for (const input of homeStamina.values()) {
      staminaByVersion.set(input.playerVersionId, input.rating);
    }
    const ratings = new Map(
      state.playerStates.map((player) => [
        player.playerVersionId,
        staminaByVersion.get(player.playerVersionId) ?? 70,
      ]),
    );
    const ticked = applySeasonRecoveryTick(fatigueState, ratings);
    for (const player of ticked.playerStates) {
      expect(player.fatigueBasisPoints).toBeGreaterThanOrEqual(0);
      expect(player.fatigueBasisPoints).toBeLessThanOrEqual(
        fatigueOf(fatigueState, player.playerVersionId),
      );
      expect(player.lastCompletedRound).toBe(1);
    }
    // Positive states strictly decrease with a high enough factor.
    const heavy = ticked.playerStates.find((p) => p.fatigueBasisPoints > 0);
    expect(heavy).toBeDefined();
    const twice = applySeasonRecoveryTick(ticked, ratings);
    for (const player of twice.playerStates) {
      const once = fatigueOf(ticked, player.playerVersionId);
      expect(player.fatigueBasisPoints).toBeLessThanOrEqual(once);
    }
    expect(twice.playerStates[0]?.lastCompletedRound).toBe(2);
  });
});

describe('M2.4 pair chemistry', () => {
  it('converts shared possessions monotonically to basis points', () => {
    expect(pairChemistryBasisPoints(0)).toBe(0);
    expect(pairChemistryBasisPoints(600)).toBe(5000);
    expect(pairChemistryBasisPoints(1200)).toBeGreaterThan(6000);
    expect(pairChemistryBasisPoints(100_000)).toBeGreaterThan(9900);
  });

  it('equals the mean of the unit pairs', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state } = buildLeagueState(home, away);
    const unit = home.players.slice(0, 5).map((p) => p.playerVersionId);
    const sharedState: SeasonEffectsState = {
      ...state,
      pairStates: state.pairStates.map((pair) => ({ ...pair, sharedPossessions: 600 })),
    };
    const expected =
      unitPairs(unit)
        .map(() => pairChemistryBasisPoints(600))
        .reduce((sum, v) => sum + v, 0) / 10;
    expect(unitChemistryBasisPoints(sharedState.pairStates, unit)).toBe(Math.round(expected));
  });

  it('increments a pair only when both members share a completed trip', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const buffer = createSeasonEffectsBuffer(state, homeStamina, awayStamina);
    const unitA = home.players.slice(0, 5).map((p) => p.playerVersionId);
    const unitB = home.players.slice(5).map((p) => p.playerVersionId);
    const awayUnit = away.players.slice(0, 5).map((p) => p.playerVersionId);
    buffer.hook.recordTrip({
      homeUnit: unitA,
      awayUnit: awayUnit,
      handler: unitA[0] ?? '',
      reboundContestCounts: [0, 0],
    });
    buffer.hook.recordTrip({
      homeUnit: unitB,
      awayUnit: awayUnit,
      handler: unitB[0] ?? '',
      reboundContestCounts: [0, 0],
    });
    const increments = buffer.finishGame(new Map(), new Map()).pairIncrements;
    const incrementOf = (a: string, b: string): number =>
      increments.find((i) => i.a === a && i.b === b)?.sharedPossessions ?? 0;
    // Unit A pairs each got exactly one trip.
    const [a0, a1] = [unitA[0] ?? '', unitA[1] ?? ''];
    expect(incrementOf(a0, a1)).toBe(1);
    // Cross-unit pairs never increment.
    expect(incrementOf(unitA[0] ?? '', unitB[0] ?? '')).toBe(0);
  });
});

describe('M2.4 mechanism evidence', () => {
  it('records opportunities, inputs, totals, and min/max within caps', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const gameVersions = new Set([...home.players, ...away.players].map((p) => p.playerVersionId));
    const pregame = {
      schemaVersion: state.schemaVersion,
      playerStates: state.playerStates.map((player) => ({
        ...player,
        fatigueBasisPoints: gameVersions.has(player.playerVersionId)
          ? 5000
          : player.fatigueBasisPoints,
      })),
      pairStates: state.pairStates.map((pair) => ({
        ...pair,
        sharedPossessions: pair.sharedPossessions + 600,
      })),
    };
    const buffer = createSeasonEffectsBuffer(pregame, homeStamina, awayStamina);
    const shooter = home.players[0]?.playerVersionId ?? '';
    const awayUnit = away.players.slice(0, 5).map((p) => p.playerVersionId);
    const homeUnit = home.players.slice(0, 5).map((p) => p.playerVersionId);
    buffer.hook.setActiveUnits(homeUnit, awayUnit);
    buffer.hook.makeAdjustment({ shooterVersion: shooter, offenseSide: 0, defenseSide: 1 });
    buffer.hook.turnoverAdjustment({ handlerVersion: shooter, offenseSide: 0 });
    buffer.hook.assistAdjustment({ offenseSide: 0 });
    const evidence = buffer.finishGame(new Map(), new Map()).evidence;

    const shooterRow = evidence.find(
      (row) => row.mechanism === 'shooter-fatigue' && row.side === 'home',
    );
    expect(shooterRow).toBeDefined();
    expect(shooterRow?.opportunities).toBe(1);
    // Fatigue 5000/10000 -> input 500,000 millionths; delta -25,000 x 0.5.
    expect(shooterRow?.inputTotals.shooter).toBe(500_000);
    expect(shooterRow?.deltaTotals).toBe(-12_500);
    expect(shooterRow?.deltaMin).toBe(-12_500);
    expect(shooterRow?.deltaMax).toBe(-12_500);
    for (const row of evidence) {
      const cap = SEASON_EFFECTS_MECHANISM_CAPS[row.mechanism];
      expect(Math.abs(row.deltaTotals)).toBeLessThanOrEqual(cap * Math.max(1, row.opportunities));
      expect(Math.abs(row.deltaMin)).toBeLessThanOrEqual(cap);
      expect(Math.abs(row.deltaMax)).toBeLessThanOrEqual(cap);
    }
  });
});

describe('M2.4 effects state construction', () => {
  it('rejects wrong counts and duplicates', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    expect(state.playerStates).toHaveLength(300);
    expect(state.pairStates).toHaveLength(1350);
    const twoInputs = [...homeStamina.values()].slice(0, 2);
    if (twoInputs.length < 2) throw new Error('fixture');
    expect(() => createSeasonEffectsState(twoInputs)).toThrow();
    const duplicate = [...homeStamina.values(), ...homeStamina.values()];
    expect(() => createSeasonEffectsState(duplicate)).toThrow();
    void awayStamina;
  });

  it('validates transitions and folds pair increments additively', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const { state, homeStamina, awayStamina } = buildLeagueState(home, away);
    const pair = state.pairStates[0];
    if (pair === undefined) throw new Error('fixture');
    const next = applySeasonGameEffectsTransition(state, {
      schemaVersion: 1,
      pregamePlayerStates: state.playerStates,
      postgamePlayerStates: state.playerStates.map((player) => ({
        ...player,
        fatigueBasisPoints: Math.min(10_000, player.fatigueBasisPoints + 100),
      })),
      pairIncrements: [{ a: pair.a, b: pair.b, sharedPossessions: 7 }],
      evidence: [],
    });
    const folded = next.pairStates.find((p) => p.a === pair.a && p.b === pair.b);
    expect(folded?.sharedPossessions).toBe(7);
    expect(next.pairStates).toHaveLength(1350);
    void homeStamina;
    void awayStamina;
  });

  it('throws when the game misses a stamina profile', () => {
    const home = buildStaminaRoster('home');
    const away = buildStaminaRoster('away');
    const input = buildGameInput(home, away, 'effects-missing-stamina');
    const { state } = buildLeagueState(home, away);
    const stripped: SeasonGameSimulationInput = {
      ...input,
      home: {
        ...input.home,
        players: input.home.players.map((p) => ({ ...p, stamina: undefined })),
      },
    };
    expect(() => simulateSeasonGameWithEffects(stripped, ctx, state)).toThrow(/no stamina profile/);
  });
});
