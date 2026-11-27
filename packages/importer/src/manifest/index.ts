import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { sortedJsonFiles } from '../shared/fs.ts';
import { rosterAdvancedLoader } from './roster-advanced.ts';
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
  RATINGS_VERSION,
  POSITION_NORMALIZATION_VERSION,
  PLAYER_VERSION_ID_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_DURABILITY_VERSION,
  applySeasonPlayoffProfiles,
  playerVersionId,
  seasonDraftCatalogSchema,
  seasonPlayoffProfilesSchema,
  type FranchiseEraPool,
} from '@hoop-rush/data-contracts';
import { LINEAGE_SEGMENTS, MODERN_SLOTS } from '../lineage.ts';
import { DATA_VERSION } from '../data-version.ts';
export { DATA_VERSION };
import { classifyUnattempted, loadCoverageReport } from '../pools/compute.ts';
import {
  FULL_COURT_HEALTH_PROFILES_ASSET,
  validateFullCourtHealthProfiles,
} from '../full-court-health/artifact.ts';
import {
  MANIFEST_PATH,
  importerManifestSchema,
  loadManifest,
  manifestPoolEntrySchema,
  manifestSimProfileSchema,
  writeManifestValidated,
  type Manifest,
  type ManifestSimIndexEntry,
} from '../shared/manifest.ts';
export { MANIFEST_PATH };
export type { Manifest };
function draftCandidateOf(player: FranchiseEraPool['players'][number]) {
  const historicalMpg = player.stats.minutes / Math.max(1, player.stats.gamesPlayed);
  const gamesPlayed = player.stats.gamesPlayed;
  const teamGames = player.eligibility.teamGames;
  return {
    playerVersionId: playerVersionId(
      player.playerId,
      player.franchiseId,
      player.eraId,
      player.seasonKey,
    ),
    playerId: player.playerId,
    franchiseId: player.franchiseId,
    eraId: player.eraId,
    seasonKey: player.seasonKey,
    displayName: player.displayName,
    playerExternalId: player.playerExternalId,
    positions: player.positions,
    heightInches: player.heightInches,
    weightLbs: player.weightLbs,
    summaryRatings: player.summaryRatings,
    detailedRatings: player.detailedRatings,
    tendencies: player.tendencies,
    stamina: {
      rating: Math.round(Math.min(95, Math.max(45, 45 + 1.25 * historicalMpg))),
      historicalMpg,
      derivationVersion: SEASON_STAMINA_VERSION,
    },
    durability: {
      rating: Math.round(
        Math.min(95, Math.max(45, 45 + (50 * gamesPlayed) / Math.max(1, teamGames))),
      ),
      derivationVersion: SEASON_DURABILITY_VERSION,
    },
    anchors: player.anchors,
    reconstructedThreePoint: player.reconstructedThreePoint,
  };
}
function playoffProfileOf(player: FranchiseEraPool['players'][number]) {
  if (player.playoffPerformance === undefined) return null;
  return {
    playerVersionId: playerVersionId(
      player.playerId,
      player.franchiseId,
      player.eraId,
      player.seasonKey,
    ),
    playoffPerformance: player.playoffPerformance,
  };
}
function playoffProfilesOf(pools: readonly FranchiseEraPool[]) {
  return pools
    .flatMap((pool) => pool.players.map((player) => playoffProfileOf(player)))
    .filter((profile): profile is NonNullable<typeof profile> => profile !== null)
    .sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
}
function writeCompactJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, 'utf8');
  renameSync(temporaryPath, path);
}
function buildPlayoffProfiles(pools: readonly FranchiseEraPool[]) {
  const profiles = playoffProfilesOf(pools);
  if (profiles.length === 0) return null;
  return seasonPlayoffProfilesSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: DATA_VERSION,
    profiles,
  });
}
function writePlayoffProfiles(
  dataDir: string,
  artifact: NonNullable<ReturnType<typeof buildPlayoffProfiles>>,
): { url: string; contentHash: string } {
  const path = join(dataDir, 'playoff-profiles.json');
  writeCompactJson(path, artifact);
  return { url: 'playoff-profiles.json', contentHash: sha256File(path) };
}
function rebuildDraftCatalog(pools: readonly FranchiseEraPool[], dataDir: string) {
  const candidates = pools
    .flatMap((pool) => pool.players.map(draftCandidateOf))
    .sort((a, b) => a.playerVersionId.localeCompare(b.playerVersionId));
  const baseCatalog = seasonDraftCatalogSchema.parse({
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion: DATA_VERSION,
    ratingsVersion: RATINGS_VERSION,
    positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: PLAYER_VERSION_ID_VERSION,
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools: pools.map((pool) => ({
      franchiseId: pool.franchiseId,
      eraId: pool.eraId,
      playerVersionIds: pool.players.map((player) =>
        playerVersionId(player.playerId, player.franchiseId, player.eraId, player.seasonKey),
      ),
    })),
    candidates,
  });
  const playoffArtifact = buildPlayoffProfiles(pools);
  // The identity hash covers the pre-split logical catalog so existing saves
  // (which pinned that byte hash) keep resuming after the asset split. Merge
  // the schema-parsed profiles so key order/optional fields match the old
  // single-catalog serialization exactly.
  const fullCatalog =
    playoffArtifact === null
      ? baseCatalog
      : applySeasonPlayoffProfiles(baseCatalog, playoffArtifact);
  const identityHash = sha256Hex(`${JSON.stringify(fullCatalog)}\n`);
  const path = join(dataDir, 'draft-catalog.json');
  writeCompactJson(path, baseCatalog);
  return {
    catalog: {
      url: 'draft-catalog.json',
      contentHash: sha256File(path),
      identityHash,
    },
    candidates: baseCatalog.candidates,
    playoffProfiles:
      playoffArtifact === null ? null : writePlayoffProfiles(dataDir, playoffArtifact),
  };
}

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
    ratings: player.detailedRatings,
    tendencies: player.tendencies,
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
      throw new Error(
        `pool ${name} fails validation for the players index: ${(error as Error).message}`,
      );
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
  splitPlayoffProfiles = false,
): {
  url: string;
  contentHash: string;
  playoffProfilesSplit?: true;
} | null {
  const poolsDir = join(dataDir, 'pools');
  const poolFiles = sortedJsonFiles(poolsDir);
  const detailPlayers: Array<
    ReturnType<typeof peakPlayerToRosterDetails> & {
      playoffPerformance?: FranchiseEraPool['players'][number]['playoffPerformance'];
    }
  > = [];
  const recoverAdvanced = rosterAdvancedLoader();
  for (const name of poolFiles) {
    try {
      const raw = preloaded?.get(name) ?? readJson(join(poolsDir, name));
      const validated = parsePool(raw);
      for (const player of validated.players) {
        detailPlayers.push({
          ...peakPlayerToRosterDetails(player),
          ...recoverAdvanced(player),
          ...(!splitPlayoffProfiles && player.playoffPerformance !== undefined
            ? { playoffPerformance: player.playoffPerformance }
            : {}),
        });
      }
    } catch (error) {
      throw new Error(
        `pool ${name} fails validation for roster details: ${(error as Error).message}`,
      );
    }
  }
  if (detailPlayers.length === 0) return null;
  const detailsPath = join(dataDir, 'roster-details.json');
  const details = parseRosterDetails({
    schemaVersion: 2,
    dataVersion: DATA_VERSION,
    players: detailPlayers,
  });
  writeJsonRetry(detailsPath, details, true);
  return {
    url: 'roster-details.json',
    contentHash: sha256File(detailsPath),
    ...(splitPlayoffProfiles ? { playoffProfilesSplit: true } : {}),
  };
}
export function refreshPlayersIndexInManifest(dataDir = PUBLIC_DATA): void {
  const entry = rebuildPlayersIndex(dataDir);
  const detailsEntry = rebuildRosterDetails(dataDir);
  if (entry === null && detailsEntry === null) return;
  const manifestPath = join(dataDir, 'manifest.json');
  if (!fileExists(manifestPath)) return;
  const manifestRaw = readJson(manifestPath);
  const manifestParsed = importerManifestSchema.safeParse(manifestRaw);
  if (!manifestParsed.success) return;
  const manifest = manifestParsed.data;
  if (entry !== null) manifest.playersIndex = entry;
  if (detailsEntry !== null) manifest.rosterDetails = detailsEntry;
  writeManifestValidated(manifestPath, manifest);
  console.log(
    `updated players index (${entry?.contentHash.slice(0, 8) ?? 'n/a'}…) and roster details (${detailsEntry?.contentHash.slice(0, 8) ?? 'n/a'}…)`,
  );
}
export const ASSET_CACHE_VERSION = '2026-08-03-historical-logos-v1';
export function run(dataDir = PUBLIC_DATA): void {
  const manifestPath = join(dataDir, 'manifest.json');
  const previousRaw = fileExists(manifestPath) ? readJson(manifestPath) : null;
  const previousParsed =
    previousRaw === null ? null : importerManifestSchema.safeParse(previousRaw);
  const previous = previousParsed?.success === true ? previousParsed.data : null;
  const previousAssets = previous?.assets;
  const previousCollection = previous?.collection;
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
  const poolByKey = new Map<string, FranchiseEraPool>();
  const poolTextByKey = new Map<string, string>();
  const poolEntries: z.infer<typeof manifestPoolEntrySchema>[] = [];
  for (const name of poolFiles) {
    const [franchiseId, eraId] = name.slice(0, -5).split('-', 2);
    if (franchiseId === undefined || eraId === undefined) {
      throw new Error(`cannot derive pool ids from filename: ${name}`);
    }
    let pool: FranchiseEraPool;
    let poolText: string;
    try {
      poolText = readFileSync(join(poolsDir, name), 'utf8');
      pool = parsePool(JSON.parse(poolText) as unknown);
    } catch (error) {
      const detail =
        error instanceof z.ZodError
          ? `${error.issues[0]?.path.join('.') || '(root)'} ${error.issues[0]?.message ?? 'invalid pool'}`
          : (error as Error).message;
      throw new Error(`pool ${name} fails validation: ${detail}`);
    }
    if (pool.dataVersion !== DATA_VERSION) {
      throw new Error(
        `pool ${name} dataVersion ${pool.dataVersion} does not match the importer ${DATA_VERSION}; rebuild the pool before publishing`,
      );
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
  const draftAssets =
    poolByKey.size === 0 ? null : rebuildDraftCatalog([...poolByKey.values()], dataDir);
  const playersIndexEntry = rebuildPlayersIndex(dataDir, poolByKey);
  if (playersIndexEntry !== null) {
    manifest.playersIndex = playersIndexEntry;
  }
  const rosterDetailsEntry = rebuildRosterDetails(
    dataDir,
    poolByKey,
    draftAssets?.playoffProfiles != null,
  );
  if (rosterDetailsEntry !== null) {
    manifest.rosterDetails = rosterDetailsEntry;
  }
  const manifestCore = loadManifest();
  const coverage = new Map(
    loadCoverageReport().map((entry) => [`${entry.franchiseId}/${entry.eraId}`, entry]),
  );
  const availability: unknown[] = [];
  for (const slot of MODERN_SLOTS) {
    for (const era of manifest.eras) {
      const key = `${slot.franchiseId}/${era.eraId}`;
      const pool = poolByKey.get(key) ?? null;
      if (pool !== null) {
        availability.push({
          franchiseId: slot.franchiseId,
          eraId: era.eraId,
          status: 'available',
          url: `pools/${slot.franchiseId}-${era.eraId}.json`,
          contentHash: sha256Hex(poolTextByKey.get(key) ?? ''),
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
  manifest.availability = availability;
  const profiles: ManifestSimIndexEntry[] = [];
  const simDir = join(dataDir, 'era-sim');
  for (const name of sortedJsonFiles(simDir)) {
    const profileRaw = readJson(join(simDir, name));
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
  for (const [key, filename] of [
    ['bracket', 'bracket.json'],
    ['capRushBracket', 'cap-rush-field.json'],
    ['capRushRosterMetadata', 'cap-rush-roster-metadata.json'],
  ] as const) {
    if (fileExists(join(opponentsDir, filename))) {
      manifest[key] = {
        url: `opponents/${filename}`,
        contentHash: sha256File(join(opponentsDir, filename)),
      };
    }
  }
  if (draftAssets !== null) {
    manifest.draftCatalog = draftAssets.catalog;
    if (draftAssets.playoffProfiles !== null) {
      manifest.playoffProfiles = draftAssets.playoffProfiles;
    }
  }
  const healthProfilesPath = join(dataDir, FULL_COURT_HEALTH_PROFILES_ASSET);
  if (fileExists(healthProfilesPath)) {
    if (draftAssets === null) {
      throw new Error('Full Court health profiles require a packaged draft catalog');
    }
    validateFullCourtHealthProfiles(
      readJson(healthProfilesPath),
      draftAssets,
      draftAssets.catalog.contentHash,
    );
    manifest.fullCourtHealthProfiles = {
      url: FULL_COURT_HEALTH_PROFILES_ASSET,
      contentHash: sha256File(healthProfilesPath),
    };
  }
  if (previousCollection !== undefined) {
    manifest.collection = previousCollection;
  }
  writeManifestValidated(manifestPath, manifest);
  console.log(`updated ${manifestPath}`);
  console.log(
    `slots=${String(MODERN_SLOTS.length)} lineageSegments=${String(LINEAGE_SEGMENTS.length)} pools=${String(poolEntries.length)} availability=${String(availability.length)}`,
  );
}
