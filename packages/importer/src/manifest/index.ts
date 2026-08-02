/**
 * Refreshes manifest content hashes and indexes for packaged artifacts (port
 * of scripts/import-nba/update_manifest.py).
 *
 * Covers: pools, era simulation profiles, and opponent artifacts. Recomputes
 * SHA-256 hashes from the packaged files and rewrites `manifest.json`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DATA } from '../config.js';
import { readJson, sha256File, writeJson } from '../json.js';

type Manifest = Record<string, unknown>;

export const MANIFEST_PATH = join(PUBLIC_DATA, 'manifest.json');

function sortedJsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

/** Recompute pool/era-sim/opponent index entries and rewrite the manifest. */
export function run(dataDir = PUBLIC_DATA): void {
  const manifestPath = join(dataDir, 'manifest.json');
  // Read the existing manifest first; every field other than the recomputed
  // indexes (schemaVersion, dataVersion, franchiseLineage, eras, assets) is
  // preserved untouched.
  const manifest = readJson(manifestPath) as Manifest;

  const pools: unknown[] = [];
  const poolDir = join(dataDir, 'pools');
  for (const name of sortedJsonFiles(poolDir)) {
    // franchiseId/eraId from the filename, split on the first hyphen.
    const [franchiseId, eraId] = name.slice(0, -5).split('-', 2);
    if (franchiseId === undefined || eraId === undefined) {
      throw new Error(`cannot derive pool ids from filename: ${name}`);
    }
    pools.push({
      franchiseId,
      eraId,
      url: `pools/${name}`,
      contentHash: sha256File(join(poolDir, name)),
    });
  }
  manifest['pools'] = pools;

  const profiles: unknown[] = [];
  const simDir = join(dataDir, 'era-sim');
  for (const name of sortedJsonFiles(simDir)) {
    const profile = readJson(join(simDir, name)) as { eraId: string };
    profiles.push({
      eraId: profile.eraId,
      url: `era-sim/${name}`,
      contentHash: sha256File(join(simDir, name)),
    });
  }
  manifest['eraSimulationProfiles'] = profiles;

  const opponents: unknown[] = [];
  const opponentsDir = join(dataDir, 'opponents');
  for (const name of sortedJsonFiles(opponentsDir)) {
    const opponent = readJson(join(opponentsDir, name)) as { opponentId: string };
    if (name === 'bracket.json') {
      manifest['bracket'] = {
        url: `opponents/${name}`,
        contentHash: sha256File(join(opponentsDir, name)),
      };
      continue;
    }
    opponents.push({
      opponentId: opponent.opponentId,
      url: `opponents/${name}`,
      contentHash: sha256File(join(opponentsDir, name)),
    });
  }
  manifest['opponents'] = opponents;

  writeJson(manifestPath, manifest, true);
  const lengthOf = (key: string): number => (manifest[key] as unknown[]).length;
  console.log(`updated ${manifestPath}`);
  console.log(
    `pools=${String(lengthOf('pools'))} profiles=${String(lengthOf('eraSimulationProfiles'))} opponents=${String(lengthOf('opponents'))}`,
  );
}
