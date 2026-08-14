/**
 * Derives the packaged Season Run free-agent eligibility index
 * (spec/2.0 M2.6.5, free-agency-index-v1) from the validated draft catalog
 * and updates the manifest hashes. Run with
 * `pnpm --filter @hoop-rush/cli gen-season-free-agency-index` AFTER the
 * draft catalog exists; `pnpm --filter @hoop-rush/cli gen-season-assets`
 * regenerates it as part of the full season asset pass.
 *
 * The index is the build-time free-agent universe: every eligible packaged
 * player-season version with its market band, card facts, and derivation
 * evidence. It is grouped by real playerId so the runtime selects at most
 * one canonical version per identity through the named seed tree. The
 * browser never scans historical data to discover candidates.
 *
 * Scoring authority: the engine. Role scores come from
 * `evaluateSeasonRoster` (a single-member roster evaluation returns that
 * member's role scores, the same seam `season-data.ts` uses for roster
 * generation), and tier thresholds come from `rolePercentileThresholds`
 * (nearest-rank p90/p75/p50 over the canonically sorted candidate
 * population). The roster-targets-v3 artifact freezes the percentile tiers
 * (elite p90 / strong p75 / useful p50) this derivation reuses; bands are
 * never assigned from Overall.
 *
 * Eligibility and bands (frozen by this generator; the artifact records the
 * input content hash so any drift is detectable):
 *
 * - EXCLUDE elite-tier versions (>= the role p90 threshold in at least one
 *   role) and any version missing a recorded rating, position, stamina,
 *   durability, identity, or presentation fact (schema-required catalog
 *   fields; v4 candidates additionally require the validated `anchors`).
 *   The optional `reconstructedThreePoint` profile is NOT an eligibility
 *   fact: it is a projection-only input absent for most pre-1985 seasons,
 *   and the Season game adapter does not consume it.
 * - `featured`: player tier `strong` (>= p75 in at least one role) — a
 *   credible rotation contributor at or below drafted-starter quality. At
 *   most one version per identity carries `featured`: the identity's best
 *   strong-tier version (most roles at p75+, then highest role-score sum,
 *   then lowest playerVersionId); sibling strong-tier versions are demoted
 *   to `role` so every identity appears in the market under one band.
 * - `role`: player tier `useful` (>= p50 in at least one role) — a
 *   specialist or useful reserve, plus the demoted strong-tier siblings
 *   above.
 * - `development`: player tier `depth` (below p50 in every role) with a
 *   recorded minutes trait — `stamina.rating >= 58` (stamina-v2,
 *   `round(45 + 1.25 * historicalMpg)`, i.e. a recorded ~10.4+ mpg), so the
 *   version demonstrably absorbed minutes and has a plausible future role
 *   inside the run.
 * - `emergency`: player tier `depth` below that trait — healthy
 *   position-coverage / injury-replacement floor candidates (the recorded
 *   depth tier is uniformly durable, so the recorded minutes history is the
 *   differentiator).
 *
 * Card facts are deterministic functions of recorded data: minimumInfluence
 * (emergency 1; development 1; role 2 when two+ roles at p50+, else 1;
 * featured 3 when two+ roles at p75+, else 2), supportedRoles (rotation for
 * featured/role bands, depth and emergency for every healthy indexed
 * version), factual strengths (roles at p75+; stamina >= 70) and
 * limitations (roles below 45; stamina < 50), the recorded durability
 * rating, the historical mpg rounded to one decimal, and healthy
 * availability. `derivationEvidence` cites the recorded facts that produced
 * the band (and the identity featured cap when a strong-tier sibling was
 * demoted to `role`); `exclusionEvidence` cites every excluded sibling of
 * the same identity (elite tier or missing facts, by version id).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_FREE_AGENCY_INDEX_VERSION,
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
import { sha256Hex } from './io.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');
/** Entry-point guard: `main` runs only when invoked as the CLI script. */
const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/** The eight basketball roles in canonical (schema) order. */
export const ROSTER_ROLES: readonly SeasonRosterRole[] = seasonRosterRoleSchema.options;

