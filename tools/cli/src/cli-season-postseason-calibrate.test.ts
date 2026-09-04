import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, withTmpDir } from './cli-test-helpers.ts';
import { seasonPostseasonCalibrateReportSchema } from './report-schemas.ts';
import { foldSeasonPostseasonCohortFacts, seasonPostseasonCalibrate, seasonPostseasonGates, seasonPostseasonTargetsSchema, type SeasonPostseasonSeasonFacts, } from './commands/season-postseason-calibrate.ts';
const INTEGRATION_RUNS = process.env.HOOP_RUSH_INTEGRATION_RUNS === '1';
function cleanSeason(rootSeed: string, length = 5): SeasonPostseasonSeasonFacts {
    return {
        rootSeed,
        championFranchiseId: 'lakers',
        seriesLengths: [
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
            length,
        ],
        homeWins: 6,
        homeGames: 10,
        upsetSeries: 1,
        decidedSeededSeries: 14,
        strengthSeries: 13,
        awardWinnersInPostseason: 6,
        awardWinners: 7,
        forfeits: 0,
        integrityFailures: 0,
        duplicateTeamFailures: 0,
        missingTeamFailures: 0,
        bothInvalidGames: 0,
        gamesPlayed: 40,
        seriesCompleted: 15,
    };
}
describe('season postseason calibrate fold and gates (postseason-targets-v1)', () => {
    it('folds seasons into cohort facts with exactly one champion per season', () => {
        const cohort = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            cleanSeason('1'.repeat(32)),
        ]);
        expect(cohort.seasonsSimulated).toBe(2);
        expect(cohort.champions).toBe(2);
        expect(cohort.seriesCompleted).toBe(30);
        expect(cohort.seriesLengthMean).toBe(5);
        expect(cohort.upsetRate).toBe(1 / 14);
        expect(cohort.homeAdvantage).toBe(0.6);
        expect(cohort.advancementByStrength).toBe(13 / 14);
        expect(cohort.awardPlausibility).toBe(6 / 7);
        expect(cohort.forfeits).toBe(0);
        expect(cohort.integrityFailures).toBe(0);
        expect(cohort.duplicateTeamFailures).toBe(0);
        expect(cohort.missingTeamFailures).toBe(0);
        expect(cohort.bothInvalidGames).toBe(0);
    });
    it('passes every gate for a healthy cohort and fails each violation class', () => {
        const good = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            cleanSeason('1'.repeat(32)),
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        const gates = seasonPostseasonGates(good);
        for (const gate of gates) {
            expect([gate.key, gate.status]).toEqual([gate.key, 'pass']);
        }
        const noChampion = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), championFranchiseId: null },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        const championGate = seasonPostseasonGates(noChampion).find((gate) => gate.key === 'championPerSeason');
        expect(championGate?.status).toBe('fail');
        const duplicateTeams = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), duplicateTeamFailures: 1 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        const duplicateGate = seasonPostseasonGates(duplicateTeams).find((gate) => gate.key === 'zeroDuplicateTeams');
        expect(duplicateGate?.status).toBe('fail');
        const missingTeams = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), missingTeamFailures: 1 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        expect(seasonPostseasonGates(missingTeams).find((g) => g.key === 'zeroMissingTeams')?.status).toBe('fail');
        const bothInvalid = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), bothInvalidGames: 1 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        expect(seasonPostseasonGates(bothInvalid).find((g) => g.key === 'zeroBothInvalidGames')?.status).toBe('fail');
        const integrity = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), integrityFailures: 1 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        expect(seasonPostseasonGates(integrity).find((g) => g.key === 'zeroIntegrityFailures')?.status).toBe('fail');
        const forfeits = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), forfeits: 9 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        expect(seasonPostseasonGates(forfeits).find((g) => g.key === 'forfeitRate')?.status).toBe('fail');
        const upsets = foldSeasonPostseasonCohortFacts([
            cleanSeason('0'.repeat(32)),
            { ...cleanSeason('1'.repeat(32)), upsetSeries: 30, strengthSeries: 5 },
            cleanSeason('2'.repeat(32)),
            cleanSeason('3'.repeat(32)),
        ]);
        expect(seasonPostseasonGates(upsets).find((g) => g.key === 'upsetRate')?.status).toBe('fail');
    });
    it('skips gates below the minimum sample instead of passing', () => {
        const tiny = foldSeasonPostseasonCohortFacts([cleanSeason('0'.repeat(32))]);
        const gates = seasonPostseasonGates(tiny);
        expect(gates.every((gate) => gate.status === 'skippedInsufficientSample')).toBe(true);
        expect(gates.every((gate) => !gate.pass)).toBe(true);
    });
});
describe('season postseason calibrate command (postseason-targets-v1)', () => {
    it('measures an injected cohort and writes the artifact only with --write', async () => {
        await withTmpDir((dir) => {
            const seeds = ['0'.repeat(32), '1'.repeat(32), '2'.repeat(32), '3'.repeat(32)];
            const runSeason = (rootSeed: string) => cleanSeason(rootSeed, seeds.indexOf(rootSeed) % 2 === 0 ? 5 : 6);
            const report = seasonPostseasonCalibrate({
                input: null,
                'seed-from': '0',
                'seed-to': '3',
                workers: null,
                out: join(dir, 'postseason-targets.json'),
                manifest: null,
                validate: null,
                write: false,
            }, { runSeason });
            expect(report.exitCode).toBe(0);
            const payload = seasonPostseasonCalibrateReportSchema.parse(report.payload);
            expect(payload.pass).toBe(true);
            expect(payload.targetsWritten).toBe(false);
            expect(payload.champions).toBe(4);
            expect(payload.duplicateTeamFailures).toBe(0);
            expect(payload.missingTeamFailures).toBe(0);
            expect(payload.bothInvalidGames).toBe(0);
            expect(payload.gates.championPerSeason).toBe(true);
            expect(payload.gates.zeroDuplicateTeams).toBe(true);
            expect(payload.gates.zeroMissingTeams).toBe(true);
            expect(payload.gates.zeroBothInvalidGames).toBe(true);
            expect(payload.gates.heldOut).toBe(true);
            const written = seasonPostseasonCalibrate({
                input: null,
                'seed-from': '0',
                'seed-to': '3',
                workers: null,
                out: join(dir, 'postseason-targets.json'),
                manifest: null,
                validate: null,
                write: true,
            }, { runSeason });
            expect(written.exitCode).toBe(0);
            const writtenPayload = seasonPostseasonCalibrateReportSchema.parse(written.payload);
            expect(writtenPayload.targetsWritten).toBe(true);
            expect(writtenPayload.targetsPath).toBe(join(dir, 'postseason-targets.json'));
            const artifact = seasonPostseasonTargetsSchema.parse(JSON.parse(readFileSync(join(dir, 'postseason-targets.json'), 'utf8')));
            expect(artifact.targetsVersion).toBe('postseason-targets-v1');
            expect(artifact.measured.calibration.champions).toBe(4);
            expect(artifact.measured.calibration.duplicateTeamFailures).toBe(0);
        });
    });
    it('fails the report when a cohort violates the champion invariant', () => {
        const runSeason = (rootSeed: string) => rootSeed === '0'.repeat(31) + '1'
            ? { ...cleanSeason(rootSeed), championFranchiseId: null }
            : cleanSeason(rootSeed);
        const report = seasonPostseasonCalibrate({
            input: null,
            'seed-from': '0',
            'seed-to': '3',
            workers: null,
            out: null,
            manifest: null,
            validate: null,
            write: false,
        }, { runSeason });
        expect(report.exitCode).toBe(1);
        const payload = seasonPostseasonCalibrateReportSchema.parse(report.payload);
        expect(payload.pass).toBe(false);
        expect(payload.gates.championPerSeason).toBe(false);
        expect(report.failures.some((failure) => failure.includes('championPerSeason'))).toBe(true);
    });
    it('runs end-to-end through the CLI on a missing targets artifact', async () => {
        const { code, stderr } = await runCli([
            'season',
            'postseason',
            'calibrate',
            '--validate',
            'missing.json',
            '--format',
            'json',
        ]);
        expect(code).toBe(1);
        expect(stderr).toContain('missing.json');
    });
});
describe.skipIf(!INTEGRATION_RUNS)('season postseason calibrate (integration-run)', () => {
    it('freezes postseason-targets-v1 over real seasons with all gates passing', async () => {
        const { seasonPostseasonCalibrate, DEFAULT_POSTSEASON_TARGETS } = await import('./commands/season-postseason-calibrate.ts');
        const report = seasonPostseasonCalibrate({
            input: null,
            'seed-from': '0',
            'seed-to': '1',
            workers: '1',
            out: null,
            manifest: null,
            validate: null,
            write: true,
        });
        expect(report.exitCode).toBe(0);
        const payload = seasonPostseasonCalibrateReportSchema.parse(report.payload);
        expect(payload.pass).toBe(true);
        expect(payload.targetsWritten).toBe(true);
        void DEFAULT_POSTSEASON_TARGETS;
    }, 1800000);
});
