import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const catalog = JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8')) as {
  candidates: {
    playerVersionId: string;
    playerId: string;
    seasonKey: string;
    playoffPerformance?: { season: string; playoffs: { gamesPlayed: number } };
  }[];
};
const byVersion = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));

let mismatches = 0;
let profiles = 0;
let checked = 0;
const dir = 'apps/web/static/data/pools';
for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  const pool = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
    players: {
      playerId: string;
      seasonKey: string;
      playoffPerformance?: { season: string; playoffs: { gamesPlayed: number } };
    }[];
  };
  for (const player of pool.players) {
    if (player.playoffPerformance === undefined) continue;
    profiles += 1;
    const candidate = [...byVersion.values()].find(
      (c) => c.playerId === player.playerId && c.seasonKey === player.seasonKey,
    );
    checked += 1;
    if (candidate === undefined) {
      mismatches += 1;
      console.log('no catalog candidate', player.playerId, player.seasonKey);
      continue;
    }
    if (candidate.playoffPerformance === undefined) {
      mismatches += 1;
      console.log('missing profile in catalog', player.playerId, player.seasonKey);
      continue;
    }
    if (candidate.playoffPerformance.season !== candidate.seasonKey) {
      mismatches += 1;
      console.log('season mismatch', player.playerId, player.seasonKey);
    }
    if (candidate.playoffPerformance.playoffs.gamesPlayed <= 0) {
      mismatches += 1;
      console.log('empty sample', player.playerId, player.seasonKey);
    }
  }
}
console.log({ profiles, checked, mismatches });

const lbj = catalog.candidates.find(
  (c) => c.seasonKey === '2017-18' && c.playerId === 'p-2544',
);
console.log('lebron 2017-18', lbj?.playerId, lbj?.seasonKey, lbj?.playoffPerformance?.playoffs.gamesPlayed);
const otherSeasons = catalog.candidates.filter(
  (c) => c.playerId === 'p-2544' && c.seasonKey !== '2017-18' && c.playoffPerformance,
).length;
console.log('other LeBron seasons carrying profiles', otherSeasons);
