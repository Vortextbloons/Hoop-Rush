import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'apps/web/static/data/pools';
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
const rows: {
  name: string;
  season: string;
  min: number;
  games: number;
  ts: number | null;
  pts: number | null;
  ast: number | null;
  reb: number | null;
  tov: number | null;
  passRate: number;
  turnoverRate: number;
  fga: number | undefined;
  mpg: number;
  oreb: number;
  dreb: number;
  astPg: number;
}[] = [];
for (const name of files) {
  const pool = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  for (const player of pool.players) {
    const profile = player.playoffPerformance;
    if (!profile) continue;
    rows.push({
      name: `${player.displayName} ${player.seasonKey}`,
      season: player.seasonKey,
      min: profile.playoffs.minutes,
      games: profile.playoffs.gamesPlayed,
      ts: profile.differences.tsPct,
      pts: profile.differences.pointsPer36,
      ast: profile.differences.assistsPer36,
      reb: profile.differences.reboundsPer36,
      tov: profile.differences.turnoversPer36,
      passRate: player.tendencies.passRate,
      turnoverRate: player.tendencies.turnoverRate,
      fga: player.anchors.fieldGoalAttemptsPerGame,
      mpg: player.anchors.minutesPerGame,
      oreb: player.anchors.offensiveReboundsPerGame,
      dreb: player.anchors.defensiveReboundsPerGame,
      astPg: player.anchors.assistsPerGame,
    });
  }
}

function quantiles(values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return `n=${String(sorted.length)} p1=${at(0.01)!.toFixed(3)} p10=${at(0.1)!.toFixed(3)} p25=${at(0.25)!.toFixed(3)} p50=${at(0.5)!.toFixed(3)} p75=${at(0.75)!.toFixed(3)} p90=${at(0.9)!.toFixed(3)} p99=${at(0.99)!.toFixed(3)} min=${sorted[0]!.toFixed(3)} max=${sorted.at(-1)!.toFixed(3)}`;
}

console.log('profiles', rows.length);
console.log('minutes', quantiles(rows.map((r) => r.min)));
console.log('games', quantiles(rows.map((r) => r.games)));
console.log('tsDiff', quantiles(rows.flatMap((r) => (r.ts === null ? [] : [r.ts]))));
console.log('ptsPer36', quantiles(rows.flatMap((r) => (r.pts === null ? [] : [r.pts]))));
console.log('astPer36', quantiles(rows.flatMap((r) => (r.ast === null ? [] : [r.ast]))));
console.log('rebPer36', quantiles(rows.flatMap((r) => (r.reb === null ? [] : [r.reb]))));
console.log('tovPer36', quantiles(rows.flatMap((r) => (r.tov === null ? [] : [r.tov]))));
console.log('nullTurnovers', rows.filter((r) => r.tov === null).length);
console.log('nullTs', rows.filter((r) => r.ts === null).length);
console.log('passRate', quantiles(rows.map((r) => r.passRate)));
console.log('turnoverRate', quantiles(rows.map((r) => r.turnoverRate)));
console.log('mpg', quantiles(rows.map((r) => r.mpg)));
console.log('fgAttempts', quantiles(rows.flatMap((r) => (r.fga === undefined ? [] : [r.fga]))));
console.log('oreb', quantiles(rows.map((r) => r.oreb)));
console.log('dreb', quantiles(rows.map((r) => r.dreb)));
console.log('astPg', quantiles(rows.map((r) => r.astPg)));

const lbj = rows.find((r) => r.name.includes('LeBron James 2017-18'));
console.log('lebron', lbj);
const big = [...rows]
  .filter((r) => r.ts !== null && r.min >= 240)
  .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  .slice(0, 6);
console.log('biggest ts risers', big);
