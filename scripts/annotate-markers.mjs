/**
 * Resilient headshot-marker annotation for packaged pools.
 *
 * The Python reannotate_assets.py keeps dying in this environment and its
 * cold-cache CDN checks are slow. This script:
 *   - reads the shared CDN status cache (.raw_nba_cache/nba_headshot_status.json)
 *   - HEAD-checks uncached players with small concurrency
 *   - saves the cache after every 50 checks so a restart resumes cleanly
 *   - rewrites each pool only when all its players carry markers
 *
 * Usage: node scripts/annotate-markers.mjs [franchise-prefix...]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.cwd();
const POOLS_DIR = join(ROOT, 'apps', 'web', 'static', 'data', 'pools');
const CACHE_PATH = join(ROOT, '.raw_nba_cache', 'nba_headshot_status.json');
const PLACEHOLDER_BYTES = 12430;
const CONCURRENCY = 8;

function loadCache() {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

let cache = loadCache();
let dirty = 0;

function saveCache() {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 1));
  dirty = 0;
}

async function headAvailable(externalId) {
  if (externalId in cache) return cache[externalId];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(
      `https://cdn.nba.com/headshots/nba/latest/1040x760/${externalId}.png`,
      { method: 'HEAD', redirect: 'follow', signal: controller.signal },
    );
    clearTimeout(timer);
    if (resp.status !== 200) {
      cache[externalId] = false;
    } else {
      const length = resp.headers.get('Content-Length');
      cache[externalId] = length === null || Number(length) !== PLACEHOLDER_BYTES;
    }
  } catch {
    cache[externalId] = false;
  }
  dirty += 1;
  if (dirty >= 50) saveCache();
  return cache[externalId];
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function writeJsonRetry(path, value) {
  const text = JSON.stringify(value, null, 2);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      writeFileSync(path, text, 'utf8');
      return;
    } catch (error) {
      if (attempt === 11) throw error;
      const wait = 200 * (attempt + 1);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

async function annotatePool(path) {
  const pool = JSON.parse(readFileSync(path, 'utf8'));
  const players = pool.players ?? [];
  const pending = players.filter(
    (p) => (p.altIds ?? {}).nbaHeadshotAvailable === undefined,
  );
  if (pending.length === 0) return 'up-to-date';
  await mapLimit(pending, CONCURRENCY, async (player) => {
    const available = await headAvailable(player.playerExternalId);
    player.altIds = { ...(player.altIds ?? {}), nbaHeadshotAvailable: available };
  });
  writeJsonRetry(path, pool);
  saveCache();
  return `${players.length - pending.length}/${players.length} kept, ${pending.length} annotated`;
}

const prefixes = process.argv.slice(2);
const files = readdirSync(POOLS_DIR)
  .filter((name) => name.endsWith('.json'))
  .filter((name) => prefixes.length === 0 || prefixes.some((p) => name.startsWith(p)))
  .sort();

let annotated = 0;
let upToDate = 0;
for (const name of files) {
  const path = join(POOLS_DIR, name);
  try {
    const result = await annotatePool(path);
    if (result === 'up-to-date') upToDate += 1;
    else annotated += 1;
    process.stdout.write(`[${name}] ${result} (cache ${Object.keys(cache).length})\n`);
  } catch (error) {
    process.stdout.write(`[${name}] ERROR ${error.message}\n`);
  }
}
process.stdout.write(`done: ${annotated} pools annotated, ${upToDate} up-to-date\n`);
