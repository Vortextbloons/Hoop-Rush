import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  checkSeasonGameResult,
  createEngineContext,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import {
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  seasonGameSimulationInputSchema,
  seasonGameTargetsSchema,
  seedSchema,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonGameTargets,
  type SeasonRotationPreset,
} from '@hoop-rush/data-contracts';
import { parseSeedRange, parseWorkers, UsageError } from '../args.ts';
import { seasonGameFixtureSchema, type SeasonGameFixture } from '../fixture-schema.ts';
import { makeReport, type CliReport } from '../report.ts';
import {
  seasonGameCalibrateReportSchema,
  seasonGameSimulateReportSchema,
  type SeasonGameSimulateReport,
} from '../report-schemas.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile, sha256Hex } from './season-data.ts';
import { seasonCalibrationSeed, seedIndexRange } from './season-calibration.ts';

/**
 * M2.2 `season game` commands (spec/2.0/04): single-game simulation with
 * exact-seconds facts and the frozen 0-1023/1024-1279 calibration cohort that
 * freezes `season-game-targets-v1`. Both commands call the authoritative
 * engine surface; the injectable `deps` seam lets tests substitute doubles
 * without touching the real engine wiring.
 */

export const SEASON_GAME_SIMULATE_OPTIONS: Record<string, boolean> = {
  input: true,
  seed: true,
  format: true,
};

export const SEASON_GAME_CALIBRATE_OPTIONS: Record<string, boolean> = {
  fixture: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  format: true,
};

/** Frozen calibration cohort: seeds 0-1023 calibration, 1024-1279 held out. */
export const SEASON_GAME_CALIBRATION_SEED_COUNT = 1024;
export const SEASON_GAME_VALIDATION_SEED_COUNT = 256;
export const SEASON_GAME_CALIBRATION_SEED_TOTAL =
  SEASON_GAME_CALIBRATION_SEED_COUNT + SEASON_GAME_VALIDATION_SEED_COUNT;

/** Chunking-independence probe size (subset re-run with a single chunk). */
export const SEASON_GAME_CHUNKING_PROBE_COUNT = 32;

/** The three rotation-preset fixtures; the default calibrate cohort. */
export const SEASON_GAME_PRESET_FIXTURES = [
  'season-game-balanced',
  'season-game-tight',
  'season-game-bench-heavy',
] as const;

export const DEFAULT_GAME_TARGETS = resolve(DEFAULT_SEASON_DIR, 'game-targets.json');

