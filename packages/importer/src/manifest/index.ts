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
import {
  LINEAGE_RULE_VERSION,
  MANIFEST_SCHEMA_VERSION,
  parsePool,
  parsePlayersIndex,
  parseRosterDetails,
  PLAYERS_INDEX_SCHEMA_VERSION,
  RATING_MODEL_VERSION,
} from '@hoop-rush/data-contracts';
import { LINEAGE_SEGMENTS, MODERN_SLOTS } from '../lineage.js';
import {
  classifyUnattempted,
  loadCoverageReport,
  loadManifest,
  type Pool,
} from '../pools/compute.js';

type Manifest = Record<string, unknown>;

export const MANIFEST_PATH = join(PUBLIC_DATA, 'manifest.json');

export const DATA_VERSION = 'm7-ratings-v3.1';

function peakPlayerToDraftEntry(player: ReturnType<typeof parsePool>['players'][number]) {
  return {
    playerId: player.playerId,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    firstName: player.firstName,
    lastName: player.lastName,
    displayName: player.displayName,
    playerExternalId: player.playerExternalId,
    altIds: player.altIds ?? null,
    positionsPlayable: player.positions.playable,
    overall: player.summaryRatings.overallRating,
    offense: player.summaryRatings.offenseRating,
    defense: player.summaryRatings.defenseRating,
    selectionScore: player.selectionScore,
    ratingModelVersion: RATING_MODEL_VERSION,
  };
}

function peakPlayerToRosterDetails(player: ReturnType<typeof parsePool>['players'][number]) {
  return {
    playerId: player.playerId,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    stats: player.stats,
  };
}

function sortedJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Rebuilds players-index.json (compact draft rows) from schema-valid packaged
 * pools and returns the manifest index entry (url + content hash). Skips
 * invalid pool files with a warning instead of failing the whole build.
 */
export function rebuildPlayersIndex(
  dataDir = PUBLIC_DATA,
): { url: string; contentHash: string } | null {
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const indexPlayers: ReturnType<typeof peakPlayerToDraftEntry>[] = [];
  for (const name of poolFiles) {
    try {
      const validated = parsePool(readJson(join(poolsDir, name)));
      for (const player of validated.players) {
        indexPlayers.push(peakPlayerToDraftEntry(player));
      }
    } catch (error) {
      console.warn(`skipped pool ${name} for players index: ${(error as Error).message}`);
    }
  }
  if (indexPlayers.length === 0) return null;
  const indexPath = join(dataDir, 'players-index.json');
  const index = parsePlayersIndex({
    schemaVersion: PLAYERS_INDEX_SCHEMA_VERSION,
    dataVersion: DATA_VERSION,
    players: indexPlayers,
  });
  writeJsonRetry(indexPath, index, true);
  return {
    url: 'players-index.json',
    contentHash: sha256File(indexPath),
  };
}

/**
 * Rebuilds roster-details.json (season statistics and height/weight behind
 * every draft row) and returns the manifest index entry. Only the Roster
 * screen loads this asset, so sandbox and classic never parse it.
 */
export function rebuildRosterDetails(
  dataDir = PUBLIC_DATA,
): { url: string; contentHash: string } | null {
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const detailPlayers: ReturnType<typeof peakPlayerToRosterDetails>[] = [];
  for (const name of poolFiles) {
    try {
      const validated = parsePool(readJson(join(poolsDir, name)));
      for (const player of validated.players) {
        detailPlayers.push(peakPlayerToRosterDetails(player));
      }
    } catch (error) {
      console.warn(`skipped pool ${name} for roster details: ${(error as Error).message}`);
    }
  }
  if (detailPlayers.length === 0) return null;
  const detailsPath = join(dataDir, 'roster-details.json');
  const details = parseRosterDetails({
    schemaVersion: 1,
    dataVersion: DATA_VERSION,
    players: detailPlayers,
  });
  writeJsonRetry(detailsPath, details, true);
  return {
    url: 'roster-details.json',
    contentHash: sha256File(detailsPath),
  };
}

/** Refreshes the draft index and roster-details artifacts and updates manifest.json in place. */
export function refreshPlayersIndexInManifest(dataDir = PUBLIC_DATA): void {
  const entry = rebuildPlayersIndex(dataDir);
  const detailsEntry = rebuildRosterDetails(dataDir);
  if (entry === null && detailsEntry === null) return;
  const manifestPath = join(dataDir, 'manifest.json');
  if (!fileExists(manifestPath)) return;
  const manifest = readJson(manifestPath) as Manifest;
  if (entry !== null) manifest['playersIndex'] = entry;
  if (detailsEntry !== null) manifest['rosterDetails'] = detailsEntry;
  writeJsonRetry(manifestPath, manifest, true);
  console.log(
    `updated players index (${entry?.contentHash.slice(0, 8) ?? 'n/a'}…) and roster details (${detailsEntry?.contentHash.slice(0, 8) ?? 'n/a'}…)`,
  );
}

/** Cache-busting version for the historical logo asset set (m7 branding). */
export const ASSET_CACHE_VERSION = '2026-08-03-historical-logos-v1';

/** Rebuilds the complete v2 manifest from packaged artifacts. */
export function run(dataDir = PUBLIC_DATA): void {
  const manifestPath = join(dataDir, 'manifest.json');
  const previous = fileExists(manifestPath) ? (readJson(manifestPath) as Manifest) : null;

  const manifest: Manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
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
      ...(segment.logoCandidates !== undefined ? { logoCandidates: segment.logoCandidates } : {}),
    })),
    eras: previous?.eras ?? [],
    pools: [],
    availability: [],
    eraSimulationProfiles: [],
    assets: {
      ...(previous?.assets ?? {}),
      cacheVersion: ASSET_CACHE_VERSION,
    },
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

  const playersIndexEntry = rebuildPlayersIndex(dataDir);
  if (playersIndexEntry !== null) {
    manifest['playersIndex'] = playersIndexEntry;
  }
  const rosterDetailsEntry = rebuildRosterDetails(dataDir);
  if (rosterDetailsEntry !== null) {
    manifest['rosterDetails'] = rosterDetailsEntry;
  }

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
        detail: classified.detail,
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
