import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { bestLegalFiveWithin } from '../../../packages/engine/src/bracket/generator.ts';
import { assignLineup } from '../../../packages/engine/src/domain/lineup.ts';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { PackagedData, loadPackagedData } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';

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

function slotOrdered(five: P[]): SimulationPlayer[] {
  const assignment = assignLineup(
    five.map((p) => ({ playerId: p.playerId, positions: p.positions })),
  );
  if (!assignment) throw new Error('illegal five');
  return [...assignment]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((a) => {
      const p = five.find((x) => x.playerId === a.playerId);
      if (!p) throw new Error('missing');
      return toSim(p);
    });
}

const teams: { name: string; team: SimulationTeam; quality: number; names: string }[] = [];
for (const c of candidates) {
  const pool = c.players.filter((p) => p.score >= 45);
  const best = bestLegalFiveWithin(pool, Infinity);
  if (!best) continue;
  teams.push({
    name: c.displayName,
    team: {
      teamId: c.franchiseId,
      displayName: c.displayName,
      players: slotOrdered(best.players as P[]),
    },
    quality: best.quality,
    names: [...best.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `${p.displayName}:${p.score.toFixed(0)}`)
      .join(', '),
  });
}

const gamesPerPair = Number(process.argv[2] ?? 8);
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
}));
rows.sort((a, b) => b.wr - a.wr);
console.log('\nslot-ordered best balanced five round robin\n');
rows.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(3)} ${(r.wr * 100).toFixed(1).padStart(6)} q${r.quality
      .toFixed(1)
      .padStart(5)}  ${r.name.padEnd(26)} ${r.names}`,
  ),
);
const rates = rows.map((r) => r.wr);
const NBA = [0.787, 0.651, 0.586, 0.52, 0.444, 0.343, 0.206];
const idx = [0, 4, 9, 14, 19, 24, 29];
console.log('\nrank  ours    NBA     gap');
idx.forEach((r, k) => {
  const ours = rates[r] ?? 0;
  const nba = NBA[k] ?? 0;
  console.log(
    `${String(r + 1).padStart(4)} ${(ours * 100).toFixed(1).padStart(6)}% ${(nba * 100)
      .toFixed(1)
      .padStart(6)}% ${((ours - nba) * 100 >= 0 ? '+' : '') + ((ours - nba) * 100).toFixed(1)}`,
  );
});
