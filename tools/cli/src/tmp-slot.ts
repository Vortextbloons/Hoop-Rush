import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEngineContext, simulateGame } from '@hoop-rush/engine';
import { opponentBracketSchema, seedSchema } from '@hoop-rush/data-contracts';
import type { OpponentBracket, SimulationTeam } from '@hoop-rush/data-contracts';
import { PackagedData, REPO_ROOT, loadPackagedData } from './commands/data-loader.ts';

const packaged = loadPackagedData();
const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile();
const bracket = opponentBracketSchema.parse(
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'apps/web/static/data/opponents/bracket.json'), 'utf8'),
  ) as unknown,
);
const context = createEngineContext();

type O = OpponentBracket['opponents'][number];
const ordered = (o: O): SimulationTeam => {
  const bySlot = [...o.lineup.assignments].sort((a, b) => a.slotIndex - b.slotIndex);
  return {
    teamId: o.teamId,
    displayName: o.displayName,
    players: bySlot.map((a) => {
      const p = o.players.find((x) => x.playerId === a.playerId);
      if (!p) throw new Error('missing');
      return p;
    }),
  };
};
const asShipped = (o: O): SimulationTeam => ({
  teamId: o.teamId,
  displayName: o.displayName,
  players: o.players,
});

function roundRobin(teamOf: (o: O) => SimulationTeam, gamesPerPair: number) {
  const teams = bracket.opponents;
  const wins = new Map<string, number>();
  const played = new Map<string, number>();
  const scored = new Map<string, number>();
  const allowed = new Map<string, number>();
  for (const t of teams) {
    wins.set(t.opponentId, 0);
    played.set(t.opponentId, 0);
    scored.set(t.opponentId, 0);
    allowed.set(t.opponentId, 0);
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
            home: aHome ? teamOf(a) : teamOf(b),
            away: aHome ? teamOf(b) : teamOf(a),
          },
          context,
        );
        const aWon = r.winner === (aHome ? 'home' : 'away');
        wins.set(a.opponentId, (wins.get(a.opponentId) ?? 0) + (aWon ? 1 : 0));
        wins.set(b.opponentId, (wins.get(b.opponentId) ?? 0) + (aWon ? 0 : 1));
        played.set(a.opponentId, (played.get(a.opponentId) ?? 0) + 1);
        played.set(b.opponentId, (played.get(b.opponentId) ?? 0) + 1);
        const homePts = r.home.box.points;
        const awayPts = r.away.box.points;
        scored.set(a.opponentId, (scored.get(a.opponentId) ?? 0) + (aHome ? homePts : awayPts));
        scored.set(b.opponentId, (scored.get(b.opponentId) ?? 0) + (aHome ? awayPts : homePts));
        allowed.set(a.opponentId, (allowed.get(a.opponentId) ?? 0) + (aHome ? awayPts : homePts));
        allowed.set(b.opponentId, (allowed.get(b.opponentId) ?? 0) + (aHome ? homePts : awayPts));
      }
    }
  }
  return teams.map((t) => ({
    id: t.opponentId,
    name: t.displayName,
    wr: (wins.get(t.opponentId) ?? 0) / (played.get(t.opponentId) ?? 1),
    ortg: (scored.get(t.opponentId) ?? 0) / (played.get(t.opponentId) ?? 1),
    drtg: (allowed.get(t.opponentId) ?? 0) / (played.get(t.opponentId) ?? 1),
  }));
}

const n = Number(process.argv[2] ?? 10);
const shipped = roundRobin(asShipped, n);
const slotOrder = roundRobin(ordered, n);
const shipBy = new Map(shipped.map((r) => [r.id, r]));
console.log(`\n${n} games/pair · shipped (array order) vs slot order\n`);
console.log('team                          shipped  slotOrd   delta   ortg   drtg');
for (const r of [...slotOrder].sort((a, b) => b.wr - a.wr)) {
  const s = shipBy.get(r.id);
  console.log(
    `${r.name.padEnd(28)} ${((s?.wr ?? 0) * 100).toFixed(1).padStart(6)}% ${(r.wr * 100)
      .toFixed(1)
      .padStart(7)}% ${
      ((r.wr - (s?.wr ?? 0)) * 100 >= 0 ? '+' : '') + ((r.wr - (s?.wr ?? 0)) * 100).toFixed(1)
    } ${r.ortg.toFixed(1).padStart(7)} ${r.drtg.toFixed(1).padStart(6)}`,
  );
}
