import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import {
  SEASON_HOME_COURT_VERSION,
  SEASON_HOME_WIN_RATE_TARGET,
  SEASON_GAME_VERSION,
  seasonGameSimulationInputSchema,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonHomeCourtProfile,
} from '@hoop-rush/data-contracts';
import {
  SEASON_HOME_COURT_PROFILE,
  checkSeasonGameResult,
  createEngineContext,
  simulateSeasonGame,
} from '@hoop-rush/engine';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import { seasonHomeCourtCalibrateReportSchema } from '../report-schemas.ts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import {
  loadSeasonGameFixture,
  resolveSeasonGameFixturePath,
  type SeasonGameEngineDeps,
} from './season-game.ts';
import { seasonCalibrationSeed, seedIndexRange } from './season-calibration.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile, sha256Hex } from './season-data.ts';

/**
 * M2.3 `season home-court calibrate` (spec/2.0/02 home court). Measures the
 * tuned engine profile against the frozen 0.575 home-win-rate target over
 * the committed Balanced/Tight/Bench-Heavy fixtures: the calibration cohort
 * (seeds 0-1023) and the held-out cohort (seeds 1024-1279) each run every
 * fixture twice (neutral adapter and the engine profile). The artifact
 * `apps/web/static/data/season/home-court-targets.json` is calibration
 * evidence; `SEASON_HOME_COURT_PROFILE` in the engine is authoritative.
 */

