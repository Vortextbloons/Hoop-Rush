import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { seedSchema } from '@hoop-rush/data-contracts';
import type {
  SimulationPlayer,
  SimulationRatings,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { PackagedData, loadPackagedData } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const { candidates } = buildCandidateCatalog(packaged.manifest, false);
const context = createEngineContext();
const SLOTS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
type P = (typeof candidates)[number]['players'][number];

const all = new Map<string, P>();
for (const c of candidates) for (const p of c.players) all.set(p.playerId, p);

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

const used = new Set<string>();
const base: SimulationPlayer[] = [];
for (const slot of SLOTS) {
  const cands = [...all.values()]
    .filter((p) => !used.has(p.playerId) && p.positions.includes(slot))
    .sort((a, b) => Math.abs(a.score - 62) - Math.abs(b.score - 62));
  const pick = cands[0];
  if (!pick) throw new Error('no base');
  used.add(pick.playerId);
  base.push(toSim(pick));
}

const baseTeam: SimulationTeam = { teamId: 'base', displayName: 'Base', players: base };
const games = 300;

function winRateOf(team: SimulationTeam): number {
  let wins = 0;
  for (let g = 0; g < games; g += 1) {
    const home = g % 2 === 0;
    const seed = seedSchema.parse(
      `000000000000${((g + 1) * 7919).toString(16).padStart(8, '0')}`.slice(-16),
    );
    const r = simulateGame(
      {
        schemaVersion: 2,
        seed,
        gameNumber: 1,
        dataVersion: profile.dataVersion,
        profile,
        home: home ? team : baseTeam,
        away: home ? baseTeam : team,
      },
      context,
    );
    if (r.winner === (home ? 'home' : 'away')) wins += 1;
  }
  return wins / games;
}

function mutate(key: keyof SimulationRatings, delta: number): SimulationTeam {
  const players = base.map((p) => ({
    ...p,
    ratings: { ...p.ratings, [key]: Math.max(20, Math.min(99, p.ratings[key] + delta)) },
  }));
  return {
    teamId: `mut-${key}-${delta}`,
    displayName: `mut-${key}-${delta}`,
    players,
  };
}

const baseline = winRateOf(baseTeam);
console.log(`baseline (62-quality generic five) self-play: ${(baseline * 100).toFixed(1)}%`);
console.log('\n+12 to ALL FIVE players on one rating (vs baseline five):');
const keys = Object.keys(base[0]?.ratings ?? {}) as (keyof SimulationRatings)[];
const results: { key: string; wr: number; delta: number }[] = [];
for (const key of keys) {
  const wr = winRateOf(mutate(key, 12));
  results.push({ key, wr, delta: wr - baseline });
}
results.sort((a, b) => b.delta - a.delta);
for (const r of results) {
  console.log(
    `  ${r.key.padEnd(18)} ${(r.wr * 100).toFixed(1).padStart(5)}%  (${r.delta >= 0 ? '+' : ''}${(r.delta * 100).toFixed(1)})`,
  );
}
