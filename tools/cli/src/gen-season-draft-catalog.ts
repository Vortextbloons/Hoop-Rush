import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DURABILITY_VERSION,
  SEASON_STAMINA_VERSION,
  playerVersionId,
  seasonDraftCatalogSchema,
  type SeasonDraftCandidate,
  type SeasonDraftCandidateDurability,
} from '@hoop-rush/data-contracts';
import { sha256Hex } from './io.ts';
function atomicWriteFileSync(target: string, content: string): void {
  const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  writeFileSync(tmp, content);
  renameSync(tmp, target);
}
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}
interface PoolEntry {
  franchiseId: string;
  eraId: string;
  playerVersionIds: string[];
}
export function durabilityRatingFrom(
  gamesPlayed: number | null | undefined,
  teamGames: number | null | undefined,
): number {
  if (
    gamesPlayed === null ||
    gamesPlayed === undefined ||
    teamGames === null ||
    teamGames === undefined ||
    gamesPlayed <= 0 ||
    teamGames <= 0
  ) {
    return 45;
  }
  return Math.round(Math.min(95, Math.max(45, 45 + (50 * gamesPlayed) / Math.max(1, teamGames))));
}
export function durabilityProfileOf(
  gamesPlayed: number | null | undefined,
  teamGames: number | null | undefined,
): SeasonDraftCandidateDurability {
  return {
    rating: durabilityRatingFrom(gamesPlayed, teamGames),
    derivationVersion: SEASON_DURABILITY_VERSION,
  };
}
function main(): void {
  const manifest = readJson(MANIFEST_PATH) as {
    schemaVersion: number;
    dataVersion: string;
    pools: Array<{
      franchiseId: string;
      eraId: string;
      url: string;
      contentHash: string;
    }>;
    eraSimulationProfiles?: Array<{
      eraId: string;
      url: string;
    }>;
  };
  const manifestDir = dirname(MANIFEST_PATH);
  const candidates = new Map<string, SeasonDraftCandidate>();
  const pools: PoolEntry[] = [];
  let dataVersion = manifest.dataVersion;
  let ratingsVersion = '';
  let positionNormalizationVersion = '';
  let sourceCount = 0;
  for (const entry of manifest.pools) {
    const poolPath = resolve(manifestDir, entry.url);
    const pool = readJson(poolPath) as {
      dataVersion: string;
      franchiseId: string;
      eraId: string;
      players: Array<{
        playerId: string;
        franchiseId: string;
        eraId: string;
        seasonKey: string;
        displayName: string;
        playerExternalId: string;
        positions: {
          primary: string;
          secondary: string[];
          playable: string[];
          normalizationVersion: string;
        };
        heightInches: number | null;
        weightLbs: number | null;
        summaryRatings: {
          overallRating: number;
          offenseRating: number;
          defenseRating: number;
        };
        detailedRatings: Record<string, number>;
        tendencies: Record<string, number>;
        stats?: {
          minutes: number | null;
          gamesPlayed: number | null;
        };
        eligibility?: {
          teamGames?: number | null;
        };
        anchors?: SeasonDraftCandidate['anchors'];
        reconstructedThreePoint?: SeasonDraftCandidate['reconstructedThreePoint'];
      }>;
    };
    dataVersion = pool.dataVersion;
    sourceCount += 1;
    const members: string[] = [];
    for (const player of pool.players) {
      const versionId = playerVersionId(
        player.playerId,
        player.franchiseId,
        player.eraId,
        player.seasonKey,
      );
      const existing = candidates.get(versionId);
      const gamesPlayed = player.stats?.gamesPlayed ?? 0;
      const minutes = player.stats?.minutes ?? 0;
      const historicalMpg = minutes / Math.max(1, gamesPlayed);
      const staminaRating = Math.round(Math.min(95, Math.max(45, 45 + 1.25 * historicalMpg)));
      const record: SeasonDraftCandidate = {
        playerVersionId: versionId,
        playerId: player.playerId,
        franchiseId: player.franchiseId,
        eraId: player.eraId,
        seasonKey: player.seasonKey,
        displayName: player.displayName,
        playerExternalId: player.playerExternalId,
        positions: {
          primary: player.positions.primary as SeasonDraftCandidate['positions']['primary'],
          secondary: player.positions.secondary as SeasonDraftCandidate['positions']['secondary'],
          playable: player.positions.playable as SeasonDraftCandidate['positions']['playable'],
          normalizationVersion: player.positions.normalizationVersion,
        },
        heightInches: player.heightInches,
        weightLbs: player.weightLbs,
        summaryRatings: player.summaryRatings,
        detailedRatings: player.detailedRatings as SeasonDraftCandidate['detailedRatings'],
        tendencies: player.tendencies as SeasonDraftCandidate['tendencies'],
        stamina: {
          rating: staminaRating,
          historicalMpg,
          derivationVersion: SEASON_STAMINA_VERSION,
        },
        durability: durabilityProfileOf(
          player.stats?.gamesPlayed ?? null,
          player.eligibility?.teamGames ?? null,
        ),
        anchors: player.anchors,
        reconstructedThreePoint: player.reconstructedThreePoint,
      };
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(record)) {
          throw new Error(
            `conflicting records derive the same playerVersionId ${versionId} (${player.playerId} in ${player.franchiseId}/${player.eraId} ${player.seasonKey})`,
          );
        }
        continue;
      }
      candidates.set(versionId, record);
      members.push(versionId);
      ratingsVersion =
        (
          player as {
            source?: {
              ratingsVersion?: string;
            };
          }
        ).source?.ratingsVersion ?? ratingsVersion;
      positionNormalizationVersion = player.positions.normalizationVersion;
    }
    pools.push({ franchiseId: entry.franchiseId, eraId: entry.eraId, playerVersionIds: members });
  }
  const catalog = {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
    dataVersion,
    ratingsVersion: ratingsVersion || RATINGS_VERSION,
    positionNormalizationVersion: positionNormalizationVersion || POSITION_NORMALIZATION_VERSION,
    playerVersionIdVersion: 'player-version-id-v1',
    staminaVersion: SEASON_STAMINA_VERSION,
    durabilityVersion: SEASON_DURABILITY_VERSION,
    pools,
    candidates: [...candidates.values()].sort((a, b) =>
      a.playerVersionId < b.playerVersionId ? -1 : 1,
    ),
  };
  const parsed = seasonDraftCatalogSchema.safeParse(catalog);
  if (!parsed.success) {
    throw new Error(
      `derived catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const content = `${JSON.stringify(parsed.data)}\n`;
  mkdirSync(SEASON_DIR, { recursive: true });
  const target = resolve(SEASON_DIR, 'draft-catalog.json');
  atomicWriteFileSync(target, content);
  const seasonManifest = readJson(MANIFEST_PATH) as {
    season?: Record<
      string,
      {
        url?: string;
        contentHash?: string;
      }
    >;
  };
  if (seasonManifest.season !== undefined) {
    seasonManifest.season.draftCatalog = {
      url: 'season/draft-catalog.json',
      contentHash: sha256Hex(content),
    };
    atomicWriteFileSync(MANIFEST_PATH, `${JSON.stringify(seasonManifest, null, 2)}\n`);
  }
  console.log(
    `wrote ${target} (${String(content.length)} bytes, ${String(candidates.size)} candidates, ${String(pools.length)} pools from ${String(sourceCount)} pool artifacts)`,
  );
  console.log(
    `manifest draftCatalog hash updated (${seasonManifest.season?.draftCatalog?.contentHash ?? 'missing season section'})`,
  );
}
main();
