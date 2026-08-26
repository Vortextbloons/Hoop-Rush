import { readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { createChallenge, createEngineContext, simulateChallenge } from '@hoop-rush/engine';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';
import { benchmarkReportSchema, type BenchmarkReport } from '../report-schemas.ts';
import { loadPackagedData, PackagedData, REPO_ROOT } from './data-loader.ts';
import { lineupForTeam, resolveUserTeam } from './challenge.ts';
import { buildInput, chunkRange, fixtureSeed, loadFixture, runSingleGame } from './sim.ts';
import { parseCount } from '../args.ts';
export const BENCHMARK_OPTIONS: Record<string, boolean> = {
    fixture: true,
    samples: true,
    'seed-from': true,
    'seed-to': true,
    workers: true,
    profile: true,
    baseline: true,
    'write-baseline': true,
    format: true,
    verbose: false,
};
function stats(samples: readonly number[]): {
    medianMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
} {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1] ?? 0;
    return {
        medianMs: median,
        p95Ms: p95,
        minMs: sorted[0] ?? 0,
        maxMs: sorted[sorted.length - 1] ?? 0,
    };
}
function resolveBaselinePath(value: string): string {
    return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
type TimedMetric = {
    sampleCount: number;
    medianMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
};
function compareBaseline(current: BenchmarkReport, baseline: BenchmarkReport, details: string[]): {
    failures: string[];
    comparison: BenchmarkReport['baselineComparison'];
} {
    if (baseline.environment.fingerprint !== current.environment.fingerprint) {
        details.push('baseline comparison skipped: environment fingerprint does not match');
        return {
            failures: [],
            comparison: {
                status: 'skipped-fingerprint',
                fingerprintMatched: false,
                baselineFingerprint: baseline.environment.fingerprint,
                regressions: [],
            },
        };
    }
    details.push('baseline environment fingerprint matched');
    const comparisons: Array<{
        id: 'poolCold' | 'poolCached' | 'singleGame' | 'challenge82';
        label: string;
        noiseMs: number;
    }> = [
        { id: 'poolCold', label: 'pool cold', noiseMs: 2 },
        { id: 'poolCached', label: 'pool cached', noiseMs: 2 },
        { id: 'singleGame', label: 'warm single game', noiseMs: 2 },
        { id: 'challenge82', label: '82-game run', noiseMs: 50 },
    ];
    const failures: string[] = [];
    const regressions: BenchmarkReport['baselineComparison']['regressions'] = [];
    for (const comparison of comparisons) {
        const currentMetric: TimedMetric = current[comparison.id];
        const baselineMetric: TimedMetric = baseline[comparison.id];
        for (const metric of ['medianMs', 'p95Ms'] as const) {
            const increase = currentMetric[metric] - baselineMetric[metric];
            if (currentMetric[metric] > baselineMetric[metric] * 1.25 && increase > comparison.noiseMs) {
                regressions.push({
                    metric,
                    measurement: comparison.id,
                    baselineMs: baselineMetric[metric],
                    currentMs: currentMetric[metric],
                    noiseAllowanceMs: comparison.noiseMs,
                });
                failures.push(`${comparison.label} ${metric} regressed from ${baselineMetric[metric].toFixed(2)} ms to ${currentMetric[metric].toFixed(2)} ms`);
            }
        }
    }
    return {
        failures,
        comparison: {
            status: regressions.length > 0 ? 'regressed' : 'matched',
            fingerprintMatched: true,
            baselineFingerprint: baseline.environment.fingerprint,
            regressions,
        },
    };
}
export function benchmark(args: {
    fixture?: string;
    samples?: string;
    'seed-from'?: string;
    'seed-to'?: string;
    workers?: string;
    profile?: string;
    baseline?: string;
    'write-baseline'?: string;
}): CliReport {
    const fixtureId = args.fixture ?? 'equal';
    const samples = parseCount(args.samples, '--samples', 50);
    const seedFrom = parseCount(args['seed-from'], '--seed-from', 0);
    const workers = Math.max(1, parseCount(args.workers, '--workers', 1));
    const context = createEngineContext();
    const packaged = loadPackagedData();
    const data = new PackagedData(packaged.manifest, packaged.dir);
    const profile = data.eraProfile();
    const bracket = data.bracket();
    const fixture = loadFixture(fixtureId);
    const heapBeforeMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const poolColdSamples: number[] = [];
    for (let i = 0; i < samples; i += 1) {
        const coldData = new PackagedData(packaged.manifest, packaged.dir);
        const started = performance.now();
        coldData.pool('lakers', '1990s');
        poolColdSamples.push(performance.now() - started);
    }
    const cachedData = new PackagedData(packaged.manifest, packaged.dir);
    cachedData.pool('lakers', '1990s');
    const poolCachedSamples: number[] = [];
    for (let i = 0; i < samples; i += 1) {
        const started = performance.now();
        cachedData.pool('lakers', '1990s');
        poolCachedSamples.push(performance.now() - started);
    }
    for (let i = 0; i < 20; i += 1) {
        void runSingleGame(buildInput(fixture, profile, fixtureSeed('bench-warm', i), false));
    }
    const singleSamples: number[] = [];
    for (const chunk of chunkRange(seedFrom, seedFrom + samples - 1, workers)) {
        for (let i = chunk.from; i <= chunk.to; i += 1) {
            const input = buildInput(fixture, profile, fixtureSeed('bench-game', i), false);
            const started = performance.now();
            runSingleGame(input);
            singleSamples.push(performance.now() - started);
        }
    }
    const userTeam = resolveUserTeam('challenge-user');
    const { lineup, players } = lineupForTeam(userTeam);
    const pool = data.pool('lakers', '1990s');
    const samplePlayer = pool.players[0];
    const challengeSamples: number[] = [];
    for (let i = 0; i < samples; i += 1) {
        const started = performance.now();
        const run = createChallenge({
            runId: `bench-${String(i)}`,
            mode: 'sandbox',
            franchiseId: 'lakers',
            eraId: '1990s',
            homeDisplayName: userTeam.displayName,
            lineup,
            players,
            selections: players.map((player) => ({
                playerId: player.playerId,
                franchiseId: 'lakers',
                eraId: '1990s',
            })),
            runSeed: fixtureSeed('bench-challenge', i),
            dataVersion: profile.dataVersion,
            ratingVersion: samplePlayer?.source.ratingsVersion ?? 'unknown',
            positionNormalizationVersion: samplePlayer?.positions.normalizationVersion ?? 'position-v1',
            engineVersion: context.engineVersion,
            profile,
            bracket,
        });
        simulateChallenge(run, profile, context);
        challengeSamples.push(performance.now() - started);
    }
    const single = stats(singleSamples);
    const challenge = stats(challengeSamples);
    const heapAfterMb = process.memoryUsage().heapUsed / 1024 / 1024;
    const fingerprint = [
        process.version,
        process.platform,
        process.arch,
        String(cpus().length),
        context.engineVersion,
        packaged.manifest.dataVersion,
        profile.profileVersion,
        bracket.bracketVersion,
        bracket.scheduleVersion,
    ].join('|');
    const payload = benchmarkReportSchema.parse({
        schemaVersion: 2,
        command: 'benchmark',
        environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpus: cpus().length,
            fingerprint,
        },
        engineVersion: context.engineVersion,
        dataVersion: packaged.manifest.dataVersion,
        profileVersion: profile.profileVersion,
        bracketVersion: bracket.bracketVersion,
        scheduleVersion: bracket.scheduleVersion,
        fixture: fixtureId,
        samples,
        workers,
        poolCold: { ...stats(poolColdSamples), sampleCount: samples },
        poolCached: { ...stats(poolCachedSamples), sampleCount: samples },
        singleGame: { ...single, sampleCount: samples },
        challenge82: { ...challenge, sampleCount: samples },
        heapUsedMb: Math.round(heapAfterMb * 100) / 100,
        heap: {
            beforeMb: Math.round(heapBeforeMb * 100) / 100,
            afterMb: Math.round(heapAfterMb * 100) / 100,
            deltaMb: heapAfterMb - heapBeforeMb,
        },
        baselineComparison: {
            status: 'not-requested',
            fingerprintMatched: false,
            baselineFingerprint: null,
            regressions: [],
        },
    });
    const details = [
        `environment: node ${payload.environment.node} · ${payload.environment.platform}/${payload.environment.arch} · ${String(payload.environment.cpus)} cpus`,
        `environment fingerprint: ${payload.environment.fingerprint}`,
        `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · bracket ${payload.bracketVersion} · schedule ${payload.scheduleVersion}`,
        `pool cold (${String(samples)} samples): median ${payload.poolCold.medianMs.toFixed(2)} ms · p95 ${payload.poolCold.p95Ms.toFixed(2)} ms`,
        `pool cached (${String(samples)} samples): median ${payload.poolCached.medianMs.toFixed(2)} ms · p95 ${payload.poolCached.p95Ms.toFixed(2)} ms`,
        `single game (${String(samples)} warm samples): median ${single.medianMs.toFixed(2)} ms · p95 ${single.p95Ms.toFixed(2)} ms · min ${single.minMs.toFixed(2)} · max ${single.maxMs.toFixed(2)}`,
        `82-game run (${String(samples)} samples): median ${challenge.medianMs.toFixed(2)} ms · p95 ${challenge.p95Ms.toFixed(2)} ms · min ${challenge.minMs.toFixed(2)} · max ${challenge.maxMs.toFixed(2)}`,
        `heap used ${String(payload.heapUsedMb)} MB · delta ${payload.heap.deltaMb.toFixed(2)} MB`,
    ];
    if (args['write-baseline']) {
        const path = resolveBaselinePath(args['write-baseline']);
        try {
            writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
            details.push(`baseline written to ${path}`);
        }
        catch (error) {
            return makeReport('benchmark', { fixture: fixtureId, samples, workers }, {
                details,
                failures: [`cannot write baseline ${path}: ${errorMessage(error)}`],
                exitCode: EXIT_USAGE_OR_DATA_ERROR,
                payload,
            });
        }
    }
    let failures: string[] = [];
    if (args.baseline) {
        const path = resolveBaselinePath(args.baseline);
        try {
            const baseline = benchmarkReportSchema.parse(JSON.parse(readFileSync(path, 'utf8')) as unknown);
            const comparison = compareBaseline(payload, baseline, details);
            payload.baselineComparison = comparison.comparison;
            failures = comparison.failures;
        }
        catch (error) {
            return makeReport('benchmark', { fixture: fixtureId, samples, workers, baseline: path }, {
                details,
                failures: [`cannot read benchmark baseline ${path}: ${errorMessage(error)}`],
                exitCode: EXIT_USAGE_OR_DATA_ERROR,
                payload,
            });
        }
    }
    if (payload.singleGame.medianMs >= 15) {
        failures.push(`warm single game median ${payload.singleGame.medianMs.toFixed(2)} ms exceeds the hard 15 ms gate`);
    }
    if (payload.singleGame.p95Ms >= 40) {
        failures.push(`warm single game p95 ${payload.singleGame.p95Ms.toFixed(2)} ms exceeds the 40 ms contention guard`);
    }
    return makeReport('benchmark', { fixture: fixtureId, samples, workers, ...(args.baseline ? { baseline: args.baseline } : {}) }, { details, failures, payload });
}
