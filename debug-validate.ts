import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, buildPlayerSeason, buildPool } from '../packages/test-fixtures/src/index.js';
import { dataValidate } from '../tools/cli/src/commands/data-validate.js';

const dir = await mkdtemp(join(tmpdir(), 'hr-debug-'));
const poolDir = join(dir, 'pools');
await mkdir(poolDir);
const assetPath = join(poolDir, 'lakers-1990s.json');
const pool = buildPool([buildPlayerSeason({ altIds: { bbref: 'player01' } })]);
const asset = JSON.stringify(pool);
await writeFile(assetPath, asset);
const contentHash = createHash('sha256').update(asset).digest('hex');
const manifest = buildManifest({
  pools: [{ franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash }],
});
const manifestPath = join(dir, 'manifest.json');
await writeFile(manifestPath, JSON.stringify(manifest));
const report = await dataValidate(manifestPath, false);
console.log('OK', report.ok);
console.log('FAILURES', JSON.stringify(report.failures, null, 1).slice(0, 3000));
await rm(dir, { recursive: true, force: true });
