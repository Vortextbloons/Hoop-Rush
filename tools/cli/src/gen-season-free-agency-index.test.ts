import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  seasonFreeAgencyIndexSchema,
  type SeasonDraftCatalog,
  type SeasonRosterRole,
} from '@hoop-rush/data-contracts';
import {
  evaluateSeasonRoster,
  playerPercentileTier,
  percentileTierOf,
  rolePercentileThresholds,
  type RoleThresholds,
} from '@hoop-rush/engine';
import {
  DEFAULT_DRAFT_CATALOG,
  DEFAULT_FREE_AGENCY_INDEX,
  DEFAULT_MANIFEST,
  loadSeasonDraftCatalog,
} from './commands/season-data.ts';
import {
  deriveFreeAgencyIndex,
  FREE_AGENCY_INDEX_MAX_BYTES,
  freeAgencyIndexContent,
  type FreeAgencyIndexStats,
  freeAgencyIndexStats,
} from './gen-season-free-agency-index.ts';
import { sha256Hex } from './io.ts';
function roleScoresOf(
  candidate: SeasonDraftCatalog['candidates'][number],
): Record<SeasonRosterRole, number> {
  return evaluateSeasonRoster({
    franchiseId: candidate.playerVersionId,
    band: 'average',
    identity: 'continuity',
    members: [
      {
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
      },
    ],
  }).roleScores;
}
interface DerivationFixture {
  catalog: SeasonDraftCatalog;
  index: ReturnType<typeof deriveFreeAgencyIndex>;
  content: string;
  committedBytes: string;
  thresholds: Record<SeasonRosterRole, RoleThresholds>;
}
let fixture: DerivationFixture;
beforeAll(() => {
  const catalog = loadSeasonDraftCatalog(DEFAULT_MANIFEST, DEFAULT_DRAFT_CATALOG);
  const catalogBytes = readFileSync(DEFAULT_DRAFT_CATALOG);
  const index = deriveFreeAgencyIndex(catalog, sha256Hex(catalogBytes));
  const content = freeAgencyIndexContent(index);
  const canonical = [...catalog.candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  );
  const thresholds = rolePercentileThresholds(
    canonical.map((candidate) => roleScoresOf(candidate)),
  );
  fixture = {
    catalog,
    index,
    content,
    committedBytes: readFileSync(DEFAULT_FREE_AGENCY_INDEX, 'utf8'),
    thresholds,
  };
});
describe('free-agency index derivation (committed artifacts)', () => {
  it('regenerates the committed artifact byte-for-byte and validates the schema', () => {
    const { content, committedBytes, index } = fixture;
    expect(sha256Hex(content)).toBe(sha256Hex(committedBytes));
    expect(content).toHaveLength(committedBytes.length);
    expect(seasonFreeAgencyIndexSchema.safeParse(JSON.parse(content) as unknown).success).toBe(
      true,
    );
    expect(index.candidates.length).toBeGreaterThan(4000);
  });
  it('pins the manifest hashes: artifact hash and catalog content hash', () => {
    const { catalog, index } = fixture;
    const manifest = JSON.parse(readFileSync(DEFAULT_MANIFEST, 'utf8')) as {
      season?: {
        freeAgencyIndex?: {
          contentHash?: string;
        };
        draftCatalog?: {
          contentHash?: string;
        };
      };
    };
    const committed = readFileSync(DEFAULT_FREE_AGENCY_INDEX, 'utf8');
    expect(manifest.season?.freeAgencyIndex?.contentHash).toBe(sha256Hex(committed));
    expect(manifest.season?.draftCatalog?.contentHash).toBe(
      sha256Hex(readFileSync(DEFAULT_DRAFT_CATALOG)),
    );
    expect(index.catalogRef.contentHash).toBe(manifest.season?.draftCatalog?.contentHash);
    expect(index.catalogRef.candidateCount).toBe(catalog.candidates.length);
  });
  it('is deterministic: two derivations produce identical bytes', () => {
    const { catalog } = fixture;
    const catalogBytes = readFileSync(DEFAULT_DRAFT_CATALOG);
    const second = freeAgencyIndexContent(deriveFreeAgencyIndex(catalog, sha256Hex(catalogBytes)));
    expect(fixture.content).toBe(second);
  });
});
describe('free-agency index band sanity', () => {
  it('admits no elite-tier candidate (recomputed through the engine)', () => {
    const { catalog, index, thresholds } = fixture;
    const byId = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    for (const entry of index.candidates) {
      const candidate = byId.get(entry.playerVersionId);
      expect(candidate).toBeDefined();
      if (candidate === undefined) continue;
      const tier = playerPercentileTier(percentileTierOf(roleScoresOf(candidate), thresholds));
      expect(tier, entry.playerVersionId).not.toBe('elite');
    }
  });
  it('assigns at most one featured version per identity group', () => {
    const { index } = fixture;
    const featuredByIdentity = new Map<string, number>();
    for (const entry of index.candidates) {
      if (entry.band !== 'featured') continue;
      featuredByIdentity.set(entry.playerId, (featuredByIdentity.get(entry.playerId) ?? 0) + 1);
    }
    for (const [playerId, count] of featuredByIdentity) {
      expect(count, `identity ${playerId}`).toBe(1);
    }
  });
  it('cites every excluded sibling in the survivors exclusion evidence', () => {
    const { catalog, index, thresholds } = fixture;
    const eligible = new Set(index.candidates.map((entry) => entry.playerVersionId));
    const indexedByIdentity = new Map<string, number>();
    for (const entry of index.candidates) {
      indexedByIdentity.set(entry.playerId, (indexedByIdentity.get(entry.playerId) ?? 0) + 1);
    }
    const excludedByIdentity = new Map<string, string[]>();
    for (const candidate of catalog.candidates) {
      if (eligible.has(candidate.playerVersionId)) continue;
      const tier = playerPercentileTier(percentileTierOf(roleScoresOf(candidate), thresholds));
      expect(tier, `non-indexed ${candidate.playerVersionId}`).toBe('elite');
      const list = excludedByIdentity.get(candidate.playerId) ?? [];
      list.push(candidate.playerVersionId);
      excludedByIdentity.set(candidate.playerId, list);
    }
    const evidenceByIdentity = new Map<string, string>();
    for (const entry of index.candidates) {
      if (entry.exclusionEvidence === '') continue;
      const joined = evidenceByIdentity.get(entry.playerId) ?? '';
      evidenceByIdentity.set(entry.playerId, `${joined} ${entry.exclusionEvidence}`);
    }
    for (const [playerId, excluded] of excludedByIdentity) {
      if ((indexedByIdentity.get(playerId) ?? 0) === 0) continue;
      const evidence = evidenceByIdentity.get(playerId) ?? '';
      expect(evidence, `identity ${playerId}`).not.toBe('');
      const cited = new Set(evidence.match(/pv-[0-9a-f]{32}/g) ?? []);
      const more = Number.parseInt(
        (evidence.match(/\+(\d+) more siblings excluded/) ?? [])[1] ?? '0',
        10,
      );
      expect(cited.size + more, `identity ${playerId} evidence: ${evidence}`).toBe(excluded.length);
      for (const versionId of cited) {
        expect(excluded).toContain(versionId);
      }
    }
  });
  it('keeps every card fact inside the frozen bounds', () => {
    const { index } = fixture;
    for (const entry of index.candidates) {
      expect(entry.durabilityRating).toBeGreaterThanOrEqual(45);
      expect(entry.durabilityRating).toBeLessThanOrEqual(95);
      expect(entry.minutesPerGame).toBeGreaterThanOrEqual(0);
      expect(entry.minutesPerGame).toBeLessThanOrEqual(60);
      expect(entry.availability.healthy).toBe(true);
      expect(entry.minimumInfluence).toBeGreaterThanOrEqual(1);
      expect(entry.minimumInfluence).toBeLessThanOrEqual(3);
      expect(entry.supportedRoles.length).toBeGreaterThanOrEqual(1);
      expect(entry.supportedRoles.length).toBeLessThanOrEqual(3);
      expect(entry.strengths.length).toBeLessThanOrEqual(8);
      expect(entry.limitations.length).toBeLessThanOrEqual(8);
      for (const strength of entry.strengths) {
        expect(strength.length).toBeGreaterThanOrEqual(1);
        expect(strength.length).toBeLessThanOrEqual(160);
      }
      for (const limitation of entry.limitations) {
        expect(limitation.length).toBeGreaterThanOrEqual(1);
        expect(limitation.length).toBeLessThanOrEqual(160);
      }
      expect(entry.derivationEvidence.length).toBeGreaterThanOrEqual(1);
      expect(entry.derivationEvidence.length).toBeLessThanOrEqual(256);
      expect(entry.exclusionEvidence.length).toBeLessThanOrEqual(256);
      if (entry.band === 'emergency' || entry.band === 'development') {
        expect(entry.minimumInfluence).toBe(1);
      }
      if (entry.band === 'featured') {
        expect(entry.minimumInfluence).toBeGreaterThanOrEqual(2);
        expect(entry.supportedRoles).toContain('rotation');
      }
      if (entry.band === 'role') {
        expect(entry.supportedRoles).toContain('rotation');
      }
    }
  });
  it('resolves every catalogRef candidateIndex to the source candidate', () => {
    const { catalog, index } = fixture;
    for (const entry of index.candidates) {
      const source = catalog.candidates[entry.catalogRef.candidateIndex];
      expect(source).toBeDefined();
      expect(source?.playerVersionId).toBe(entry.playerVersionId);
      expect(entry.catalogRef.catalogVersion).toBe(catalog.catalogVersion);
      expect(entry.catalogRef.dataVersion).toBe(catalog.dataVersion);
    }
  });
  it('keeps groupedVersions canonical and identity-consistent', () => {
    const { index } = fixture;
    const entriesByIdentity = new Map<string, string[]>();
    for (const entry of index.candidates) {
      const list = entriesByIdentity.get(entry.playerId) ?? [];
      list.push(entry.playerVersionId);
      entriesByIdentity.set(entry.playerId, list);
    }
    for (const [playerId, versionIds] of Object.entries(index.groupedVersions)) {
      expect([...versionIds]).toEqual([...versionIds].sort());
      expect(new Set(versionIds).size).toBe(versionIds.length);
      for (const versionId of versionIds) {
        expect(entriesByIdentity.get(playerId)).toContain(versionId);
      }
    }
    expect(Object.keys(index.groupedVersions).length).toBe(
      new Set(index.candidates.map((entry) => entry.playerId)).size,
    );
  });
  it('stays inside the compactness gate and reports the measured size', () => {
    const { content } = fixture;
    const stats: FreeAgencyIndexStats = freeAgencyIndexStats(
      seasonFreeAgencyIndexSchema.parse(JSON.parse(content) as unknown),
      content.length,
    );
    expect(content.length).toBeLessThanOrEqual(FREE_AGENCY_INDEX_MAX_BYTES);
    expect(content.length).toBeLessThan(5000000);
    expect(stats.bandCounts.featured).toBeGreaterThan(0);
    expect(stats.bandCounts.role).toBeGreaterThan(0);
    expect(stats.bandCounts.development).toBeGreaterThan(0);
    expect(stats.bandCounts.emergency).toBeGreaterThan(0);
    expect(stats.candidateCount + stats.excludedCount).toBeGreaterThan(7000);
  });
});
