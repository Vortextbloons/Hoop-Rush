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
const teams = bracket.opponents;
const teamOf = (o: OpponentBracket['opponents'][number]): SimulationTeam => ({
  teamId: o.teamId,
  displayName: o.displayName,
  players: o.players,
});

interface Agg {
  games: number;
  pts: number;
  poss: number;
  fga: number;
  fgm: number;
  tpa: number;
  tpm: number;
  fta: number;
  ftm: number;
  orb: number;
  tov: number;
  ast: number;
}

const zero = (): Agg => ({
  games: 0,
  pts: 0,
  poss: 0,
  fga: 0,
  fgm: 0,
  tpa: 0,
  tpm: 0,
  fta: 0,
  ftm: 0,
  orb: 0,
  tov: 0,
  ast: 0,
});
const agg = new Map<string, Agg>();
const perPlayer = new Map<string, { fga: number; fgm: number; tpa: number; pts: number }>();
for (const t of teams) agg.set(t.opponentId, zero());

const gamesPerPair = 6;
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
      for (const [side, opp] of [
        [r.home, aHome ? a : b],
        [r.away, aHome ? b : a],
      ] as const) {
        const e = agg.get(opp.opponentId);
        if (!e) continue;
        e.games += 1;
        e.pts += side.box.points;
        e.poss += side.box.possessions;
        e.fga += side.box.fieldGoals.attempted;
        e.fgm += side.box.fieldGoals.made;
        e.tpa += side.box.threes.attempted;
        e.tpm += side.box.threes.made;
        e.fta += side.box.freeThrows.attempted;
        e.ftm += side.box.freeThrows.made;
        e.orb += side.box.rebounds.offensive;
        e.tov += side.box.turnovers;
        e.ast += side.box.assists;
        for (const p of side.players) {
          const key = `${opp.opponentId}/${p.playerId}`;
          const rec = perPlayer.get(key) ?? { fga: 0, fgm: 0, tpa: 0, pts: 0 };
          rec.fga += p.fieldGoals.attempted;
          rec.fgm += p.fieldGoals.made;
          rec.tpa += p.threes.attempted;
          rec.pts += p.points;
          perPlayer.set(key, rec);
        }
      }
    }
  }
}

const rows = teams.map((t) => {
  const e = agg.get(t.opponentId) ?? zero();
  const g = Math.max(1, e.games);
  const poss = e.poss / g;
  return {
    id: t.opponentId,
    name: t.displayName,
    wr: t.strength.winRate,
    poss,
    ortg: (e.pts / Math.max(1, e.poss)) * 100,
    fgPct: e.fgm / Math.max(1, e.fga),
    threeRate: e.tpa / Math.max(1, e.fga),
    threePct: e.tpm / Math.max(1, e.tpa),
    ftr: e.fta / Math.max(1, e.fga),
    ftPct: e.ftm / Math.max(1, e.fta),
    orbPct: e.orb / Math.max(1, e.fga + e.fta * 0.44 + e.tov),
    tovRate: e.tov / Math.max(1, e.poss),
    astRate: e.ast / Math.max(1, e.fgm),
    shots: e.fga / g,
  };
});
rows.sort((x, y) => y.wr - x.wr);
console.log(
  'team                          win%  pace   ORtg   FG%  3PA%  3P%   FTr   FT%  ORB%  TOV%  AST%',
);
for (const r of rows) {
  console.log(
    `${r.name.padEnd(28)} ${(r.wr * 100).toFixed(1).padStart(5)} ${r.poss.toFixed(1).padStart(5)} ${r.ortg.toFixed(1).padStart(6)} ${(r.fgPct * 100).toFixed(1).padStart(5)} ${(r.threeRate * 100).toFixed(1).padStart(5)} ${(r.threePct * 100).toFixed(1).padStart(5)} ${r.ftr.toFixed(2).padStart(5)} ${(r.ftPct * 100).toFixed(1).padStart(5)} ${(r.orbPct * 100).toFixed(1).padStart(5)} ${(r.tovRate * 100).toFixed(1).padStart(5)} ${(r.astRate * 100).toFixed(1).padStart(5)}`,
  );
}

console.log('\nper-player load (FGA/game, team share of FGA):');
for (const t of teams) {
  const total = t.players.reduce(
    (s, p) => s + (perPlayer.get(`${t.opponentId}/${p.playerId}`)?.fga ?? 0),
    0,
  );
  const line = t.players
    .map((p) => {
      const rec = perPlayer.get(`${t.opponentId}/${p.playerId}`);
      const share = ((rec?.fga ?? 0) / Math.max(1, total)) * 100;
      return `${p.displayName.split(' ').slice(-1)[0]} ${((rec?.fga ?? 0) / gamesPerPair / 29).toFixed(1)}fga/${share.toFixed(0)}%`;
    })
    .join(' · ');
  console.log(`${t.displayName.padEnd(28)} ${line}`);
}
