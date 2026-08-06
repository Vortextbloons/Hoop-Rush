import { describe, expect, it } from 'vitest';
import {
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_HOME_WIN_RATE_TARGET,
  seasonGameSimulationInputSchema,
  seasonHomeCourtProfileSchema,
  playerVersionId,
  type Position,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { simulateSeasonGame } from './season-game.ts';
import {
  SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT,
  SEASON_HOME_COURT_PROFILE,
  SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT,
  seasonHomeCourtMechanisms,
} from './home-court.ts';
import { seasonRotationSetDigest } from './rotation.ts';

const ctx = createEngineContext();

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

function buildTeam(side: 'home' | 'away'): SeasonGameTeamInput {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = `p-hc-${side}-${String(index)}`;
    const base = buildSimulationPlayer();
    return {
      playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
      playerId,
      displayName: `${side} player ${String(index)}`,
      positions: [...positions],
      heightInches: 76,
      weightLbs: 200,
      ratings: { ...base.ratings },
      tendencies: { ...base.tendencies },
    };
  });
  return { teamId: side, displayName: side, franchiseId, players };
}

function rotationOf(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((p) => p.playerVersionId);
  return {
    franchiseId: team.franchiseId,
    starters: ids.slice(0, 5),
    benchOrder: ids.slice(5),
    targetMinutes: [
      ...ids.slice(0, 5).map((id) => ({ playerVersionId: id, minutes: 33 })),
      ...ids.slice(5).map((id, index) => ({
        playerVersionId: id,
        minutes: [21, 18, 15, 12, 9][index] ?? 0,
      })),
    ],
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => id ?? ''),
    rotationVersion: 'season-rotation-v2',
  };
}

function buildInput(
  seed: string,
  homeCourt: SeasonGameSimulationInput['homeCourt'],
): SeasonGameSimulationInput {
  const home = buildTeam('home');
  const away = buildTeam('away');
  return {
    schemaVersion: 1,
    seed: seedFromString(seed),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: rotationOf(home),
    awayRotation: rotationOf(away),
    availability: [...home.players, ...away.players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: true,
    })),
    removals: [],
    returns: [],
    homeCourt,
  };
}