/**
 * Development/emergency split within the depth tier: a recorded minutes
 * trait of stamina >= 58 (stamina-v2 `round(45 + 1.25 * mpg)`, ~10.4+ mpg)
 * marks a depth-tier version as `development`; below that the healthy
 * floor is `emergency`. Chosen because the packaged depth tier is otherwise
 * homogeneous (uniformly high durability, no multi-position versions).
 */
export const DEVELOPMENT_MIN_STAMINA = 58;

/** Limitation floor for a role score (below this the role is cited). */
export const LIMITATION_MAX_ROLE_SCORE = 45;

/** Availability stamina facts cited as strengths/limitations. */
export const STRENGTH_MIN_STAMINA = 70;
export const LIMITATION_MAX_STAMINA = 50;

/** Maximum role facts cited per card (strengths and limitations). */
export const ROLE_FACT_CAP = 3;

/** Maximum role facts cited as limitations (kept tighter than strengths). */
export const LIMITATION_ROLE_FACT_CAP = 2;

/** Maximum excluded siblings cited in one exclusionEvidence string. */
export const EXCLUDED_SIBLING_CITE_CAP = 2;

/**
 * Compactness gate (bytes of the serialized artifact). The frozen index
 * schema carries a fixed per-version key/field overhead of roughly 700
 * bytes per entry (identity, positions, catalogRef, evidence), so the
 * full-universe index of ~4,900 eligible versions cannot reach a few
 * hundred KB: the measured committed artifact is ~4.1 MB (24% of the
 * 17 MB draft catalog). This gate pins the bound with ~9% headroom so
 * future derivation changes cannot silently bloat the artifact.
 */
export const FREE_AGENCY_INDEX_MAX_BYTES = 4_500_000;

/** Records the exclusion reason of one catalog version (elite or missing facts). */
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

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** Role scores of one candidate through the authoritative engine seam. */
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

/** The highest-scoring role of a candidate (canonical tie-break). */
function bestRoleOf(scored: ScoredCandidate): SeasonRosterRole {
  let best: SeasonRosterRole = ROSTER_ROLES[0] as SeasonRosterRole;
  for (const role of ROSTER_ROLES) {
    if (scored.roleScores[role] > scored.roleScores[best]) best = role;
  }
  return best;
}

/** Roles at or above a percentile threshold, in canonical order. */
function rolesAtOrAbove(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
  threshold: 'elite' | 'strong' | 'useful',
): SeasonRosterRole[] {
  return ROSTER_ROLES.filter((role) => scored.roleScores[role] >= thresholds[role][threshold]);
}

/**
 * Band of one eligible version. Demotion for the identity featured cap is
 * applied separately (see `featuredVersionIdOf`).
 */
function bandOf(
  scored: ScoredCandidate,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
  excluded: ReadonlySet<string>,
): SeasonFreeAgencyBand | null {
  const { candidate } = scored;
  if (excluded.has(candidate.playerVersionId)) return null;
  if (scored.playerTier === 'strong') return 'featured';
  if (scored.playerTier === 'useful') return 'role';
  if (candidate.stamina.rating >= DEVELOPMENT_MIN_STAMINA) return 'development';
  return 'emergency';
}

/**
 * The identity's featured version: the eligible strong-tier sibling with
 * the most roles at p75+, then the highest role-score sum, then the lowest
 * playerVersionId. All other strong-tier siblings are demoted to `role` so
 * at most one featured version exists per identity group.
 */
function featuredVersionIdOf(
  scoredGroup: ScoredCandidate[],
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string | null {
  let best: ScoredCandidate | null = null;
  let bestMulti = -1;
  let bestSum = -Infinity;
  for (const scored of scoredGroup) {
    if (scored.playerTier !== 'strong') continue;
    const multi = rolesAtOrAbove(scored, thresholds, 'strong').length;
    const sum = ROSTER_ROLES.reduce((total, role) => total + scored.roleScores[role], 0);
    if (
      multi > bestMulti ||
      (multi === bestMulti && sum > bestSum) ||
      (multi === bestMulti &&
        sum === bestSum &&
        (best === null || scored.candidate.playerVersionId < best.candidate.playerVersionId))
    ) {
      best = scored;
      bestMulti = multi;
      bestSum = sum;
    }
  }
  return best?.candidate.playerVersionId ?? null;
}

/** Missing-fact exclusions (defensive; the catalog schema already enforces most). */
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
  const bestRole = bestRoleOf(scored);
  const tier = scored.playerTier === 'strong' ? 'p75' : 'p50';
  return `tier ${scored.playerTier}; best ${bestRole} ${String(
    rounded(scored.roleScores[bestRole]),
  )} (${tier} ${String(
    rounded(thresholds[bestRole][scored.playerTier === 'strong' ? 'strong' : 'useful']),
  )}); dur ${String(candidate.durability.rating)}${capNote}`;
}

