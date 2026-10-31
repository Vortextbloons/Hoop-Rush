import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePool } from '../../packages/data-contracts/src/index.ts';
import { PUBLIC_DATA } from '../../packages/importer/src/config.ts';
import { loadPlayoffAdjustments } from '../../packages/importer/src/ratings/playoff-performance.ts';
import { run } from '../../packages/importer/src/manifest/index.ts';

const poolsDir = join(PUBLIC_DATA, 'pools');
let updated = 0;
for (const name of readdirSync(poolsDir)
  .filter((name) => name.endsWith('.json'))
  .sort()) {
  const path = join(poolsDir, name);
  const original = readFileSync(path, 'utf8');
  const pool = parsePool(JSON.parse(original));
  let changed = false;
  for (const player of pool.players) {
    if (player.playoffPerformance === undefined) continue;
    const adjustment = loadPlayoffAdjustments(player.seasonKey).get(player.playerExternalId);
    if (JSON.stringify(player.playoffPerformance.adjustment) === JSON.stringify(adjustment))
      continue;
    if (adjustment === undefined) delete player.playoffPerformance.adjustment;
    else player.playoffPerformance.adjustment = adjustment;
    changed = true;
    updated += 1;
  }
  if (changed) {
    const raw = JSON.parse(original);
    raw.players = raw.players.map((player: { playerId: string }) => {
      const validated = pool.players.find((candidate) => candidate.playerId === player.playerId);
      return { ...player, playoffPerformance: validated?.playoffPerformance };
    });
    parsePool(raw);
    writeFileSync(path, JSON.stringify(raw) + '\n');
  }
}
run();
console.log(`Updated ${updated} playoff profiles`);
