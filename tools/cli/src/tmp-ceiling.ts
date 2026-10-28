import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { bestLegalFiveWithin } from '../../../packages/engine/src/bracket/generator.ts';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { PackagedData, loadPackagedData } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './commands/data-loader.ts';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const { candidates } = buildCandidateCatalog(packaged.manifest, false);
const context = createEngineContext();
type P = (typeof candidates)[number]['players'][number];
const toSim = (p: P): SimulationPlayer => ({
  playerId: p.playerId,
  displayName: p.displayName,
  positions: p.positions,
  heightInches: p.heightInches,
  weightLbs: p.weightLbs,
  ratings: p.ratings,
  tendencies: p.tendencies,
  anchors: p.anchors,
});

const shipped = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
) as { opponents: { opponentId: string; displayName: string; strength: { winRate: number } }[] };
const shippedRate = new Map(shipped.opponents.map((o) => [o.displayName, o.strength.winRate]));

const teams: { name: string; team: SimulationTeam; quality: number; names: string }[] = [];
for (const c of candidates) {
  const pool = c.players.filter((p) => p.score >= 45);
  const best = bestLegalFiveWithin(pool, Infinity);
  if (!best) {
    console.log(`!! ${c.displayName} no legal five`);
    continue;
  }
  teams.push({
    name: c.displayName,
    team: { teamId: c.franchiseId, displayName: c.displayName, players: best.players.map(toSim) },
    quality: best.quality,
    names: [...best.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `${p.displayName}:${p.score.toFixed(0)}`)
      .join(', '),
  });
}

const gamesPerPair = Number(process.argv[2] ?? 10);
const wins = new Map<string, number>();
const played = new Map<string, number>();
for (const t of teams) {
  wins.set(t.name, 0);
  played.set(t.name, 0);
}
for (let i = 0; i < teams.length; i += 1) {
  for (let j = i + 1; j < teams.length; j += 1) {
    const a = teams[i];
    const b = teams[j];
    if (!a || !b) continue;
    for (let g = 0; g < gamesPerPair; g += 1) {
      const aHome = g % 2 === 0;
      const seed = seedSchema.parse(
        `00000000000000${((i * 100 + j) * 100 + g).toString(16).padStart(2, '0')}`.slice(-16),
      );
      const r = simulateGame(
        {
          schemaVersion: 2,
          seed,
          gameNumber: 1,
          dataVersion: profile.dataVersion,
          profile,
          home: aHome ? a.team : b.team,
          away: aHome ? b.team : a.team,
        },
        context,
      );
      const aWon = r.winner === (aHome ? 'home' : 'away');
      wins.set(a.name, (wins.get(a.name) ?? 0) + (aWon ? 1 : 0));
      wins.set(b.name, (wins.get(b.name) ?? 0) + (aWon ? 0 : 1));
      played.set(a.name, (played.get(a.name) ?? 0) + 1);
      played.set(b.name, (played.get(b.name) ?? 0) + 1);
    }
  }
}

const rows = teams.map((t) => ({
  ...t,
  wr: (wins.get(t.name) ?? 0) / (played.get(t.name) ?? 1),
  ship: shippedRate.get(t.name) ?? 0,
}));
rows.sort((a, b) => b.wr - a.wr);
console.log('\nuncapped best five round robin\n');
console.log('rank  win%  shipped  quality  team');
rows.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(4)} ${(r.wr * 100).toFixed(1).padStart(6)} ${(r.ship * 100)
      .toFixed(1)
      .padStart(8)} ${r.quality.toFixed(1).padStart(8)}  ${r.name.padEnd(26)} ${r.names}`,
  ),
);
const rates = rows.map((r) => r.wr);
console.log(
  `\nspread ${(Math.min(...rates) * 100).toFixed(1)}% .. ${(Math.max(...rates) * 100).toFixed(1)}%`,
);