const FIXTURES_DIR = new URL('../fixtures/', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1')
  .replace(/%20/g, ' ');

/** Calibration seed i: the fixed 32-hex-digit sequential cohort (M2.2).
 * Canonical implementation in `season-calibration.ts`. */
export const seasonGameCalibrationSeed = seasonCalibrationSeed;

/** Resolves a fixture reference: a path (or `*.json`) is read as-is, an id
 * resolves against the committed fixtures directory. */
export function resolveSeasonGameFixturePath(ref: string): string {
  const looksLikePath = ref.includes('/') || ref.includes('\\') || ref.endsWith('.json');
  return looksLikePath ? resolve(ref) : `${FIXTURES_DIR}${ref}.json`;
}

export function loadSeasonGameFixture(ref: string): SeasonGameFixture {
  const path = resolveSeasonGameFixturePath(ref);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`season game fixture not found: ${ref} (expected ${path})`);
  }
  const parsed = seasonGameFixtureSchema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) {
    throw new UsageError(
      `fixture ${ref} fails validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return parsed.data;
}

/** Engine surface injected by tests; defaults to the real engine. */
export interface SeasonGameEngineDeps {
  simulateSeasonGame: typeof simulateSeasonGame;
  checkSeasonGameResult: typeof checkSeasonGameResult;
  /** M2.4 effects-mode calibration (season-game-targets-v3). */
  simulateSeasonGameWithEffects?: typeof simulateSeasonGameWithEffects;
}

/** Per-game facts posted by the calibration worker; aggregation is
 * order-insensitive so worker counts and chunk order never change results. */
export interface SeasonGameGameFacts {
  fixtureId: string;
  seedIndex: number;
  seed: string;
  outcome: 'completed' | 'forfeit' | 'no-legal-five-both';
  deterministic: boolean;
  /** checkSeasonGameResult failure strings for the game. */
  checks: string[];
  /** Starter actual seconds, five per side, in slot order (completed only). */
  starterSeconds: number[];
  /** Bench actual seconds, five per side, in benchOrder (completed only). */
  benchSeconds: number[];
  /** Per bench role (sixth..tenth), actual seconds across both sides. */
  benchRoleSeconds: number[][];
  /** Team points, [home, away] (completed only). */
  points: number[];
  /** Team possessions, [home, away] (completed only). */
  possessions: number[];
}

/**
 * Simulates one calibration game twice (determinism evidence) and derives the
 * per-game facts. Shared by the worker (real engine) and the in-process test
 * runner (injected doubles). With `effects` set, the M2.4 stamina/chemistry
 * seam is applied on top of the fixture input (season-game-targets-v3).
 */
export async function simulateSeasonGameFacts(
  fixtureId: string,
  seedIndex: number,
  input: SeasonGameSimulationInput,
  deps: SeasonGameEngineDeps,
  effects = false,
): Promise<SeasonGameGameFacts> {
  const context = createEngineContext();
  let first: SeasonGameSimulationResult;
  let second: SeasonGameSimulationResult;
  let checks: string[];
  if (effects) {
    if (deps.simulateSeasonGameWithEffects === undefined) {
      throw new Error('season game calibrate --effects requires the effects engine seam');
    }
    const { representativeEffectsState, withFixtureStamina } = await import('./season-effects.ts');
    const effectsInput = seasonGameSimulationInputSchema.parse(withFixtureStamina(input));
    const { state } = representativeEffectsState(effectsInput);
    const firstOutcome = deps.simulateSeasonGameWithEffects(effectsInput, context, state);
    const secondOutcome = deps.simulateSeasonGameWithEffects(effectsInput, context, state);
    first = firstOutcome.result;
    second = secondOutcome.result;
    checks = first.outcome === 'completed' ? deps.checkSeasonGameResult(first, effectsInput) : [];
    // The neutral-replay determinism check inside checkSeasonGameResult is
    // expected to differ under effects; determinism is verified by the
    // double-run below.
    checks = checks.filter((failure) => !failure.startsWith('determinism:'));
  } else {
    first = deps.simulateSeasonGame(input, context);
    second = deps.simulateSeasonGame(input, context);
    checks = deps.checkSeasonGameResult(first, input);
  }
  const deterministic = JSON.stringify(first) === JSON.stringify(second);
  const facts: SeasonGameGameFacts = {
    fixtureId,
    seedIndex,
    seed: input.seed,
    outcome: first.outcome,
    deterministic,
    checks,
    starterSeconds: [],
    benchSeconds: [],
    benchRoleSeconds: [[], [], [], [], []],
    points: [],
    possessions: [],
  };
  if (first.outcome !== 'completed') return facts;
  for (const side of [input.home, input.away]) {
    const rotation = side === input.home ? input.homeRotation : input.awayRotation;
    const resultSide = side === input.home ? first.home : first.away;
    const secondsOf = new Map(
      resultSide.players.map((player) => [player.playerVersionId, player.seconds]),
    );
    for (const id of rotation.starters) facts.starterSeconds.push(secondsOf.get(id) ?? 0);
    rotation.benchOrder.forEach((id, role) => {
      const seconds = secondsOf.get(id) ?? 0;
      facts.benchSeconds.push(seconds);
      const roleSeconds = facts.benchRoleSeconds[role];
      if (roleSeconds !== undefined) roleSeconds.push(seconds);
    });
    facts.points.push(resultSide.score);
    facts.possessions.push(resultSide.box.possessions);
  }
  return facts;
}

export interface SeasonGameCohortRequest {
  fixtures: Array<{ fixtureId: string; path: string }>;
  seedIndices: number[];
  workers: number;
  /** M2.4: run the cohort through the stamina/chemistry seam. */
  effects?: boolean;
}

export type SeasonGameCohortRunner = (
  request: SeasonGameCohortRequest,
) => Promise<SeasonGameGameFacts[]>;

/**
 * Worker-based cohort runner: each (fixture, seed-range chunk) is simulated
 * in a worker thread; the main thread only concatenates per-game facts, so
 * every aggregate is a pure fold over (fixture, seed).
 */
export async function runSeasonGameCohort(
  request: SeasonGameCohortRequest,
): Promise<SeasonGameGameFacts[]> {
  const chunkSize = Math.max(1, Math.ceil(request.seedIndices.length / request.workers));
  const promises: Array<Promise<SeasonGameGameFacts[]>> = [];
  for (const fixture of request.fixtures) {
    for (let start = 0; start < request.seedIndices.length; start += chunkSize) {
      const seedIndices = request.seedIndices.slice(start, start + chunkSize);
      promises.push(
        new Promise<SeasonGameGameFacts[]>((resolvePromise, rejectPromise) => {
          const worker = new Worker(
            new URL('./season-game-calibration-worker.ts', import.meta.url),
            {
              workerData: {
                fixtureId: fixture.fixtureId,
                fixturePath: fixture.path,
                seedIndices,
                ...(request.effects === true ? { effects: true } : {}),
              },
            },
          );
          worker.on('message', (message: { facts: SeasonGameGameFacts[] }) => {
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

/** In-process cohort runner for tests: identical chunking to the worker path
 * but calls the injected engine doubles. */
export async function runSeasonGameCohortInProcess(
  request: SeasonGameCohortRequest,
  deps: SeasonGameEngineDeps,
): Promise<SeasonGameGameFacts[]> {
  const chunkSize = Math.max(1, Math.ceil(request.seedIndices.length / request.workers));
  const facts: SeasonGameGameFacts[] = [];
  for (const fixture of request.fixtures) {
    const parsed = seasonGameFixtureSchema.safeParse(readJsonFile(fixture.path));
    if (!parsed.success) {
      throw new Error(`season game fixture ${fixture.fixtureId} fails validation`);
    }
    for (let start = 0; start < request.seedIndices.length; start += chunkSize) {
      for (const index of request.seedIndices.slice(start, start + chunkSize)) {
        const seed = seasonGameCalibrationSeed(index);
        const input = seasonGameSimulationInputSchema.parse({ ...parsed.data.input, seed });
        facts.push(
          await simulateSeasonGameFacts(
            fixture.fixtureId,
            index,
            input,
            deps,
            request.effects ?? false,
          ),
        );
      }
    }
  }
  return facts;
}

export function seasonGameSimulate(
  args: { input: string | null; seed: string | null },
  deps: Partial<SeasonGameEngineDeps> = {},
): CliReport {
  const inputRef = args.input;
  if (inputRef === null) {
    throw new UsageError('season game simulate requires --input <fixture>');
  }
  const fixture = loadSeasonGameFixture(inputRef);
  const seed = args.seed ?? fixture.input.seed;
  if (!seedSchema.safeParse(seed).success) {
    throw new UsageError(`--seed must be a hex seed (got "${seed}")`);
  }
  const input = seasonGameSimulationInputSchema.parse({ ...fixture.input, seed });
  const simulate = deps.simulateSeasonGame ?? simulateSeasonGame;
  const check = deps.checkSeasonGameResult ?? checkSeasonGameResult;
  const context = createEngineContext();
  const result = simulate(input, context);
  const invariantFailures = check(result, input);
  const payload = seasonGameSimulateReportSchema.parse(
    buildSimulatePayload(fixture, input, result, invariantFailures),
  );
  return makeReport(
    'season game simulate',
    { fixture: fixture.fixtureId, seed },
    {
      details: renderSimulateDetails(input, result, payload),
      failures: invariantFailures,
      payload,
    },
  );
}

function buildSimulatePayload(
  fixture: SeasonGameFixture,
  input: SeasonGameSimulationInput,
  result: SeasonGameSimulationResult,
  invariantFailures: string[],
): SeasonGameSimulateReport {
  const completed = result.outcome === 'completed';
  return {
    schemaVersion: 1,
    command: 'season game simulate',
    fixtureId: fixture.fixtureId,
    seed: result.seed,
    outcome: result.outcome,
    winner: result.outcome === 'no-legal-five-both' ? null : result.winner,
    home: {
      teamId: input.home.teamId,
      displayName: input.home.displayName,
      score: completed ? result.home.score : result.outcome === 'forfeit' ? result.homeScore : null,
    },
    away: {
      teamId: input.away.teamId,
      displayName: input.away.displayName,
      score: completed ? result.away.score : result.outcome === 'forfeit' ? result.awayScore : null,
    },
    overtimePeriods: completed ? result.overtimePeriods : 0,
    forfeit:
      result.outcome === 'forfeit'
        ? { losingFranchiseId: result.losingFranchiseId, trigger: result.trigger }
        : null,
    engineVersion: result.engineVersion,
    dataVersion: result.dataVersion,
    profileVersion: result.profileVersion,
    gameVersion: SEASON_GAME_VERSION,
    rotationVersion: SEASON_ROTATION_VERSION,
    playerMinutes: playerMinutesOf(input, result),
    substitutions: completed ? result.substitutions : [],
    unitStints: completed ? result.unitStints : [],
    foulOuts: completed ? result.foulOuts : [],
    deviations: completed ? result.deviations : [],
    invariantFailures,
    pass: invariantFailures.length === 0,
  };
}

/** Actual-vs-target rows for all twenty rostered players. */
function playerMinutesOf(
  input: SeasonGameSimulationInput,
  result: SeasonGameSimulationResult,
): SeasonGameSimulateReport['playerMinutes'] {
  const reasonOf = new Map(
    (result.outcome === 'completed' ? result.deviations : []).map((deviation) => [
      `${deviation.side}\u0000${deviation.playerVersionId}`,
      deviation.reasons,
    ]),
  );
  const rows: SeasonGameSimulateReport['playerMinutes'] = [];
  for (const side of ['home', 'away'] as const) {
    const team = side === 'home' ? input.home : input.away;
    const rotation = side === 'home' ? input.homeRotation : input.awayRotation;
    const target = new Map(
      rotation.targetMinutes.map((row) => [row.playerVersionId, row.minutes * 60]),
    );
    const actual =
      result.outcome === 'completed'
        ? new Map(
            (side === 'home' ? result.home : result.away).players.map((player) => [
              player.playerVersionId,
              player.seconds,
            ]),
          )
        : new Map<string, number>();
    for (const player of team.players) {
      const actualSeconds = actual.get(player.playerVersionId) ?? 0;
      const targetSeconds = target.get(player.playerVersionId) ?? 0;
      rows.push({
        side,
        playerVersionId: player.playerVersionId,
        actualSeconds,
        targetSeconds,
        deviationSeconds: actualSeconds - targetSeconds,
        reasons: reasonOf.get(`${side}\u0000${player.playerVersionId}`) ?? [],
      });
    }
  }
  return rows;
}

function renderSimulateDetails(
  input: SeasonGameSimulationInput,
  result: SeasonGameSimulationResult,
  payload: SeasonGameSimulateReport,
): string[] {
  const minutes = (seconds: number): string => (seconds / 60).toFixed(1);
  const versions = `engine ${payload.engineVersion} · data ${payload.dataVersion} · profile ${payload.profileVersion} · game ${payload.gameVersion} · rotation ${payload.rotationVersion} · seed ${payload.seed}`;
  const details: string[] = [];
  if (result.outcome === 'completed') {
    const home = result.home;
    const away = result.away;
    const overtime = result.overtimePeriods > 0 ? ` (${String(result.overtimePeriods)} OT)` : '';
    details.push(
      `${home.displayName} ${String(home.score)} - ${String(away.score)} ${away.displayName} (winner: ${result.winner}${overtime})`,
      versions,
    );
    for (const side of [home, away]) {
      const box = side.box;
      details.push(
        `${side.displayName}: ${String(box.points)} pts · ${String(box.fieldGoals.made)}/${String(box.fieldGoals.attempted)} FG · ${String(box.threes.made)}/${String(box.threes.attempted)} 3P · ${String(box.freeThrows.made)}/${String(box.freeThrows.attempted)} FT · ${String(box.rebounds.offensive)}+${String(box.rebounds.defensive)}+${String(box.rebounds.team)} REB · ${String(box.assists)} AST · ${String(box.turnovers)} TOV · ${String(box.fouls)} PF · ${String(box.possessions)} POSS`,
      );
    }
    const names = new Map(
      [...input.home.players, ...input.away.players].map((player) => [
        player.playerVersionId,
        player.displayName,
      ]),
    );
    for (const row of payload.playerMinutes) {
      const reason = row.reasons.length > 0 ? ` (${row.reasons.join(', ')})` : '';
      details.push(
        `  ${row.side} ${names.get(row.playerVersionId) ?? row.playerVersionId}: ${minutes(row.actualSeconds)}/${minutes(row.targetSeconds)} min actual/target${reason}`,
      );
    }
    details.push(`substitutions: ${String(result.substitutions.length)}`);
    for (const sub of result.substitutions) {
      details.push(
        `  sub ${sub.side} p${String(sub.period)} ${String(sub.secondsRemaining)}s in ${sub.playerIn} out ${sub.playerOut} (${sub.reason})`,
      );
    }
    details.push(`foul outs: ${String(result.foulOuts.length)}`);
    for (const foul of result.foulOuts) {
      details.push(
        `  ${foul.side} ${foul.playerVersionId} (p${String(foul.period)} ${String(foul.secondsRemaining)}s)`,
      );
    }
    details.push(`unit stints: ${String(result.unitStints.length)}`);
    details.push(`deviations: ${String(result.deviations.length)}`);
    for (const deviation of result.deviations) {
      details.push(
        `  dev ${deviation.side} ${deviation.playerVersionId}: ${String(deviation.actualSeconds)}s vs ${String(deviation.targetSeconds)}s (${deviation.reasons.join(', ')})`,
      );
    }
  } else if (result.outcome === 'forfeit') {
    details.push(
      `${input.home.displayName} 2 - 0 ${input.away.displayName} (forfeit: ${result.losingFranchiseId}, ${result.trigger})`,
      versions,
    );
  } else {
    details.push(
      'no legal five on either side (no-legal-five-both); no player statistics',
      versions,
    );
  }
  if (payload.invariantFailures.length > 0) {
    details.push(`invariant failures: ${String(payload.invariantFailures.length)}`);
  }
  return details;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index] ?? 0;
}

/** p1-p99 envelope over one aggregate metric (the frozen calibration band). */
function envelope(values: readonly number[]): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  return [percentile(sorted, 0.01), percentile(sorted, 0.99)];
}

export interface SeasonGameFixtureStats {
  fixtureId: string;
  preset: SeasonRotationPreset | null;
  sample: number;
  starterSecondsMedian: number;
  benchSecondsMedian: number;
  benchRoleMedianSeconds: number[];
  aggregateEnvelopes: Record<string, [number, number]>;
  failures: { games: number; checks: number; determinism: number };
}

/** Order-insensitive fold over per-game facts for one fixture. */
function aggregateFixture(
  fixtureId: string,
  facts: readonly SeasonGameGameFacts[],
  metricKeys: readonly string[],
): SeasonGameFixtureStats {
  const starter: number[] = [];
  const bench: number[] = [];
  const benchRole: number[][] = [[], [], [], [], []];
  const metrics: Record<string, number[]> = Object.fromEntries(metricKeys.map((key) => [key, []]));
  let sample = 0;
  let failureGames = 0;
  let failureChecks = 0;
  let determinismFailures = 0;
  for (const fact of facts) {
    if (fact.fixtureId !== fixtureId) continue;
    if (fact.checks.length > 0 || !fact.deterministic) failureGames += 1;
    failureChecks += fact.checks.length;
    if (!fact.deterministic) determinismFailures += 1;
    if (fact.outcome !== 'completed') continue;
    sample += 1;
    starter.push(...fact.starterSeconds);
    bench.push(...fact.benchSeconds);
    fact.benchRoleSeconds.forEach((seconds, role) => {
      const target = benchRole[role];
      if (target !== undefined) target.push(...seconds);
    });
    if (metricKeys.includes('points')) metrics.points?.push(...fact.points);
    if (metricKeys.includes('possessions')) metrics.possessions?.push(...fact.possessions);
  }
  const aggregateEnvelopes: Record<string, [number, number]> = {};
  for (const key of metricKeys) {
    const values = metrics[key];
    if (values !== undefined && values.length > 0) {
      aggregateEnvelopes[key] = envelope(values);
    }
  }
  return {
    fixtureId,
    preset: null,
    sample,
    starterSecondsMedian: median(starter),
    benchSecondsMedian: median(bench),
    benchRoleMedianSeconds: benchRole.map(median),
    aggregateEnvelopes,
    failures: { games: failureGames, checks: failureChecks, determinism: determinismFailures },
  };
}

export interface SeasonGameCalibrateDeps extends Partial<SeasonGameEngineDeps> {
  /** Cohort runner; defaults to worker threads (real engine) or, when engine
   * doubles are injected, the in-process runner. */
  runCohort?: SeasonGameCohortRunner;
}

export async function seasonGameCalibrate(
  args: {
    fixture?: string | null;
    'seed-from'?: string | null;
    'seed-to'?: string | null;
    workers?: string | null;
    out?: string | null;
    manifest?: string | null;
    /** M2.4: run the cohort through the stamina/chemistry effects seam. */
    effects?: string | null;
  },
  deps: SeasonGameCalibrateDeps = {},
): Promise<CliReport> {
  const effects = args.effects !== null && args.effects !== undefined && args.effects !== 'false';
  const fixtureIds = (args.fixture ?? SEASON_GAME_PRESET_FIXTURES.join(','))
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (fixtureIds.length === 0) {
    throw new UsageError('--fixture needs at least one fixture id');
  }
  const { from: seedFrom, to: seedTo } = parseSeedRange(
    args,
    SEASON_GAME_CALIBRATION_SEED_TOTAL - 1,
    {
      requireOrder: true,
    },
  );
  const workers = parseWorkers(args, 4, { clampToAtLeastOne: true });
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;

  const fixtures = fixtureIds.map((id) => {
    const fixture = loadSeasonGameFixture(id);
    return {
      fixtureId: fixture.fixtureId,
      preset: fixture.preset ?? null,
      path: resolveSeasonGameFixturePath(id),
    };
  });
  const presetCount = new Set(
    fixtures
      .filter(
        (fixture): fixture is typeof fixture & { preset: SeasonRotationPreset } =>
          fixture.preset !== null,
      )
      .map((fixture) => fixture.preset),
  ).size;
  const hasAllPresetFixtures = presetCount === 3;

  // Frozen split: indices below 1024 are calibration, 1024+ are held out.
  const calibrationIndices = seedIndexRange(
    seedFrom,
    Math.min(seedTo, SEASON_GAME_CALIBRATION_SEED_COUNT - 1),
  );
  const validationIndices = seedIndexRange(
    Math.max(seedFrom, SEASON_GAME_CALIBRATION_SEED_COUNT),
    seedTo,
  );

  const simulate = deps.simulateSeasonGame ?? simulateSeasonGame;
  const check = deps.checkSeasonGameResult ?? checkSeasonGameResult;
  const engineDeps: SeasonGameEngineDeps = {
    simulateSeasonGame: simulate,
    checkSeasonGameResult: check,
  };
  const runCohort =
    deps.runCohort ??
    (deps.simulateSeasonGame !== undefined || deps.checkSeasonGameResult !== undefined
      ? (request: SeasonGameCohortRequest) => runSeasonGameCohortInProcess(request, engineDeps)
      : runSeasonGameCohort);

  const start = Date.now();
  const calibrationFacts = await runCohort({
    fixtures,
    seedIndices: calibrationIndices,
    workers,
    ...(effects ? { effects: true } : {}),
  });
  const validationFacts = await runCohort({
    fixtures,
    seedIndices: validationIndices,
    workers,
    ...(effects ? { effects: true } : {}),
  });
  const durationMs = Date.now() - start;

  // Gate 6: re-run a fixed subset with a single chunk and compare facts.
  const probeIndices = calibrationIndices.slice(0, SEASON_GAME_CHUNKING_PROBE_COUNT);
  const probeFacts = await runCohort({
    fixtures,
    seedIndices: probeIndices,
    workers: 1,
    ...(effects ? { effects: true } : {}),
  });
  const probeByKey = new Map(
    probeFacts.map((fact) => [factKey(fact.fixtureId, fact.seedIndex), fact]),
  );
  const chunkingIndependent = [...probeByKey.values()].every((fact) =>
    calibrationFacts.some(
      (main) =>
        factKey(main.fixtureId, main.seedIndex) === factKey(fact.fixtureId, fact.seedIndex) &&
        JSON.stringify(main) === JSON.stringify(fact),
    ),
  );

  const stats = fixtures.map((fixture) => {
    const aggregate = aggregateFixture(fixture.fixtureId, calibrationFacts, [
      'points',
      'possessions',
    ]);
    return { ...aggregate, preset: fixture.preset };
  });
  const statsByFixture = new Map(stats.map((stat) => [stat.fixtureId, stat]));
  const tight = statsByFixture.get('season-game-tight');
  const balanced = statsByFixture.get('season-game-balanced');
  const benchHeavy = statsByFixture.get('season-game-bench-heavy');

  // Gate 1: zero accounting/legality/ownership/determinism failures.
  const allFacts = [...calibrationFacts, ...validationFacts];
  const zeroFailures = allFacts.every((fact) => fact.checks.length === 0 && fact.deterministic);

  // Gates 2-3: median starter/bench second ordering across the presets.
  const starterOrdering =
    hasAllPresetFixtures &&
    tight !== undefined &&
    balanced !== undefined &&
    benchHeavy !== undefined &&
    tight.starterSecondsMedian > balanced.starterSecondsMedian &&
    balanced.starterSecondsMedian > benchHeavy.starterSecondsMedian;
  const benchOrdering =
    hasAllPresetFixtures &&
    tight !== undefined &&
    balanced !== undefined &&
    benchHeavy !== undefined &&
    benchHeavy.benchSecondsMedian > balanced.benchSecondsMedian &&
    balanced.benchSecondsMedian > tight.benchSecondsMedian;

  // Gate 4: bench-role medians non-increasing from sixth through tenth.
  const benchRoleNonIncreasing =
    tight !== undefined &&
    balanced !== undefined &&
    benchHeavy !== undefined &&
    [tight, balanced, benchHeavy].every((stat) => nonIncreasing(stat.benchRoleMedianSeconds));

  // Gate 5: held-out aggregate metrics inside the frozen calibration envelopes.
  let heldOutWithin = 0;
  let heldOutTotal = 0;
  for (const fact of validationFacts) {
    if (fact.outcome !== 'completed') continue;
    const stat = statsByFixture.get(fact.fixtureId);
    if (stat === undefined) continue;
    for (const key of ['points', 'possessions'] as const) {
      const [lo, hi] = stat.aggregateEnvelopes[key] ?? [0, 0];
      const values = key === 'points' ? fact.points : fact.possessions;
      for (const value of values) {
        heldOutTotal += 1;
        if (value >= lo && value <= hi) heldOutWithin += 1;
      }
    }
  }
  const heldOutPassShare = heldOutTotal === 0 ? 0 : heldOutWithin / heldOutTotal;
  const heldOutPass = heldOutPassShare >= 0.95;

  const pass =
    zeroFailures &&
    starterOrdering &&
    benchOrdering &&
    benchRoleNonIncreasing &&
    heldOutPass &&
    chunkingIndependent;

  // Freeze the targets artifact when every gate passes.
  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  const outPath = args.out ?? DEFAULT_GAME_TARGETS;
  if (pass) {
    const targets: SeasonGameTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_GAME_TARGETS_VERSION,
      gameVersion: SEASON_GAME_VERSION,
      plannerVersion: SEASON_ROTATION_PLANNER_VERSION,
      rotationVersion: SEASON_ROTATION_VERSION,
      calibration: {
        calibrationSeedCount: calibrationIndices.length,
        validationSeedCount: validationIndices.length,
        generatedAtIso: new Date().toISOString(),
      },
      fixtures: ['season-game-balanced', 'season-game-tight', 'season-game-bench-heavy'].map(
        (fixtureId) => {
          const stat = statsByFixture.get(fixtureId);
          if (stat === undefined) {
            throw new Error(
              `cannot freeze targets: preset fixture ${fixtureId} was not calibrated`,
            );
          }
          return {
            fixtureId,
            preset: stat.preset as SeasonRotationPreset,
            sample: stat.sample,
            starterSecondsMedian: stat.starterSecondsMedian,
            benchSecondsMedian: stat.benchSecondsMedian,
            benchRoleMedianSeconds: stat.benchRoleMedianSeconds,
            aggregateEnvelopes: stat.aggregateEnvelopes,
          };
        },
      ),
      gates: {
        zeroFailures,
        starterOrdering,
        benchOrdering,
        benchRoleNonIncreasing,
        heldOutPassShare,
        heldOutPass,
      },
    };
    seasonGameTargetsSchema.parse(targets);
    try {
      const target = resolve(outPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(targets, null, 2)}\n`);
      targetsWritten = true;
      targetsPath = target;
      // Update the manifest hash for the committed targets artifact.
      if (resolve(outPath) === resolve(DEFAULT_GAME_TARGETS)) {
        const manifestPathResolved = resolve(manifestPath);
        const manifest = JSON.parse(readFileSync(manifestPathResolved, 'utf8')) as {
          season?: Record<string, { url?: string; contentHash?: string }>;
        };
        if (manifest.season !== undefined) {
          manifest.season.gameTargets = {
            url: 'season/game-targets.json',
            contentHash: sha256Hex(readFileSync(target)),
          };
          writeFileSync(manifestPathResolved, `${JSON.stringify(manifest, null, 2)}\n`);
        }
      }
    } catch (error) {
      gateFailures.push(`cannot write targets: ${(error as Error).message}`);
    }
  }

  const payload = seasonGameCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season game calibrate',
    fixtures: fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      preset: fixture.preset,
    })),
    calibrationSeedCount: calibrationIndices.length,
    validationSeedCount: validationIndices.length,
    workers,
    durationMs,
    fixtureStats: stats,
    gates: {
      zeroFailures,
      starterOrdering,
      benchOrdering,
      benchRoleNonIncreasing,
      heldOutPassShare,
      heldOutPass,
    },
    chunkingIndependent,
    targetsWritten,
    targetsPath,
    pass,
  });

  const details = [
    `${fixtures.map((fixture) => fixture.fixtureId).join(', ')} · ${String(calibrationIndices.length)} calibration + ${String(validationIndices.length)} validation seeds in ${String(durationMs)}ms (${String(workers)} workers)`,
    `starter medians: tight ${formatMedian(tight?.starterSecondsMedian)} > balanced ${formatMedian(balanced?.starterSecondsMedian)} > bench-heavy ${formatMedian(benchHeavy?.starterSecondsMedian)}`,
    `bench medians: bench-heavy ${formatMedian(benchHeavy?.benchSecondsMedian)} > balanced ${formatMedian(balanced?.benchSecondsMedian)} > tight ${formatMedian(tight?.benchSecondsMedian)}`,
    `held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% (≥ 95% required)`,
    `gates: zeroFailures ${String(zeroFailures)} · starterOrdering ${String(starterOrdering)} · benchOrdering ${String(benchOrdering)} · benchRoles ${String(benchRoleNonIncreasing)} · chunking ${String(chunkingIndependent)}`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (!zeroFailures) {
    gateFailures.push('accounting, legality, ownership, or determinism failure observed');
  }
  if (!starterOrdering) {
    gateFailures.push('starter second medians are not ordered tight > balanced > bench-heavy');
  }
  if (!benchOrdering) {
    gateFailures.push('bench second medians are not ordered bench-heavy > balanced > tight');
  }
  if (!benchRoleNonIncreasing) {
    gateFailures.push('bench-role medians are not non-increasing from sixth through tenth');
  }
  if (!heldOutPass) {
    gateFailures.push(`held-out pass share ${(heldOutPassShare * 100).toFixed(1)}% below 95%`);
  }
  if (!chunkingIndependent) {
    gateFailures.push('chunking probe results diverged (worker-count dependence)');
  }
  if (pass && !targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season game calibrate',
    { fixtures: fixtureIds, seedFrom, seedTo, workers },
    { details, failures: gateFailures, payload },
  );
}

function factKey(fixtureId: string, seedIndex: number): string {
  return `${fixtureId}\u0000${String(seedIndex)}`;
}

function formatMedian(value: number | undefined): string {
  return value === undefined ? 'n/a' : value.toFixed(1);
}

/** True when every successive value is not greater than its predecessor. */
function nonIncreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    const previous = values[i - 1];
    const current = values[i];
    if (previous === undefined || current === undefined || previous < current) return false;
  }
  return true;
}
