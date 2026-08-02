import { readFileSync, writeFileSync } from 'node:fs';
import { pools } from './packages/importer/src/index.js';

const manifest = pools.loadManifest();
const result = pools.computePool('warriors', '2000s', manifest, pools.loadBbrefIds(), false);
if ('reason' in result) {
  console.log('FAIL', result.reason, result.detail);
} else {
  console.log('players', result.players.length);
  const text = JSON.stringify(result, null, 2);
  console.log('bytes', text.length);
  try {
    writeFileSync('apps/web/static/data/pools/warriors-2000s.json', text, 'utf8');
    console.log('write OK');
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.log('WRITE ERR', err.code, err.message.slice(0, 200));
  }
  // Find suspicious names
  for (const player of result.players) {
    if (/[\uD800-\uDFFF]/.test(player.displayName) || /[\uFFFD]/.test(player.displayName)) {
      console.log('SUSPECT NAME', JSON.stringify(player.displayName));
    }
  }
}
