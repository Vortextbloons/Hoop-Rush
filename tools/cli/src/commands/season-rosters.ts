import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SEASON_AI_VERSION, SEASON_ROSTER_GENERATION_VERSION, SEASON_ROTATION_VERSION, seasonDraftStateSchema, seasonLeagueGenerationResultSchema, seasonRosterTargetsSchema, seasonRunSchema, seedSchema, type SeasonDraftState, type SeasonLeagueGenerationResult, type SeasonRosterTargets, type SeasonStrengthBand, } from '@hoop-rush/data-contracts';
import { SeasonAiGenerationError, SeasonAiTargetsError, completionTargetsMet, generateAiLeague, seasonGenerationDigest, validateSeasonRoster, validateSeasonRotation, } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonRostersAuditReportSchema, seasonRostersCalibrateReportSchema, seasonRostersGenerateReportSchema, } from '../report-schemas.ts';
import { parseCount } from '../args.ts';
import { seasonCalibrationSeed } from './season-calibration.ts';
import { DEFAULT_MANIFEST, DEFAULT_ROSTER_TARGETS, fixtureHumanRoster, loadSeasonDraftCatalog, loadSeasonRosterTargets, poolLegalFailuresOf, readJsonFile, roleTierThresholdsOf, } from './season-data.ts';
import type { RosterCalibrationWorkerRun } from './rosters-calibration-worker.ts';
import { commitTargetsArtifact, runWorkerChunk, runWorkerChunks } from '../artifact.ts';
export const SEASON_ROSTERS_GENERATE_OPTIONS: Record<string, boolean> = {
    seed: true,
    draft: true,
    out: true,
    manifest: true,
    format: true,
};
export const SEASON_ROSTERS_AUDIT_OPTIONS: Record<string, boolean> = {
    input: true,
    manifest: true,
    'human-franchises': true,
    format: true,
};
export const SEASON_ROSTERS_CALIBRATE_OPTIONS: Record<string, boolean> = {
    workers: true,
    'calibration-seeds': true,
    'validation-seeds': true,
    out: true,
    manifest: true,
    targets: true,
    validate: false,
    format: true,
};
export const rosterCalibrationSeed = seasonCalibrationSeed;
export const ORDER_INVARIANCE_SEED_COUNT = 2;
function humanRostersOf(state: SeasonDraftState): Array<{
    franchiseId: string;
    playerVersionIds: string[];
}> {
    return state.participants.map((participant) => ({
        franchiseId: participant.franchiseId,
        playerVersionIds: state.picks
            .filter((pick) => pick.participantId === participant.participantId)
            .map((pick) => pick.playerVersionId),
    }));
}
function readDraftState(path: string): SeasonDraftState {
    const parsed = seasonDraftStateSchema.safeParse(readJsonFile(path));
    if (!parsed.success) {
        throw new Error(`draft input fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
    }
    return parsed.data;
}
export function seasonRostersGenerate(args: {
    seed: string | null;
    draft: string | null;
    out: string | null;
    manifest: string | null;
}): CliReport {
    const seed = args.seed;
    if (seed === null) {
        throw new Error('season rosters generate requires --seed <hex>');
    }
    if (!seedSchema.safeParse(seed).success) {
        return makeReport('season rosters generate', { seed, draft: args.draft }, { failures: [`--seed must be a hex seed (got "${seed}")`], exitCode: 2 });
    }
    if (args.draft === null) {
        throw new Error('season rosters generate requires --draft <draft.json>');
    }
    let state: SeasonDraftState;
    try {
        state = readDraftState(args.draft);
    }
    catch (error) {
        return makeReport('season rosters generate', { seed, draft: args.draft }, {
            failures: [(error as Error).message],
            exitCode: 2,
        });
    }
    if (state.status !== 'finalized' && state.status !== 'complete') {
        return makeReport('season rosters generate', { seed, draft: args.draft }, {
            failures: [
                `draft state must be finalized (or complete) to generate rosters (got ${state.status})`,
            ],
            exitCode: 2,
        });
    }
    const catalog = loadSeasonDraftCatalog(args.manifest ?? DEFAULT_MANIFEST);
    let targets: SeasonRosterTargets;
    try {
        targets = loadSeasonRosterTargets(args.manifest ?? DEFAULT_MANIFEST);
    }
    catch (error) {
        return makeReport('season rosters generate', { seed, draft: args.draft }, { failures: [(error as Error).message], exitCode: 2 });
    }
    const humanRosters = humanRostersOf(state);
    let result: SeasonLeagueGenerationResult;
    try {
        result = generateAiLeague({
            seed,
            catalog,
            league: state.league,
            humanFranchiseIds: humanRosters.map((roster) => roster.franchiseId),
            humanRosters,
            targets,
        });
    }
    catch (error) {
        if (error instanceof SeasonAiTargetsError) {
            return makeReport('season rosters generate', { seed, draft: args.draft }, {
                failures: [`targets rejected: ${(error as Error).message}`],
                exitCode: 1,
            });
        }
        if (error instanceof SeasonAiGenerationError) {
            return makeReport('season rosters generate', { seed, draft: args.draft }, {
                failures: [
                    `generation exhausted: ${error.diagnostics.failedTeams.join(', ')} (${error.diagnostics.unmetConstraints.join('; ')})`,
                ],
                exitCode: 1,
            });
        }
        throw error;
    }
    const payload = seasonRostersGenerateReportSchema.parse({
        schemaVersion: 1,
        command: 'season rosters generate',
        seed,
        teams: result.rosters.length,
        ownershipRows: result.ownership.length,
        pools: result.aiPools.length,
        anchorsTotal: result.aiPools.reduce((sum, pool) => sum + pool.anchors.length, 0),
        repairCount: result.aiPools.reduce((sum, pool) => sum + pool.repairCount, 0),
        digest: result.digest,
        diagnostics: result.diagnostics,
        wrote: false,
        outPath: null,
        pass: true,
    });
    const details = [
        `seed ${seed} · ${String(result.rosters.length)} rosters · ${String(result.ownership.length)} ownership rows · ${String(result.aiPools.length)} pools · ${String(payload.anchorsTotal)} anchors`,
        `digest ${result.digest}`,
        `diagnostics: generated ${String(result.diagnostics.teamsGenerated)} · repaired ${String(result.diagnostics.teamsRepaired)} · backtracks ${String(result.diagnostics.backtracks)} · nodes ${String(result.diagnostics.nodesVisited)}`,
    ];
    if (args.out !== null) {
        try {
            const target = resolve(args.out);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
            payload.wrote = true;
            payload.outPath = target;
            details.push(`wrote ${target}`);
        }
        catch (error) {
            return makeReport('season rosters generate', { seed, draft: args.draft }, {
                details,
                failures: [`cannot write ${args.out}: ${(error as Error).message}`],
                payload: { ...payload, pass: false },
                exitCode: 1,
            });
        }
    }
    else {
        details.push('preview only; pass --out <path> to write the result');
    }
    return makeReport('season rosters generate', { seed, draft: args.draft }, {
        details,
        payload,
    });
}
interface AuditedLeague {
    rosters: SeasonLeagueGenerationResult['rosters'];
    ownership: SeasonLeagueGenerationResult['ownership'];
    rotations: SeasonLeagueGenerationResult['rotations'];
    aiAssignments: SeasonLeagueGenerationResult['aiAssignments'];
    aiPools: SeasonLeagueGenerationResult['aiPools'];
    diagnostics: SeasonLeagueGenerationResult['diagnostics'];
    evaluations: SeasonLeagueGenerationResult['evaluations'];
    digest: string;
    seed: string;
    aiVersion: string;
    rosterGenerationVersion: string;
    rotationVersion: string;
    rosterTargetsVersion: string | null;
    humanFranchiseIds: string[];
}
function auditedLeagueOf(input: unknown, inputPath: string): AuditedLeague {
    const runParse = seasonRunSchema.safeParse(input);
    if (runParse.success) {
        const run = runParse.data;
        return {
            rosters: run.rosters,
            ownership: run.ownership,
            rotations: run.rotations,
            aiAssignments: run.aiAssignments,
            aiPools: run.aiPools,
            diagnostics: run.generationAudit.diagnostics,
            evaluations: run.evaluations,
            digest: run.generationAudit.digest,
            seed: run.rootSeed,
            aiVersion: run.versions.aiVersion,
            rosterGenerationVersion: run.versions.rosterGenerationVersion,
            rotationVersion: run.versions.rotationVersion,
            rosterTargetsVersion: run.versions.rosterTargetsVersion,
            humanFranchiseIds: run.draft.participants.map((p) => p.franchiseId),
        };
    }
    const resultParse = seasonLeagueGenerationResultSchema.safeParse(input);
    if (resultParse.success) {
        return {
            rosters: resultParse.data.rosters,
            ownership: resultParse.data.ownership,
            rotations: resultParse.data.rotations,
            aiAssignments: resultParse.data.aiAssignments,
            aiPools: resultParse.data.aiPools,
            diagnostics: resultParse.data.diagnostics,
            evaluations: resultParse.data.evaluations,
            digest: resultParse.data.digest,
            seed: resultParse.data.seed,
            aiVersion: resultParse.data.aiVersion,
            rosterGenerationVersion: resultParse.data.rosterGenerationVersion,
            rotationVersion: resultParse.data.rotationVersion,
            rosterTargetsVersion: null,
            humanFranchiseIds: [],
        };
    }
    throw new Error(`${inputPath} is neither a season run snapshot nor a league generation result`);
}
export function seasonRostersAudit(args: {
    input: string | null;
    manifest: string | null;
    'human-franchises'?: string | null;
}): CliReport {
    const inputPath = args.input;
    if (inputPath === null) {
        throw new Error('season rosters audit requires --input <league.json>');
    }
    const failures: string[] = [];
    const details: string[] = [];
    let league: AuditedLeague;
    try {
        league = auditedLeagueOf(readJsonFile(inputPath), inputPath);
    }
    catch (error) {
        return makeReport('season rosters audit', { input: inputPath }, {
            failures: [(error as Error).message],
            exitCode: 2,
        });
    }
    let targets: SeasonRosterTargets;
    try {
        targets = loadSeasonRosterTargets(args.manifest ?? DEFAULT_MANIFEST);
    }
    catch (error) {
        return makeReport('season rosters audit', { input: inputPath }, { failures: [(error as Error).message], exitCode: 2 });
    }
    const explicitHumans = args['human-franchises'] === undefined || args['human-franchises'] === null
        ? null
        : args['human-franchises']
            .split(',')
            .map((id) => id.trim())
            .filter((id) => id.length > 0);
    const humanFranchiseIds = league.humanFranchiseIds.length > 0 ? league.humanFranchiseIds : (explicitHumans ?? []);
    const quotaGatesEnabled = humanFranchiseIds.length > 0;
    if (!quotaGatesEnabled) {
        details.push('quota/identity gates skipped: no human franchise known (pass --human-franchises)');
    }
    if (humanFranchiseIds.length === 0) {
        details.push('tier thresholds computed over the full catalog: no human franchise known (pass --human-franchises)');
    }
    const humanSet = new Set(humanFranchiseIds);
    const humanVersionIds = new Set(league.rosters
        .filter((roster) => humanSet.has(roster.franchiseId))
        .flatMap((roster) => roster.players.map((player) => player.playerVersionId)));
    const catalog = loadSeasonDraftCatalog(args.manifest ?? DEFAULT_MANIFEST);
    const poolFailures: string[] = [];
    const anchorFailures: string[] = [];
    const tierFailures: string[] = [];
    const selectionFailures: string[] = [];
    const exclusivityFailures: string[] = [];
    const quotaFailures: string[] = [];
    const identityFailures: string[] = [];
    const rotationFailures: string[] = [];
    const roleCoverageFailures: string[] = [];
    const versionFailures: string[] = [];
    if (league.ownership.length !== 300) {
        selectionFailures.push(`ownership must have 300 rows (got ${String(league.ownership.length)})`);
    }
    const ownedIds = new Set<string>();
    for (const row of league.ownership) {
        if (ownedIds.has(row.playerVersionId)) {
            selectionFailures.push(`duplicate ownership of ${row.playerVersionId}`);
        }
        ownedIds.add(row.playerVersionId);
    }
    const rosterOwned = new Set(league.rosters.flatMap((roster) => roster.players.map((player) => player.playerVersionId)));
    if (rosterOwned.size !== 300) {
        selectionFailures.push(`rosters must own exactly 300 distinct versions (got ${String(rosterOwned.size)})`);
    }
    for (const id of rosterOwned) {
        if (!ownedIds.has(id))
            selectionFailures.push(`roster version ${id} is missing from ownership`);
    }
    for (const id of ownedIds) {
        if (!rosterOwned.has(id))
            selectionFailures.push(`ownership row ${id} is missing from rosters`);
    }
    for (const roster of league.rosters) {
        const members = roster.players.map((player) => {
            const candidate = catalog.candidates.find((c) => c.playerVersionId === player.playerVersionId);
            if (!candidate) {
                throw new Error(`roster references an unknown version ${player.playerVersionId}`);
            }
            return { playerVersionId: player.playerVersionId, playable: candidate.positions.playable };
        });
        const legality = validateSeasonRoster(members);
        if (legality.length > 0) {
            selectionFailures.push(`${roster.franchiseId}: ${legality.join('; ')}`);
        }
        if (!completionTargetsMet(members)) {
            selectionFailures.push(`${roster.franchiseId}: completion target (4/4/3) missed`);
        }
    }
    for (const rotation of league.rotations) {
        const memberPlayable = new Map(league.rosters
            .find((roster) => roster.franchiseId === rotation.franchiseId)
            ?.players.map((player) => {
            const candidate = catalog.candidates.find((c) => c.playerVersionId === player.playerVersionId);
            if (!candidate) {
                throw new Error(`roster references an unknown version ${player.playerVersionId}`);
            }
            return [player.playerVersionId, candidate.positions.playable] as const;
        }) ?? []);
        const rotationFailuresFor = validateSeasonRotation(rotation, memberPlayable);
        if (rotationFailuresFor.length > 0) {
            rotationFailures.push(`${rotation.franchiseId}: ${rotationFailuresFor.join('; ')}`);
        }
    }
    const aiRows = league.aiAssignments.filter((a) => !humanSet.has(a.franchiseId));
    if (quotaGatesEnabled) {
        if (aiRows.length !== 29 && aiRows.length !== 28) {
            quotaFailures.push(`expected 29 or 28 AI rows (got ${String(aiRows.length)})`);
        }
        const quotas = aiRows.length === 29 ? targets.policy.bandQuotas.solo : targets.policy.bandQuotas.duo;
        const bandCounts: Record<string, number> = {
            contender: 0,
            playoff: 0,
            average: 0,
            weaker: 0,
        };
        const identityCounts = new Map<string, number>();
        for (const row of aiRows) {
            bandCounts[row.band] = (bandCounts[row.band] ?? 0) + 1;
            identityCounts.set(row.identity, (identityCounts.get(row.identity) ?? 0) + 1);
        }
        for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
            if (bandCounts[band] !== quotas[band]) {
                quotaFailures.push(`${band} quota must be ${String(quotas[band])} (got ${String(bandCounts[band])})`);
            }
        }
        const identityValues = [...identityCounts.values()].sort((a, b) => a - b);
        if (identityValues.length !== 6) {
            identityFailures.push(`all six identities must appear (got ${String(identityValues.length)})`);
        }
        else if ((identityValues[5] ?? 0) - (identityValues[0] ?? 0) > 1) {
            identityFailures.push('identity counts must differ by no more than one');
        }
    }
    for (const evaluation of league.evaluations) {
        if (evaluation.rolesCovered.length !== 8) {
            roleCoverageFailures.push(`${evaluation.franchiseId}: covers ${String(evaluation.rolesCovered.length)}/8 roles`);
        }
    }
    if (league.aiVersion !== SEASON_AI_VERSION) {
        versionFailures.push(`ai version mismatch: ${league.aiVersion}`);
    }
    if (league.rosterGenerationVersion !== SEASON_ROSTER_GENERATION_VERSION) {
        versionFailures.push(`roster generation version mismatch: ${league.rosterGenerationVersion}`);
    }
    if (league.rotationVersion !== SEASON_ROTATION_VERSION) {
        versionFailures.push(`rotation version mismatch: ${league.rotationVersion}`);
    }
    if (league.rosterTargetsVersion !== null &&
        league.rosterTargetsVersion !== targets.targetsVersion) {
        versionFailures.push(`run targets version ${league.rosterTargetsVersion} does not match artifact ${targets.targetsVersion}`);
    }
    const thresholds = roleTierThresholdsOf(catalog, humanVersionIds);
    const aiPools = league.aiPools;
    if (aiPools.length === 0) {
        poolFailures.push('league carries no AI pools (roster-generation-v2 requires one pool per AI team)');
    }
    const poolOwnerOf = new Map<string, string>();
    for (const pool of aiPools) {
        const poolIssues = poolLegalFailuresOf(pool, thresholds, catalog, targets);
        for (const issue of poolIssues) {
            if (issue.includes('anchor')) {
                anchorFailures.push(issue);
                if (issue.includes('not elite'))
                    tierFailures.push(issue);
            }
            else {
                poolFailures.push(issue);
            }
        }
        for (const versionId of pool.playerVersionIds) {
            const owner = poolOwnerOf.get(versionId);
            if (owner !== undefined) {
                exclusivityFailures.push(`exclusivity: ${versionId} appears in pools ${owner} and ${pool.franchiseId}`);
            }
            else {
                poolOwnerOf.set(versionId, pool.franchiseId);
            }
        }
    }
    const rosterOwnerOf = new Map<string, string>();
    for (const roster of league.rosters) {
        for (const player of roster.players) {
            const owner = rosterOwnerOf.get(player.playerVersionId);
            if (owner !== undefined) {
                exclusivityFailures.push(`exclusivity: ${player.playerVersionId} appears on rosters ${owner} and ${roster.franchiseId}`);
            }
            else {
                rosterOwnerOf.set(player.playerVersionId, roster.franchiseId);
            }
        }
    }
    let digestVerified = false;
    try {
        const recomputed = seasonGenerationDigest({
            seed: league.seed,
            aiVersion: league.aiVersion,
            rosterGenerationVersion: league.rosterGenerationVersion,
            rotationVersion: league.rotationVersion,
            targetsVersion: targets.targetsVersion,
            rosters: league.rosters,
            ownership: league.ownership,
            rotations: league.rotations,
            aiAssignments: league.aiAssignments,
            aiPools: league.aiPools,
            diagnostics: league.diagnostics,
        });
        digestVerified = recomputed === league.digest;
        if (!digestVerified) {
            failures.push(`digest mismatch: stored ${league.digest}, recomputed ${recomputed}`);
        }
        else {
            details.push(`digest verified: ${league.digest}`);
        }
    }
    catch (error) {
        failures.push(`digest recomputation failed: ${(error as Error).message}`);
    }
    failures.push(...poolFailures, ...anchorFailures, ...exclusivityFailures);
    failures.push(...selectionFailures, ...quotaFailures, ...identityFailures, ...rotationFailures);
    failures.push(...roleCoverageFailures, ...versionFailures);
    const payload = seasonRostersAuditReportSchema.parse({
        schemaVersion: 1,
        command: 'season rosters audit',
        input: inputPath,
        teams: league.rosters.length,
        ownershipRows: league.ownership.length,
        pools: league.aiPools.length,
        quotaFailures: quotaFailures.length,
        identityFailures: identityFailures.length,
        selectionFailures: selectionFailures.length,
        legalityFailures: selectionFailures.length,
        roleCoverageFailures: roleCoverageFailures.length,
        rotationFailures: rotationFailures.length,
        poolFailures: poolFailures.length,
        anchorFailures: anchorFailures.length,
        tierFailures: tierFailures.length,
        exclusivityFailures: exclusivityFailures.length,
        versionFailures: versionFailures.length,
        digestVerified,
        auditFailures: failures.length,
        pass: failures.length === 0,
    });
    details.push(`rosters ${String(league.rosters.length)} · ownership ${String(league.ownership.length)} · AI rows ${String(aiRows.length)} · pools ${String(league.aiPools.length)}`, `audit failures: ${String(failures.length)}`);
    return makeReport('season rosters audit', { input: inputPath }, {
        details,
        failures,
        payload,
    });
}
function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
function distribution(values: readonly number[]): {
    median: number;
    range: [
        number,
        number
    ];
    min: number;
    max: number;
    sample: number;
} {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        median: median(sorted),
        range: [sorted[0] ?? 0, sorted[sorted.length - 1] ?? 0],
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        sample: sorted.length,
    };
}
async function runCalibrationChunks(args: {
    seeds: string[];
    catalogPath: string;
    leaguePath: string;
    humanRosters: Array<{
        franchiseId: string;
        playerVersionIds: string[];
    }>;
    workers: number;
    targets: SeasonRosterTargets;
}): Promise<RosterCalibrationWorkerRun[]> {
    return runWorkerChunks<string, RosterCalibrationWorkerRun>({
        workerUrl: new URL('./rosters-calibration-worker.ts', import.meta.url),
        workerData: (seeds) => ({ ...args, seeds, variant: 'roster' }),
        items: args.seeds,
        workers: args.workers,
        payloadKey: 'runs',
    });
}
async function runOrderInvarianceChunk(args: {
    seeds: string[];
    catalogPath: string;
    leaguePath: string;
    humanRosters: Array<{
        franchiseId: string;
        playerVersionIds: string[];
    }>;
    targets: SeasonRosterTargets;
}): Promise<Array<{
    seed: string;
    digests: string[];
}>> {
    return runWorkerChunk<Array<{
        seed: string;
        digests: string[];
    }>>({
        workerUrl: new URL('./rosters-calibration-worker.ts', import.meta.url),
        workerData: { ...args, variant: 'order-invariance' },
        payloadKey: 'orderInvariance',
    });
}
export interface SeasonRostersCalibrateDeps {
    runCohort?: (args: {
        seeds: string[];
        catalogPath: string;
        leaguePath: string;
        humanRosters: Array<{
            franchiseId: string;
            playerVersionIds: string[];
        }>;
        workers: number;
        targets: SeasonRosterTargets;
    }) => Promise<RosterCalibrationWorkerRun[]>;
    runOrderInvariance?: (args: {
        seeds: string[];
        catalogPath: string;
        leaguePath: string;
        humanRosters: Array<{
            franchiseId: string;
            playerVersionIds: string[];
        }>;
        targets: SeasonRosterTargets;
    }) => Promise<Array<{
        seed: string;
        digests: string[];
    }>>;
}
export async function seasonRostersCalibrate(args: {
    workers?: string;
    'calibration-seeds'?: string;
    'validation-seeds'?: string;
    out?: string;
    manifest?: string;
    targets?: string;
    validate?: boolean;
}, deps: SeasonRostersCalibrateDeps = {}): Promise<CliReport> {
    const calibrationCount = parseCount(args['calibration-seeds'], '--calibration-seeds', 256);
    const validationCount = parseCount(args['validation-seeds'], '--validation-seeds', 64);
    const workers = Math.max(1, parseCount(args.workers, '--workers', 4));
    const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
    const validateOnly = args.validate === true;
    let targets: SeasonRosterTargets;
    try {
        targets =
            args.targets === undefined
                ? loadSeasonRosterTargets(manifestPath)
                : seasonRosterTargetsSchema.parse(readJsonFile(args.targets));
    }
    catch (error) {
        return makeReport('season rosters calibrate', { calibrationSeeds: calibrationCount, validationSeeds: validationCount }, { failures: [(error as Error).message], exitCode: 2 });
    }
    const catalog = loadSeasonDraftCatalog(manifestPath);
    const humanRoster = fixtureHumanRoster(catalog);
    const humanRosters = [{ franchiseId: 'lakers', playerVersionIds: humanRoster }];
    const catalogPath = resolve(manifestPath, '..', 'season', 'draft-catalog.json');
    const leaguePath = resolve(manifestPath, '..', 'season', 'league.json');
    const start = Date.now();
    const calibrationSeeds = Array.from({ length: calibrationCount }, (_, i) => rosterCalibrationSeed(i));
    const validationSeeds = Array.from({ length: validationCount }, (_, i) => rosterCalibrationSeed(calibrationCount + i));
    const orderInvarianceSeeds = Array.from({ length: Math.min(ORDER_INVARIANCE_SEED_COUNT, calibrationCount) }, (_, i) => rosterCalibrationSeed(calibrationCount + validationCount + i));
    const chunkInput = {
        catalogPath,
        leaguePath,
        humanRosters,
        targets,
    };
    const runCohort = deps.runCohort ?? runCalibrationChunks;
    const runOrderInvariance = deps.runOrderInvariance ?? runOrderInvarianceChunk;
    const calibrationRuns = await runCohort({
        ...chunkInput,
        seeds: calibrationSeeds,
        workers,
    });
    const validationRuns = await runCohort({
        ...chunkInput,
        seeds: validationSeeds,
        workers,
    });
    const orderInvariance = await runOrderInvariance({
        ...chunkInput,
        seeds: orderInvarianceSeeds,
    });
    const durationMs = Date.now() - start;
    const byBand: Record<string, number[]> = {
        contender: [],
        playoff: [],
        average: [],
        weaker: [],
    };
    const byIdentity = new Map<string, number[]>();
    let failureCount = 0;
    let repairs = 0;
    let backtracks = 0;
    let roleGaps = 0;
    let identityGapLeagues = 0;
    const humanFranchiseIds = humanRosters.map((roster) => roster.franchiseId);
    for (const run of calibrationRuns) {
        if (run.failed) {
            failureCount += 1;
            continue;
        }
        repairs += run.repairs;
        backtracks += run.backtracks;
        const identities = new Set<string>();
        for (const team of run.teams) {
            if (humanFranchiseIds.includes(team.franchiseId))
                continue;
            byBand[team.band]?.push(team.strengthScore);
            byIdentity.set(team.identity, [...(byIdentity.get(team.identity) ?? []), team.strengthScore]);
            identities.add(team.identity);
            if (team.rolesCovered < 8)
                roleGaps += 1;
        }
        if (identities.size !== 6)
            identityGapLeagues += 1;
    }
    const bands: Record<SeasonStrengthBand, ReturnType<typeof distribution>> = {
        contender: distribution(byBand.contender ?? []),
        playoff: distribution(byBand.playoff ?? []),
        average: distribution(byBand.average ?? []),
        weaker: distribution(byBand.weaker ?? []),
    };
    const identityNames = [
        'star-chaser',
        'depth-builder',
        'defense-first',
        'shooting-first',
        'continuity',
        'active-trader',
    ] as const;
    const identities: Record<string, ReturnType<typeof distribution>> = {};
    for (const identity of identityNames) {
        identities[identity] = distribution(byIdentity.get(identity) ?? []);
    }
    const tierTotals: Record<SeasonStrengthBand, {
        elite: number;
        strong: number;
        useful: number;
        total: number;
    }> = {
        contender: { elite: 0, strong: 0, useful: 0, total: 0 },
        playoff: { elite: 0, strong: 0, useful: 0, total: 0 },
        average: { elite: 0, strong: 0, useful: 0, total: 0 },
        weaker: { elite: 0, strong: 0, useful: 0, total: 0 },
    };
    let anchorsExpected = 0;
    let anchorShortfall = 0;
    let extraEliteTeams = 0;
    let aiTeams = 0;
    let poolLegalityFailures = 0;
    let selectionFailures = 0;
    let superTeamCount = 0;
    let averageWeakerRosters = 0;
    const soloQuotas = targets.policy.bandQuotas.solo;
    const expectedPerLeague = ['contender', 'playoff', 'average', 'weaker'].reduce((sum, band) => sum +
        soloQuotas[band as SeasonStrengthBand] *
            targets.policy.guaranteedAnchors[band as SeasonStrengthBand], 0);
    for (const run of calibrationRuns) {
        if (run.failed)
            continue;
        poolLegalityFailures += run.poolFailures.length > 0 ? 1 : 0;
        selectionFailures += run.selectionFailures.length > 0 ? 1 : 0;
        anchorsExpected += expectedPerLeague;
        anchorShortfall += run.guaranteedAnchorShortfall;
        extraEliteTeams += run.extraEliteTeams;
        aiTeams += 29;
        for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
            const counts = run.tierCounts[band];
            const totals = tierTotals[band];
            totals.elite += counts.elite;
            totals.strong += counts.strong;
            totals.useful += counts.useful;
            totals.total += counts.total;
        }
    }
    for (const run of calibrationRuns) {
        if (run.failed)
            continue;
        for (const team of run.teams) {
            if (humanFranchiseIds.includes(team.franchiseId))
                continue;
            if (team.band === 'average' || team.band === 'weaker') {
                averageWeakerRosters += 1;
                if (team.strengthScore >= bands.contender.median)
                    superTeamCount += 1;
            }
        }
    }
    const anchorFulfillment = anchorsExpected === 0
        ? 0
        : Math.max(0, Math.min(1, (anchorsExpected - anchorShortfall) / anchorsExpected));
    const extraEliteRate = aiTeams === 0 ? 0 : extraEliteTeams / aiTeams;
    const extraEliteExpected = aiTeams === 0
        ? 0
        : (['contender', 'playoff', 'average', 'weaker'] as const).reduce((sum, band) => sum + (soloQuotas[band] * targets.policy.extraEliteRollProbability[band]) / 29, 0);
    const superTeamIncidence = averageWeakerRosters === 0 ? 0 : superTeamCount / averageWeakerRosters;
    const bandTierShares: Record<SeasonStrengthBand, {
        eliteShare: number;
        strongShare: number;
        usefulShare: number;
    }> = {} as Record<SeasonStrengthBand, {
        eliteShare: number;
        strongShare: number;
        usefulShare: number;
    }>;
    for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
        const totals = tierTotals[band];
        bandTierShares[band] = {
            eliteShare: totals.total === 0 ? 0 : totals.elite / totals.total,
            strongShare: totals.total === 0 ? 0 : totals.strong / totals.total,
            usefulShare: totals.total === 0 ? 0 : totals.useful / totals.total,
        };
    }
    const orderedBandMedians = bands.contender.median > bands.playoff.median &&
        bands.contender.median > bands.average.median &&
        bands.contender.median > bands.weaker.median;
    const quotas = calibrationRuns.every((run) => {
        if (run.failed)
            return false;
        const humanFranchises = new Set(humanFranchiseIds);
        const counts: Record<string, number> = { contender: 0, playoff: 0, average: 0, weaker: 0 };
        for (const team of run.teams) {
            if (humanFranchises.has(team.franchiseId))
                continue;
            counts[team.band] = (counts[team.band] ?? 0) + 1;
        }
        return (counts.contender === soloQuotas.contender &&
            counts.playoff === soloQuotas.playoff &&
            counts.average === soloQuotas.average &&
            counts.weaker === soloQuotas.weaker);
    });
    const roleCoverage = roleGaps === 0;
    const identitiesGate = identityGapLeagues === 0;
    let heldOutWithin = 0;
    let heldOutTotal = 0;
    for (const run of validationRuns) {
        if (run.failed)
            continue;
        for (const team of run.teams) {
            heldOutTotal += 1;
            const [lo, hi] = bands[team.band].range;
            if (team.strengthScore >= lo && team.strengthScore <= hi)
                heldOutWithin += 1;
        }
    }
    const heldOutPassShare = heldOutTotal === 0 ? 0 : heldOutWithin / heldOutTotal;
    const orderInvarianceFailures = orderInvariance.filter((probe) => new Set(probe.digests).size !== 1).length;
    const gates = targets.calibration.gates;
    const gateResults = {
        orderedBandMedians,
        quotas,
        roleCoverage,
        identities: identitiesGate,
        poolLegality: poolLegalityFailures === 0,
        selectionLegality: selectionFailures === 0,
        failureRate: failureCount === 0,
        minBandSeparation: bands.contender.median - bands.weaker.median >= gates.minBandSeparation,
        anchorFulfillment: anchorFulfillment >= gates.anchorFulfillmentMin,
        extraEliteWithinTolerance: Math.abs(extraEliteRate - extraEliteExpected) <= gates.extraEliteRateTolerance,
        superTeamIncidence: superTeamIncidence <= gates.superTeamIncidenceMax,
        orderInvariance: orderInvarianceFailures === 0,
        heldOutPassShare,
        heldOutPass: heldOutPassShare >= gates.heldOutPassShare,
    };
    const pass = gateResults.failureRate &&
        gateResults.minBandSeparation &&
        gateResults.anchorFulfillment &&
        gateResults.extraEliteWithinTolerance &&
        gateResults.superTeamIncidence &&
        gateResults.orderInvariance &&
        gateResults.poolLegality &&
        gateResults.selectionLegality &&
        gateResults.heldOutPass &&
        orderedBandMedians &&
        quotas &&
        roleCoverage &&
        identitiesGate;
    let targetsWritten = false;
    let targetsPath: string | null = null;
    const gateFailures: string[] = [];
    const measuredIdentities = {} as SeasonRosterTargets['measured']['identities'];
    for (const identity of identityNames) {
        const entry = identities[identity];
        measuredIdentities[identity] =
            entry === undefined
                ? { range: [0, 0], median: 0 }
                : { range: entry.range, median: entry.median };
    }
    const measured: SeasonRosterTargets['measured'] = {
        bands: {
            contender: {
                range: bands.contender.range,
                median: bands.contender.median,
                ...bandTierShares.contender,
            },
            playoff: {
                range: bands.playoff.range,
                median: bands.playoff.median,
                ...bandTierShares.playoff,
            },
            average: {
                range: bands.average.range,
                median: bands.average.median,
                ...bandTierShares.average,
            },
            weaker: { range: bands.weaker.range, median: bands.weaker.median, ...bandTierShares.weaker },
        },
        identities: measuredIdentities,
        anchorFulfillment,
        extraEliteRate,
        superTeamIncidence,
        poolLegalityFailures,
        selectionFailures,
        generationFailures: failureCount,
    };
    const updatedTargets: SeasonRosterTargets = {
        ...targets,
        calibration: {
            ...targets.calibration,
            calibrationSeedCount: calibrationCount,
            validationSeedCount: validationCount,
            generatedAtIso: new Date().toISOString(),
        },
        measured,
    };
    seasonRosterTargetsSchema.parse(updatedTargets);
    if (!validateOnly) {
        const outPath = args.out ?? DEFAULT_ROSTER_TARGETS;
        const commit = commitTargetsArtifact({
            outPath,
            defaultTargetsPath: DEFAULT_ROSTER_TARGETS,
            manifestPath,
            manifestKey: 'rosterTargets',
            manifestUrl: 'season/roster-targets.json',
            content: updatedTargets,
        });
        targetsWritten = commit.written;
        targetsPath = commit.path;
        if (commit.error !== null)
            gateFailures.push(commit.error);
    }
    const payload = seasonRostersCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'season rosters calibrate',
        calibrationSeeds: calibrationCount,
        validationSeeds: validationCount,
        failures: failureCount,
        repairRate: calibrationRuns.length === 0 ? 0 : repairs / calibrationRuns.length,
        backtrackRate: calibrationRuns.length === 0 ? 0 : backtracks / calibrationRuns.length,
        durationMs,
        bands: {
            contender: { ...bands.contender, ...bandTierShares.contender },
            playoff: { ...bands.playoff, ...bandTierShares.playoff },
            average: { ...bands.average, ...bandTierShares.average },
            weaker: { ...bands.weaker, ...bandTierShares.weaker },
        },
        identities,
        measured: {
            anchorFulfillment,
            extraEliteRate,
            extraEliteExpected,
            superTeamIncidence,
            poolLegalityFailures,
            selectionFailures,
            generationFailures: failureCount,
            orderInvarianceFailures,
        },
        gates: gateResults,
        targetsWritten,
        targetsPath,
        validateOnly,
        pass,
    });
    const details = [
        `${String(calibrationCount)} calibration + ${String(validationCount)} validation seeds in ${String(durationMs)}ms (${String(workers)} workers)${validateOnly ? ' · validate-only' : ''}`,
        `failures ${String(failureCount)} · repair rate ${(payload.repairRate * 100).toFixed(1)}% · backtrack rate ${(payload.backtrackRate * 100).toFixed(1)}%`,
        `band medians: contender ${bands.contender.median.toFixed(1)} > playoff ${bands.playoff.median.toFixed(1)} > average ${bands.average.median.toFixed(1)} > weaker ${bands.weaker.median.toFixed(1)}`,
        `anchors ${(anchorFulfillment * 100).toFixed(1)}% delivered · extra elite rate ${(extraEliteRate * 100).toFixed(1)}% (expected ${(extraEliteExpected * 100).toFixed(1)}%) · super teams ${(superTeamIncidence * 100).toFixed(1)}%`,
        `pool legality failures ${String(poolLegalityFailures)} · selection failures ${String(selectionFailures)} · order-invariance failures ${String(orderInvarianceFailures)}`,
        `held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% (≥ ${String(gates.heldOutPassShare * 100)}% required)`,
        `gates: failureRate ${String(gateResults.failureRate)} · separation ${String(gateResults.minBandSeparation)} · anchors ${String(gateResults.anchorFulfillment)} · extraElite ${String(gateResults.extraEliteWithinTolerance)} · superTeams ${String(gateResults.superTeamIncidence)} · orderInvariance ${String(gateResults.orderInvariance)} · heldOut ${String(gateResults.heldOutPass)}`,
        `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
    ];
    if (failureCount > 0)
        gateFailures.push(`${String(failureCount)} generation failures`);
    if (!orderedBandMedians)
        gateFailures.push('band medians are not strictly ordered');
    if (!quotas)
        gateFailures.push('band quota check failed');
    if (!roleCoverage)
        gateFailures.push(`role coverage gaps: ${String(roleGaps)}`);
    if (!identitiesGate)
        gateFailures.push('identity coverage missing in some league');
    if (!gateResults.poolLegality)
        gateFailures.push('illegal or duplicate pools found');
    if (!gateResults.selectionLegality)
        gateFailures.push('illegal or duplicate rosters found');
    if (!gateResults.minBandSeparation) {
        gateFailures.push(`contender-weaker separation ${(bands.contender.median - bands.weaker.median).toFixed(1)} below ${String(gates.minBandSeparation)}`);
    }
    if (!gateResults.anchorFulfillment) {
        gateFailures.push(`anchor fulfillment ${(anchorFulfillment * 100).toFixed(1)}% below ${String(gates.anchorFulfillmentMin * 100)}%`);
    }
    if (!gateResults.extraEliteWithinTolerance) {
        gateFailures.push(`extra elite rate ${(extraEliteRate * 100).toFixed(1)}% outside the ${String(gates.extraEliteRateTolerance * 100)}% tolerance of expected ${(extraEliteExpected * 100).toFixed(1)}%`);
    }
    if (!gateResults.superTeamIncidence) {
        gateFailures.push(`super team incidence ${(superTeamIncidence * 100).toFixed(1)}% above ${String(gates.superTeamIncidenceMax * 100)}%`);
    }
    if (!gateResults.orderInvariance) {
        gateFailures.push(`${String(orderInvarianceFailures)} order-invariance failures (reversed/shuffled inputs changed the digest)`);
    }
    if (!gateResults.heldOutPass) {
        gateFailures.push(`held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% below ${String(gates.heldOutPassShare * 100)}%`);
    }
    if (!targetsWritten && !validateOnly)
        gateFailures.push('targets artifact was not written');
    return makeReport('season rosters calibrate', { workers, calibrationSeeds: calibrationCount, validationSeeds: validationCount }, {
        details,
        failures: gateFailures,
        payload,
    });
}
