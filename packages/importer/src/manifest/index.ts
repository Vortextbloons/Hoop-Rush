/**
 * Regenerates the v2 manifest from packaged artifacts and the authoritative
 * lineage table (spec/12). The manifest is the only artifact that carries the
 * 30 modern franchise slots, the historical lineage segments, and the
 * complete franchise-era availability matrix; the browser never discovers
 * availability by scanning records.
 *
 * Preserved across runs: asset config, eras, and the frozen bracket. Rebuilt
 * every run: pools index, availability matrix (from the persisted coverage
 * report), and era simulation profiles.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DATA } from '../config.js';
import { fileExists, readJson, sha256File, writeJsonRetry } from '../json.js';
import { LINEAGE_RULE_VERSION, ARTIFACT_SCHEMA_VERSION } from '@hoop-rush/data-contracts';
import { LINEAGE_SEGMENTS, MODERN_SLOTS } from '../lineage.js';
import {
  classifyUnattempted,
  loadCoverageReport,
  loadManifest,
  type Pool,
} from '../pools/compute.js';

type Manifest = Record<string, unknown>;

export const MANIFEST_PATH = join(PUBLIC_DATA, 'manifest.json');

export const DATA_VERSION = 'm3.5';

function sortedJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/** Rebuilds the complete v2 manifest from packaged artifacts. */
export function run(dataDir = PUBLIC_DATA): void {
  const manifestPath = join(dataDir, 'manifest.json');
  const previous = fileExists(manifestPath) ? (readJson(manifestPath) as Manifest) : null;

  const manifest: Manifest = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    modernFranchiseSlots: MODERN_SLOTS.map((slot) => ({ ...slot })),
    franchiseLineage: LINEAGE_SEGMENTS.map((segment) => ({
      modernFranchiseId: segment.modernFranchiseId,
      historicalTeamId: segment.historicalTeamId,
      validFromSeasonKey: segment.validFromSeasonKey,
      ...(segment.validThroughSeasonKey !== undefined
        ? { validThroughSeasonKey: segment.validThroughSeasonKey }
        : {}),
      displayName: segment.displayName,
      city: segment.city,
      ...(segment.abbreviation !== undefined ? { abbreviation: segment.abbreviation } : {}),
      sourceIdentityIds: [segment.historicalTeamId],
      lineageRuleVersion: LINEAGE_RULE_VERSION,
    })),
    eras: (previous?.eras as unknown[] | undefined) ?? [],
    pools: [],
    availability: [],
    eraSimulationProfiles: [],
    assets: previous?.assets ?? {},
  };

  // Pools index + availability matrix from packaged pool assets.
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const poolByKey = new Map<string, Pool>();
  const poolEntries: unknown[] = [];
  for (const name of poolFiles) {
    const [franchiseId, eraId] = name.slice(0, -5).split('-', 2);
    if (franchiseId === undefined || eraId === undefined) {
      throw new Error(`cannot derive pool ids from filename: ${name}`);
    }
    let pool: Pool;
    try {
      pool = readJson(join(poolsDir, name)) as Pool;
    } catch (error) {
      throw new Error(`unreadable pool ${name}: ${(error as Error).message}`);
    }
    poolByKey.set(`${franchiseId}/${eraId}`, pool);
    poolEntries.push({
      franchiseId,
      eraId,
      url: `pools/${name}`,
      contentHash: sha256File(join(poolsDir, name)),
    });
  }
  manifest['pools'] = poolEntries;

  // Complete availability matrix: every slot x era combination, from the
  // persisted coverage report (truthful reasons) with cheap classification
  // for combinations the last build did not attempt.
  const manifestCore = loadManifest();
  const coverage = new Map(
    loadCoverageReport().map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  const availability: unknown[] = [];
  for (const slot of MODERN_SLOTS) {
    for (const era of manifest['eras'] as Array<{ eraId: string }>) {
      const key = `${slot.franchiseId}/${era.eraId}`;
      const pool = poolByKey.get(key) ?? null;
      if (pool !== null) {
        availability.push({
          franchiseId: slot.franchiseId,
          eraId: era.eraId,
          status: 'available',
          url: `pools/${slot.franchiseId}-${era.eraId}.json`,
          contentHash: sha256File(join(poolsDir, `${slot.franchiseId}-${era.eraId}.json`)),
          playerCount: pool.players.length,
          coverageSummary: pool.coverageSummary,
        });
        continue;
      }
      const reported = coverage.get(key);
      if (reported !== undefined && reported.status === 'unavailable') {
        availability.push({ ...reported });
        continue;
      }
      const classified = classifyUnattempted(slot.franchiseId, era.eraId, manifestCore);
      availability.push({
        franchiseId: slot.franchiseId,
        eraId: era.eraId,
        status: 'unavailable',
        reason: classified.reason,
        ...(classified.detail !== undefined ? { detail: classified.detail } : {}),
        ...(classified.firstSupportedSeason !== undefined
          ? { firstSupportedSeason: classified.firstSupportedSeason }
          : {}),
      });
    }
  }
  manifest['availability'] = availability;

  // Era simulation profiles.
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

  // Frozen bracket (the fixed 30-opponent schedule).
  const opponentsDir = join(dataDir, 'opponents');
  if (fileExists(join(opponentsDir, 'bracket.json'))) {
    manifest['bracket'] = {
      url: 'opponents/bracket.json',
      contentHash: sha256File(join(opponentsDir, 'bracket.json')),
    };
  }

  writeJsonRetry(manifestPath, manifest, true);
  console.log(`updated ${manifestPath}`);
  console.log(
    `slots=${String(MODERN_SLOTS.length)} lineageSegments=${String(LINEAGE_SEGMENTS.length)} pools=${String(poolEntries.length)} availability=${String(availability.length)}`,
  );
}
