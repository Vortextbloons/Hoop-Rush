import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sortedJsonFiles } from '../shared/manifest.ts';
import { PUBLIC_DATA } from '../config.ts';
import { fileExists, readJson, sha256File, sha256Hex, writeJsonRetry } from '../json.ts';
import {
  LINEAGE_RULE_VERSION,
  MANIFEST_SCHEMA_VERSION,
  parsePool,
  parsePlayersIndex,
  parseRosterDetails,
  PLAYERS_INDEX_SCHEMA_VERSION,
  RATING_MODEL_VERSION,
} from '@hoop-rush/data-contracts';
import { LINEAGE_SEGMENTS, MODERN_SLOTS } from '../lineage.ts';
import { classifyUnattempted, loadCoverageReport, loadManifest } from '../pools/compute.ts';
const manifestEraSchema = z.looseObject({
  eraId: z.string(),
  label: z.string().optional(),
  fromSeasonKey: z.string(),
  toSeasonKey: z.string(),
});
type ManifestEra = z.infer<typeof manifestEraSchema>;
const manifestPoolEntrySchema = z.looseObject({
  franchiseId: z.string(),
  eraId: z.string(),
  url: z.string(),
  contentHash: z.string(),
});
const manifestAssetRefSchema = z.looseObject({
  url: z.string(),
  contentHash: z.string(),
});
type ManifestAssetRef = z.infer<typeof manifestAssetRefSchema>;
const manifestPoolFileSchema = z.looseObject({
  players: z.array(z.unknown()).optional(),
  coverageSummary: z.unknown().optional(),
});
type ManifestPoolFile = z.infer<typeof manifestPoolFileSchema>;
const manifestSimProfileSchema = z.looseObject({
  eraId: z.string(),
});
const manifestSimIndexEntrySchema = z.object({
  eraId: z.string(),
  url: z.string(),
  contentHash: z.string(),
});
type ManifestSimIndexEntry = z.infer<typeof manifestSimIndexEntrySchema>;
const seasonArtifactsSchema = z.object({
  league: manifestAssetRefSchema.optional(),
  schedule: manifestAssetRefSchema.optional(),
  draftCatalog: manifestAssetRefSchema.optional(),
  rosterTargets: manifestAssetRefSchema.optional(),
  freeAgencyIndex: manifestAssetRefSchema.optional(),
  freeAgencyTargets: manifestAssetRefSchema.optional(),
});
type SeasonArtifacts = z.infer<typeof seasonArtifactsSchema>;
const importerManifestSchema = z.looseObject({
  schemaVersion: z.number(),
  dataVersion: z.string(),
  modernFranchiseSlots: z.array(z.unknown()).optional(),
  franchiseLineage: z.array(z.unknown()).optional(),
  eras: z.array(manifestEraSchema),
  pools: z.array(manifestPoolEntrySchema).optional(),
  availability: z.array(z.unknown()).optional(),
  eraSimulationProfiles: z.array(z.unknown()).optional(),
  bracket: manifestAssetRefSchema.optional(),
  playersIndex: manifestAssetRefSchema.optional(),
  rosterDetails: manifestAssetRefSchema.optional(),
  season: seasonArtifactsSchema.optional(),
  assets: z
    .looseObject({
      source: z.string().optional(),
      cacheVersion: z.string().optional(),
    })
    .optional(),
});
export type Manifest = z.infer<typeof importerManifestSchema>;
export const MANIFEST_PATH = join(PUBLIC_DATA, 'manifest.json');
export const DATA_VERSION = 'm10-ratings-v3.8';
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
export function rebuildPlayersIndex(
  dataDir = PUBLIC_DATA,
  preloaded?: ReadonlyMap<string, unknown>,
): {
  url: string;
  contentHash: string;
} | null {
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const indexPlayers: ReturnType<typeof peakPlayerToDraftEntry>[] = [];
  for (const name of poolFiles) {
    try {
      const raw = preloaded?.get(name) ?? readJson(join(poolsDir, name));
      const validated = parsePool(raw);
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
export function rebuildRosterDetails(
  dataDir = PUBLIC_DATA,
  preloaded?: ReadonlyMap<string, unknown>,
): {
  url: string;
  contentHash: string;
} | null {
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const detailPlayers: ReturnType<typeof peakPlayerToRosterDetails>[] = [];
  for (const name of poolFiles) {
    try {
      const raw = preloaded?.get(name) ?? readJson(join(poolsDir, name));
      const validated = parsePool(raw);
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
export function refreshPlayersIndexInManifest(dataDir = PUBLIC_DATA): void {
  const entry = rebuildPlayersIndex(dataDir);
  const detailsEntry = rebuildRosterDetails(dataDir);
  if (entry === null && detailsEntry === null) return;
  const manifestPath = join(dataDir, 'manifest.json');
  if (!fileExists(manifestPath)) return;
  const manifestRaw = readJson(manifestPath) as unknown;
  const manifestParsed = importerManifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) return;
  const manifest = manifestParsed.data;
  if (entry !== null) manifest.playersIndex = entry;
  if (detailsEntry !== null) manifest.rosterDetails = detailsEntry;
  writeJsonRetry(manifestPath, manifest, true);
  console.log(
    `updated players index (${entry?.contentHash.slice(0, 8) ?? 'n/a'}…) and roster details (${detailsEntry?.contentHash.slice(0, 8) ?? 'n/a'}…)`,
  );
}
export const ASSET_CACHE_VERSION = '2026-08-03-historical-logos-v1';
export function run(dataDir = PUBLIC_DATA): void {
  const manifestPath = join(dataDir, 'manifest.json');
  const previousRaw = fileExists(manifestPath) ? (readJson(manifestPath) as unknown) : null;
  const previousParsed =
    previousRaw === null ? null : importerManifestSchema.safeParse(previousRaw);
  const previous = previousParsed?.success === true ? previousParsed.data : null;
  const previousAssets = previous?.assets;
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
      ...(previousAssets ?? {}),
      cacheVersion: ASSET_CACHE_VERSION,
    },
  };
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const poolByKey = new Map<string, ManifestPoolFile>();
  const poolTextByKey = new Map<string, string>();
  const poolEntries: z.infer<typeof manifestPoolEntrySchema>[] = [];
  for (const name of poolFiles) {
    const [franchiseId, eraId] = name.slice(0, -5).split('-', 2);
    if (franchiseId === undefined || eraId === undefined) {
      throw new Error(`cannot derive pool ids from filename: ${name}`);
    }
    let pool: ManifestPoolFile;
    let poolText: string;
    try {
      poolText = readFileSync(join(poolsDir, name), 'utf8');
      const poolRaw = JSON.parse(poolText) as unknown;
      const poolParsed = manifestPoolFileSchema.safeParse(poolRaw);
      if (!poolParsed.success) {
        throw new Error(poolParsed.error.issues[0]?.message ?? 'invalid pool');
      }
      pool = poolParsed.data;
    } catch (error) {
      throw new Error(`unreadable pool ${name}: ${(error as Error).message}`);
    }
    poolByKey.set(`${franchiseId}/${eraId}`, pool);
    poolTextByKey.set(`${franchiseId}/${eraId}`, poolText);
    poolEntries.push({
      franchiseId,
      eraId,
      url: `pools/${name}`,
      contentHash: sha256Hex(poolText),
    });
  }
  manifest.pools = poolEntries;
  const playersIndexEntry = rebuildPlayersIndex(dataDir, poolByKey);
  if (playersIndexEntry !== null) {
    manifest.playersIndex = playersIndexEntry;
  }
  const rosterDetailsEntry = rebuildRosterDetails(dataDir, poolByKey);
  if (rosterDetailsEntry !== null) {
    manifest.rosterDetails = rosterDetailsEntry;
  }
  const manifestCore = loadManifest();
  const coverage = new Map(
    loadCoverageReport().map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  const availability: unknown[] = [];
  for (const slot of MODERN_SLOTS) {
    for (const era of manifest.eras ?? []) {
      const key = `${slot.franchiseId}/${era.eraId}`;
      const pool = poolByKey.get(key) ?? null;
      if (pool !== null) {
        availability.push({
          franchiseId: slot.franchiseId,
          eraId: era.eraId,
          status: 'available',
          url: `pools/${slot.franchiseId}-${era.eraId}.json`,
          contentHash: sha256Hex(poolTextByKey.get(key) ?? ''),
          playerCount: pool.players?.length ?? 0,
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
  manifest.availability = availability;
  const profiles: ManifestSimIndexEntry[] = [];
  const simDir = join(dataDir, 'era-sim');
  for (const name of sortedJsonFiles(simDir)) {
    const profileRaw = readJson(join(simDir, name)) as unknown;
    const profileParsed = manifestSimProfileSchema.safeParse(profileRaw);
    if (!profileParsed.success) continue;
    profiles.push({
      eraId: profileParsed.data.eraId,
      url: `era-sim/${name}`,
      contentHash: sha256File(join(simDir, name)),
    });
  }
  manifest.eraSimulationProfiles = profiles;
  const opponentsDir = join(dataDir, 'opponents');
  if (fileExists(join(opponentsDir, 'bracket.json'))) {
    manifest.bracket = {
      url: 'opponents/bracket.json',
      contentHash: sha256File(join(opponentsDir, 'bracket.json')),
    };
  }
  const seasonDir = join(dataDir, 'season');
  const seasonRefs: SeasonArtifacts = {};
  for (const [key, name] of [
    ['league', 'league.json'],
    ['schedule', 'schedule.json'],
    ['draftCatalog', 'draft-catalog.json'],
    ['rosterTargets', 'roster-targets.json'],
    ['freeAgencyIndex', 'free-agency-index.json'],
    ['freeAgencyTargets', 'free-agency-targets.json'],
  ] as const) {
    const path = join(seasonDir, name);
    if (fileExists(path)) {
      seasonRefs[key] = { url: `season/${name}`, contentHash: sha256File(path) };
    }
  }
  if (Object.keys(seasonRefs).length > 0) {
    manifest.season = seasonRefs;
  }
  writeJsonRetry(manifestPath, manifest, true);
  console.log(`updated ${manifestPath}`);
  console.log(
    `slots=${String(MODERN_SLOTS.length)} lineageSegments=${String(LINEAGE_SEGMENTS.length)} pools=${String(poolEntries.length)} availability=${String(availability.length)}`,
  );
}
