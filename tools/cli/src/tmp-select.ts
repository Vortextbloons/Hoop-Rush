import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { evaluateLineupBalance } from '../../../packages/engine/src/challenge/lineup-eval.ts';
import { assignLineup } from '../../../packages/engine/src/domain/lineup.ts';
import { seedSchema, LINEUP_STRUCTURE, canPlay } from '@hoop-rush/data-contracts';
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

function slotOrdered(five: P[]): SimulationPlayer[] | null {
  const assignment = assignLineup(
    five.map((p) => ({ playerId: p.playerId, positions: p.positions })),
  );
  if (!assignment) return null;
  return [...assignment]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((a) => {
      const p = five.find((x) => x.playerId === a.playerId);
      if (!p) throw new Error('missing');
      return toSim(p);
    });
}

const benchmarks: { name: string; team: SimulationTeam }[] = [];
for (const id of ['spurs', 'jazz', 'heat']) {
  const c = candidates.find((x) => x.franchiseId === id);
  if (!c) throw new Error(id);
  const pool = [...c.players].filter((p) => p.score >= 45).sort((a, b) => b.score - a.score);
  const players = slotOrdered(pool.slice(0, 5) as P[]) ?? slotOrdered(pool.slice(1, 6) as P[]);
  if (!players) throw new Error(`bench ${id}`);
  benchmarks.push({
    name: id,
    team: { teamId: id, displayName: id, players },
  });
}

let seedCounter = 0;
function winRate(players: SimulationPlayer[], gamesPer = 30): { wr: number; margin: number } {
  const team: SimulationTeam = { teamId: 'probe', displayName: 'probe', players };
  let wins = 0;
  let total = 0;
  let margin = 0;
  for (const b of benchmarks) {
    for (let g = 0; g < gamesPer; g += 1) {
      const home = g % 2 === 0;
      seedCounter += 1;
      const seed = seedSchema.parse(
        `0000000000${(seedCounter * 2654435761).toString(16).slice(-10)}`
          .padEnd(16, '0')
          .slice(0, 16),
      );
      const r = simulateGame(
        {
          schemaVersion: 2,
          seed,
          gameNumber: 1,
          dataVersion: profile.dataVersion,
          profile,
          home: home ? team : b.team,
          away: home ? b.team : team,
        },
        context,
      );
      const won = r.winner === (home ? 'home' : 'away');
      if (won) wins += 1;
      const forPts = home ? r.home.box.points : r.away.box.points;
      const againstPts = home ? r.away.box.points : r.home.box.points;
      margin += forPts - againstPts;
      total += 1;
    }
  }
  return { wr: wins / total, margin: margin / total };
}

function combos<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      const item = items[i];
      if (item === undefined) continue;
      pick.push(item);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

const TARGETS = ['bulls', 'timberwolves', 'magic', 'kings', 'celtics', 'bucks', '76ers'];
const POOL_DEPTH = 13;

for (const franchiseId of TARGETS) {
  const c = candidates.find((x) => x.franchiseId === franchiseId);
  if (!c) continue;
  const pool = [...c.players].filter((p) => p.score >= 45).sort((a, b) => b.score - a.score);
  const shortlist = pool.slice(0, POOL_DEPTH) as P[];
  const legal: {
    five: P[];
    players: SimulationPlayer[];
    mean: number;
    balance: ReturnType<typeof evaluateLineupBalance>;
  }[] = [];
  for (const five of combos(shortlist, 5)) {
    const players = slotOrdered(five);
    if (!players) continue;
    const balance = evaluateLineupBalance({ teamId: 'p', displayName: 'p', players });
    if (!balance.ok) continue;
    legal.push({ five, players, mean: five.reduce((s, p) => s + p.score, 0) / 5, balance });
  }
  console.log(
    `\n=== ${c.displayName}: ${legal.length} legal balanced fives from top ${POOL_DEPTH} ===`,
  );
  const byMean = [...legal].sort((a, b) => b.mean - a.mean);
  const probes = new Map<string, { wr: number; margin: number }>();
  for (const entry of byMean.slice(0, 8)) {
    const key = entry.five.map((p) => p.playerId).join(',');
    probes.set(key, winRate(entry.players));
  }
  byMean.slice(0, 8).forEach((entry, index) => {
    const key = entry.five.map((p) => p.playerId).join(',');
    const probe = probes.get(key)!;
    const b = entry.balance;
    const names = [...entry.five]
      .sort((a, b2) => b2.score - a.score)
      .map((p) => p.displayName.split(' ').slice(-1)[0])
      .join('/');
    console.log(
      `  #${index + 1} mean ${entry.mean.toFixed(1)} probe ${(probe.wr * 100).toFixed(1).padStart(5)}% margin ${probe.margin.toFixed(1).padStart(6)} | cr${b.creation.toFixed(0)} sh${b.shooting.toFixed(0)} in${b.interiorPresence.toFixed(0)} rb${b.rebounding.toFixed(0)} df${b.defense.toFixed(0)} | ${names}`,
    );
  });

  // best-by-probe among all legal fives (sample if large)
  const sample = legal.length > 40 ? byMean.filter((_, i) => i < 40) : legal;
  let bestProbe: { entry: (typeof legal)[number]; probe: { wr: number; margin: number } } | null =
    null;
  for (const entry of sample) {
    const key = entry.five.map((p) => p.playerId).join(',');
    const probe = probes.get(key) ?? winRate(entry.players, 16);
    if (bestProbe === null || probe.wr > bestProbe.probe.wr) bestProbe = { entry, probe };
  }
  if (bestProbe) {
    const b = bestProbe.entry.balance;
    const names = [...bestProbe.entry.five]
      .sort((a, b2) => b2.score - a.score)
      .map((p) => p.displayName.split(' ').slice(-1)[0])
      .join('/');
    console.log(
      `  BEST-BY-SIM mean ${bestProbe.entry.mean.toFixed(1)} probe ${(bestProbe.probe.wr * 100).toFixed(1)}% margin ${bestProbe.probe.margin.toFixed(1)} | cr${b.creation.toFixed(0)} sh${b.shooting.toFixed(0)} in${b.interiorPresence.toFixed(0)} rb${b.rebounding.toFixed(0)} df${b.defense.toFixed(0)} | ${names}`,
    );
  }
}

// Confirm assignment ordering requirement
const check = candidates.find((x) => x.franchiseId === 'bulls');
if (check) {
  const pool = [...check.players].filter((p) => p.score >= 45).sort((a, b) => b.score - a.score);
  const five = pool.slice(0, 5) as P[];
  console.log(
    `\nslot legality of raw top-5 for bulls: ${five
      .map((p, i) => {
        const slot = LINEUP_STRUCTURE[i];
        return `${slot}=${p.displayName.split(' ').slice(-1)[0]}(${slot !== undefined && canPlay(p.positions, slot) ? 'ok' : 'NO'})`;
      })
      .join(' ')}`,
  );
}
