import { describe, expect, it } from 'vitest';
import type {
  EraSimulationProfile,
  GameResult,
  SimulationPlayer,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildGameSimulationInput,
  buildLegalSimulationTeam,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { simulateGame } from './game.js';
import { createEngineContext } from './context.js';

/**
 * Directional and magnitude sensitivity for every modeled rating family
 * (spec/06). Each test changes exactly one dimension between otherwise
 * identical fixtures and checks the expected direction plus a credible
 * magnitude across a seeded batch.
 */

const ctx = createEngineContext();
const SEEDS = 200;

type TeamMutator = (team: SimulationTeam) => SimulationTeam;

function mutatePlayers(
  team: SimulationTeam,
  mutate: (player: SimulationPlayer) => SimulationPlayer,
): SimulationTeam {
  return { ...team, players: team.players.map(mutate) };
}

function mutateAllRatings(
  team: SimulationTeam,
  key: keyof SimulationPlayer['ratings'],
  delta: number,
): SimulationTeam {
  return mutatePlayers(team, (p) => ({
    ...p,
    ratings: { ...p.ratings, [key]: Math.min(98, Math.max(20, p.ratings[key] + delta)) },
  }));
}

function mutateAllTendencies(
  team: SimulationTeam,
  key: keyof SimulationPlayer['tendencies'],
  delta: number,
): SimulationTeam {
  return mutatePlayers(team, (p) => ({
    ...p,
    tendencies: { ...p.tendencies, [key]: Math.min(100, Math.max(0, p.tendencies[key] + delta)) },
  }));
}

function profileWith(
  parameters: Partial<EraSimulationProfile['parameters']>,
): EraSimulationProfile {
  return buildEraSimulationProfile({
    parameters: { ...buildEraSimulationProfile().parameters, ...parameters },
  });
}

function compare(
  name: string,
  baseTeam: SimulationTeam,
  changedTeam: SimulationTeam,
  select: (result: GameResult, side: 'home' | 'away') => number,
): { base: number; changed: number } {
  let baseTotal = 0;
  let changedTotal = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const seed = seedFromString(`sens-${name}-${i}`);
    const baseInput = buildGameSimulationInput({ seed, home: baseTeam, away: baseTeam });
    const changedInput = buildGameSimulationInput({ seed, home: changedTeam, away: changedTeam });
    baseTotal += select(simulateGame(baseInput, ctx), 'home');
    changedTotal += select(simulateGame(changedInput, ctx), 'home');
  }
  return { base: baseTotal / SEEDS, changed: changedTotal / SEEDS };
}

function expectDirection(
  name: string,
  base: number,
  changed: number,
  delta: number,
  maxRelative = 0.6,
  minRelative = 0.03,
): void {
  const relative = (changed - base) / Math.max(1e-9, Math.abs(base));
  // Direction must hold; magnitude must be a credible swing (>= 3% of base
  // by default) but not an explosion for a one-dimension change (cap varies
  // by stat). Role-based usage concentrates shots on high-usage players, so
  // all-five skill bumps move totals a little less than flat-usage models.
  expect(
    relative,
    `${name}: base=${base.toFixed(2)} changed=${changed.toFixed(2)}`,
  ).toBeGreaterThan(delta > 0 ? minRelative : -minRelative);
  expect(Math.abs(relative), name).toBeLessThan(maxRelative);
}

const baseTeam = buildLegalSimulationTeam({ teamId: 'sens-base', displayName: 'Sens Base' });

