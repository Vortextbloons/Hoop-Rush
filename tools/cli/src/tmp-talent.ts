import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { bestLegalFiveWithin } from '../../../packages/engine/src/bracket/generator.ts';
import { evaluateLineupBalance } from '../../../packages/engine/src/challenge/lineup-eval.ts';
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

interface Row {
  name: string;
  team: SimulationTeam;
  quality: number;
  five: P[];
  balance: ReturnType<typeof evaluateLineupBalance>;
}

const rows: Row[] = [];
for (const c of candidates) {
  const pool = c.players.filter((p) => p.score >= 45);
  const best = bestLegalFiveWithin(pool, Infinity);
  if (!best) continue;
  const five = best.players as P[];
  const team: SimulationTeam = {
    teamId: c.franchiseId,
    displayName: c.displayName,
    players: slotOrdered(five),
  };
  rows.push({
    name: c.displayName,
    team,
    quality: best.quality,
    five,
    balance: evaluateLineupBalance(team),
  });
}

const gamesPerPair = Number(process.argv[2] ?? 8);
const wins = new Map<string, number>();
const played = new Map<string, number>();
const pts = new Map<string, { for: number; against: number }>();
for (const r of rows) {
  wins.set(r.name, 0);
  played.set(r.name, 0);
  pts.set(r.name, { for: 0, against: 0 });
}
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const a = rows[i];
    const b = rows[j];
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
      const ae = pts.get(a.name);
      const be = pts.get(b.name);
      const aPts = aHome ? r.home.box.points : r.away.box.points;
      const bPts = aHome ? r.away.box.points : r.home.box.points;
      if (ae) {
        ae.for += aPts;
        ae.against += bPts;
      }
      if (be) {
        be.for += bPts;
        be.against += aPts;
      }
    }
  }
}

const summary = rows.map((r) => {
  const g = Math.max(1, played.get(r.name) ?? 1);
  const p = pts.get(r.name) ?? { for: 0, against: 0 };
  return {
    ...r,
    wr: (wins.get(r.name) ?? 0) / g,
    margin: (p.for - p.against) / g,
  };
});
summary.sort((a, b) => b.wr - a.wr);

// rank correlation helpers
function rank(values: number[]): number[] {
  const order = [...values.keys()].sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
  const ranks = new Array<number>(values.length);
  order.forEach((idx, position) => {
    ranks[idx] = position;
  });
  return ranks;
}
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = (a[i] ?? 0) - ma;
    const y = (b[i] ?? 0) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

console.log('rank  win%   qual  margin | create shoot inter rebnd defns | team');
summary.forEach((r, i) => {
  const b = r.balance;
  console.log(
    `${String(i + 1).padStart(4)} ${(r.wr * 100).toFixed(1).padStart(6)} ${r.quality
      .toFixed(1)
      .padStart(
        6,
      )} ${r.margin.toFixed(1).padStart(6)} | ${b.creation.toFixed(0).padStart(6)} ${b.shooting
      .toFixed(0)
      .padStart(5)} ${b.interiorPresence.toFixed(0).padStart(5)} ${b.rebounding
      .toFixed(0)
      .padStart(5)} ${b.defense.toFixed(0).padStart(5)} | ${r.name}`,
  );
});

const wr = summary.map((r) => r.wr);
const dims = ['creation', 'shooting', 'interiorPresence', 'rebounding', 'defense'] as const;
console.log('\ncorrelation of win rate with each dimension (raw and rank):');
console.log(
  `  quality          r=${pearson(
    wr,
    summary.map((r) => r.quality),
  ).toFixed(3)}  rank=${pearson(rank(wr), rank(summary.map((r) => r.quality))).toFixed(3)}`,
);
for (const dim of dims) {
  const vals = summary.map((r) => r.balance[dim]);
  console.log(
    `  ${dim.padEnd(16)} r=${pearson(wr, vals).toFixed(3)}  rank=${pearson(rank(wr), rank(vals)).toFixed(3)}`,
  );
}
