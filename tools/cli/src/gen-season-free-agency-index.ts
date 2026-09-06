import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_FREE_AGENCY_INDEX_VERSION,
  contentHashSchema,
  seasonDraftCatalogSchema,
  seasonFreeAgencyIndexSchema,
  seasonRosterRoleSchema,
  type SeasonDraftCandidate,
  type SeasonDraftCatalog,
  type SeasonFreeAgencyBand,
  type SeasonFreeAgencyIndex,
  type SeasonFreeAgencyIndexEntry,
  type SeasonRosterRole,
} from '@hoop-rush/data-contracts';
import {
  evaluateSeasonRoster,
  percentileTierOf,
  playerPercentileTier,
  rolePercentileThresholds,
  type PercentileTier,
  type RoleThresholds,
} from '@hoop-rush/engine';
import { sha256Hex, readJson } from './io.ts';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
export const ROSTER_ROLES: readonly SeasonRosterRole[] = seasonRosterRoleSchema.options;
export const DEVELOPMENT_MIN_STAMINA = 58;
export const LIMITATION_MAX_ROLE_SCORE = 45;
export const STRENGTH_MIN_STAMINA = 70;
export const LIMITATION_MAX_STAMINA = 50;
export const ROLE_FACT_CAP = 3;
export const LIMITATION_ROLE_FACT_CAP = 2;
export const EXCLUDED_SIBLING_CITE_CAP = 2;
export const FREE_AGENCY_INDEX_MAX_BYTES = 7000000;
export interface ExclusionRecord {
  playerVersionId: string;
  reason: string;
}
export interface FreeAgencyIndexStats {
  candidateCount: number;
  identityCount: number;
  excludedCount: number;
  bandCounts: Record<SeasonFreeAgencyBand, number>;
  bytes: number;
}
function roleScoresOf(candidate: SeasonDraftCandidate): Record<SeasonRosterRole, number> {
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
interface ScoredCandidate {
  candidate: SeasonDraftCandidate;
  roleScores: Record<SeasonRosterRole, number>;
  tiers: Record<SeasonRosterRole, PercentileTier>;
  playerTier: PercentileTier;
}
function scoreCandidate(
  candidate: SeasonDraftCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): ScoredCandidate {
  const roleScores = roleScoresOf(candidate);
  const tiers = percentileTierOf(roleScores, thresholds);
  return { candidate, roleScores, tiers, playerTier: playerPercentileTier(tiers) };
}
function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}
function bestRoleOf(scored: ScoredCandidate): SeasonRosterRole {
  let best: SeasonRosterRole = ROSTER_ROLES[0] as SeasonRosterRole;
  for (const role of ROSTER_ROLES) {
    if (scored.roleScores[role] > scored.roleScores[best]) best = role;
  }
  return best;
}
function rolesAtOrAbove(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
  threshold: 'elite' | 'strong' | 'useful',
): SeasonRosterRole[] {
  return ROSTER_ROLES.filter((role) => scored.roleScores[role] >= thresholds[role][threshold]);
}
function bandOf(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
  excluded: ReadonlySet<string>,
): SeasonFreeAgencyBand | null {
  const { candidate } = scored;
  if (excluded.has(candidate.playerVersionId)) return null;
  if (scored.playerTier === 'elite') return 'featured';
  if (scored.playerTier === 'strong') return 'featured';
  if (scored.playerTier === 'useful') return 'role';
  if (candidate.stamina.rating >= DEVELOPMENT_MIN_STAMINA) return 'development';
  return 'emergency';
}
function featuredVersionIdOf(
  scoredGroup: ScoredCandidate[],
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string | null {
  let best: ScoredCandidate | null = null;
  let bestTierRank = -1;
  let bestMulti = -1;
  let bestSum = -Infinity;
  for (const scored of scoredGroup) {
    const tierRank = scored.playerTier === 'elite' ? 1 : scored.playerTier === 'strong' ? 0 : -1;
    if (tierRank < 0) continue;
    const eliteThreshold: 'elite' | 'strong' = scored.playerTier === 'elite' ? 'elite' : 'strong';
    const multi = rolesAtOrAbove(scored, thresholds, eliteThreshold).length;
    const sum = ROSTER_ROLES.reduce((total, role) => total + scored.roleScores[role], 0);
    if (
      tierRank > bestTierRank ||
      (tierRank === bestTierRank && multi > bestMulti) ||
      (tierRank === bestTierRank && multi === bestMulti && sum > bestSum) ||
      (tierRank === bestTierRank &&
        multi === bestMulti &&
        sum === bestSum &&
        (best === null || scored.candidate.playerVersionId < best.candidate.playerVersionId))
    ) {
      best = scored;
      bestTierRank = tierRank;
      bestMulti = multi;
      bestSum = sum;
    }
  }
  return best?.candidate.playerVersionId ?? null;
}
function missingFactReason(candidate: SeasonDraftCandidate, catalogVersion: string): string | null {
  if (candidate.positions.playable.length === 0) return 'missing playable positions';
  if (catalogVersion === 'season-draft-catalog-v4' && candidate.anchors === undefined) {
    return 'missing validated anchors (v4)';
  }
  return null;
}
function strengthsOf(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string[] {
  const strengths: string[] = [];
  for (const role of rolesAtOrAbove(scored, thresholds, 'strong')) {
    if (strengths.length >= ROLE_FACT_CAP) break;
    strengths.push(
      `${role} ${String(rounded(scored.roleScores[role]))} (p75 ${String(rounded(thresholds[role].strong))})`,
    );
  }
  if (scored.candidate.stamina.rating >= STRENGTH_MIN_STAMINA) {
    strengths.push(`stamina ${String(scored.candidate.stamina.rating)}/95`);
  }
  return strengths.slice(0, 8);
}
function limitationsOf(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string[] {
  const limitations: string[] = [];
  for (const role of ROSTER_ROLES) {
    if (scored.roleScores[role] >= LIMITATION_MAX_ROLE_SCORE) continue;
    if (limitations.length >= LIMITATION_ROLE_FACT_CAP) break;
    limitations.push(
      `${role} ${String(rounded(scored.roleScores[role]))} (p50 ${String(rounded(thresholds[role].useful))})`,
    );
  }
  if (scored.candidate.stamina.rating < LIMITATION_MAX_STAMINA) {
    limitations.push(`stamina ${String(scored.candidate.stamina.rating)}/95`);
  }
  return limitations.slice(0, 8);
}
function minimumInfluenceOf(
  band: SeasonFreeAgencyBand,
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): number {
  if (band === 'emergency' || band === 'development') return 1;
  if (band === 'featured') {
    if (scored.playerTier === 'elite') return 3;
    return rolesAtOrAbove(scored, thresholds, 'strong').length >= 2 ? 3 : 2;
  }
  return rolesAtOrAbove(scored, thresholds, 'useful').length >= 2 ? 2 : 1;
}
function supportedRolesOf(
  band: SeasonFreeAgencyBand,
): SeasonFreeAgencyIndexEntry['supportedRoles'] {
  const roles: SeasonFreeAgencyIndexEntry['supportedRoles'] = [];
  if (band === 'featured' || band === 'role') roles.push('rotation');
  roles.push('depth');
  roles.push('emergency');
  return roles;
}
function derivationEvidenceOf(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
  capped: boolean,
): string {
  const { candidate } = scored;
  const capNote = capped ? '; identity featured cap' : '';
  if (scored.playerTier === 'depth') {
    return `tier depth; stamina ${String(candidate.stamina.rating)}/95; dur ${String(candidate.durability.rating)}${capNote}`;
  }
  if (scored.playerTier === 'elite') {
    const bestRole = bestRoleOf(scored);
    return `tier elite; best ${bestRole} ${String(rounded(scored.roleScores[bestRole]))} (p90 ${String(rounded(thresholds[bestRole].elite))}); dur ${String(candidate.durability.rating)}${capNote}`;
  }
  const bestRole = bestRoleOf(scored);
  const tier = scored.playerTier === 'strong' ? 'p75' : 'p50';
  return `tier ${scored.playerTier}; best ${bestRole} ${String(rounded(scored.roleScores[bestRole]))} (${tier} ${String(rounded(thresholds[bestRole][scored.playerTier === 'strong' ? 'strong' : 'useful']))}); dur ${String(candidate.durability.rating)}${capNote}`;
}
function exclusionEvidenceOf(
  excludedSiblings: ReadonlyArray<{
    version: SeasonDraftCandidate;
    reason: string;
  }>,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string {
  if (excludedSiblings.length === 0) return '';
  const cited = excludedSiblings.slice(0, EXCLUDED_SIBLING_CITE_CAP);
  const withDetails = cited.map(({ version, reason }) => {
    const scoredSibling = scoreCandidate(version, thresholds);
    const eliteRoles = rolesAtOrAbove(scoredSibling, thresholds, 'elite');
    const eliteRole = eliteRoles[0];
    if (eliteRole !== undefined) {
      return `${version.playerVersionId} ${reason} (${eliteRole} ${String(rounded(scoredSibling.roleScores[eliteRole]))} >= p90 ${String(rounded(thresholds[eliteRole].elite))})`;
    }
    return `${version.playerVersionId} ${reason}`;
  });
  const remaining = excludedSiblings.length - cited.length;
  const moreMarker = remaining > 0 ? `; +${String(remaining)} more siblings excluded` : '';
  let parts = withDetails;
  let joined = `${parts.join('; ')}${moreMarker}`;
  if (joined.length > 256) {
    parts = cited.map(({ version, reason }) => `${version.playerVersionId} ${reason}`);
    joined = `${parts.join('; ')}${moreMarker}`;
  }
  if (joined.length > 256) {
    const first = cited[0];
    if (first !== undefined) {
      const remainingAll = excludedSiblings.length - 1;
      joined = `${first.version.playerVersionId} ${first.reason}${remainingAll > 0 ? `; +${String(remainingAll)} more siblings excluded` : ''}`;
    }
  }
  return joined;
}
export function deriveFreeAgencyIndex(
  catalog: SeasonDraftCatalog,
  catalogContentHash: string,
): SeasonFreeAgencyIndex {
  const canonical = [...catalog.candidates].sort((a, b) =>
    a.playerVersionId < b.playerVersionId ? -1 : 1,
  );
  const thresholds = rolePercentileThresholds(
    canonical.map((candidate) => roleScoresOf(candidate)),
  );
  const scored = new Map<string, ScoredCandidate>();
  for (const candidate of canonical) {
    scored.set(candidate.playerVersionId, scoreCandidate(candidate, thresholds));
  }
  const excluded = new Map<
    string,
    {
      version: SeasonDraftCandidate;
      reason: string;
    }
  >();
  for (const candidate of canonical) {
    const missing = missingFactReason(candidate, catalog.catalogVersion);
    if (missing !== null) {
      excluded.set(candidate.playerVersionId, { version: candidate, reason: missing });
    }
  }
  const eligibleByIdentity = new Map<string, ScoredCandidate[]>();
  for (const candidate of canonical) {
    if (excluded.has(candidate.playerVersionId)) continue;
    const group = eligibleByIdentity.get(candidate.playerId) ?? [];
    const scoredCandidate = scored.get(candidate.playerVersionId);
    if (scoredCandidate !== undefined) group.push(scoredCandidate);
    eligibleByIdentity.set(candidate.playerId, group);
  }
  const excludedIds = new Set(excluded.keys());
  const featuredIds = new Set<string>();
  for (const [playerId, group] of eligibleByIdentity) {
    const featured = featuredVersionIdOf(group, thresholds);
    if (featured !== null) featuredIds.add(`${playerId}::${featured}`);
  }
  const bandOfVersion = new Map<string, SeasonFreeAgencyBand>();
  for (const [playerId, group] of eligibleByIdentity) {
    for (const scoredCandidate of group) {
      const { playerVersionId } = scoredCandidate.candidate;
      const band = bandOf(scoredCandidate, thresholds, excludedIds);
      if (band === null) continue;
      const demoted = band === 'featured' && !featuredIds.has(`${playerId}::${playerVersionId}`);
      bandOfVersion.set(playerVersionId, demoted ? 'role' : band);
    }
  }
  const indexById = new Map<string, number>();
  catalog.candidates.forEach((candidate, index) => {
    indexById.set(candidate.playerVersionId, index);
  });
  const candidates: SeasonFreeAgencyIndexEntry[] = [];
  const groupedVersions = new Map<string, string[]>();
  for (const [playerId, group] of eligibleByIdentity) {
    for (const scoredCandidate of group) {
      const { candidate } = scoredCandidate;
      const band = bandOfVersion.get(candidate.playerVersionId);
      if (band === undefined) continue;
      const capped =
        (scoredCandidate.playerTier === 'strong' || scoredCandidate.playerTier === 'elite') &&
        band === 'role';
      const excludedSiblings = [...excluded.entries()]
        .filter(([, record]) => record.version.playerId === playerId)
        .map(([, record]) => record);
      const entry = {
        playerVersionId: candidate.playerVersionId,
        playerId: candidate.playerId,
        displayName: candidate.displayName,
        positions: candidate.positions,
        band,
        minimumInfluence: minimumInfluenceOf(band, scoredCandidate, thresholds),
        supportedRoles: supportedRolesOf(band),
        strengths: strengthsOf(scoredCandidate, thresholds),
        limitations: limitationsOf(scoredCandidate, thresholds),
        durabilityRating: candidate.durability.rating,
        minutesPerGame: rounded(candidate.stamina.historicalMpg),
        availability: { healthy: true, notes: '' },
        catalogRef: {
          catalogVersion: catalog.catalogVersion,
          dataVersion: catalog.dataVersion,
          candidateIndex: indexById.get(candidate.playerVersionId) ?? -1,
        },
        derivationEvidence: derivationEvidenceOf(scoredCandidate, thresholds, capped),
        exclusionEvidence: exclusionEvidenceOf(excludedSiblings, thresholds),
      };
      if (entry.catalogRef.candidateIndex < 0) {
        throw new Error(`candidate ${candidate.playerVersionId} has no catalog index`);
      }
      candidates.push(entry);
      const versions = groupedVersions.get(playerId) ?? [];
      versions.push(candidate.playerVersionId);
      groupedVersions.set(playerId, versions);
    }
  }
  candidates.sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
  for (const versions of groupedVersions.values()) {
    versions.sort((a, b) => (a < b ? -1 : 1));
  }
  const groupedObject: Record<string, string[]> = {};
  for (const playerId of [...groupedVersions.keys()].sort()) {
    const versions = groupedVersions.get(playerId);
    if (versions !== undefined) groupedObject[playerId] = versions;
  }
  const index: SeasonFreeAgencyIndex = {
    schemaVersion: 1,
    indexVersion: SEASON_FREE_AGENCY_INDEX_VERSION,
    dataVersion: catalog.dataVersion,
    catalogRef: {
      catalogVersion: catalog.catalogVersion,
      contentHash: contentHashSchema.parse(catalogContentHash),
      candidateCount: catalog.candidates.length,
    },
    candidates,
    groupedVersions: groupedObject,
  };
  const parsed = seasonFreeAgencyIndexSchema.safeParse(index);
  if (!parsed.success) {
    throw new Error(
      `derived free-agency index fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}
export function freeAgencyIndexContent(index: SeasonFreeAgencyIndex): string {
  const content = `${JSON.stringify(index)}\n`;
  if (content.length > FREE_AGENCY_INDEX_MAX_BYTES) {
    throw new Error(
      `free-agency index exceeds the ${String(FREE_AGENCY_INDEX_MAX_BYTES)}-byte compactness gate (${String(content.length)} bytes)`,
    );
  }
  return content;
}
export function freeAgencyIndexStats(
  index: SeasonFreeAgencyIndex,
  bytes: number,
): FreeAgencyIndexStats {
  const bandCounts: Record<SeasonFreeAgencyBand, number> = {
    featured: 0,
    role: 0,
    development: 0,
    emergency: 0,
  };
  for (const candidate of index.candidates) {
    bandCounts[candidate.band] += 1;
  }
  return {
    candidateCount: index.candidates.length,
    identityCount: Object.keys(index.groupedVersions).length,
    excludedCount: index.catalogRef.candidateCount - index.candidates.length,
    bandCounts,
    bytes,
  };
}
function main(): void {
  const manifest = readJson(MANIFEST_PATH) as {
    season?: Record<
      string,
      {
        url?: string;
        contentHash?: string;
      }
    >;
  };
  const catalogPath = resolve(SEASON_DIR, 'draft-catalog.json');
  const catalogBytes = readFileSync(catalogPath);
  const parsed = seasonDraftCatalogSchema.safeParse(
    JSON.parse(catalogBytes.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `draft catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  const catalogContentHash = sha256Hex(catalogBytes);
  const index = deriveFreeAgencyIndex(parsed.data, catalogContentHash);
  const content = freeAgencyIndexContent(index);
  mkdirSync(SEASON_DIR, { recursive: true });
  const target = resolve(SEASON_DIR, 'free-agency-index.json');
  writeFileSync(target, content);
  if (manifest.season !== undefined) {
    manifest.season.freeAgencyIndex = {
      url: 'season/free-agency-index.json',
      contentHash: sha256Hex(content),
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const stats = freeAgencyIndexStats(index, content.length);
  console.log(
    `wrote ${target} (${String(stats.bytes)} bytes, ${String(stats.candidateCount)} candidates, ${String(stats.identityCount)} identities)`,
  );
  console.log(
    `bands: featured ${String(stats.bandCounts.featured)} · role ${String(stats.bandCounts.role)} · development ${String(stats.bandCounts.development)} · emergency ${String(stats.bandCounts.emergency)}`,
  );
  console.log(
    `manifest freeAgencyIndex hash updated (${manifest.season?.freeAgencyIndex?.contentHash ?? 'missing season section'})`,
  );
}
if (IS_ENTRY) {
  main();
}
