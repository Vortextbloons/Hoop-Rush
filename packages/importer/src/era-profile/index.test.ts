import { describe, expect, it } from 'vitest';
import { deriveLeagueAggregatesFromStints, type StintRow } from './aggregates.js';
import { computePoolShotMix, type PoolPlayerLike } from './shot-mix.js';
import { target } from './profile.js';

function stint(partial: Partial<StintRow>): StintRow {
  return partial;
}

describe('deriveLeagueAggregatesFromStints', () => {
  it('holds the possessions identity and computes team_games from player games', () => {
    const stints: StintRow[] = [
      stint({
        fga: 100,
        fgm: 40,
        tpa: 20,
        tpm: 5,
        fta: 30,
        ftm: 20,
        offensiveRebounds: 10,
        defensiveRebounds: 30,
        assists: 20,
        steals: 8,
        turnovers: 12,
        fouls: 15,
        points: 105,
        gamesPlayed: 80,
      }),
      stint({
        fga: 50,
        fgm: 20,
        tpa: 5,
        tpm: 2,
        fta: 10,
        ftm: 5,
        offensiveRebounds: 5,
        defensiveRebounds: 20,
        assists: 10,
        steals: 4,
        turnovers: 6,
        fouls: 8,
        points: 47,
        gamesPlayed: 60,
      }),
    ];

    const a = deriveLeagueAggregatesFromStints(stints);

    // player_games / 10 approximates league team-games.
    expect(a.teamGames).toBe(14);

    // possessions = fga + 0.44 * fta - oreb + tov
    expect(a.possessions).toBe(100 + 50 + 0.44 * (30 + 10) - (10 + 5) + (12 + 6));
    expect(a.possessions).toBeCloseTo(170.6, 10);

    expect(a.points).toBe(152);
    expect(a.fgm).toBe(60);
    expect(a.tpm).toBe(7);
    expect(a.tov).toBe(18);
    expect(a.oreb).toBe(15);
    expect(a.dreb).toBe(50);
  });

  it('floors team_games at 1.0 and leaves unavailable families null', () => {
    const a = deriveLeagueAggregatesFromStints([]);
    expect(a.teamGames).toBe(1.0);
    expect(a.possessions).toBeNull();
    expect(a.oreb).toBeNull();
    expect(a.tov).toBeNull();
    expect(a.tpa).toBeNull();
  });

  it('coerces missing fields like float(x or 0) and keeps family availability', () => {
    const a = deriveLeagueAggregatesFromStints([
      stint({ fga: undefined, points: 10, gamesPlayed: 5 }),
    ]);
    expect(a.fga).toBe(0);
    expect(a.points).toBe(10);
    // team_games = max(1, player_games / 10) floors at one team-game.
    expect(a.teamGames).toBe(1.0);
    // Absent families stay null; present ones sum.
    expect(a.oreb).toBeNull();
    expect(a.possessions).toBeNull();
    expect(a.tpa).toBeNull();
  });
});

describe('computePoolShotMix', () => {
  const player = (
    usage: number,
    zones: Pick<
      PoolPlayerLike['tendencies'],
      | 'rimFrequency'
      | 'shortMidFrequency'
      | 'longMidFrequency'
      | 'cornerThreeFrequency'
      | 'aboveBreakThreeFrequency'
    >,
  ): PoolPlayerLike => ({
    tendencies: { usageRate: usage, ...zones },
    detailedRatings: { freeThrow: 75, passing: 60 },
  });

  it('usage-weights the zone mix and rescales the three-point share to the league rate', () => {
    const players: PoolPlayerLike[] = [
      player(20, {
        rimFrequency: 40,
        shortMidFrequency: 20,
        longMidFrequency: 10,
        cornerThreeFrequency: 10,
        aboveBreakThreeFrequency: 20,
      }),
      player(10, {
        rimFrequency: 30,
        shortMidFrequency: 20,
        longMidFrequency: 20,
        cornerThreeFrequency: 5,
        aboveBreakThreeFrequency: 25,
      }),
    ];

    const mix = computePoolShotMix(players, 0.15);

    // Rescaled mix still sums to one.
    const sum = mix.rim + mix.shortMid + mix.longMid + mix.cornerThree + mix.aboveBreakThree;
    expect(sum).toBeCloseTo(1.0, 4);

    // The three-point component is normalized to the league 3PA rate.
    const threeShare = mix.cornerThree + mix.aboveBreakThree;
    expect(threeShare).toBeCloseTo(0.15, 4);

    // Values are rounded to 4 decimals.
    for (const value of Object.values(mix)) {
      expect(value).toBe(Math.round(value * 10000) / 10000);
    }
  });

  it('keeps the raw mix when the pool has no three-point priors', () => {
    const players: PoolPlayerLike[] = [
      player(10, {
        rimFrequency: 50,
        shortMidFrequency: 30,
        longMidFrequency: 20,
        cornerThreeFrequency: 0,
        aboveBreakThreeFrequency: 0,
      }),
    ];
    const mix = computePoolShotMix(players, 0.3);
    expect(mix.cornerThree + mix.aboveBreakThree).toBe(0);
    expect(mix.rim + mix.shortMid + mix.longMid).toBeCloseTo(1, 4);
  });
});

describe('target', () => {
  it('rounds the value to 4 decimals with the given tolerance and default sample', () => {
    expect(target(1.23456789, 0.02)).toEqual({
      value: 1.2346,
      tolerance: 0.02,
      minimumSample: 200,
    });
    expect(target(0.28, 0.04, 2000).minimumSample).toBe(2000);
  });
});
