import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { evaluateLineupBalance } from '../../../packages/engine/src/challenge/lineup-eval.ts';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { PackagedData, loadPackagedData } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const { candidates } = buildCandidateCatalog(packaged.manifest, false);
const context = createEngineContext();
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type P = (typeof candidates)[number]['players'][number];

function toSim(p: P): SimulationPlayer {
  return {
    playerId: p.playerId,
    displayName: p.displayName,
    positions: p.positions,
    heightInches: p.heightInches,
    weightLbs: p.weightLbs,
    ratings: p.ratings,
    tendencies: p.tendencies,
    anchors: p.anchors,
  };
}
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
const quality = (five: P[]) => mean(five.map((p) => p.score));

// Find the legal five whose quality is nearest `target`, honouring the balance floor
// unless `requireBalance` is false.
function fiveNearQuality(pool: P[], target: number, requireBalance: boolean): P[] | null {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const bySlot = SLOTS.map((slot) => sorted.filter((p) => p.positions.includes(slot)));
  let best: P[] | null = null;
  let bestErr = Infinity;
  let fallback: P[] | null = null;
  let fallbackErr = Infinity;
  let nodes = 0;
  function search(slot: number, chosen: P[], used: Set<string>, running: number): void {
    nodes += 1;
    if (nodes > 300000) return;
    if (slot === 5) {
      const q = running / 5;
      const err = Math.abs(q - target);
      const team: SimulationTeam = { teamId: 'p', displayName: 'p', players: chosen.map(toSim) };
      if (requireBalance && !evaluateLineupBalance(team).ok) {
        if (err < fallbackErr) {
          fallbackErr = err;
          fallback = [...chosen];
        }
        return;
      }
      if (err < bestErr) {
        bestErr = err;
        best = [...chosen];
      }
      return;
    }
    const slotPos = SLOTS[slot];
    if (!slotPos) return;
    for (const p of bySlot[slot] ?? []) {
      if (used.has(p.playerId)) continue;
      used.add(p.playerId);
      chosen.push(p);
      search(slot + 1, chosen, used, running + p.score);
      chosen.pop();
      used.delete(p.playerId);
    }
  }
  search(0, [], new Set(), 0);
  return (best as P[] | null) ?? (fallback as P[] | null);
}

// Franchise pool quality = mean of its top five scores.
const poolQuality = candidates
  .map((c) => {
    const top = [...c.players].sort((a, b) => b.score - a.score).slice(0, 5);
    return {
      id: c.franchiseId,
      name: c.displayName,
      q: mean(top.map((p) => p.score)),
      pool: c.players,
    };
  })
  .sort((a, b) => b.q - a.q);

console.log('franchise pool quality ranking:');
poolQuality.forEach((f, i) =>
  console.log(`  ${String(i + 1).padStart(2)} ${f.q.toFixed(1)} ${f.name}`),
);

// Target quality curve: top of pool-quality distribution gets its best five,
// bottom gets its weakest legal five.
const globalScores = candidates.flatMap((c) => c.players.map((p) => p.score)).sort((a, b) => a - b);
const qAt = (frac: number) => {
  const idx = Math.min(
    globalScores.length - 1,
    Math.max(0, Math.round(frac * (globalScores.length - 1))),
  );
  return globalScores[idx] ?? 60;
};

const teams: SimulationTeam[] = [];
const meta: { name: string; five: P[]; q: number; target: number }[] = [];
poolQuality.forEach((f, i) => {
  const t = i / (poolQuality.length - 1); // 0 = best franchise
  const target = qAt(0.99 - 0.96 * Math.pow(t, 0.85));
  const five = fiveNearQuality(f.pool, target, t < 0.7);
  if (!five) {
    console.log(`!! ${f.id} no five`);
    return;
  }
  meta.push({ name: f.name, five, q: quality(five), target });
  teams.push({ teamId: f.id, displayName: f.name, players: five.map(toSim) });
});
console.log(`\nbuilt ${teams.length} teams`);

const gamesPerPair = 14;
const wins = new Map<string, number>();
const played = new Map<string, number>();
for (const t of teams) {
  wins.set(t.teamId, 0);
  played.set(t.teamId, 0);
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
          home: aHome ? a : b,
          away: aHome ? b : a,
        },
        context,
      );
      const aWon = r.winner === (aHome ? 'home' : 'away');
      wins.set(a.teamId, (wins.get(a.teamId) ?? 0) + (aWon ? 1 : 0));
      wins.set(b.teamId, (wins.get(b.teamId) ?? 0) + (aWon ? 0 : 1));
      played.set(a.teamId, (played.get(a.teamId) ?? 0) + 1);
      played.set(b.teamId, (played.get(b.teamId) ?? 0) + 1);
    }
  }
}

const rows = meta.map((m, i) => ({
  ...m,
  poolRank: i + 1,
  wr: (wins.get(teams[i]?.teamId ?? '') ?? 0) / (played.get(teams[i]?.teamId ?? '') ?? 1),
}));
console.log('\ntier win%  quality target  team');
rows.forEach((r) => {
  console.log(
    `${String(r.poolRank).padStart(4)} ${(r.wr * 100).toFixed(1).padStart(5)} ${r.q.toFixed(1).padStart(8)} ${r.target.toFixed(1).padStart(6)}  ${r.name.padEnd(24)} ${r.five.map((p) => `${p.displayName}:${p.score.toFixed(0)}`).join(', ')}`,
  );
});
const sorted = [...rows].sort((a, b) => b.wr - a.wr);
const m = mean(sorted.map((r) => r.wr));
console.log(
  `\nspread ${(Math.min(...sorted.map((r) => r.wr)) * 100).toFixed(1)}% .. ${(Math.max(...sorted.map((r) => r.wr)) * 100).toFixed(1)}%  mean ${(m * 100).toFixed(1)}%`,
);
function spearman(xs: number[], ys: number[]) {
  const rx = xs.map(
    (v) => xs.filter((o) => o < v).length + (xs.filter((o) => o === v).length - 1) / 2,
  );
  const ry = ys.map(
    (v) => ys.filter((o) => o < v).length + (ys.filter((o) => o === v).length - 1) / 2,
  );
  const mx = mean(rx),
    my = mean(ry);
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const a = (rx[i] ?? 0) - mx,
      b = (ry[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}
console.log(
  `spearman(tier, winRate) = ${spearman(
    rows.map((r) => r.poolRank),
    rows.map((r) => r.wr),
  ).toFixed(3)}`,
);
console.log(
  `spearman(quality, winRate) = ${spearman(
    rows.map((r) => r.q),
    rows.map((r) => r.wr),
  ).toFixed(3)}`,
);
