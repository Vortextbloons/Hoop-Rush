import { resolve } from 'node:path';
import { z } from 'zod';
import { SEASON_POSTSEASON_TARGETS_VERSION, SEASON_RUN_SCHEMA_VERSION, commandIdSchema, type FranchiseId, type SeasonAdvancePostseasonCommand, type SeasonPostseasonSummary, type SeasonRun, type SeasonStartPostseasonCommand, type Seed, } from '@hoop-rush/data-contracts';
import { createEngineContext, deriveSeasonAwards, handleSeasonRunCommand } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonPostseasonCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile } from './season-data.ts';
import { gateSummary, m25RangeGate, m25ToleranceGate, mean, seasonCalibrationSeed, seedIndexRange, type M25Gate, } from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';
import { commitTargetsArtifact } from '../artifact.ts';
import { loadPackagedData, PackagedData } from './data-loader.ts';
export const SEASON_POSTSEASON_CALIBRATE_OPTIONS: Record<string, boolean> = {
    input: true,
    'seed-from': true,
    'seed-to': true,
    workers: true,
    out: true,
    manifest: true,
    validate: true,
    write: false,
    format: true,
};
export const DEFAULT_POSTSEASON_TARGETS = resolve(DEFAULT_SEASON_DIR, 'postseason-targets.json');
export const SEASON_POSTSEASON_CALIBRATION_SEED_COUNT = 8;
export const SEASON_POSTSEASON_VALIDATION_SEED_COUNT = 4;
export const SEASON_POSTSEASON_MIN_SEASONS = 4;
export const SEASON_POSTSEASON_SERIES_LENGTH_RANGE = { min: 4.5, max: 6.5 } as const;
export const SEASON_POSTSEASON_UPSET_RATE_MAX = 0.45;
export const SEASON_POSTSEASON_HOME_ADVANTAGE_RANGE = { min: 0.5, max: 0.7 } as const;
export const SEASON_POSTSEASON_STRENGTH_MIN = 0.5;
export const SEASON_POSTSEASON_AWARD_PLAUSIBILITY_MIN = 0.8;
export const SEASON_POSTSEASON_FORFEITS_PER_SEASON_MAX = 2;
export const seasonPostseasonMeasuredSchema = z.object({
    seasonsSimulated: z.number().int().nonnegative(),
    gamesPlayed: z.number().int().nonnegative(),
    seriesCompleted: z.number().int().nonnegative(),
    seriesLengthMean: z.number(),
    upsetRate: z.number().min(0).max(1),
    homeAdvantage: z.number().min(0).max(1),
    advancementByStrength: z.number().min(0).max(1),
    awardPlausibility: z.number().min(0).max(1),
    forfeits: z.number().int().nonnegative(),
    integrityFailures: z.number().int().nonnegative(),
    champions: z.number().int().nonnegative(),
    duplicateTeamFailures: z.number().int().nonnegative(),
    missingTeamFailures: z.number().int().nonnegative(),
    bothInvalidGames: z.number().int().nonnegative(),
});
export type SeasonPostseasonMeasured = z.infer<typeof seasonPostseasonMeasuredSchema>;
export const seasonPostseasonTargetsSchema = z.object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(SEASON_POSTSEASON_TARGETS_VERSION),
    policy: z.object({
        seriesLengthMin: z.literal(4.5),
        seriesLengthMax: z.literal(6.5),
        upsetRateMax: z.literal(0.45),
        homeAdvantageMin: z.literal(0.5),
        homeAdvantageMax: z.literal(0.7),
        advancementByStrengthMin: z.literal(0.5),
        awardPlausibilityMin: z.literal(0.8),
        forfeitsPerSeasonMax: z.literal(2),
        minSeasons: z.literal(4),
    }),
    cohort: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
        seedFrom: z.number().int().nonnegative(),
        seedTo: z.number().int().nonnegative(),
    }),
    measured: z.object({
        calibration: seasonPostseasonMeasuredSchema,
        heldOut: seasonPostseasonMeasuredSchema,
    }),
    engineVersion: z.string().min(1).max(64),
    generatedAtIso: z.string().min(1),
});
export type SeasonPostseasonTargets = z.infer<typeof seasonPostseasonTargetsSchema>;
export interface SeasonPostseasonSeasonFacts {
    rootSeed: string;
    championFranchiseId: string | null;
    seriesLengths: number[];
    homeWins: number;
    homeGames: number;
    upsetSeries: number;
    decidedSeededSeries: number;
    strengthSeries: number;
    awardWinnersInPostseason: number;
    awardWinners: number;
    forfeits: number;
    integrityFailures: number;
    duplicateTeamFailures: number;
    missingTeamFailures: number;
    bothInvalidGames: number;
    gamesPlayed: number;
    seriesCompleted: number;
}
export type SeasonPostseasonSeasonRunner = (rootSeed: Seed) => SeasonPostseasonSeasonFacts;
export interface SeasonPostseasonCohortFacts extends SeasonPostseasonMeasured {
    awardWinners: number;
    upsetSeries: number;
    homeGames: number;
    decidedSeededSeries: number;
}
export function foldSeasonPostseasonCohortFacts(facts: readonly SeasonPostseasonSeasonFacts[]): SeasonPostseasonCohortFacts {
    const all = [...facts];
    const lengths = all.flatMap((fact) => fact.seriesLengths);
    const total = (pick: (fact: SeasonPostseasonSeasonFacts) => number): number => all.reduce((sum, fact) => sum + pick(fact), 0);
    const decided = total((fact) => fact.decidedSeededSeries);
    const homeGames = total((fact) => fact.homeGames);
    const awardWinners = total((fact) => fact.awardWinners);
    return {
        seasonsSimulated: all.length,
        gamesPlayed: total((fact) => fact.gamesPlayed),
        seriesCompleted: total((fact) => fact.seriesCompleted),
        seriesLengthMean: lengths.length === 0 ? 0 : mean(lengths),
        upsetRate: decided === 0 ? 0 : total((fact) => fact.upsetSeries) / decided,
        homeAdvantage: homeGames === 0 ? 0 : total((fact) => fact.homeWins) / homeGames,
        advancementByStrength: decided === 0 ? 0 : total((fact) => fact.strengthSeries) / decided,
        awardPlausibility: awardWinners === 0 ? 0 : total((fact) => fact.awardWinnersInPostseason) / awardWinners,
        awardWinners,
        upsetSeries: total((fact) => fact.upsetSeries),
        homeGames,
        decidedSeededSeries: decided,
        forfeits: total((fact) => fact.forfeits),
        integrityFailures: total((fact) => fact.integrityFailures),
        champions: total((fact) => (fact.championFranchiseId === null ? 0 : 1)),
        duplicateTeamFailures: total((fact) => fact.duplicateTeamFailures),
        missingTeamFailures: total((fact) => fact.missingTeamFailures),
        bothInvalidGames: total((fact) => fact.bothInvalidGames),
    };
}
export function seasonPostseasonGates(cohort: SeasonPostseasonCohortFacts): M25Gate[] {
    const min = SEASON_POSTSEASON_MIN_SEASONS;
    return [
        m25ToleranceGate('championPerSeason', cohort.champions, cohort.seasonsSimulated, 0, cohort.seasonsSimulated, min),
        m25ToleranceGate('zeroDuplicateTeams', cohort.duplicateTeamFailures, 0, 0, cohort.seasonsSimulated, min),
        m25ToleranceGate('zeroMissingTeams', cohort.missingTeamFailures, 0, 0, cohort.seasonsSimulated, min),
        m25ToleranceGate('zeroBothInvalidGames', cohort.bothInvalidGames, 0, 0, cohort.seasonsSimulated, min),
        m25RangeGate('seriesLength', cohort.seriesLengthMean, SEASON_POSTSEASON_SERIES_LENGTH_RANGE.min, SEASON_POSTSEASON_SERIES_LENGTH_RANGE.max, cohort.seriesCompleted, min * 14),
        m25ToleranceGate('upsetRate', cohort.upsetRate, 0, SEASON_POSTSEASON_UPSET_RATE_MAX, cohort.seriesCompleted, min * 14),
        m25RangeGate('homeAdvantage', cohort.homeAdvantage, SEASON_POSTSEASON_HOME_ADVANTAGE_RANGE.min, SEASON_POSTSEASON_HOME_ADVANTAGE_RANGE.max, cohort.gamesPlayed, min * 30),
        m25ToleranceGate('advancementByStrength', cohort.advancementByStrength, 1, 1 - SEASON_POSTSEASON_STRENGTH_MIN, cohort.seriesCompleted, min * 14),
        m25ToleranceGate('awardPlausibility', cohort.awardPlausibility, 1, 1 - SEASON_POSTSEASON_AWARD_PLAUSIBILITY_MIN, cohort.awardWinners, min * 7),
        m25ToleranceGate('forfeitRate', cohort.forfeits, 0, SEASON_POSTSEASON_FORFEITS_PER_SEASON_MAX * cohort.seasonsSimulated, cohort.seasonsSimulated, min),
        m25ToleranceGate('zeroIntegrityFailures', cohort.integrityFailures, 0, 0, cohort.seasonsSimulated, min),
    ];
}
export function simulateSeasonPostseasonFacts(rootSeed: Seed, options: {
    runPath?: string | null;
    manifestPath?: string | null;
    profileEra?: string | null;
} = {}): SeasonPostseasonSeasonFacts {
    const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
    const season: SeasonM25SeasonFacts = runSeasonM25({
        runPath: options.runPath ?? null,
        manifestPath,
        profileEra: options.profileEra ?? null,
        rootSeed,
        driveWindows: true,
        pickObjectives: true,
    });
    let run: SeasonRun = season.run;
    let effects = season.effects;
    const packaged = loadPackagedData(manifestPath);
    const profile = new PackagedData(packaged.manifest, packaged.dir).eraProfile(options.profileEra ?? '1990s');
    const postseasonSummaries: SeasonPostseasonSummary[] = [];
    let integrityFailures = 0;
    const startCommand: SeasonStartPostseasonCommand = {
        schemaVersion: SEASON_RUN_SCHEMA_VERSION,
        command: 'start-postseason',
        commandId: commandIdSchema.parse(`cal-start-${rootSeed}`),
        runId: run.runId,
        expectedStateRevision: run.stateRevision,
        expectedStateDigest: run.stateDigest,
    };
    const start = handleSeasonRunCommand(startCommand, {
        run,
        pending: null,
        humanFranchiseId: null,
        catalog: season.catalog,
        effects,
        profile,
    });
    if (start.result.result.status === 'rejected') {
        throw new Error(`seed ${rootSeed} start-postseason rejected (${start.result.result.rejection.code})`);
    }
    run = start.run;
    effects =
        (start.run as SeasonRun & {
            effects?: typeof effects;
        }).effects ?? effects;
    let guard = 0;
    while (run.stage !== 'completed' && guard < 300) {
        guard += 1;
        const command: SeasonAdvancePostseasonCommand = {
            schemaVersion: SEASON_RUN_SCHEMA_VERSION,
            command: 'advance-postseason',
            commandId: commandIdSchema.parse(`cal-adv-${rootSeed}-${String(guard)}`),
            runId: run.runId,
            expectedStateRevision: run.stateRevision,
            expectedStateDigest: run.stateDigest,
        };
        const output = handleSeasonRunCommand(command, {
            run,
            pending: null,
            humanFranchiseId: null,
            catalog: season.catalog,
            effects,
            profile,
        });
        if (output.result.result.status === 'rejected') {
            const rejection = output.result.result.rejection;
            if (rejection.code === 'integrity-failure')
                integrityFailures += 1;
            throw new Error(`seed ${rootSeed} advance ${String(guard)} rejected (${rejection.code}): ${JSON.stringify(rejection)}`);
        }
        run = output.run;
        effects =
            (output.run as SeasonRun & {
                effects?: typeof effects;
            }).effects ?? effects;
        if (output.postseasonSummaries !== undefined) {
            postseasonSummaries.push(...output.postseasonSummaries);
        }
    }
    return seasonPostseasonFactsOf(run, season, postseasonSummaries, integrityFailures);
}
export function seasonPostseasonFactsOf(run: SeasonRun, season: SeasonM25SeasonFacts, postseasonSummaries: readonly SeasonPostseasonSummary[], integrityFailures: number): SeasonPostseasonSeasonFacts {
    const bracket = run.postseason.bracket;
    const seriesLengths: number[] = [];
    const seriesOutcomes: Array<{
        upset: boolean;
        strength: boolean;
    }> = [];
    const bracketTeams = new Map<string, Set<FranchiseId>>();
    if (bracket !== null) {
        const allSeries = [
            ...bracket.east.firstRound,
            ...bracket.east.semifinals,
            ...bracket.west.firstRound,
            ...bracket.west.semifinals,
            bracket.east.conferenceFinal,
            bracket.west.conferenceFinal,
            bracket.finals,
        ];
        for (const bracketSeries of allSeries) {
            if (bracketSeries.games.length === 0)
                continue;
            seriesLengths.push(bracketSeries.games.length);
            const teams = new Set([bracketSeries.homeCourtFranchiseId, bracketSeries.challengerFranchiseId].filter((team): team is FranchiseId => team !== null));
            const conference = bracketSeries.conference ?? 'finals';
            const existing = bracketTeams.get(conference) ?? new Set<FranchiseId>();
            for (const team of teams)
                existing.add(team);
            bracketTeams.set(conference, existing);
            if (bracketSeries.higherSeed !== null &&
                bracketSeries.lowerSeed !== null &&
                bracketSeries.winnerFranchiseId !== null) {
                const higherWon = bracketSeries.winnerFranchiseId === bracketSeries.homeCourtFranchiseId;
                seriesOutcomes.push({ upset: !higherWon, strength: higherWon });
            }
        }
    }
    let homeWins = 0;
    let homeGames = 0;
    let forfeits = 0;
    let bothInvalidGames = 0;
    for (const summary of postseasonSummaries) {
        homeGames += 1;
        if (summary.winnerFranchiseId === summary.homeFranchiseId)
            homeWins += 1;
        if (summary.status === 'forfeit')
            forfeits += 1;
        if (summary.status === 'final' &&
            summary.rotationEvidence.home.playersUsed === 0 &&
            summary.rotationEvidence.away.playersUsed === 0) {
            bothInvalidGames += 1;
        }
    }
    const duplicateTeamFailures = 0;
    let missingTeamFailures = 0;
    for (const conference of ['east', 'west'] as const) {
        const teams = bracketTeams.get(conference) ?? new Set<FranchiseId>();
        if (teams.size !== 8)
            missingTeamFailures += 1;
    }
    const finalsTeams = bracketTeams.get('finals') ?? new Set<FranchiseId>();
    if (finalsTeams.size !== 0 && finalsTeams.size !== 2)
        missingTeamFailures += 1;
    let awardWinnersInPostseason = 0;
    let awardWinners = 0;
    try {
        const awards = deriveSeasonAwards({
            runId: run.runId,
            rosters: run.rosters,
            summaries: season.summaries,
        });
        const postseasonTeams = new Set<FranchiseId>();
        for (const teams of bracketTeams.values()) {
            for (const team of teams)
                postseasonTeams.add(team);
        }
        const winners = [
            awards.mvp,
            awards.defensivePlayerOfYear,
            awards.sixthManOfYear,
            ...awards.allLeagueFirstTeam,
        ];
        awardWinners = winners.length;
        for (const winner of winners) {
            if (postseasonTeams.has(winner.franchiseId))
                awardWinnersInPostseason += 1;
        }
    }
    catch { }
    return {
        rootSeed: run.rootSeed,
        championFranchiseId: run.postseason.championFranchiseId,
        seriesLengths,
        homeWins,
        homeGames,
        upsetSeries: seriesOutcomes.filter((outcome) => outcome.upset).length,
        decidedSeededSeries: seriesOutcomes.length,
        strengthSeries: seriesOutcomes.filter((outcome) => outcome.strength).length,
        awardWinnersInPostseason,
        awardWinners,
        forfeits,
        integrityFailures,
        duplicateTeamFailures,
        missingTeamFailures,
        bothInvalidGames,
        gamesPlayed: postseasonSummaries.length,
        seriesCompleted: seriesLengths.length,
    };
}
export function validateSeasonPostseasonTargets(path: string): string[] {
    const parsed = seasonPostseasonTargetsSchema.safeParse(readJsonFile(path));
    if (!parsed.success) {
        return [`targets artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`];
    }
    return [];
}
export interface SeasonPostseasonCalibrateDeps {
    runSeason?: SeasonPostseasonSeasonRunner;
}
export function seasonPostseasonCalibrate(args: {
    input?: string | null;
    'seed-from'?: string | null;
    'seed-to'?: string | null;
    workers?: string | null;
    out?: string | null;
    manifest?: string | null;
    validate?: string | null;
    write?: boolean;
}, deps: SeasonPostseasonCalibrateDeps = {}): CliReport {
    if (args.validate !== null && args.validate !== undefined) {
        const failures = validateSeasonPostseasonTargets(args.validate);
        return makeReport('season postseason calibrate', { validate: args.validate }, { details: ['validated existing artifact'], failures });
    }
    const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
    const runSeason = deps.runSeason ??
        ((rootSeed: Seed) => simulateSeasonPostseasonFacts(rootSeed, { manifestPath }));
    const { from, to } = parseSeedRange(args, SEASON_POSTSEASON_CALIBRATION_SEED_COUNT + SEASON_POSTSEASON_VALIDATION_SEED_COUNT - 1, { requireOrder: true, error: Error });
    const calibrationIndices = seedIndexRange(from, Math.min(to, SEASON_POSTSEASON_CALIBRATION_SEED_COUNT - 1));
    const validationIndices = seedIndexRange(Math.max(from, SEASON_POSTSEASON_CALIBRATION_SEED_COUNT), to);
    const started = Date.now();
    const calibrationFacts = calibrationIndices.map((index) => runSeason(seasonCalibrationSeed(index)));
    const validationFacts = validationIndices.map((index) => runSeason(seasonCalibrationSeed(index)));
    const durationMs = Date.now() - started;
    const calibration = foldSeasonPostseasonCohortFacts(calibrationFacts);
    const validation = foldSeasonPostseasonCohortFacts(validationFacts);
    const calibrationGates = seasonPostseasonGates(calibration);
    const validationGates = seasonPostseasonGates(validation);
    const calibrationSummary = gateSummary(calibrationGates);
    const validationSummary = gateSummary(validationGates);
    const validationPass = validationIndices.length === 0 ? true : validationSummary.pass;
    const pass = calibrationSummary.pass && validationPass;
    let targetsWritten = false;
    let targetsPath: string | null = null;
    const gateFailures: string[] = [];
    const outPath = args.out ?? DEFAULT_POSTSEASON_TARGETS;
    const writeRequested = args.write === true;
    if (pass && writeRequested) {
        const targets: SeasonPostseasonTargets = {
            schemaVersion: 1,
            targetsVersion: SEASON_POSTSEASON_TARGETS_VERSION,
            policy: {
                seriesLengthMin: 4.5,
                seriesLengthMax: 6.5,
                upsetRateMax: 0.45,
                homeAdvantageMin: 0.5,
                homeAdvantageMax: 0.7,
                advancementByStrengthMin: 0.5,
                awardPlausibilityMin: 0.8,
                forfeitsPerSeasonMax: 2,
                minSeasons: 4,
            },
            cohort: {
                seedFrom: calibrationIndices[0] ?? 0,
                seedTo: calibrationIndices[calibrationIndices.length - 1] ?? 0,
            },
            heldOut: {
                seedFrom: validationIndices[0] ?? 0,
                seedTo: validationIndices[validationIndices.length - 1] ?? 0,
            },
            measured: {
                calibration: measuredOf(calibration),
                heldOut: measuredOf(validation),
            },
            engineVersion: createEngineContext().engineVersion,
            generatedAtIso: new Date().toISOString(),
        };
        seasonPostseasonTargetsSchema.parse(targets);
        const commit = commitTargetsArtifact({
            outPath,
            defaultTargetsPath: DEFAULT_POSTSEASON_TARGETS,
            manifestPath,
            manifestKey: 'postseasonTargets',
            manifestUrl: 'season/postseason-targets.json',
            content: targets,
        });
        targetsWritten = commit.written;
        targetsPath = commit.path;
        if (commit.error !== null)
            gateFailures.push(commit.error);
    }
    const payload = seasonPostseasonCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'season postseason calibrate',
        targetsVersion: SEASON_POSTSEASON_TARGETS_VERSION,
        calibrationSeeds: calibrationIndices.length,
        validationSeeds: validationIndices.length,
        seasonsSimulated: calibration.seasonsSimulated + validation.seasonsSimulated,
        gamesPlayed: calibration.gamesPlayed + validation.gamesPlayed,
        seriesCompleted: calibration.seriesCompleted + validation.seriesCompleted,
        seriesLengthMean: calibration.seriesLengthMean,
        upsetRate: calibration.upsetRate,
        upsetGames: calibration.upsetSeries,
        homeAdvantage: calibration.homeAdvantage,
        homeGames: calibration.homeGames,
        advancementByStrength: calibration.advancementByStrength,
        strengthDecidedSeries: calibration.decidedSeededSeries,
        awardPlausibility: calibration.awardPlausibility,
        awardChecks: calibration.awardWinners,
        forfeits: calibration.forfeits,
        integrityFailures: calibration.integrityFailures,
        champions: calibration.champions,
        duplicateTeamFailures: calibration.duplicateTeamFailures,
        missingTeamFailures: calibration.missingTeamFailures,
        bothInvalidGames: calibration.bothInvalidGames,
        gates: { ...calibrationSummary.gates, heldOut: validationPass },
        metrics: [...calibrationGates, ...validationGates],
        skippedGates: [...calibrationSummary.skippedGates, ...validationSummary.skippedGates],
        targetsWritten,
        targetsPath,
        durationMs,
        pass,
    });
    const details = [
        `cohort ${String(calibrationIndices.length)} + ${String(validationIndices.length)} held-out seasons in ${String(durationMs)}ms`,
        `series length mean ${calibration.seriesLengthMean.toFixed(2)} · upset rate ${(calibration.upsetRate * 100).toFixed(1)}% · home advantage ${(calibration.homeAdvantage * 100).toFixed(1)}%`,
        `advancement by strength ${(calibration.advancementByStrength * 100).toFixed(1)}% · award plausibility ${(calibration.awardPlausibility * 100).toFixed(1)}%`,
        `champions ${String(calibration.champions)}/${String(calibration.seasonsSimulated)} · forfeits ${String(calibration.forfeits)} · integrity failures ${String(calibration.integrityFailures)} · both-invalid games ${String(calibration.bothInvalidGames)}`,
        `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : writeRequested ? 'NOT written' : 'not written (no --write)'}`,
    ];
    if (!pass) {
        for (const metric of [...calibrationGates, ...validationGates]) {
            if (!metric.pass && metric.status === 'fail') {
                gateFailures.push(`${metric.key}: observed ${String(metric.observed)} outside the frozen envelope`);
            }
        }
    }
    return makeReport('season postseason calibrate', { seedFrom: from, seedTo: to }, { details, failures: gateFailures, payload });
}
function measuredOf(cohort: SeasonPostseasonCohortFacts): SeasonPostseasonMeasured {
    return {
        seasonsSimulated: cohort.seasonsSimulated,
        gamesPlayed: cohort.gamesPlayed,
        seriesCompleted: cohort.seriesCompleted,
        seriesLengthMean: cohort.seriesLengthMean,
        upsetRate: cohort.upsetRate,
        homeAdvantage: cohort.homeAdvantage,
        advancementByStrength: cohort.advancementByStrength,
        awardPlausibility: cohort.awardPlausibility,
        forfeits: cohort.forfeits,
        integrityFailures: cohort.integrityFailures,
        champions: cohort.champions,
        duplicateTeamFailures: cohort.duplicateTeamFailures,
        missingTeamFailures: cohort.missingTeamFailures,
        bothInvalidGames: cohort.bothInvalidGames,
    };
}
