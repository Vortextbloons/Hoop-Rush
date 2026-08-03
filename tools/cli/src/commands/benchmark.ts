import { cpus } from 'node:os';
import { createChallenge, createEngineContext, simulateChallenge } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.js';
import { benchmarkReportSchema } from '../report-schemas.js';
import { loadPackagedData, PackagedData } from './data-loader.js';
import { lineupForTeam, resolveUserTeam } from './challenge.js';
import { buildInput, loadFixture, runSingleGame, UsageError } from './sim.js';

/**
 * `benchmark` (spec/09 target): measures warm single-game and complete
 * 82-game simulation throughput and reports environment, versions, sample
 * size, median, p95, and memory. Output is evidence; stable reference-hardware
 * thresholds become CI gates later.
 */

export const BENCHMARK_OPTIONS: Record<string, boolean> = {
  fixture: true,
  samples: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  profile: true,
  format: true,
  verbose: false,
};

function parseCount(value: string | undefined, option: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`${option} must be a nonnegative integer (got "${value}")`);
  }
  return parsed;
}

function seedFor(prefix: string, index: number): string {
  let hash = 0x811c9dc5;
  const value = `${prefix}-${String(index)}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
}

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

export function benchmark(args: {
  fixture?: string;
  samples?: string;
  'seed-from'?: string;
  'seed-to'?: string;
  workers?: string;
  profile?: string;
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

  // Warm-up: JIT and module initialization settle before measurement.
  for (let i = 0; i < 20; i += 1) {
    void runSingleGame(buildInput(fixture, profile, seedFor('bench-warm', i), false));
  }

  const singleSamples: number[] = [];
  const chunkSize = Math.ceil(samples / workers);
  const chunks: Array<{ from: number; to: number }> = [];
  for (let from = seedFrom; from < seedFrom + samples; from += chunkSize) {
    chunks.push({ from, to: Math.min(seedFrom + samples - 1, from + chunkSize - 1) });
  }
  for (const chunk of chunks) {
    for (let i = chunk.from; i <= chunk.to; i += 1) {
      const input = buildInput(fixture, profile, seedFor('bench-game', i), false);
      const started = performance.now();
      runSingleGame(input);
      singleSamples.push(performance.now() - started);
    }
  }

  // Complete 82-game runs against the packaged bracket (always finishes 82).
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
      runSeed: seedFor('bench-challenge', i),
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
  const memoryMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const payload = benchmarkReportSchema.parse({
    schemaVersion: 1,
    command: 'benchmark',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
    },
    engineVersion: context.engineVersion,
    dataVersion: profile.dataVersion,
    profileVersion: profile.profileVersion,
    bracketVersion: bracket.bracketVersion,
    scheduleVersion: bracket.scheduleVersion,
    fixture: fixtureId,
    samples,
    workers,
    singleGame: { ...single, sampleCount: samples },
    challenge82: { ...challenge, sampleCount: samples },
    heapUsedMb: Math.round(memoryMb * 100) / 100,
  });

  const details = [
    `environment: node ${payload.environment.node} · ${payload.environment.platform}/${payload.environment.arch} · ${String(payload.environment.cpus)} cpus`,
    `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · bracket ${payload.bracketVersion} · schedule ${payload.scheduleVersion}`,
    `single game (${String(samples)} warm samples): median ${single.medianMs.toFixed(2)} ms · p95 ${single.p95Ms.toFixed(2)} ms · min ${single.minMs.toFixed(2)} · max ${single.maxMs.toFixed(2)}`,
    `82-game run (${String(samples)} samples): median ${challenge.medianMs.toFixed(2)} ms · p95 ${challenge.p95Ms.toFixed(2)} ms · min ${challenge.minMs.toFixed(2)} · max ${challenge.maxMs.toFixed(2)}`,
    `heap used ${String(payload.heapUsedMb)} MB`,
  ];
  return makeReport('benchmark', { fixture: fixtureId, samples, workers }, { details, payload });
}