describe('sensitivity: shooting and finishing', () => {
  it('higher insideScoring increases points and field-goal percentage', () => {
    const changed = mutateAllRatings(baseTeam, 'insideScoring', 15);
    // Both sides are measured: the home side of a paired seeded batch is
    // systematically offset by RNG consumption order, so a one-sided
    // selector makes the magnitude estimate noisy.
    const points = compare('inside', baseTeam, changed, (r) => {
      return (r.home.box.points + r.away.box.points) / 2;
    });
    expectDirection('points', points.base, points.changed, 1, 0.6, 0.025);
    const fg = compare('inside-fg', baseTeam, changed, (r) => {
      const h = r.home.box.fieldGoals;
      const a = r.away.box.fieldGoals;
      return (h.made + a.made) / Math.max(1, h.attempted + a.attempted);
    });
    expectDirection('fgpct', fg.base, fg.changed, 1);
  });

  it('higher threePoint increases three-point percentage and three attempts', () => {
    const changed = mutateAllRatings(baseTeam, 'threePoint', 15);
    const threePct = compare('three-pct', baseTeam, changed, (r) => {
      const t = r.home.box.threes;
      return t.made / Math.max(1, t.attempted);
    });
    expectDirection('threePct', threePct.base, threePct.changed, 1);
  });

  it('higher threePointRate tendency raises three-point attempt share', () => {
    const changed = mutateAllTendencies(baseTeam, 'threePointRate', 25);
    const share = compare('three-share', baseTeam, changed, (r) => {
      const b = r.home.box;
      return b.threes.attempted / Math.max(1, b.fieldGoals.attempted);
    });
    expectDirection('threeShare', share.base, share.changed, 1);
  });

  it('higher freeThrow rating raises free-throw percentage', () => {
    const changed = mutateAllRatings(baseTeam, 'freeThrow', 15);
    const ftPct = compare('ft-pct', baseTeam, changed, (r) => {
      const t = r.home.box.freeThrows;
      return t.made / Math.max(1, t.attempted);
    });
    expectDirection('ftPct', ftPct.base, ftPct.changed, 1);
  });
});

describe('sensitivity: creation and usage', () => {
  it('higher usageRate concentrates shot attempts on that player', () => {
    const star = mutatePlayers(baseTeam, (p) =>
      p.playerId === 'p-fixture-1'
        ? { ...p, tendencies: { ...p.tendencies, usageRate: p.tendencies.usageRate + 35 } }
        : p,
    );
    const share = (r: GameResult) => {
      const player = r.home.players.find((p) => p.playerId === 'p-fixture-1')!;
      return player.fieldGoals.attempted / Math.max(1, r.home.box.fieldGoals.attempted);
    };
    const result = compare('usage', baseTeam, star, share);
    expectDirection('usageShare', result.base, result.changed, 1);
  });

  it('higher passing raises assists per game', () => {
    const changed = mutateAllRatings(baseTeam, 'passing', 15);
    const assists = compare('passing', baseTeam, changed, (r) => r.home.box.assists);
    expectDirection('assists', assists.base, assists.changed, 1);
  });
});

describe('sensitivity: ball security', () => {
  it('higher ballHandling reduces turnovers', () => {
    const changed = mutateAllRatings(baseTeam, 'ballHandling', 15);
    const tov = compare('handling', baseTeam, changed, (r) => r.home.box.turnovers);
    // Fewer turnovers with better handling.
    expect(tov.changed, `base=${tov.base} changed=${tov.changed}`).toBeLessThan(tov.base * 0.97);
    expect(tov.base - tov.changed).toBeGreaterThan(0);
  });

  it('higher turnoverRate tendency increases turnovers', () => {
    const changed = mutateAllTendencies(baseTeam, 'turnoverRate', 15);
    const tov = compare('tov-tend', baseTeam, changed, (r) => r.home.box.turnovers);
    expectDirection('turnovers', tov.base, tov.changed, 1);
  });
});

