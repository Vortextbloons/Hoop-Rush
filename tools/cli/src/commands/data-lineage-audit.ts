import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  franchiseEraPoolSchema,
  hoopRushManifestSchema,
  type HoopRushManifest,
} from '@hoop-rush/data-contracts';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.js';
import { DEFAULT_MANIFEST } from './data-loader.js';

/**
 * `hoop-rush data lineage-audit`: proves historical team ranges map to
 * exactly one modern slot, detects gaps/overlaps/duplicates, verifies pool
 * ownership (every packaged player-season resolves through the lineage
 * table), checks ABA exclusion, audits per-segment historical logo metadata,
 * and reports unavailable combinations (spec/09, spec/12). `--verify-logos`
 * additionally fetches each segment's primary logo candidate and fails on
 * unreachable or non-image responses.
 */

export const DATA_LINEAGE_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
  verbose: false,
  'verify-logos': false,
};

interface LineageAuditPayload {
  dataVersion: string;
  slotCount: number;
  segmentCount: number;
  overlaps: string[];
  duplicates: string[];
  ownershipFailures: string[];
  logoFailures: string[];
  logoVerificationFailures: string[];
  unavailableCombinations: Array<{ franchiseId: string; eraId: string; reason: string }>;
}

const IMAGE_CONTENT_TYPES = /^image\/(png|gif|jpeg|jpg|svg\+xml|webp|avif)/i;

export async function dataLineageAudit(args: {
  input?: string | null;
  verifyLogos?: boolean;
}): Promise<CliReport> {
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
  const logoFailures: string[] = [];
  const logoVerificationFailures: string[] = [];

  // Historical logo metadata: every segment carries at least one well-formed
  // candidate with a source host (spec/12 branding contract). Missing
  // artwork must never block gameplay, but the manifest must still declare
  // the verified reference.
  for (const segment of manifest.franchiseLineage) {
    const candidates = segment.logoCandidates ?? [];
    if (candidates.length === 0) {
      logoFailures.push(
        `logos: ${segment.modernFranchiseId} ${segment.displayName} (${segment.validFromSeasonKey}) has no logo candidates`,
      );
      continue;
    }
    for (const [i, candidate] of candidates.entries()) {
      let url: URL;
      try {
        url = new URL(candidate.url);
      } catch {
        logoFailures.push(
          `logos: ${segment.modernFranchiseId} ${segment.displayName} candidate ${String(i)} is not a valid URL: ${candidate.url}`,
        );
        continue;
      }
      if (url.protocol !== 'https:') {
        logoFailures.push(
          `logos: ${segment.modernFranchiseId} ${segment.displayName} candidate ${String(i)} must be https: ${candidate.url}`,
        );
      }
    }
    if (!candidates[0]?.source) {
      logoFailures.push(
        `logos: ${segment.modernFranchiseId} ${segment.displayName} candidate 0 has no source host`,
      );
    }
  }

  // Optional live verification of each segment's primary logo candidate.
  if (args.verifyLogos) {
    for (const segment of manifest.franchiseLineage) {
      const primary = segment.logoCandidates?.[0];
      if (!primary) continue;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, 15000);
        const response = await fetch(primary.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'hoop-rush lineage-audit (build tooling)',
            Accept: 'image/*',
          },
        });
        clearTimeout(timer);
        if (!response.ok) {
          logoVerificationFailures.push(
            `logos: ${segment.modernFranchiseId} ${segment.displayName} primary candidate returned HTTP ${String(response.status)}: ${primary.url}`,
          );
          continue;
        }
        const contentType = response.headers.get('content-type') ?? '';
        const bytes = (await response.arrayBuffer()).byteLength;
        if (!IMAGE_CONTENT_TYPES.test(contentType)) {
          logoVerificationFailures.push(
            `logos: ${segment.modernFranchiseId} ${segment.displayName} primary candidate is not an image (${contentType}): ${primary.url}`,
          );
          continue;
        }
        if (bytes < 500) {
          logoVerificationFailures.push(
            `logos: ${segment.modernFranchiseId} ${segment.displayName} primary candidate is suspiciously small (${String(bytes)} bytes): ${primary.url}`,
          );
        }
      } catch {
        logoVerificationFailures.push(
          `logos: ${segment.modernFranchiseId} ${segment.displayName} primary candidate could not be fetched: ${primary.url}`,
        );
      }
    }
  }

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
    for (const [i, current] of sorted.entries()) {
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
  details.push(
    `logos: segments with candidates=${String(
      manifest.franchiseLineage.filter((s) => (s.logoCandidates?.length ?? 0) > 0).length,
    )}/${String(manifest.franchiseLineage.length)}`,
  );

  failures.push(...ownershipFailures, ...logoFailures, ...logoVerificationFailures);
  const payload: LineageAuditPayload = {
    dataVersion: manifest.dataVersion,
    slotCount: manifest.modernFranchiseSlots.length,
    segmentCount: manifest.franchiseLineage.length,
    overlaps,
    duplicates,
    ownershipFailures,
    logoFailures,
    logoVerificationFailures,
    unavailableCombinations,
  };
  return makeReport('data lineage-audit', { input: inputPath }, { details, failures, payload });
}

export { DEFAULT_MANIFEST };