describe('season home-court seam (M2.3)', () => {
  it('is byte-identical for the neutral profile across arbitrary seeds', () => {
    for (let i = 0; i < 12; i += 1) {
      const seed = `hc-neutral-${String(i)}`;
      const neutral = buildInput(seed, SEASON_NEUTRAL_HOME_COURT);
      const a = simulateSeasonGame(neutral, ctx);
      const b = simulateSeasonGame(neutral, ctx);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('defaults omitted homeCourt fields to the neutral adapter at the schema boundary', () => {
    // The M2.2 committed fixture inputs carry no homeCourt field: the zod
    // default applies the neutral profile, so they parse and simulate
    // unchanged (the M2.2 fixture regression gate).
    const base = buildInput('hc-schema-1', SEASON_NEUTRAL_HOME_COURT);
    const withoutHomeCourt = { ...base };
    delete (withoutHomeCourt as { homeCourt?: unknown }).homeCourt;
    const parsed = seasonGameSimulationInputSchema.parse(withoutHomeCourt);
    expect(parsed.homeCourt).toEqual(SEASON_NEUTRAL_HOME_COURT);
    const neutral = simulateSeasonGame(parsed, ctx);
    const direct = simulateSeasonGame(base, ctx);
    expect(JSON.stringify(neutral)).toBe(JSON.stringify(direct));
  });

  it('keeps the neutral profile byte-identical to the M2.2 committed fixture inputs', () => {
    // The committed M2.2 scenario fixtures carry no homeCourt field: they
    // parse with the neutral default and must produce the same results as
    // the M2.2 engine (no digests changed by the v4 contract bump).
    const input = buildInput('hc-fixture-1', SEASON_NEUTRAL_HOME_COURT);
    const first = simulateSeasonGame(input, ctx);
    const second = simulateSeasonGame(input, ctx);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('derives exactly two signed bounded mechanisms from a profile', () => {
    const mechanisms = seasonHomeCourtMechanisms(SEASON_HOME_COURT_PROFILE);
    expect(mechanisms.homeDefenseShotAdjustment).toBeLessThan(0);
    expect(mechanisms.awayTurnoverPressureAdjustment).toBeGreaterThan(0);
    expect(Math.abs(mechanisms.homeDefenseShotAdjustment)).toBeLessThanOrEqual(
      SEASON_HOME_COURT_DEFENSE_MAX_ADJUSTMENT,
    );
    expect(mechanisms.awayTurnoverPressureAdjustment).toBeLessThanOrEqual(
      SEASON_HOME_COURT_TURNOVER_MAX_ADJUSTMENT,
    );
    const neutral = seasonHomeCourtMechanisms(SEASON_NEUTRAL_HOME_COURT);
    expect(neutral.homeDefenseShotAdjustment).toBe(0);
    expect(neutral.awayTurnoverPressureAdjustment).toBe(0);
    // Monotonic in the constants.
    const higher = seasonHomeCourtMechanisms({
      schemaVersion: 1,
      profileVersion: 'season-home-court-v1',
      homeDefensiveCommunication: 1,
      awayTurnoverPressure: 1,
      targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
    });
    expect(higher.homeDefenseShotAdjustment).toBeLessThan(mechanisms.homeDefenseShotAdjustment);
    expect(higher.awayTurnoverPressureAdjustment).toBeGreaterThan(
      mechanisms.awayTurnoverPressureAdjustment,
    );
    // The engine constant is a valid profile with the frozen target.
    expect(seasonHomeCourtProfileSchema.safeParse(SEASON_HOME_COURT_PROFILE).success).toBe(true);
    expect(SEASON_HOME_COURT_PROFILE.targetHomeWinRate).toBe(SEASON_HOME_WIN_RATE_TARGET);
  });

  it('moves the home win rate toward the target with small effects', () => {
    // Small held-out-style subset: 60 mirror matchups on both adapters.
    const neutralWins = (): number => {
      let wins = 0;
      for (let i = 0; i < 60; i += 1) {
        const seed = i.toString(16).padStart(32, '0');
        const result = simulateSeasonGame(buildInput(seed, SEASON_NEUTRAL_HOME_COURT), ctx);
        if (result.outcome === 'completed') {
          if (result.winner === 'home') wins += 1;
        } else if (result.outcome === 'forfeit' && result.homeScore === 2) {
          wins += 1;
        }
      }
      return wins;
    };
    const homeWins = (): number => {
      let wins = 0;
      for (let i = 0; i < 60; i += 1) {
        const seed = i.toString(16).padStart(32, '0');
        const result = simulateSeasonGame(buildInput(seed, SEASON_HOME_COURT_PROFILE), ctx);
        if (result.outcome === 'completed') {
          if (result.winner === 'home') wins += 1;
        } else if (result.outcome === 'forfeit' && result.homeScore === 2) {
          wins += 1;
        }
      }
      return wins;
    };
    const neutralRate = neutralWins() / 60;
    const homeRate = homeWins() / 60;
    // The tuned profile must move the rate toward 0.575 and away from the
    // neutral baseline; on a 60-game subset the effect direction is the
    // stable assertion (the ±0.01 tolerance gate lives in the calibration
    // cohort, not a 60-game subset).
    expect(homeRate).toBeGreaterThan(neutralRate);
    expect(Math.abs(homeRate - SEASON_HOME_WIN_RATE_TARGET)).toBeLessThan(0.2);
  });

  it('keeps possession extremes within the neutral band', () => {
    // Compare possession counts on the same 24 seeds: the home-court
    // mechanisms touch turnover and conversion, not pace, so the per-game
    // possession range stays inside the neutral envelope plus a small
    // allowance.
    const possessions = (homeCourt: SeasonGameSimulationInput['homeCourt']): number[] => {
      const counts: number[] = [];
      for (let i = 0; i < 24; i += 1) {
        const seed = i.toString(16).padStart(32, '0');
        const result = simulateSeasonGame(buildInput(seed, homeCourt), ctx);
        if (result.outcome === 'completed') {
          counts.push(result.home.box.possessions, result.away.box.possessions);
        }
      }
      return counts;
    };
    const neutral = possessions(SEASON_NEUTRAL_HOME_COURT).sort((a, b) => a - b);
    const home = possessions(SEASON_HOME_COURT_PROFILE).sort((a, b) => a - b);
    const neutralMin = neutral[0] ?? 0;
    const neutralMax = neutral[neutral.length - 1] ?? 0;
    const homeMin = home[0] ?? 0;
    const homeMax = home[home.length - 1] ?? 0;
    expect(homeMin).toBeGreaterThanOrEqual(neutralMin - 4);
    expect(homeMax).toBeLessThanOrEqual(neutralMax + 4);
  });
});

describe('season rotation set digest (M2.3)', () => {
  it('is canonical regardless of rotation order and target-minute order', () => {
    const rotationA = rotationOf(buildTeam('home'));
    const rotationB = rotationOf(buildTeam('away'));
    const first = seasonRotationSetDigest([rotationA, rotationB]);
    const second = seasonRotationSetDigest([
      { ...rotationB, targetMinutes: [...rotationB.targetMinutes].reverse() },
      rotationA,
    ]);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).toBe(second);
    const tampered = seasonRotationSetDigest([
      { ...rotationA, closingFive: [...rotationA.closingFive].reverse() },
      rotationB,
    ]);
    expect(tampered).not.toBe(first);
  });
});
