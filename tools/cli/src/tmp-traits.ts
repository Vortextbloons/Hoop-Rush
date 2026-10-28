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

function bestBalancedFive(pool: P[]): P[] | null {
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const bySlot = SLOTS.map((slot) => sorted.filter((p) => p.positions.includes(slot)));
  let best: P[] | null = null;
  let bestQuality = -Infinity;
  let nodes = 0;
  function search(slot: number, chosen: P[], used: Set<string>, running: number) {
    nodes += 1;
    if (nodes > 400000) return;
    if (slot === 5) {
      const team: SimulationTeam = { teamId: 'p', displayName: 'p', players: chosen.map(toSim) };
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
  return best as P[] | null;
}

const teams: { name: string; team: SimulationTeam; five: P[] }[] = [];
const usedPlayers = new Set<string>();
for (const c of candidates) {
  const five = bestBalancedFive(c.players.filter((p) => !usedPlayers.has(p.playerId)));
  if (!five) continue;
  for (const p of five) usedPlayers.add(p.playerId);
  teams.push({
    name: c.displayName,
    five,
    team: { teamId: c.franchiseId, displayName: c.displayName, players: five.map(toSim) },
  });
}

// Aggregate sim-relevant traits.
const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
const traits = teams.map((t) => {
  const r = t.five.map((p) => p.ratings);
  return {
    name: t.name,
    score: mean(t.five.map((p) => p.score)),
    reb: mean(r.map((x) => (x.offensiveRebound + x.defensiveRebound) / 2)),
    oReb: mean(r.map((x) => x.offensiveRebound)),
    dReb: mean(r.map((x) => x.defensiveRebound)),
    perimD: mean(r.map((x) => x.perimeterDefense)),
    intD: mean(r.map((x) => x.interiorDefense)),
    steal: mean(r.map((x) => x.steal)),
    block: mean(r.map((x) => x.block)),
    defIq: mean(r.map((x) => x.defensiveIq)),
    three: mean(r.map((x) => x.threePoint)),
    mid: mean(r.map((x) => x.midrange)),
    inside: mean(r.map((x) => x.insideScoring)),
    close: mean(r.map((x) => x.closeShot)),
    ft: mean(r.map((x) => x.freeThrow)),
    passing: mean(r.map((x) => x.passing)),
    handle: mean(r.map((x) => x.ballHandling)),
    oIq: mean(r.map((x) => x.offensiveIq)),
    speed: mean(r.map((x) => x.speed)),
    str: mean(r.map((x) => x.strength)),
    vert: mean(r.map((x) => x.vertical)),
    height: mean(t.five.map((p) => p.heightInches ?? 78)),
    team: t.team,
  };
});

const gamesPerPair = 16;
const wins = new Map<string, number>();
const played = new Map<string, number>();
const margins = new Map<string, number>();
for (const t of teams) {
  wins.set(t.team.teamId, 0);
  played.set(t.team.teamId, 0);
  margins.set(t.team.teamId, 0);
}
for (let i = 0; i < teams.length; i += 1) {
  for (let j = i + 1; j < teams.length; j += 1) {
    const a = teams[i]?.team;
    const b = teams[j]?.team;
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
      const margin = r.home.box.points - r.away.box.points;
      margins.set(a.teamId, (margins.get(a.teamId) ?? 0) + (aHome ? margin : -margin));
      margins.set(b.teamId, (margins.get(b.teamId) ?? 0) + (aHome ? -margin : margin));
    }
  }
}

const rows = traits.map((t) => ({
  ...t,
  wr: (wins.get(t.team.teamId) ?? 0) / (played.get(t.team.teamId) ?? 1),
  diff: (margins.get(t.team.teamId) ?? 0) / (played.get(t.team.teamId) ?? 1),
}));
rows.sort((a, b) => b.wr - a.wr);

function corr(xs: number[], ys: number[]) {
  const mx = mean(xs);
  const my = mean(ys);
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

const keys = [
  'score',
  'reb',
  'oReb',
  'dReb',
  'perimD',
  'intD',
  'steal',
  'block',
  'defIq',
  'three',
  'mid',
  'inside',
  'close',
  'ft',
  'passing',
  'handle',
  'oIq',
  'speed',
  'str',
  'vert',
  'height',
] as const;
console.log('\ncorrelation of team trait with actual win rate:');
const ranked = keys
  .map((k) => ({
    k,
    c: corr(
      rows.map((r) => r[k] as number),
      rows.map((r) => r.wr),
    ),
  }))
  .sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
for (const { k, c } of ranked) console.log(`  ${k.padEnd(9)} ${c >= 0 ? '+' : ''}${c.toFixed(3)}`);

console.log('\nrank win%  diff   score  reb   intD  three height team');
rows.forEach((r, i) =>
  console.log(
    `${String(i + 1).padStart(4)} ${(r.wr * 100).toFixed(1).padStart(5)} ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1).padStart(5)} ${r.score.toFixed(1).padStart(6)} ${r.reb.toFixed(1).padStart(5)} ${r.intD.toFixed(1).padStart(5)} ${r.three.toFixed(1).padStart(6)} ${(r.height ?? 0).toFixed(0).padStart(6)}  ${r.name}`,
  ),
);
