import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { opponentBracketSchema } from '@hoop-rush/data-contracts';
import type { SimulationPlayer } from '@hoop-rush/data-contracts';
import { REPO_ROOT } from './commands/data-loader.ts';

const bracket = opponentBracketSchema.parse(
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
  ) as unknown,
);

const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
const creation = (p: SimulationPlayer) =>
  (p.ratings.ballHandling * 0.4 + p.ratings.passing * 0.35 + p.ratings.offensiveIq * 0.25) / 100;
const spacingOf = (p: SimulationPlayer) =>
  (p.ratings.threePoint / 100) * 0.6 + (p.tendencies.threePointRate / 100) * 0.4;
const defenseOf = (p: SimulationPlayer) =>
  (p.ratings.perimeterDefense +
    p.ratings.interiorDefense +
    p.ratings.steal +
    p.ratings.block +
    p.ratings.defensiveIq) /
  500;

const rows = bracket.opponents.map((o) => {
  const players = o.players;
  const overall =
    mean(
      players.map(
        (p) =>
          (p.ratings.insideScoring +
            p.ratings.midrange +
            p.ratings.threePoint +
            p.ratings.ballHandling +
            p.ratings.perimeterDefense +
            p.ratings.interiorDefense) /
          6,
      ),
    ) / 1;
  return {
    name: o.displayName,
    wr: o.strength.winRate,
    overall,
    spacing: mean(players.map(spacingOf)),
    defense: mean(players.map(defenseOf)),
    rebound: mean(
      players.map((p) => (p.ratings.offensiveRebound + p.ratings.defensiveRebound) / 2),
    ),
    creation: mean(players.map(creation)),
    maxUsage: Math.max(...players.map((p) => p.tendencies.usageRate)),
    sumUsage: players.reduce((s, p) => s + p.tendencies.usageRate, 0),
    maxScore: Math.max(...players.map((p) => (p.strength ? 0 : 0))),
    names: players.map((p) => p.displayName).join(', '),
  };
});

function corr(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0,
    dx = 0,
    dy = 0;
  for (const [i, x] of xs.entries()) {
    const a = x - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}
const ys = rows.map((r) => r.wr);
for (const key of [
  'overall',
  'spacing',
  'defense',
  'rebound',
  'creation',
  'maxUsage',
  'sumUsage',
] as const) {
  console.log(
    `${key.padEnd(9)} corr ${corr(
      rows.map((r) => r[key]),
      ys,
    ).toFixed(
      3,
    )}  range ${Math.min(...rows.map((r) => r[key])).toFixed(1)}..${Math.max(...rows.map((r) => r[key])).toFixed(1)}`,
  );
}

console.log('\nteam                          win%   over  spac  def  reb  crea  maxU sumU');
for (const r of [...rows].sort((a, b) => b.wr - a.wr)) {
  console.log(
    `${r.name.padEnd(28)} ${(r.wr * 100).toFixed(1).padStart(5)} ${r.overall.toFixed(1).padStart(6)} ${r.spacing.toFixed(2).padStart(5)} ${r.defense.toFixed(2).padStart(5)} ${r.rebound.toFixed(1).padStart(5)} ${r.creation.toFixed(2).padStart(5)} ${r.maxUsage.toFixed(1).padStart(5)} ${r.sumUsage.toFixed(0).padStart(4)}`,
  );
}