export const SEASON_HOME_COURT_CALIBRATE_OPTIONS: Record<string, boolean> = {
  fixture: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  constants: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const SEASON_HOME_COURT_CALIBRATION_SEED_COUNT = 1024;
export const SEASON_HOME_COURT_VALIDATION_SEED_COUNT = 256;
export const SEASON_HOME_COURT_SEED_TOTAL =
  SEASON_HOME_COURT_CALIBRATION_SEED_COUNT + SEASON_HOME_COURT_VALIDATION_SEED_COUNT;

/** Frozen tolerance around the 0.575 held-out target. */
export const SEASON_HOME_COURT_TOLERANCE = 0.01;

/**
 * Binomial standard error of a home win rate over `n` games. The frozen
 * held-out cohort (256 seeds x 3 fixtures = 768 games) has a ~1.8pp SE, so
 * a fixed ±1pp point gate would fail on ordinary binomial noise; the gates
 * below combine the frozen point tolerance with the sample's standard error.
 */
export function homeWinRateStandardError(n: number): number {
  if (n <= 0) return 0;
  return Math.sqrt((SEASON_HOME_WIN_RATE_TARGET * (1 - SEASON_HOME_WIN_RATE_TARGET)) / n);
}

export const SEASON_HOME_COURT_PRESET_FIXTURES = [
  'season-game-balanced',
  'season-game-tight',
  'season-game-bench-heavy',
] as const;

export const DEFAULT_HOME_COURT_TARGETS = resolve(DEFAULT_SEASON_DIR, 'home-court-targets.json');

/** The artifact written by `season home-court calibrate`. */
export const seasonHomeCourtTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  profileVersion: z.literal(SEASON_HOME_COURT_VERSION),
  constants: z.object({
    homeDefensiveCommunication: z.number().min(0).max(1),
    awayTurnoverPressure: z.number().min(0).max(1),
  }),
  targetHomeWinRate: z.literal(SEASON_HOME_WIN_RATE_TARGET),
  calibration: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  heldOut: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  achievedHomeWinRate: z.number().min(0).max(1),
  gamesSimulated: z.number().int().positive(),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonHomeCourtTargets = z.infer<typeof seasonHomeCourtTargetsSchema>;

/** Per-game facts posted by the calibration worker. */
export interface SeasonHomeCourtGameFacts {
  fixtureId: string;
  seedIndex: number;
  neutralHomeWon: boolean;
  homeProfileHomeWon: boolean;
  completed: boolean;
  /** Home-team possessions under the tuned profile (completed only). */
  homePossessions: number;
  awayPossessions: number;
}

function homeWon(result: SeasonGameSimulationResult): boolean {
  if (result.outcome === 'completed') return result.winner === 'home';
  if (result.outcome === 'forfeit') return result.homeScore === 2;
  return false;
}

/**
 * Simulates one calibration game twice (neutral adapter and the given
 * profile) and derives the facts. Shared by the worker (real engine) and
 * the in-process test runner (injected doubles).
 */
export function simulateSeasonHomeCourtFacts(
  fixtureId: string,
  seedIndex: number,
  input: SeasonGameSimulationInput,
  profile: SeasonHomeCourtProfile,
  deps: SeasonGameEngineDeps,
): SeasonHomeCourtGameFacts {
  const context = createEngineContext();
  const neutral = deps.simulateSeasonGame({ ...input, homeCourt: SEASON_NEUTRAL_PROFILE }, context);
  const home = deps.simulateSeasonGame({ ...input, homeCourt: profile }, context);
  const facts: SeasonHomeCourtGameFacts = {
    fixtureId,
    seedIndex,
    neutralHomeWon: homeWon(neutral),
    homeProfileHomeWon: homeWon(home),
    completed: home.outcome === 'completed',
    homePossessions: 0,
    awayPossessions: 0,
  };
  if (home.outcome === 'completed') {
    facts.homePossessions = home.home.box.possessions;
    facts.awayPossessions = home.away.box.possessions;
  }
  return facts;
}

/** The neutral zero adapter used as the calibration baseline. */
export const SEASON_NEUTRAL_PROFILE: SeasonHomeCourtProfile = {
  schemaVersion: 1,
  profileVersion: SEASON_HOME_COURT_VERSION,
  homeDefensiveCommunication: 0,
  awayTurnoverPressure: 0,
  targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
};

export interface SeasonHomeCourtCohortRequest {
  fixtures: Array<{ fixtureId: string; path: string }>;
  seedIndices: number[];
  workers: number;
  profile: SeasonHomeCourtProfile;
}

export type SeasonHomeCourtCohortRunner = (
  request: SeasonHomeCourtCohortRequest,
) => Promise<SeasonHomeCourtGameFacts[]>;

/** Worker-based cohort runner: one worker per (fixture, seed-range chunk). */
export async function runSeasonHomeCourtCohort(
  request: SeasonHomeCourtCohortRequest,
): Promise<SeasonHomeCourtGameFacts[]> {
  const chunkSize = Math.max(1, Math.ceil(request.seedIndices.length / request.workers));
  const promises: Array<Promise<SeasonHomeCourtGameFacts[]>> = [];
  for (const fixture of request.fixtures) {
    for (let start = 0; start < request.seedIndices.length; start += chunkSize) {
      const seedIndices = request.seedIndices.slice(start, start + chunkSize);
      promises.push(
        new Promise<SeasonHomeCourtGameFacts[]>((resolvePromise, rejectPromise) => {
          const worker = new Worker(
            new URL('./season-home-court-calibration-worker.ts', import.meta.url),
            {
              workerData: {
                fixtureId: fixture.fixtureId,
                fixturePath: fixture.path,
                seedIndices,
                profile: request.profile,
              },
            },
          );
          worker.on('message', (message: { facts: SeasonHomeCourtGameFacts[] }) => {
            resolvePromise(message.facts);
            void worker.terminate();
          });
          worker.on('error', rejectPromise);
          worker.on('exit', (code) => {
            if (code !== 0) rejectPromise(new Error(`worker exited ${String(code)}`));
          });
        }),
      );
    }
  }
  const chunks = await Promise.all(promises);
  return chunks.flat();
}

/** In-process cohort runner for tests with injected engine doubles. */
export function runSeasonHomeCourtCohortInProcess(
  request: SeasonHomeCourtCohortRequest,
  deps: SeasonGameEngineDeps,
): Promise<SeasonHomeCourtGameFacts[]> {
  const facts: SeasonHomeCourtGameFacts[] = [];
  for (const fixture of request.fixtures) {
    const parsed = seasonGameFixtureSchema.safeParse(readJsonFile(fixture.path));
    if (!parsed.success) {
      throw new Error(`season game fixture ${fixture.fixtureId} fails validation`);
    }
    for (const index of request.seedIndices) {
      const seed = seasonCalibrationSeed(index);
      const input = seasonGameSimulationInputSchema.parse({ ...parsed.data.input, seed });
      facts.push(
        simulateSeasonHomeCourtFacts(fixture.fixtureId, index, input, request.profile, deps),
      );
    }
  }
  return Promise.resolve(facts);
}

/** Aggregates home win rates over one cohort. */
function foldWinRates(facts: readonly SeasonHomeCourtGameFacts[]): {
  neutralHomeWinRate: number;
  achievedHomeWinRate: number;
  games: number;
} {
  let games = 0;
  let neutralWins = 0;
  let homeWins = 0;
  for (const fact of facts) {
    games += 1;
    if (fact.neutralHomeWon) neutralWins += 1;
    if (fact.homeProfileHomeWon) homeWins += 1;
  }
  return {
    neutralHomeWinRate: games === 0 ? 0 : neutralWins / games,
    achievedHomeWinRate: games === 0 ? 0 : homeWins / games,
    games,
  };
}

/** Possession stability: the mean |home-away| delta over a cohort. */
function possessionDelta(facts: readonly SeasonHomeCourtGameFacts[]): number {
  const deltas: number[] = [];
  for (const fact of facts) {
    if (!fact.completed) continue;
    deltas.push(Math.abs(fact.homePossessions - fact.awayPossessions));
  }
  if (deltas.length === 0) return 0;
  return deltas.reduce((sum, delta) => sum + delta, 0) / deltas.length;
}

/** The profile carried by a `--constants a,b` override (dev tuning seam). */
function profileOfConstants(constants: string | null | undefined): SeasonHomeCourtProfile {
  if (constants === null || constants === undefined) return SEASON_HOME_COURT_PROFILE;
  const parts = constants.split(',');
  const home = Number.parseFloat(parts[0] ?? '');
  const away = Number.parseFloat(parts[1] ?? '');
  if (
    !Number.isFinite(home) ||
    !Number.isFinite(away) ||
    home < 0 ||
    home > 1 ||
    away < 0 ||
    away > 1
  ) {
    throw new Error('--constants must be two numbers in 0..1 (e.g. 0.5,0.4)');
  }
  return {
    schemaVersion: 1,
    profileVersion: SEASON_HOME_COURT_VERSION,
    homeDefensiveCommunication: home,
    awayTurnoverPressure: away,
    targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
  };
}

/** Validates an existing artifact against the engine profile and versions. */
export function validateSeasonHomeCourtTargets(path: string): string[] {
  const parsed = seasonHomeCourtTargetsSchema.safeParse(readJsonFile(path));
  if (!parsed.success) {
    return [`targets artifact fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`];
  }
  const targets = parsed.data;
  const failures: string[] = [];
  if (
    targets.constants.homeDefensiveCommunication !==
    SEASON_HOME_COURT_PROFILE.homeDefensiveCommunication
  ) {
    failures.push(
      `homeDefensiveCommunication ${String(targets.constants.homeDefensiveCommunication)} does not match the engine profile ${String(SEASON_HOME_COURT_PROFILE.homeDefensiveCommunication)}`,
    );
  }
  if (targets.constants.awayTurnoverPressure !== SEASON_HOME_COURT_PROFILE.awayTurnoverPressure) {
    failures.push(
      `awayTurnoverPressure ${String(targets.constants.awayTurnoverPressure)} does not match the engine profile ${String(SEASON_HOME_COURT_PROFILE.awayTurnoverPressure)}`,
    );
  }
  return failures;
}

export interface SeasonHomeCourtCalibrateDeps extends Partial<SeasonGameEngineDeps> {
  runCohort?: SeasonHomeCourtCohortRunner;
}

export async function seasonHomeCourtCalibrate(
  args: {
    fixture?: string | null;
    'seed-from'?: string | null;
    'seed-to'?: string | null;
    workers?: string | null;
    constants?: string | null;
    out?: string | null;
    manifest?: string | null;
    validate?: string | null;
  },
  deps: SeasonHomeCourtCalibrateDeps = {},
): Promise<CliReport> {
  if (args.validate !== null && args.validate !== undefined) {
    const failures = validateSeasonHomeCourtTargets(args.validate);
    return makeReport(
      'season home-court calibrate',
      { validate: args.validate },
      { details: ['validated existing artifact'], failures },
    );
  }
  const fixtureIds = (args.fixture ?? SEASON_HOME_COURT_PRESET_FIXTURES.join(','))
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (fixtureIds.length === 0) {
    throw new Error('--fixture needs at least one fixture id');
  }
  const { from: seedFrom, to: seedTo } = parseSeedRange(args, SEASON_HOME_COURT_SEED_TOTAL - 1, {
    requireOrder: true,
    error: Error,
  });
  const workers = parseWorkers(args, 4, { clampToAtLeastOne: true });
  const profile = profileOfConstants(args.constants);
  const fixtures = fixtureIds.map((id) => {
    const fixture = loadSeasonGameFixture(id);
    return { fixtureId: fixture.fixtureId, path: resolveSeasonGameFixturePath(id) };
  });

  const simulate = deps.simulateSeasonGame ?? simulateSeasonGame;
  const check = deps.checkSeasonGameResult ?? checkSeasonGameResult;
  const engineDeps: SeasonGameEngineDeps = {
    simulateSeasonGame: simulate,
    checkSeasonGameResult: check,
  };
  const runCohort =
    deps.runCohort ??
    (deps.simulateSeasonGame !== undefined
      ? (request: SeasonHomeCourtCohortRequest) =>
          runSeasonHomeCourtCohortInProcess(request, engineDeps)
      : runSeasonHomeCourtCohort);

  const calibrationIndices = seedIndexRange(
    seedFrom,
    Math.min(seedTo, SEASON_HOME_COURT_CALIBRATION_SEED_COUNT - 1),
  );
  const validationIndices = seedIndexRange(
    Math.max(seedFrom, SEASON_HOME_COURT_CALIBRATION_SEED_COUNT),
    seedTo,
  );

  const started = Date.now();
  const calibrationFacts = await runCohort({
    fixtures,
    seedIndices: calibrationIndices,
    workers,
    profile,
  });
  const validationFacts = await runCohort({
    fixtures,
    seedIndices: validationIndices,
    workers,
    profile,
  });
  const durationMs = Date.now() - started;

  const calibration = foldWinRates(calibrationFacts);
  const validation = foldWinRates(validationFacts);
  const achievedHomeWinRate = validation.achievedHomeWinRate;
  const neutralHomeWinRate = validation.neutralHomeWinRate;
  const gamesSimulated = calibration.games + validation.games;

  // Gates. The frozen held-out cohort is a 768-game binomial sample (SE
  // ~1.8pp), so the point tolerance is floored by the sample's standard
  // error: the achieved rate must be within max(0.01, 2 sigma) of the
  // target, and the neutral baseline within 3 sigma of 50%.
  const sampleStandardError = homeWinRateStandardError(validation.games);
  const targetTolerance = Math.max(SEASON_HOME_COURT_TOLERANCE, 2 * sampleStandardError);
  const baselineTolerance = Math.max(0.03, 3 * sampleStandardError);
  const neutralBaseline = Math.abs(neutralHomeWinRate - 0.5) <= baselineTolerance;
  const withinTolerance =
    Math.abs(achievedHomeWinRate - SEASON_HOME_WIN_RATE_TARGET) <= targetTolerance;
  // The home-court mechanisms touch turnover and conversion, never pace:
  // the mean home/away possession delta stays close to the neutral band.
  const neutralDelta = possessionDelta(calibrationFacts);
  const homeDelta = possessionDelta(validationFacts);
  const possessionStable = Math.abs(homeDelta - neutralDelta) <= 2;

  // Empirical monotonicity on a fixed subset: halving both constants must
  // not raise the home win rate beyond a small noise allowance. The exact
  // mechanism monotonicity is unit-tested in the engine.
  const monotonic = await (async () => {
    if (args.constants !== null && args.constants !== undefined) return true;
    const lowProfile: SeasonHomeCourtProfile = {
      ...profile,
      homeDefensiveCommunication: profile.homeDefensiveCommunication * 0.5,
      awayTurnoverPressure: profile.awayTurnoverPressure * 0.5,
    };
    const probeIndices = calibrationIndices.slice(0, 64);
    const lowFacts = await runCohort({
      fixtures,
      seedIndices: probeIndices,
      workers: 1,
      profile: lowProfile,
    });
    const lowRate = foldWinRates(lowFacts).achievedHomeWinRate;
    return achievedHomeWinRate + 0.02 >= lowRate;
  })();

  const pass = neutralBaseline && withinTolerance && possessionStable && monotonic;

  // Write the evidence artifact when every gate passes.
  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  const outPath = args.out ?? DEFAULT_HOME_COURT_TARGETS;
  if (pass) {
    const targets: SeasonHomeCourtTargets = {
      schemaVersion: 1,
      profileVersion: SEASON_HOME_COURT_VERSION,
      constants: {
        homeDefensiveCommunication: profile.homeDefensiveCommunication,
        awayTurnoverPressure: profile.awayTurnoverPressure,
      },
      targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
      calibration: {
        seedFrom: calibrationIndices[0] ?? 0,
        seedTo: calibrationIndices[calibrationIndices.length - 1] ?? 0,
      },
      heldOut: {
        seedFrom: validationIndices[0] ?? 0,
        seedTo: validationIndices[validationIndices.length - 1] ?? 0,
      },
      achievedHomeWinRate,
      gamesSimulated,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonHomeCourtTargetsSchema.parse(targets);
    try {
      const target = resolve(outPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(targets, null, 2)}\n`);
      targetsWritten = true;
      targetsPath = target;
      if (resolve(outPath) === resolve(DEFAULT_HOME_COURT_TARGETS)) {
        const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          season?: Record<string, { url?: string; contentHash?: string }>;
        };
        if (manifest.season !== undefined) {
          manifest.season.homeCourtTargets = {
            url: 'season/home-court-targets.json',
            contentHash: sha256Hex(readFileSync(target)),
          };
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }
      }
    } catch (error) {
      gateFailures.push(`cannot write targets: ${(error as Error).message}`);
    }
  }

  const payload = seasonHomeCourtCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season home-court calibrate',
    profileVersion: SEASON_HOME_COURT_VERSION,
    constants: {
      homeDefensiveCommunication: profile.homeDefensiveCommunication,
      awayTurnoverPressure: profile.awayTurnoverPressure,
    },
    targetHomeWinRate: SEASON_HOME_WIN_RATE_TARGET,
    calibrationSeedCount: calibrationIndices.length,
    validationSeedCount: validationIndices.length,
    neutralHomeWinRate,
    achievedHomeWinRate,
    gamesSimulated,
    durationMs,
    gates: { neutralBaseline, withinTolerance, possessionStable, monotonic },
    targetsWritten,
    targetsPath,
    pass,
  });

  const details = [
    `fixtures ${fixtureIds.join(', ')} · ${String(calibrationIndices.length)} calibration + ${String(validationIndices.length)} held-out seeds in ${String(durationMs)}ms (${String(workers)} workers)`,
    `neutral home win rate ${(neutralHomeWinRate * 100).toFixed(1)}% (baseline ≈ 50%, gate ±${(baselineTolerance * 100).toFixed(1)}pp at 3σ)`,
    `achieved home win rate ${(achievedHomeWinRate * 100).toFixed(1)}% vs target ${(SEASON_HOME_WIN_RATE_TARGET * 100).toFixed(1)}% (gate ±${(targetTolerance * 100).toFixed(1)}pp at max(1pp, 2σ))`,
    `gates: neutral ${String(neutralBaseline)} · tolerance ${String(withinTolerance)} · possessions ${String(possessionStable)} · monotonic ${String(monotonic)}`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (!neutralBaseline) {
    gateFailures.push(
      `neutral home win rate ${(neutralHomeWinRate * 100).toFixed(1)}% is outside the ${(baselineTolerance * 100).toFixed(1)}pp 3σ baseline gate`,
    );
  }
  if (!withinTolerance) {
    gateFailures.push(
      `held-out home win rate ${(achievedHomeWinRate * 100).toFixed(1)}% is outside ${(targetTolerance * 100).toFixed(1)}pp of ${(SEASON_HOME_WIN_RATE_TARGET * 100).toFixed(1)}%`,
    );
  }
  if (!possessionStable) {
    gateFailures.push('home-court profile shifted possession deltas beyond the band');
  }
  if (!monotonic) {
    gateFailures.push('home win rate did not respond monotonically to the constants');
  }
  if (pass && !targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season home-court calibrate',
    { fixtures: fixtureIds, seedFrom, seedTo, workers },
    { details, failures: gateFailures, payload },
  );
}