/**
 * One cited exclusion reason per excluded sibling (best elite role only).
 * Compact deterministically under the schema's 256-char cap: first drop the
 * threshold parentheticals, then cite only the first sibling, so the
 * remaining-count marker always survives and the evidence never truncates
 * silently.
 */
function exclusionEvidenceOf(
  excludedSiblings: ReadonlyArray<{ version: SeasonDraftCandidate; reason: string }>,
  thresholds: Record<SeasonRosterRole, RoleThresholds>,
): string {
  if (excludedSiblings.length === 0) return '';
  const cited = excludedSiblings.slice(0, EXCLUDED_SIBLING_CITE_CAP);
  const withDetails = cited.map(({ version, reason }) => {
    const scoredSibling = scoreCandidate(version, thresholds);
    const eliteRoles = rolesAtOrAbove(scoredSibling, thresholds, 'elite');
    const eliteRole = eliteRoles[0];
    if (eliteRole !== undefined) {
      return `${version.playerVersionId} ${reason} (${eliteRole} ${String(
        rounded(scoredSibling.roleScores[eliteRole]),
      )} >= p90 ${String(rounded(thresholds[eliteRole].elite))})`;
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

/**
 * Derives the validated free-agency index from a parsed catalog. Pure and
 * deterministic: the same catalog bytes always produce the same index.
 * `catalogContentHash` is the SHA-256 of the committed catalog artifact
 * bytes (the same hash the manifest pins under `season.draftCatalog`).
 */
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

  // Exclusions: elite tier and missing recorded facts. Per identity, every
  // non-indexed version records its reason for the survivors' evidence.
  const excluded = new Map<string, { version: SeasonDraftCandidate; reason: string }>();
  for (const candidate of canonical) {
    const scoredCandidate = scored.get(candidate.playerVersionId);
    if (scoredCandidate === undefined) continue;
    if (scoredCandidate.playerTier === 'elite') {
      const eliteRoles = rolesAtOrAbove(scoredCandidate, thresholds, 'elite');
      const eliteRole = eliteRoles[0] ?? ROSTER_ROLES[0];
      excluded.set(candidate.playerVersionId, {
        version: candidate,
        reason: `elite in ${String(eliteRole)}`,
      });
      continue;
    }
    const missing = missingFactReason(candidate, catalog.catalogVersion);
    if (missing !== null) {
      excluded.set(candidate.playerVersionId, { version: candidate, reason: missing });
    }
  }

  // Group eligible versions by identity (canonical version order).
  const eligibleByIdentity = new Map<string, ScoredCandidate[]>();
  for (const candidate of canonical) {
    if (excluded.has(candidate.playerVersionId)) continue;
    const group = eligibleByIdentity.get(candidate.playerId) ?? [];
    const scoredCandidate = scored.get(candidate.playerVersionId);
    if (scoredCandidate !== undefined) group.push(scoredCandidate);
    eligibleByIdentity.set(candidate.playerId, group);
  }

  // Band assignment with the identity featured cap.
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

  // Build entries in canonical (playerVersionId ascending) order.
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
      const capped = scoredCandidate.playerTier === 'strong' && band === 'role';
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
      contentHash: catalogContentHash,
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

/** Serializes a derived index to the compact committed artifact bytes. */
export function freeAgencyIndexContent(index: SeasonFreeAgencyIndex): string {
  const content = `${JSON.stringify(index)}\n`;
  if (content.length > FREE_AGENCY_INDEX_MAX_BYTES) {
    throw new Error(
      `free-agency index exceeds the ${String(FREE_AGENCY_INDEX_MAX_BYTES)}-byte compactness gate (${String(content.length)} bytes)`,
    );
  }
  return content;
}

/** Counts facts of a derived index (band distribution, sizes). */
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
    season?: Record<string, { url?: string; contentHash?: string }>;
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
