import { computePool, loadManifest, loadBbrefIds } from './src/pools/compute.js';

const manifest = loadManifest();
console.log('eras', manifest.eras.length, 'pools', manifest.pools.length);
const result = computePool('lakers', '1990s', manifest, loadBbrefIds(), false);
if ('reason' in result) {
  console.log('FAIL', result.reason, result.detail);
} else {
  console.log('OK players', result.players.length);
  console.log('first', result.players[0]?.displayName, result.players[0]?.seasonKey);
}
