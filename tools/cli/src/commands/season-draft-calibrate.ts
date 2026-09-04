import { resolve } from 'node:path';
import { z } from 'zod';
import { SEASON_AI_VERSION, SEASON_DRAFT_SAFE_MINIMUM, SEASON_DRAFT_VERSION, SEASON_OFFER_TARGETS_VERSION, SEASON_ROSTER_GENERATION_VERSION, SEASON_ROTATION_VERSION, type SeasonDraftCatalog, type SeasonDraftCommand, type SeasonDraftState, type SeasonLeague, type SeasonLeagueGenerationResult, type SeasonRosterTargets, type Seed, } from '@hoop-rush/data-contracts';
import { applySeasonDraftCommand, generateAiLeague } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonDraftCalibrateReportSchema } from '../report-schemas.ts';
import { parseCount } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, loadSeasonRosterTargets, pickBestSelectable, } from './season-data.ts';
import { rosterCalibrationSeed } from './season-rosters.ts';
import { percentile } from '../stats.ts';
import { commitTargetsArtifact, runWorkerChunks } from '../artifact.ts';
export const SEASON_DRAFT_CALIBRATE_OPTIONS: Record<string, boolean> = {
    workers: true,
    'calibration-seeds': true,
    'validation-seeds': true,
    out: true,
    manifest: true,
    format: true,
};
export const DEFAULT_OFFER_TARGETS = resolve(DEFAULT_SEASON_DIR, 'offer-targets.json');
export interface SeasonDraftCalibrationRun {
    seed: Seed;
    variety: number;
    minSafePerOffer: number;
    selectableGroupCoverageShare: number;
    duplicateVersion: boolean;
    draftFailed: boolean;
    generationFailed: boolean;
    bands: Record<'contender' | 'playoff' | 'average' | 'weaker', number[]>;
}
function cmd(commandId: string, expectedRevision: number, payload: SeasonDraftCommand['payload']): SeasonDraftCommand {
    return { commandId, expectedRevision, payload };
}
function apply(state: SeasonDraftState | null, catalog: SeasonDraftCatalog, command: SeasonDraftCommand, targets: SeasonRosterTargets): {
    state: SeasonDraftState | null;
    generation: SeasonLeagueGenerationResult | null;
} {
    const result = applySeasonDraftCommand(state, catalog, command, {
        generate: (input) => generateAiLeague({ ...input, targets }),
    });
    if (result.record.status !== 'accepted') {
        throw new Error(`calibration command ${command.commandId} rejected: ${result.record.errorCode} (${result.record.message})`);
    }
    return { state: result.state, generation: result.generation };
}
function measureDraft(state: SeasonDraftState, catalog: SeasonDraftCatalog): Pick<SeasonDraftCalibrationRun, 'variety' | 'minSafePerOffer' | 'selectableGroupCoverageShare' | 'duplicateVersion'> {
    const allCards = state.offers.flatMap((offer) => offer.cards.map((card) => card.playerVersionId));
    const groupMask = (playable: readonly string[]): number => playable.reduce<number>((acc, position) => acc |
        (position === 'PG' || position === 'SG'
            ? 1
            : position === 'SF' || position === 'PF'
                ? 2
                : 4), 0);
    const byId = new Map(catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]));
    const coveredOffers = state.offers.filter((offer) => {
        let mask = 0;
        for (const card of offer.cards) {
            if (!card.selectable)
                continue;
            const candidate = byId.get(card.playerVersionId);
            if (candidate !== undefined)
                mask |= groupMask(candidate.positions.playable);
        }
        return (mask & 1) !== 0 && (mask & 2) !== 0 && (mask & 4) !== 0;
    }).length;
    const pickedBefore = new Set<string>();
    let duplicateVersion = false;
    state.offers.forEach((offer, index) => {
        if (duplicateVersion)
            return;
        for (const card of offer.cards) {
            if (pickedBefore.has(card.playerVersionId)) {
                duplicateVersion = true;
                return;
            }
        }
        const ownPick = state.picks[index];
        if (ownPick !== undefined)
            pickedBefore.add(ownPick.playerVersionId);
    });
    return {
        variety: new Set(allCards).size,
        minSafePerOffer: state.offers.length === 0
            ? 0
            : Math.min(...state.offers.map((offer) => offer.cards.filter((card) => card.selectable).length)),
        selectableGroupCoverageShare: state.offers.length === 0 ? 0 : coveredOffers / state.offers.length,
        duplicateVersion,
    };
}
export function playSeasonDraftCalibrationSeed(args: {
    seed: Seed;
    catalog: SeasonDraftCatalog;
    league: SeasonLeague;
    targets: SeasonRosterTargets;
}): SeasonDraftCalibrationRun {
    const { seed, catalog, league, targets } = args;
    const empty = {
        variety: 0,
        minSafePerOffer: 0,
        selectableGroupCoverageShare: 0,
        duplicateVersion: false,
        draftFailed: false,
        generationFailed: false,
        bands: {
            contender: [],
            playoff: [],
            average: [],
            weaker: [],
        } as SeasonDraftCalibrationRun['bands'],
    };
    const draft = apply(null, catalog, cmd('c-create', 0, {
        kind: 'create-season-draft',
        runId: `calibrate-${seed.slice(0, 12)}`,
        rootSeed: seed,
        league,
        humanParticipantIds: ['human'],
        catalogVersion: SEASON_DRAFT_VERSION,
    }), targets).state as SeasonDraftState;
    let state = draft;
    let sequence = 0;
    let draftFailed = false;
    while (state.status === 'drafting' && state.currentTurnParticipantId !== null) {
        const drawn = applySeasonDraftCommand(state, catalog, cmd(`c-draw-${String(sequence)}`, state.revision, {
            kind: 'draw-season-offer',
            participantId: 'human',
        }), { generate: (input) => generateAiLeague({ ...input, targets }) });
        if (drawn.record.status !== 'accepted' || drawn.state === null) {
            draftFailed = true;
            break;
        }
        state = drawn.state;
        const best = pickBestSelectable(state, catalog);
        const picked = apply(state, catalog, cmd(`c-pick-${String(sequence)}`, state.revision, {
            kind: 'select-draft-player',
            participantId: 'human',
            playerVersionId: best.playerVersionId,
        }), targets);
        state = picked.state as SeasonDraftState;
        sequence += 1;
    }
    if (!draftFailed && state.picks.filter((pick) => pick.participantId === 'human').length !== 10) {
        throw new Error(`seed ${seed} did not complete ten picks`);
    }
    const measured = measureDraft(state, catalog);
    if (draftFailed) {
        return { seed, ...measured, draftFailed: true, generationFailed: false, bands: empty.bands };
    }
    const finalized = apply(state, catalog, cmd('c-finalize', state.revision, {
        kind: 'finalize-human-rosters',
    }), targets);
    state = finalized.state as SeasonDraftState;
    let generation: SeasonLeagueGenerationResult;
    let generationFailed = false;
    const generated = applySeasonDraftCommand(state, catalog, cmd('c-generate', state.revision, {
        kind: 'generate-ai-league',
    }), {
        generate: (input) => generateAiLeague({ ...input, targets }),
    });
    if (generated.record.status !== 'accepted' || generated.generation === null) {
        generationFailed = true;
        generation = {
            schemaVersion: 2,
            seed,
            aiVersion: SEASON_AI_VERSION,
            rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
            rotationVersion: SEASON_ROTATION_VERSION,
            rosters: [],
            ownership: [],
            rotations: [],
            aiAssignments: [],
            aiPools: [],
            evaluations: [],
            diagnostics: {
                seed,
                aiVersion: SEASON_AI_VERSION,
                rosterGenerationVersion: SEASON_ROSTER_GENERATION_VERSION,
                teamsGenerated: 0,
                teamsRepaired: 0,
                backtracks: 0,
                nodesVisited: 0,
                nodeBudget: 100000,
                failedTeams: [],
                unmetConstraints: [],
            },
            digest: '0'.repeat(32),
        };
    }
    else {
        generation = generated.generation;
    }
    const humanFranchises = new Set(state.participants.map((p) => p.franchiseId));
    const bands: SeasonDraftCalibrationRun['bands'] = {
        contender: [],
        playoff: [],
        average: [],
        weaker: [],
    };
    for (const evaluation of generation.evaluations) {
        if (humanFranchises.has(evaluation.franchiseId))
            continue;
        bands[evaluation.band].push(evaluation.strengthScore);
    }
    return {
        seed,
        ...measured,
        draftFailed: false,
        generationFailed,
        bands,
    };
}
export function runSeasonDraftCalibrationSeeds(args: {
    seeds: Seed[];
    catalog: SeasonDraftCatalog;
    league: SeasonLeague;
    targets: SeasonRosterTargets;
}): SeasonDraftCalibrationRun[] {
    return args.seeds.map((seed) => playSeasonDraftCalibrationSeed({
        seed,
        catalog: args.catalog,
        league: args.league,
        targets: args.targets,
    }));
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
        range: [percentile(sorted, 0.01), percentile(sorted, 0.99)],
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        sample: sorted.length,
    };
}
const offerTargetsSchema = z.object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(SEASON_OFFER_TARGETS_VERSION),
    calibration: z.object({
        calibrationSeedCount: z.number().int().positive(),
        validationSeedCount: z.number().int().positive(),
        generatedAtIso: z.string().min(1),
        draftVersion: z.literal('season-draft-v2'),
        safeMinimum: z.literal(SEASON_DRAFT_SAFE_MINIMUM),
    }),
    variety: z.object({
        median: z.number(),
        range: z.tuple([z.number(), z.number()]),
        min: z.number(),
        max: z.number(),
        sample: z.number().int().nonnegative(),
    }),
    selectableGroupCoverage: z.object({
        share: z.number().min(0).max(1),
        range: z.tuple([z.number(), z.number()]),
        sampleOffers: z.number().int().nonnegative(),
    }),
    bands: z.object({
        contender: z.object({
            median: z.number(),
            range: z.tuple([z.number(), z.number()]),
        }),
        playoff: z.object({
            median: z.number(),
            range: z.tuple([z.number(), z.number()]),
        }),
        average: z.object({
            median: z.number(),
            range: z.tuple([z.number(), z.number()]),
        }),
        weaker: z.object({
            median: z.number(),
            range: z.tuple([z.number(), z.number()]),
        }),
    }),
    heldOutPassShare: z.literal(0.95),
});
export type SeasonOfferTargets = z.infer<typeof offerTargetsSchema>;
async function runCalibrationChunks(args: {
    seeds: Seed[];
    catalogPath: string;
    leaguePath: string;
    workers: number;
    targets: SeasonRosterTargets;
}): Promise<SeasonDraftCalibrationRun[]> {
    return runWorkerChunks<Seed, SeasonDraftCalibrationRun>({
        workerUrl: new URL('./draft-calibration-worker.ts', import.meta.url),
        workerData: (seeds) => ({ ...args, seeds }),
        items: args.seeds,
        workers: args.workers,
        payloadKey: 'runs',
    });
}
export async function seasonDraftCalibrate(args: {
    workers?: string;
    'calibration-seeds'?: string;
    'validation-seeds'?: string;
    out?: string;
    manifest?: string;
}): Promise<CliReport> {
    const calibrationCount = parseCount(args['calibration-seeds'], '--calibration-seeds', 256);
    const validationCount = parseCount(args['validation-seeds'], '--validation-seeds', 64);
    const workers = Math.max(1, parseCount(args.workers, '--workers', 4));
    const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
    const catalogPath = resolve(manifestPath, '..', 'season', 'draft-catalog.json');
    const leaguePath = resolve(manifestPath, '..', 'season', 'league.json');
    const start = Date.now();
    let rosterTargets: SeasonRosterTargets;
    try {
        rosterTargets = loadSeasonRosterTargets(manifestPath);
    }
    catch (error) {
        return makeReport('season draft calibrate', { calibrationSeeds: calibrationCount, validationSeeds: validationCount }, { failures: [(error as Error).message], exitCode: 2 });
    }
    const calibrationSeeds = Array.from({ length: calibrationCount }, (_, i) => rosterCalibrationSeed(i));
    const validationSeeds = Array.from({ length: validationCount }, (_, i) => rosterCalibrationSeed(calibrationCount + i));
    const calibrationRuns = await runCalibrationChunks({
        seeds: calibrationSeeds,
        catalogPath,
        leaguePath,
        workers,
        targets: rosterTargets,
    });
    const validationRuns = await runCalibrationChunks({
        seeds: validationSeeds,
        catalogPath,
        leaguePath,
        workers,
        targets: rosterTargets,
    });
    const durationMs = Date.now() - start;
    const varietyValues = calibrationRuns.map((run) => run.variety);
    const safeValues = calibrationRuns.map((run) => run.minSafePerOffer);
    const coverageValues = calibrationRuns.map((run) => run.selectableGroupCoverageShare);
    const byBand: SeasonDraftCalibrationRun['bands'] = {
        contender: [],
        playoff: [],
        average: [],
        weaker: [],
    };
    let generationFailures = 0;
    let draftFailures = 0;
    let duplicateDrafts = 0;
    for (const run of calibrationRuns) {
        if (run.generationFailed)
            generationFailures += 1;
        if (run.draftFailed)
            draftFailures += 1;
        if (run.duplicateVersion)
            duplicateDrafts += 1;
        for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
            byBand[band].push(...run.bands[band]);
        }
    }
    const bands = {
        contender: distribution(byBand.contender),
        playoff: distribution(byBand.playoff),
        average: distribution(byBand.average),
        weaker: distribution(byBand.weaker),
    };
    const variety = distribution(varietyValues);
    const coverage = distribution(coverageValues);
    const minSafe = Math.min(...safeValues);
    const safeAvailabilityShare = calibrationRuns.length === 0
        ? 0
        : calibrationRuns.filter((run) => run.minSafePerOffer >= SEASON_DRAFT_SAFE_MINIMUM).length /
            calibrationRuns.length;
    const allOffers = calibrationRuns.reduce((sum) => sum + 10, 0);
    const coveredOffers = calibrationRuns.reduce((sum, run) => sum + run.selectableGroupCoverageShare * 10, 0);
    const selectableGroupCoverageShare = allOffers === 0 ? 0 : coveredOffers / allOffers;
    const minSafeGate = safeAvailabilityShare === 1 && minSafe >= SEASON_DRAFT_SAFE_MINIMUM;
    const zeroDuplicates = duplicateDrafts === 0;
    const zeroGenerationFailures = generationFailures === 0;
    const withinVariety = (run: SeasonDraftCalibrationRun): boolean => !run.draftFailed && run.variety >= variety.range[0] && run.variety <= variety.range[1];
    const withinCoverage = (run: SeasonDraftCalibrationRun): boolean => !run.draftFailed &&
        run.selectableGroupCoverageShare >= coverage.range[0] &&
        run.selectableGroupCoverageShare <= coverage.range[1];
    const shareOf = (runs: SeasonDraftCalibrationRun[], check: (run: SeasonDraftCalibrationRun) => boolean): number => {
        if (runs.length === 0)
            return 0;
        return runs.filter(check).length / runs.length;
    };
    const heldOutVarietyPassShare = shareOf(validationRuns, withinVariety);
    const heldOutSafePassShare = shareOf(validationRuns, (run) => !run.draftFailed && run.minSafePerOffer >= SEASON_DRAFT_SAFE_MINIMUM);
    const heldOutCoveragePassShare = shareOf(validationRuns, withinCoverage);
    let heldOutStrengthWithin = 0;
    let heldOutStrengthTotal = 0;
    for (const run of validationRuns) {
        if (run.draftFailed || run.generationFailed)
            continue;
        for (const band of ['contender', 'playoff', 'average', 'weaker'] as const) {
            for (const score of run.bands[band]) {
                heldOutStrengthTotal += 1;
                if (score >= bands[band].range[0] && score <= bands[band].range[1]) {
                    heldOutStrengthWithin += 1;
                }
            }
        }
    }
    const heldOutStrengthPassShare = heldOutStrengthTotal === 0 ? 0 : heldOutStrengthWithin / heldOutStrengthTotal;
    const heldOutPassShare = Math.min(heldOutVarietyPassShare, heldOutSafePassShare, heldOutCoveragePassShare, heldOutStrengthPassShare);
    const heldOutPass = heldOutPassShare >= 0.95;
    const pass = minSafeGate && zeroDuplicates && zeroGenerationFailures && heldOutPass;
    let targetsWritten = false;
    let targetsPath: string | null = null;
    const gateFailures: string[] = [];
    const targets: SeasonOfferTargets = {
        schemaVersion: 1,
        targetsVersion: SEASON_OFFER_TARGETS_VERSION,
        calibration: {
            calibrationSeedCount: calibrationCount,
            validationSeedCount: validationCount,
            generatedAtIso: new Date().toISOString(),
            draftVersion: 'season-draft-v2',
            safeMinimum: SEASON_DRAFT_SAFE_MINIMUM,
        },
        variety: {
            median: variety.median,
            range: variety.range,
            min: variety.min,
            max: variety.max,
            sample: variety.sample,
        },
        selectableGroupCoverage: {
            share: selectableGroupCoverageShare,
            range: coverage.range,
            sampleOffers: allOffers,
        },
        bands: {
            contender: { median: bands.contender.median, range: bands.contender.range },
            playoff: { median: bands.playoff.median, range: bands.playoff.range },
            average: { median: bands.average.median, range: bands.average.range },
            weaker: { median: bands.weaker.median, range: bands.weaker.range },
        },
        heldOutPassShare: 0.95,
    };
    offerTargetsSchema.parse(targets);
    const outPath = args.out ?? DEFAULT_OFFER_TARGETS;
    const commit = commitTargetsArtifact({
        outPath,
        defaultTargetsPath: DEFAULT_OFFER_TARGETS,
        manifestPath,
        manifestKey: 'offerTargets',
        manifestUrl: 'season/offer-targets.json',
        content: targets,
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    if (commit.error !== null)
        gateFailures.push(commit.error);
    const payload = seasonDraftCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'season draft calibrate',
        calibrationSeeds: calibrationCount,
        validationSeeds: validationCount,
        durationMs,
        variety,
        minSafePerOffer: minSafe,
        safeAvailabilityShare,
        selectableGroupCoverageShare,
        duplicateDrafts,
        draftFailures,
        generationFailures,
        bands,
        gates: {
            minSafe: minSafeGate,
            zeroDuplicates,
            zeroDraftFailures: draftFailures === 0,
            zeroGenerationFailures,
            selectableGroupCoverage: selectableGroupCoverageShare >= 0.95,
            heldOutVarietyPassShare,
            heldOutVarietyPass: heldOutVarietyPassShare >= 0.95,
            heldOutSafePassShare,
            heldOutSafePass: heldOutSafePassShare >= 0.95,
            heldOutCoveragePassShare,
            heldOutCoveragePass: heldOutCoveragePassShare >= 0.95,
            heldOutStrengthPassShare,
            heldOutStrengthPass: heldOutStrengthPassShare >= 0.95,
        },
        targetsWritten,
        targetsPath,
        pass,
    });
    const details = [
        `${String(calibrationCount)} calibration + ${String(validationCount)} validation seeds in ${String(durationMs)}ms (${String(workers)} workers)`,
        `variety median ${variety.median.toFixed(1)} (range ${variety.range[0].toFixed(1)}-${variety.range[1].toFixed(1)}) · min safe per offer ${String(minSafe)} · safe availability ${(safeAvailabilityShare * 100).toFixed(1)}%`,
        `selectable group coverage ${(selectableGroupCoverageShare * 100).toFixed(1)}% · duplicate drafts ${String(duplicateDrafts)} · draft failures ${String(draftFailures)} · generation failures ${String(generationFailures)}`,
        `held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% (≥ 95% required)`,
        `gates: minSafe ${String(minSafeGate)} · duplicates ${String(zeroDuplicates)} · generation ${String(zeroGenerationFailures)}`,
        `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
    ];
    if (draftFailures > 0) {
        details.push(`${String(draftFailures)} drafts dead-ended with NO_FEASIBLE_GLOBAL_OFFER under the greedy pick policy (finding; not a frozen gate)`);
    }
    if (!minSafeGate)
        gateFailures.push('some offer had fewer than 3 selectable cards');
    if (!zeroDuplicates)
        gateFailures.push('an exact version was duplicated across offers+picks');
    if (!zeroGenerationFailures) {
        gateFailures.push(`${String(generationFailures)} AI generation failures`);
    }
    if (!heldOutPass) {
        gateFailures.push(`held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% below 95%`);
    }
    if (!targetsWritten)
        gateFailures.push('targets artifact was not written');
    return makeReport('season draft calibrate', { workers, calibrationSeeds: calibrationCount, validationSeeds: validationCount }, {
        details,
        failures: gateFailures,
        payload,
    });
}
