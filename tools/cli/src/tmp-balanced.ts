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

// Exhaustive-ish search for balanced fives, maximizing quality.
function bestBalancedFive(pool: P[]): { five: P[]; quality: number } | null {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const bySlot = SLOTS.map((slot) => sorted.filter((p) => p.positions.includes(slot)));
  let best: P[] | null = null;
  let bestQuality = -Infinity;
  let nodes = 0;
  const seen = new Set<string>();
  function search(slot: number, chosen: P[], used: Set<string>, running: number) {
    nodes += 1;
    if (nodes > 400000) return;
    if (slot === 5) {
      const key = [...chosen.map((p) => p.playerId)].sort().join(',');
      if (seen.has(key)) return;
      seen.add(key);
      const team: SimulationTeam = {
        teamId: 'probe',
        displayName: 'probe',
        players: chosen.map(toSim),
      };
      if (!evaluateLineupBalance(team).ok) return;
      if (running > bestQuality) {
        bestQuality = running;
        best = [...chosen];
      }
      return;
    }
    const slotPos = SLOTS[slot];
    if (!slotPos) return;
    for (const p of bySlot[slot] ?? []) {
      if (used.has(p.playerId)) continue;
      if (running + p.score * (5 - slot) < bestQuality) break;
      used.add(p.playerId);
      chosen.push(p);
      search(slot + 1, chosen, used, running + p.score);
      chosen.pop();
      used.delete(p.playerId);
    }
  }
  search(0, [], new Set(), 0);
  if (!best) return null;
  const five = best as P[];
  return { five, quality: five.reduce((a, p) => a + p.score, 0) / 5 };
}

const results: {
  franchiseId: string;
  name: string;
  five: P[];
  quality: number;
  team: SimulationTeam;
}[] = [];
const usedPlayers = new Set<string>();
for (const c of candidates) {
  const pool = c.players.filter((p) => !usedPlayers.has(p.playerId));
  const best = bestBalancedFive(pool);
  if (!best) {
    console.log(`!! ${c.franchiseId} no balanced five`);
    continue;
  }
  for (const p of best.five) usedPlayers.add(p.playerId);
  results.push({
    franchiseId: c.franchiseId,
    name: c.displayName,
    five: best.five,
    quality: best.quality,
    team: { teamId: c.franchiseId, displayName: c.displayName, players: best.five.map(toSim) },
  });
}
console.log(`balanced best fives: ${results.length}`);

const gamesPerPair = 14;
const wins = new Map<string, number>();
const played = new Map<string, number>();
for (const r of results) {
  wins.set(r.franchiseId, 0);
  played.set(r.franchiseId, 0);
}
const teams = results.map((r) => r.team);
const t0 = performance.now();
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
console.log(`round robin ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const rows = results.map((r) => ({
  ...r,
  wr: (wins.get(r.franchiseId) ?? 0) / (played.get(r.franchiseId) ?? 1),
}));
rows.sort((a, b) => b.wr - a.wr);
console.log('\nrank win%   quality  team');
rows.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(4)}  ${(r.wr * 100).toFixed(1).padStart(5)}  ${r.quality.toFixed(1).padStart(7)}  ${r.name.padEnd(24)} ${r.five.map((p) => `${p.displayName}:${p.score.toFixed(0)}`).join(', ')}`,
  ),
);
const mean = rows.reduce((a, r) => a + r.wr, 0) / rows.length;
function corr(xs: number[], ys: number[]) {
  const mx = xs.reduce((a, c) => a + c, 0) / xs.length;
  const my = ys.reduce((a, c) => a + c, 0) / ys.length;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}
console.log(
  `\nspread ${(Math.min(...rows.map((r) => r.wr)) * 100).toFixed(1)}% .. ${(Math.max(...rows.map((r) => r.wr)) * 100).toFixed(1)}% mean ${(mean * 100).toFixed(1)}%`,
);
console.log(
  `corr(quality, winRate) = ${corr(
    rows.map((r) => r.quality),
    rows.map((r) => r.wr),
  ).toFixed(3)}`,
);
