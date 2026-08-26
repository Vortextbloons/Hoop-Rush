import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seasonDraftCatalogSchema, seasonDraftStateSchema, seasonFreeAgencyIndexSchema, seasonLeagueSchema, seasonRosterRoleSchema, seasonRosterTargetsSchema, type SeasonAiPool, type SeasonDraftCandidate, type SeasonDraftCatalog, type SeasonDraftState, type SeasonFreeAgencyIndex, type SeasonLeague, type SeasonRosterRole, type SeasonRosterTargets, } from '@hoop-rush/data-contracts';
import { completionTargetsMet, evaluateSeasonRoster, legalFiveAfterAnyRemoval, percentileTierOf, playerPercentileTier, rolePercentileThresholds, rosterFeasible, type PercentileTier, type RoleThresholds, type SeasonRosterMemberInput, } from '@hoop-rush/engine';
import { readJson as readJsonFile, sha256Hex } from '../io.ts';
export { sha256Hex };
export { readJsonFile };
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
export const DEFAULT_MANIFEST = resolve(REPO_ROOT, 'apps/web/static/data/manifest.json');
export const DEFAULT_SEASON_DIR = resolve(REPO_ROOT, 'apps/web/static/data/season');
export const DEFAULT_DRAFT_CATALOG = resolve(DEFAULT_SEASON_DIR, 'draft-catalog.json');
export const DEFAULT_LEAGUE = resolve(DEFAULT_SEASON_DIR, 'league.json');
export const DEFAULT_ROSTER_TARGETS = resolve(DEFAULT_SEASON_DIR, 'roster-targets.json');
export const DEFAULT_FREE_AGENCY_INDEX = resolve(DEFAULT_SEASON_DIR, 'free-agency-index.json');
export function loadSeasonDraftCatalog(manifestPath: string = DEFAULT_MANIFEST, catalogPath: string = DEFAULT_DRAFT_CATALOG): SeasonDraftCatalog {
    const manifest = readJsonFile(manifestPath) as {
        season?: {
            draftCatalog?: {
                url?: string;
                contentHash?: string;
            };
        };
    };
    const expectedHash = manifest.season?.draftCatalog?.contentHash;
    if (expectedHash !== undefined) {
        const actual = sha256Hex(readFileSync(catalogPath));
        if (actual !== expectedHash) {
            throw new Error(`draft catalog content hash mismatch: expected ${expectedHash}, got ${actual}`);
        }
    }
    const parsed = seasonDraftCatalogSchema.safeParse(readJsonFile(catalogPath));
    if (!parsed.success) {
        throw new Error(`draft catalog fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
}
export function loadSeasonLeague(leaguePath: string = DEFAULT_LEAGUE): SeasonLeague {
    const parsed = seasonLeagueSchema.safeParse(readJsonFile(leaguePath));
    if (!parsed.success) {
        throw new Error(`league artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
}
export function loadSeasonRosterTargets(manifestPath: string = DEFAULT_MANIFEST, targetsPath?: string): SeasonRosterTargets {
    const manifest = readJsonFile(manifestPath) as {
        season?: {
            rosterTargets?: {
                url?: string;
                contentHash?: string;
            };
        };
    };
    const entry = manifest.season?.rosterTargets;
    if (entry === undefined) {
        throw new Error('manifest has no season.rosterTargets entry (verified roster targets required)');
    }
    if (entry.contentHash === undefined) {
        throw new Error('manifest season.rosterTargets entry has no contentHash');
    }
    const resolved = targetsPath ??
        (entry.url !== undefined
            ? resolveArtifact(dirname(manifestPath), entry.url)
            : DEFAULT_ROSTER_TARGETS);
    const actual = sha256Hex(readFileSync(resolved));
    if (actual !== entry.contentHash) {
        throw new Error(`roster targets content hash mismatch: expected ${entry.contentHash}, got ${actual} (${resolved})`);
    }
    const parsed = seasonRosterTargetsSchema.safeParse(readJsonFile(resolved));
    if (!parsed.success) {
        throw new Error(`roster targets fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
}
export function loadSeasonFreeAgencyIndex(manifestPath: string = DEFAULT_MANIFEST, indexPath?: string): SeasonFreeAgencyIndex {
    const manifest = readJsonFile(manifestPath) as {
        season?: {
            freeAgencyIndex?: {
                url?: string;
                contentHash?: string;
            };
            draftCatalog?: {
                url?: string;
                contentHash?: string;
            };
        };
    };
    const entry = manifest.season?.freeAgencyIndex;
    if (entry === undefined) {
        throw new Error('manifest has no season.freeAgencyIndex entry (verified free-agency index required)');
    }
    if (entry.contentHash === undefined) {
        throw new Error('manifest season.freeAgencyIndex entry has no contentHash');
    }
    const resolved = indexPath ??
        (entry.url !== undefined
            ? resolveArtifact(dirname(manifestPath), entry.url)
            : DEFAULT_FREE_AGENCY_INDEX);
    const actual = sha256Hex(readFileSync(resolved));
    if (actual !== entry.contentHash) {
        throw new Error(`free-agency index content hash mismatch: expected ${entry.contentHash}, got ${actual} (${resolved})`);
    }
    const parsed = seasonFreeAgencyIndexSchema.safeParse(readJsonFile(resolved));
    if (!parsed.success) {
        throw new Error(`free-agency index fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    const draftEntry = manifest.season?.draftCatalog;
    if (draftEntry?.contentHash !== undefined &&
        parsed.data.catalogRef.contentHash !== draftEntry.contentHash) {
        throw new Error(`free-agency index catalogRef hash ${parsed.data.catalogRef.contentHash} does not match the packaged draft catalog ${draftEntry.contentHash}`);
    }
    return parsed.data;
}
export function loadDraftStateInput(path: string): SeasonDraftState {
    const parsed = seasonDraftStateSchema.safeParse(readJsonFile(path));
    if (!parsed.success) {
        throw new Error(`draft input fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
}
export function resolveArtifact(manifestDir: string, url: string): string {
    return isAbsolute(url) ? url : resolve(manifestDir, url);
}
export function fixtureHumanRoster(catalog: SeasonDraftCatalog): string[] {
    const sorted = [...catalog.candidates].sort((a, b) => b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.playerVersionId.localeCompare(b.playerVersionId));
    const roster: SeasonRosterMemberInput[] = [];
    const available = sorted.map((candidate) => ({
        playerVersionId: candidate.playerVersionId,
        playable: candidate.positions.playable,
    }));
    for (const candidate of sorted) {
        if (roster.length >= 10)
            break;
        const probe: SeasonRosterMemberInput[] = [
            ...roster,
            { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
        ];
        const remaining = available.filter((member) => member.playerVersionId !== candidate.playerVersionId &&
            !probe.some((p) => p.playerVersionId === member.playerVersionId));
        if (!rosterFeasible(probe, remaining, 10 - probe.length))
            continue;
        roster.push({
            playerVersionId: candidate.playerVersionId,
            playable: candidate.positions.playable,
        });
    }
    if (roster.length !== 10) {
        throw new Error('fixture human roster could not reach ten legal players');
    }
    if (!completionTargetsMet(roster) || !legalFiveAfterAnyRemoval(roster)) {
        throw new Error('fixture human roster failed the legality checks');
    }
    return roster.map((member) => member.playerVersionId);
}
export function pickBestSelectable(state: SeasonDraftState, catalog: SeasonDraftCatalog): SeasonDraftCandidate {
    const offer = state.currentOffer;
    if (offer === null)
        throw new Error('no offer drawn for the fixture pick');
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const candidates = offer.cards
        .filter((card) => card.selectable)
        .map((card) => byId.get(card.playerVersionId))
        .filter((candidate): candidate is SeasonDraftCandidate => candidate !== undefined)
        .sort((a, b) => b.summaryRatings.overallRating - a.summaryRatings.overallRating ||
        a.playerVersionId.localeCompare(b.playerVersionId));
    if (candidates.length === 0) {
        throw new Error(`offer for pick ${String(offer.pickOrdinal)} has no selectable card`);
    }
    return candidates[0] as SeasonDraftCandidate;
}
export const ROSTER_ROLES: readonly SeasonRosterRole[] = seasonRosterRoleSchema.options;
export function canonicalNonHumanCandidates(catalog: SeasonDraftCatalog, humanVersionIds: ReadonlySet<string>): SeasonDraftCatalog['candidates'] {
    return [...catalog.candidates]
        .filter((candidate) => !humanVersionIds.has(candidate.playerVersionId))
        .sort((a, b) => (a.playerVersionId < b.playerVersionId ? -1 : 1));
}
function candidateRoleScores(candidate: SeasonDraftCandidate): Record<SeasonRosterRole, number> {
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
export function roleTierThresholdsOf(catalog: SeasonDraftCatalog, humanVersionIds: ReadonlySet<string>): Record<SeasonRosterRole, RoleThresholds> {
    const population = canonicalNonHumanCandidates(catalog, humanVersionIds);
    return rolePercentileThresholds(population.map((candidate) => candidateRoleScores(candidate)));
}
export function tierOfPool(pool: SeasonAiPool, thresholds: Record<SeasonRosterRole, RoleThresholds>, catalog: SeasonDraftCatalog): PercentileTier {
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const members = pool.playerVersionIds
        .map((versionId) => byId.get(versionId))
        .filter((candidate): candidate is SeasonDraftCandidate => candidate !== undefined)
        .map((candidate) => ({
        detailedRatings: candidate.detailedRatings,
        tendencies: candidate.tendencies,
    }));
    const evaluation = evaluateSeasonRoster({
        franchiseId: pool.franchiseId,
        band: pool.band,
        identity: pool.identity,
        members,
    });
    return playerPercentileTier(percentileTierOf(evaluation.roleScores, thresholds));
}
export function poolAnchorFailuresOf(pool: SeasonAiPool, thresholds: Record<SeasonRosterRole, RoleThresholds>, catalog: SeasonDraftCatalog, targets: SeasonRosterTargets): string[] {
    const failures: string[] = [];
    const members = new Set(pool.playerVersionIds);
    const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
    const priorityRoles = targets.policy.identityPriorityRoles[pool.identity];
    for (const anchor of pool.anchors) {
        const where = `pool ${pool.franchiseId} anchor ${anchor.playerVersionId}`;
        if (!members.has(anchor.playerVersionId)) {
            failures.push(`${where}: outside the pool`);
            continue;
        }
        if (!priorityRoles.includes(anchor.qualifyingRole)) {
            failures.push(`${where}: qualifying role ${anchor.qualifyingRole} is not a priority role of ${pool.identity}`);
        }
        const candidate = byId.get(anchor.playerVersionId);
        const threshold = thresholds[anchor.qualifyingRole].elite;
        if (candidate === undefined)
            continue;
        const score = candidateRoleScores(candidate)[anchor.qualifyingRole];
        if (Math.abs(score - anchor.roleScore) > 1e-6) {
            failures.push(`${where}: recorded roleScore ${String(anchor.roleScore)} does not match recomputed ${String(score)}`);
        }
        if (Math.abs(threshold - anchor.percentileThreshold) > 1e-6) {
            failures.push(`${where}: recorded percentileThreshold ${String(anchor.percentileThreshold)} does not match recomputed p90 ${String(threshold)}`);
        }
        if (score < threshold) {
            failures.push(`${where}: not elite in qualifying role ${anchor.qualifyingRole} (${String(score)} < ${String(threshold)})`);
        }
    }
    return failures;
}
export function poolLegalFailuresOf(pool: SeasonAiPool, thresholds: Record<SeasonRosterRole, RoleThresholds>, catalog: SeasonDraftCatalog, targets: SeasonRosterTargets): string[] {
    const failures: string[] = [];
    if (new Set(pool.playerVersionIds).size !== 20) {
        failures.push(`pool ${pool.franchiseId}: must hold exactly 20 distinct versions`);
    }
    const members = new Set(pool.playerVersionIds);
    const selected = new Set(pool.selections);
    if (selected.size !== 10) {
        failures.push(`pool ${pool.franchiseId}: selections must be exactly ten distinct versions`);
    }
    for (const versionId of pool.selections) {
        if (!members.has(versionId)) {
            failures.push(`pool ${pool.franchiseId}: selection ${versionId} is outside the pool`);
        }
    }
    const guaranteed = targets.policy.guaranteedAnchors[pool.band];
    if (pool.anchors.length < guaranteed) {
        failures.push(`pool ${pool.franchiseId}: ${String(pool.anchors.length)} anchors below the ${String(guaranteed)} guaranteed for ${pool.band}`);
    }
    if (pool.anchors.length > guaranteed + 1) {
        failures.push(`pool ${pool.franchiseId}: more than one extra elite anchor beyond the ${String(guaranteed)} guarantee`);
    }
    failures.push(...poolAnchorFailuresOf(pool, thresholds, catalog, targets));
    return failures;
}
