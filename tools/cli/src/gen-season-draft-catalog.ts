/**
 * Derives the packaged Season Run draft catalog (spec/2.0 M2.1) from the
 * validated franchise-era pool artifacts and updates the manifest hashes.
 * Run with `pnpm --filter @hoop-rush/cli gen-season-draft-catalog` AFTER the
 * pools exist (they are committed under apps/web/static/data/pools).
 *
 * The catalog contains one deduplicated candidate record per
 * playerVersionId with every identity, position, summary, physical,
 * simulation-rating, and tendency field roster scoring needs. Conflicting
 * records that derive the same playerVersionId with different content are
 * rejected; the catalog is validated by the seasonDraftCatalogSchema before
 * it is written.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_DRAFT_VERSION,
  playerVersionId,
  seasonDraftCatalogSchema,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

interface PoolEntry {
  franchiseId: string;
  eraId: string;
  playerVersionIds: string[];
}

function main(): void {
  const manifest = readJson(MANIFEST_PATH) as {
    schemaVersion: number;
    dataVersion: string;
    pools: Array<{ franchiseId: string; eraId: string; url: string; contentHash: string }>;
    eraSimulationProfiles?: Array<{ eraId: string; url: string }>;
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
        (player as { source?: { ratingsVersion?: string } }).source?.ratingsVersion ??
        ratingsVersion;
      positionNormalizationVersion = player.positions.normalizationVersion;
    }
    pools.push({ franchiseId: entry.franchiseId, eraId: entry.eraId, playerVersionIds: members });
  }

  const catalog = {
    schemaVersion: 1,
    catalogVersion: SEASON_DRAFT_VERSION,
    dataVersion,
    ratingsVersion: ratingsVersion || 'ratings-v3.4',
    positionNormalizationVersion: positionNormalizationVersion || 'position-v3',
    playerVersionIdVersion: 'player-version-id-v1',
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
  writeFileSync(target, content);

  const seasonManifest = readJson(MANIFEST_PATH) as {
    season?: Record<string, { url?: string; contentHash?: string }>;
  };
  if (seasonManifest.season !== undefined) {
    seasonManifest.season.draftCatalog = {
      url: 'season/draft-catalog.json',
      contentHash: sha256Hex(content),
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(seasonManifest, null, 2)}\n`);
  }

  console.log(
    `wrote ${target} (${String(content.length)} bytes, ${String(candidates.size)} candidates, ${String(pools.length)} pools from ${String(sourceCount)} pool artifacts)`,
  );
  console.log(
    `manifest draftCatalog hash updated (${seasonManifest.season?.draftCatalog?.contentHash ?? 'missing season section'})`,
  );
}

main();
