import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { seedSchema } from '@hoop-rush/data-contracts';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import { PackagedData, loadPackagedData, REPO_ROOT } from './commands/data-loader.ts';
import { buildCandidateCatalog } from './commands/bracket-generate.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const { candidates } = buildCandidateCatalog(packaged.manifest, false);
const context = createEngineContext();
type P = (typeof candidates)[number]['players'][number];
const all = new Map<string, P>();
for (const c of candidates) for (const p of c.players) all.set(p.playerId, p);
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
) as {
  opponents: {
    opponentId: string;
    displayName: string;
    players: SimulationPlayer[];
    strength: { winRate: number };
  }[];
};
const teamOf = (o: { teamId: string; displayName: string; players: SimulationPlayer[] }) => o;

function winRate(team: SimulationTeam, opponent: SimulationTeam, games: number): number {
  let wins = 0;
  for (let g = 0; g < games; g += 1) {
    const home = g % 2 === 0;
    const seed = seedSchema.parse(
      `000000000000${(g * 2654435761).toString(16).slice(-8)}`.padEnd(16, '0'),
    );
    const r = simulateGame(
      {
        schemaVersion: 2,
        seed,
        gameNumber: 1,
        dataVersion: profile.dataVersion,
        profile,
        home: home ? team : opponent,
        away: home ? opponent : team,
      },
      context,
    );
    if (r.winner === (home ? 'home' : 'away')) wins += 1;
  }
  return wins / games;
}

const bulls = bracket.opponents.find((o) => o.opponentId === 'bracket-bulls');
const spurs = bracket.opponents.find((o) => o.opponentId === 'bracket-spurs');
if (!bulls || !spurs) throw new Error('missing');

// Reference: a fixed opponent so every variant faces the same wall.
const reference: SimulationTeam = {
  teamId: 'ref',
  displayName: 'Reference',
  players: spurs.players,
};

const bullsTeam: SimulationTeam = {
  teamId: 'bulls',
  displayName: 'Bulls',
  players: bulls.players,
};

console.log('--- reference: shipped Bulls vs shipped Spurs, 200 games ---');
console.log(`bulls win rate ${(winRate(bullsTeam, reference, 200) * 100).toFixed(1)}%`);

// Usage concentration test at constant ratings: take each Bull and scale
// shotRate/usageRate to change how concentrated the offense is.
function reshape(base: SimulationPlayer[], concentration: number): SimulationPlayer[] {
  const demands = base.map((p) => p.tendencies.shotRate);
  const max = Math.max(...demands);
  return base.map((p) => {
    const isStar = p.tendencies.shotRate === max;
    const scale = isStar ? 1 + concentration : 1 - concentration;
    return {
      ...p,
      tendencies: {
        ...p.tendencies,
        shotRate: Math.max(4, p.tendencies.shotRate * scale),
        usageRate: Math.max(4, p.tendencies.usageRate * scale),
      },
    };
  });
}

console.log('\n--- usage concentration (same ratings, only shotRate/usageRate scaled) ---');
for (const c of [-0.5, -0.25, 0, 0.25, 0.5, 1.0]) {
  const variant = reshape(bulls.players, c);
  const wr = winRate({ teamId: 'v', displayName: `c${c}`, players: variant }, reference, 120);
  console.log(`  concentration ${c >= 0 ? '+' : ''}${c.toFixed(2)}  win% ${(wr * 100).toFixed(1)}`);
}

// Swap test: replace Rose with a lower-usage guard of similar score.
console.log('\n--- replace Derrick Rose with lower-usage guards (same slot) ---');
const rose = bulls.players.find((p) => p.displayName.includes('Rose'));
const roseIdx = bulls.players.indexOf(rose!);
console.log(`rose index ${roseIdx}, shotRate ${rose?.tendencies.shotRate}`);
const guards = [...all.values()]
  .filter((p) => p.playerId !== rose?.playerId && p.positions.includes('PG'))
  .sort((a, b) => b.score - a.score);
void guards;

// Direct diagnostic: Bulls vs a league-average opponent, 200 games.
const league: SimulationTeam = {
  teamId: 'lg',
  displayName: 'League',
  players: bracket.opponents
    .flatMap((o) => o.players)
    .filter((_, i) => i % 30 === 0)
    .slice(0, 5),
};
console.log(`\ngeneric five sanity: ${(winRate(bullsTeam, league, 60) * 100).toFixed(1)}%`);
void teamOf;
