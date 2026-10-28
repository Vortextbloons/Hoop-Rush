import { createEngineContext } from '@hoop-rush/engine';
import {
  bestLegalFiveWithin,
  BRACKET_TARGET_LADDER,
  interpolateLadder,
} from '../../../packages/engine/src/bracket/generator.ts';
import { assignLineup } from '../../../packages/engine/src/domain/lineup.ts';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { OpponentBracket, SimulationPlayer } from '@hoop-rush/data-contracts';
import { simulateGame } from '@hoop-rush/engine';
import { PackagedData, loadPackagedData, REPO_ROOT } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const bracket = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
) as OpponentBracket;

// Ceiling per franchise, in the SAME ordering the search now produces.
const ceilings = new Map<string, number>();
for (const c of candidates) {
  const best = bestLegalFiveWithin(
    c.players.filter((p) => p.score >= 45),
    Infinity,
  );
  if (best) ceilings.set(c.franchiseId, best.quality);
}

const tiers = [...candidates].sort(
  (a, b) => (ceilings.get(b.franchiseId) ?? 0) - (ceilings.get(a.franchiseId) ?? 0),
);

const gamesPerPair = Number(process.argv[2] ?? 8);

function buildField(floorSupport: number) {
  const allScores = candidates
    .flatMap((c) => c.players)
    .map((p) => p.score)
    .sort((a, b) => a - b);
  const topSupport = allScores[allScores.length - 1] ?? 70;
  const teamOf = (five: P[], id: string, name: string) => ({
    teamId: id,
    displayName: name,
    players: five.map(toSim),
  });
  // Opening opponent carried through unchanged.
  const opening = bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening')!;
  const field: { key: string; team: ReturnType<typeof teamOf>; five: P[] }[] = [
    {
      key: opening.opponentId,
      team: { teamId: opening.teamId, displayName: opening.displayName, players: opening.players },
      five: [],
    },
  ];
  tiers.forEach((c, rank) => {
    const position = rank / Math.max(1, tiers.length - 1);
    const ceiling = topSupport - (topSupport - floorSupport) * position;
    const pool = c.players.filter((p) => p.score >= 45);
    const five =
      bestLegalFiveWithin(pool, ceiling) ??
      bestLegalFiveWithin(pool, ceilings.get(c.franchiseId) ?? topSupport);
    if (!five) throw new Error(`no five ${c.franchiseId}`);
    field.push({
      key: c.franchiseId,
      team: teamOf(five.players as P[], c.franchiseId, c.displayName),
      five: five.players as P[],
    });
  });
  return field;
}

function measure(field: ReturnType<typeof buildField>) {
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  for (const t of field) {
    wins.set(t.key, 0);
    played.set(t.key, 0);
  }
  for (let i = 0; i < field.length; i += 1) {
    for (let j = i + 1; j < field.length; j += 1) {
      const a = field[i];
      const b = field[j];
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
        wins.set(a.key, (wins.get(a.key) ?? 0) + (aWon ? 1 : 0));
        wins.set(b.key, (wins.get(b.key) ?? 0) + (aWon ? 0 : 1));
        played.set(a.key, (played.get(a.key) ?? 0) + 1);
        played.set(b.key, (played.get(b.key) ?? 0) + 1);
      }
    }
  }
  const rates = field.map((t) => (wins.get(t.key) ?? 0) / (played.get(t.key) ?? 1));
  const sorted = [...rates].sort((a, b) => b - a);
  let err = 0;
  for (const [i, r] of sorted.entries())
    err += Math.abs(r - interpolateLadder(BRACKET_TARGET_LADDER, i));
  return { rates, sorted, err: err / sorted.length, field };
}

const allScores = candidates
  .flatMap((c) => c.players)
  .map((p) => p.score)
  .sort((a, b) => a - b);
const top = allScores[allScores.length - 1] ?? 70;
const bottom = allScores[0] ?? 45;
console.log(`support range ${bottom.toFixed(0)}..${top.toFixed(0)}`);
for (const f of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
  const floorSupport = top - (top - bottom) * f;
  const field = buildField(floorSupport);
  const m = measure(field);
  const nba = [0.787, 0.651, 0.586, 0.52, 0.444, 0.343, 0.206];
  const idx = [0, 4, 9, 14, 19, 24, 29];
  const gaps = idx.map((i) => ((m.sorted[i] ?? 0) - (nba[idx.indexOf(i)] ?? 0)) * 100);
  console.log(
    `step ${f.toFixed(1)} err ${(m.err * 100).toFixed(2)}  span ${(m.sorted[29]! * 100).toFixed(1)}..${(m.sorted[0]! * 100).toFixed(1)}  gaps ${gaps.map((g) => (g >= 0 ? '+' : '') + g.toFixed(1)).join(' ')}`,
  );
}
