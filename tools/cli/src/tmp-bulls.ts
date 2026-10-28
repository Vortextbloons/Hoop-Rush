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

const named = (franchise: string) => {
  const c = candidates.find((x) => x.franchiseId === franchise);
  if (!c) throw new Error(`no ${franchise}`);
  return c.players.filter((p) => p.score >= 45);
};

const bulls = named('bulls');
console.log(`bulls pool (>=45): ${bulls.length} players`);
for (const p of [...bulls].sort((a, b) => b.score - a.score).slice(0, 22)) {
  console.log(
    `  ${p.score.toFixed(0)}  ${p.displayName.padEnd(22)} ${p.positions.join('/').padEnd(18)} ${String(p.heightInches)} ${p.seasonKey}`,
  );
}

// Benchmarks: a spread of real opponents from the shipped bracket.
const benchmarkIds = ['bracket-spurs', 'bracket-heat', 'bracket-warriors', 'bracket-nuggets'];
void benchmarkIds;

const spurs = named('spurs');
const spursFive = bestLegalFiveWithin(spurs, Infinity);
if (!spursFive) throw new Error('spurs');
const benchmarks: SimulationTeam[] = [
  { teamId: 'spurs', displayName: 'Spurs', players: spursFive.players.map(toSim) },
  {
    teamId: 'heat',
    displayName: 'Heat',
    players: bestLegalFiveWithin(named('heat'), Infinity)!.players.map(toSim),
  },
  {
    teamId: 'nets',
    displayName: 'Nets',
    players: bestLegalFiveWithin(named('nets'), Infinity)!.players.map(toSim),
  },
];

function strength(five: P[], gamesPer = 24): number {
  const order = assignLineup(five.map((p) => ({ playerId: p.playerId, positions: p.positions })));
  if (!order) throw new Error('illegal five');
  const sorted = [...order].sort((a, b) => a.slotIndex - b.slotIndex);
  const players = sorted.map((a) => {
    const p = five.find((x) => x.playerId === a.playerId);
    if (!p) throw new Error('missing');
    return toSim(p);
  });
  const team: SimulationTeam = { teamId: 'probe', displayName: 'probe', players };
  let wins = 0;
  let total = 0;
  for (const b of benchmarks) {
    for (let g = 0; g < gamesPer; g += 1) {
      const home = g % 2 === 0;
      const seed = seedSchema.parse(
        `0000000000000${(total * 2654435761).toString(16).slice(-7)}`.padEnd(16, '0'),
      );
      const r = simulateGame(
        {
          schemaVersion: 2,
          seed,
          gameNumber: 1,
          dataVersion: profile.dataVersion,
          profile,
          home: home ? team : b,
          away: home ? b : team,
        },
        context,
      );
      if (r.winner === (home ? 'home' : 'away')) wins += 1;
      total += 1;
    }
  }
  return wins / total;
}

const show = (label: string, five: P[]) => {
  const assignment = assignLineup(
    five.map((p) => ({ playerId: p.playerId, positions: p.positions })),
  );
  const slots = ['PG', 'SG', 'SF', 'PF', 'C'];
  const desc = [...(assignment ?? [])]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((a) => `${slots[a.slotIndex]}=${five.find((p) => p.playerId === a.playerId)?.displayName}`)
    .join(' ');
  const quality = five.reduce((s, p) => s + p.score, 0) / five.length;
  const ok = evaluateLineupBalance({
    teamId: 'p',
    displayName: 'p',
    players: five.map(toSim),
  });
  console.log(
    `${label.padEnd(18)} q${quality.toFixed(1)} bal:${ok.ok ? 'y' : 'n'} sp${ok.shooting.toFixed(0)} de${ok.defense.toFixed(0)} rb${ok.rebounding.toFixed(0)}  ${(strength(five) * 100).toFixed(1)}%  ${desc}`,
  );
};

const byName = (frag: string) => {
  const p = bulls.find((x) => x.displayName.includes(frag));
  if (!p) throw new Error(`no player ${frag}`);
  return p;
};

console.log('\nBulls candidate fives (win% vs Spurs/Heat/Nets benchmarks):');
const scoreBest = bestLegalFiveWithin(bulls, Infinity);
if (scoreBest) show('score-best', scoreBest.players as P[]);

const jordan = byName('Jordan');
const pippen = byName('Pippen');
const rose = byName('Rose');
const noah = byName('Noah');
for (const pfName of [
  'Grant',
  'Rodman',
  'Kukoč',
  'Kukoc',
  'Cartwright',
  'Love',
  'Gilmore',
  'Sloan',
]) {
  const pf = bulls.find((x) => x.displayName.includes(pfName));
  if (!pf) continue;
  const five = [jordan, rose, pippen, pf, noah];
  if (new Set(five.map((p) => p.playerId)).size !== 5) continue;
  if (!assignLineup(five.map((p) => ({ playerId: p.playerId, positions: p.positions })))) continue;
  show(`Jordan/Rose/Pip/${pfName}`, five);
}
const laVine = bulls.find((x) => x.displayName.includes('LaVine'));
if (laVine) show('Jordan/Rose/Pip/LaVine', [jordan, rose, pippen, laVine, noah]);
