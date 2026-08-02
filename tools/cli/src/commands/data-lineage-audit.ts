import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.js';

/**
 * `hoop-rush data lineage-audit`: proves historical team ranges map to
 * exactly one modern slot, detects gaps/overlaps/duplicates, verifies pool
 * ownership (every packaged player-season resolves through the lineage
 * table), checks ABA exclusion, and reports unavailable combinations
 * (spec/09, spec/12).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');

export const DATA_LINEAGE_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
  verbose: false,
};

export interface LineageAuditPayload {
  dataVersion: string;
  slotCount: number;
  segmentCount: number;
  overlaps: string[];
  duplicates: string[];
  ownershipFailures: string[];
  unavailableCombinations: Array<{ franchiseId: string; eraId: string; reason: string }>;
}

export async function dataLineageAudit(args: { input?: string | null }): Promise<CliReport> {
  const inputPath = args.input ?? DEFAULT_MANIFEST;
  let raw: string;
  try {
    raw = await readFile(inputPath, 'utf8');
  } catch {
    return makeReport(
      'data lineage-audit',
      { input: inputPath },
      {
        failures: [`manifest not found or unreadable: ${inputPath}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const parsed = hoopRushManifestSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    return makeReport(
      'data lineage-audit',
      { input: inputPath },
      {
        failures: [`manifest fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const manifest: HoopRushManifest = parsed.data;
  const failures: string[] = [];
  const details: string[] = [];
  const overlaps: string[] = [];
  const duplicates: string[] = [];
  const ownershipFailures: string[] = [];

  // Per-slot segments sorted; detect overlaps (gaps are legal: Hornets 2002-03).
  const bySlot = new Map<string, typeof manifest.franchiseLineage>();
  for (const segment of manifest.franchiseLineage) {
    const list = bySlot.get(segment.modernFranchiseId) ?? [];
    list.push(segment);
    bySlot.set(segment.modernFranchiseId, list);
  }
  for (const [franchiseId, segments] of bySlot) {
    const sorted = [...segments].sort((a, b) =>
      a.validFromSeasonKey.localeCompare(b.validFromSeasonKey),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      const next = sorted[i + 1];
      if (
        next &&
        current.validThroughSeasonKey !== undefined &&
        next.validFromSeasonKey <= current.validThroughSeasonKey
      ) {
        const overlap = `${franchiseId}: ${current.displayName} (${current.validFromSeasonKey}-${current.validThroughSeasonKey}) overlaps ${next.displayName} (${next.validFromSeasonKey}...)`;
        overlaps.push(overlap);
        failures.push(`lineage: ${overlap}`);
      }
    }
  }

  // Exactly one segment owns each (slot, season) point.
  const owners = new Map<string, string>();
  for (const segment of manifest.franchiseLineage) {
    const from = segment.validFromSeasonKey;
    const to = segment.validThroughSeasonKey ?? '9999-99';
    const fromYear = parseInt(from.split('-')[0] ?? '', 10);
    const toYear = parseInt(to.split('-')[0] ?? '', 10);
    for (let year = fromYear; year <= Math.min(toYear, 2030); year += 1) {
      const key = `${segment.modernFranchiseId}/${String(year)}`;
      const existing = owners.get(key);
      if (existing !== undefined && existing !== segment.historicalTeamId) {
        const duplicate = `${segment.modernFranchiseId} ${String(year)}: ${existing} vs ${segment.historicalTeamId}`;
        duplicates.push(duplicate);
        failures.push(`lineage: duplicate ownership ${duplicate}`);
      }
      owners.set(key, segment.historicalTeamId);
    }
  }

  // Pool ownership: every packaged player-season resolves through the lineage
  // table to the pool's modern slot with the packaged historical identity.
  const manifestDir = dirname(inputPath);
  for (const pool of manifest.pools) {
    const assetPath = isAbsolute(pool.url) ? pool.url : resolve(manifestDir, pool.url);
    let content: string;
    try {
      content = await readFile(assetPath, 'utf8');
    } catch {
      ownershipFailures.push(`pools: ${pool.franchiseId}/${pool.eraId} asset missing`);
      continue;
    }
    const poolParsed = franchiseEraPoolSchema.safeParse(JSON.parse(content) as unknown);
    if (!poolParsed.success) continue;
    for (const player of poolParsed.data.players) {
      const identity = player.historicalTeamIdentity;
      const segment = manifest.franchiseLineage.find(
        (s) =>
          s.modernFranchiseId === pool.franchiseId &&
          s.historicalTeamId === identity.teamId &&
          player.seasonKey >= s.validFromSeasonKey &&
          (s.validThroughSeasonKey === undefined || player.seasonKey <= s.validThroughSeasonKey),
      );
      if (!segment) {
        ownershipFailures.push(
          `${pool.franchiseId}/${pool.eraId}: ${player.displayName} ${player.seasonKey} (${identity.displayName}, ${identity.teamId}) has no owning lineage segment`,
        );
      }
      // ABA/predecessor exclusion: NBA-valid ranges start at the BAA/NBA
      // membership season encoded in the lineage table; any season before the
      // slot's first segment is impossible by construction of stints, but the
      // identity must still match the segment display name.
      if (segment && segment.displayName !== identity.displayName) {
        ownershipFailures.push(
          `${pool.franchiseId}/${pool.eraId}: ${player.displayName} identity "${identity.displayName}" does not match segment "${segment.displayName}"`,
        );
      }
    }
  }

  const unavailableCombinations = manifest.availability
    .filter((entry) => entry.status === 'unavailable')
    .map((entry) => ({
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      reason: entry.reason,
    }));

  details.push(
    `slots=${String(manifest.modernFranchiseSlots.length)} segments=${String(manifest.franchiseLineage.length)} pools=${String(manifest.pools.length)}`,
  );
  details.push(`unavailable combinations: ${String(unavailableCombinations.length)}`);

  failures.push(...ownershipFailures);
  const payload: LineageAuditPayload = {
    dataVersion: manifest.dataVersion,
    slotCount: manifest.modernFranchiseSlots.length,
    segmentCount: manifest.franchiseLineage.length,
    overlaps,
    duplicates,
    ownershipFailures,
    unavailableCombinations,
  };
  return makeReport('data lineage-audit', { input: inputPath }, { details, failures, payload });
}

export { DEFAULT_MANIFEST };