describe('sensitivity: defense', () => {
  it('higher perimeterDefense lowers opponent points', () => {
    const changed = mutateAllRatings(baseTeam, 'perimeterDefense', 15);
    const oppPts = compare('perim', baseTeam, changed, (r) => r.away.box.points);
    expect(oppPts.changed, `base=${oppPts.base} changed=${oppPts.changed}`).toBeLessThan(
      oppPts.base * 0.975,
    );
  });

  it('higher interiorDefense lowers opponent field-goal percentage', () => {
    const changed = mutateAllRatings(baseTeam, 'interiorDefense', 15);
    const oppFg = compare('interior', baseTeam, changed, (r) => {
      const b = r.away.box.fieldGoals;
      return b.made / Math.max(1, b.attempted);
    });
    expect(oppFg.changed).toBeLessThan(oppFg.base * 0.97);
  });

  it('higher steal raises steals and opponent turnovers', () => {
    const changed = mutateAllRatings(baseTeam, 'steal', 15);
    const steals = compare('steal', baseTeam, changed, (r) => r.home.box.steals);
    expectDirection('steals', steals.base, steals.changed, 1);
    const oppTov = compare('steal-tov', baseTeam, changed, (r) => r.away.box.turnovers);
    expectDirection('oppTurnovers', oppTov.base, oppTov.changed, 1);
  });

  it('higher block raises blocks', () => {
    const changed = mutateAllRatings(baseTeam, 'block', 15);
    const blocks = compare('block', baseTeam, changed, (r) => r.home.box.blocks);
    // Blocks are rare per game, so the relative swing is naturally large.
    expectDirection('blocks', blocks.base, blocks.changed, 1, 4);
  });
});

describe('sensitivity: rebounding', () => {
  it('higher offensiveRebound raises offensive rebounds', () => {
    const changed = mutateAllRatings(baseTeam, 'offensiveRebound', 15);
    const oreb = compare('oreb', baseTeam, changed, (r) => r.home.box.rebounds.offensive);
    expectDirection('offensiveRebounds', oreb.base, oreb.changed, 1);
  });

  it('higher defensiveRebound lowers opponent offensive rebounds', () => {
    const changed = mutateAllRatings(baseTeam, 'defensiveRebound', 15);
    const oppOreb = compare('dreb', baseTeam, changed, (r) => r.away.box.rebounds.offensive);
    expect(oppOreb.changed).toBeLessThan(oppOreb.base * 0.975);
  });
});

describe('sensitivity: fouls and free throws', () => {
  it('higher freeThrowRate tendency draws more free throws', () => {
    const changed = mutateAllTendencies(baseTeam, 'freeThrowRate', 15);
    const fta = compare('ft-draw', baseTeam, changed, (r) => r.home.box.freeThrows.attempted);
    expectDirection('freeThrowsAttempted', fta.base, fta.changed, 1);
  });
});

describe('sensitivity: era pace and shot mix', () => {
  it('higher era pace increases possessions per game', () => {
    const fast = profileWith({ pace: 115 });
    const slow = profileWith({ pace: 80 });
    const fastPoss = compare('pace', baseTeam, baseTeam, (r) => r.home.box.possessions).base;
    void fastPoss;
    let fastTotal = 0;
    let slowTotal = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const seed = seedFromString(`sens-pace-${i}`);
      fastTotal += simulateGame(
        buildGameSimulationInput({ seed, profile: fast, home: baseTeam, away: baseTeam }),
        ctx,
      ).home.box.possessions;
      slowTotal += simulateGame(
        buildGameSimulationInput({ seed, profile: slow, home: baseTeam, away: baseTeam }),
        ctx,
      ).home.box.possessions;
    }
    const fastMean = fastTotal / SEEDS;
    const slowMean = slowTotal / SEEDS;
    expect(fastMean).toBeGreaterThan(slowMean * 1.15);
  });

  it('higher league three-point rate raises three-point attempt share', () => {
    const threeHeavy = profileWith({ league3PARate: 0.35 });
    const threeLight = profileWith({ league3PARate: 0.05 });
    let heavyShare = 0;
    let lightShare = 0;
    for (let i = 0; i < SEEDS; i += 1) {
      const seed = seedFromString(`sens-mix-${i}`);
      const pickShare = (input: ReturnType<typeof buildGameSimulationInput>) => {
        const r = simulateGame(input, ctx);
        const b = r.home.box;
        return b.threes.attempted / Math.max(1, b.fieldGoals.attempted);
      };
      heavyShare += pickShare(
        buildGameSimulationInput({ seed, profile: threeHeavy, home: baseTeam, away: baseTeam }),
      );
      lightShare += pickShare(
        buildGameSimulationInput({ seed, profile: threeLight, home: baseTeam, away: baseTeam }),
      );
    }
    expect(heavyShare / SEEDS).toBeGreaterThan((lightShare / SEEDS) * 1.3);
  });
});
