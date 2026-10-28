import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { opponentBracketSchema, seedSchema } from '@hoop-rush/data-contracts';
import type { OpponentBracket } from '@hoop-rush/data-contracts';
import { PackagedData, REPO_ROOT, loadPackagedData } from './commands/data-loader.ts';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const bracket = opponentBracketSchema.parse(
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
  ) as unknown,
);
const context = createEngineContext();
const gamesPerPair = Number(process.argv[2] ?? 20);
const teams = bracket.opponents;
const teamOf = (o: OpponentBracket['opponents'][number]) => ({
  teamId: o.teamId,
  displayName: o.displayName,
  players: o.players,
});

const wins = new Map<string, number>();
const played = new Map<string, number>();
for (const t of teams) {
  wins.set(t.opponentId, 0);
  played.set(t.opponentId, 0);
}
const t0 = performance.now();
for (let i = 0; i < teams.length; i += 1) {
  for (let j = i + 1; j < teams.length; j += 1) {
    const a = teams[i];
    const b = teams[j];
    if (!a || !b) continue;
    for (let g = 0; g < gamesPerPair; g += 1) {
      const aHome = g % 2 === 0;
      const seed = seedSchema.parse(
        `0000000000000000${((i * 100 + j) * 1000 + g).toString(16)}`.slice(-16),
      );
      const r = simulateGame(
        {
          schemaVersion: 2,
          seed,
          gameNumber: 1,
          dataVersion: profile.dataVersion,
          profile,
          home: aHome ? teamOf(a) : teamOf(b),
          away: aHome ? teamOf(b) : teamOf(a),
        },
        context,
      );
      const aWon = r.winner === (aHome ? 'home' : 'away');
      wins.set(a.opponentId, (wins.get(a.opponentId) ?? 0) + (aWon ? 1 : 0));
      wins.set(b.opponentId, (wins.get(b.opponentId) ?? 0) + (aWon ? 0 : 1));
      played.set(a.opponentId, (played.get(a.opponentId) ?? 0) + 1);
      played.set(b.opponentId, (played.get(b.opponentId) ?? 0) + 1);
    }
  }
}
const elapsed = (performance.now() - t0) / 1000;

const rows = teams.map((t) => ({
  team: t.displayName,
  id: t.opponentId,
  recorded: t.strength.winRate,
  observed: (wins.get(t.opponentId) ?? 0) / (played.get(t.opponentId) ?? 1),
  players: t.players.map((p) => p.displayName),
}));
rows.sort((a, b) => b.observed - a.observed);
console.log(
  `\n${teams.length * (teams.length - 1) * gamesPerPair} games in ${elapsed.toFixed(1)}s\n`,
);
console.log('rank  observed  recorded  delta   team');
rows.forEach((r, i) => {
  const delta = (r.observed - r.recorded) * 100;
  console.log(
    `${String(i + 1).padStart(4)}  ${(r.observed * 100).toFixed(1).padStart(7)}%  ${(r.recorded * 100).toFixed(1).padStart(7)}%  ${delta >= 0 ? '+' : ''}${delta.toFixed(1).padStart(5)}  ${r.team.padEnd(24)} ${r.players.join(', ')}`,
  );
});
const observed = rows.map((r) => r.observed);
const mean = observed.reduce((a, c) => a + c, 0) / observed.length;
console.log(
  `\nobserved mean ${(mean * 100).toFixed(2)}% (30 teams playing only each other => 50.00%)`,
);
console.log(
  `observed spread ${(Math.min(...observed) * 100).toFixed(1)}% .. ${(Math.max(...observed) * 100).toFixed(1)}%`,
);
const maxDelta = Math.max(...rows.map((r) => Math.abs(r.observed - r.recorded)));
const meanDelta = rows.reduce((a, r) => a + Math.abs(r.observed - r.recorded), 0) / rows.length;
console.log(
  `recorded vs observed: mean abs error ${(meanDelta * 100).toFixed(2)} pts, max ${(maxDelta * 100).toFixed(2)} pts`,
);
function spearman(xs: number[], ys: number[]) {
  const rankOf = (v: number, arr: number[]) =>
    arr.filter((o) => o < v).length + (arr.filter((o) => o === v).length - 1) / 2;
  const rx = xs.map((v) => rankOf(v, xs));
  const ry = ys.map((v) => rankOf(v, ys));
  const mx = rx.reduce((a, c) => a + c, 0) / rx.length;
  const my = ry.reduce((a, c) => a + c, 0) / ry.length;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const a = (rx[i] ?? 0) - mx;
    const b = (ry[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}
console.log(
  `spearman(recorded, observed) = ${spearman(
    rows.map((r) => r.recorded),
    rows.map((r) => r.observed),
  ).toFixed(3)}`,
);
