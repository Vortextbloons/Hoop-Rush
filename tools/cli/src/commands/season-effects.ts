import { resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_EFFECT_TARGETS_LEGACY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  playerVersionId,
  seasonGameSimulationInputSchema,
  type SeasonEffectsState,
  type SeasonGameSimulationInput,
  type SeasonGameSimulationResult,
  type SeasonMechanism,
  type SeasonStaminaInput,
} from '@hoop-rush/data-contracts';
import {
  SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP,
  SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP,
  SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_HELP_DEFENSE_MAX_PP,
  SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP,
  applySeasonRecoveryTick,
  checkSeasonGameResult,
  createEngineContext,
  createSeasonEffectsState,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
  unitChemistryBasisPoints,
} from '@hoop-rush/engine';
import { parseCount, UsageError } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import {
  seasonEffectsCalibrateReportSchema,
  seasonEffectsDistributionReportSchema,
  seasonEffectsRolesReportSchema,
  seasonEffectsSensitivityReportSchema,
} from '../report-schemas.ts';
import { seasonGameFixtureSchema } from '../fixture-schema.ts';
import {
  seasonGameCalibrationSeed,
  loadSeasonGameFixture,
  resolveSeasonGameFixturePath,
  type SeasonGameEngineDeps,
} from './season-game.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile } from './season-data.ts';
import { seedIndexRange } from './season-calibration.ts';
import { median } from '../stats.ts';
import { commitTargetsArtifact, runWorkerChunks, validateTargetsArtifact } from '../artifact.ts';

/**
 * M2.4 `season effects` commands (spec/2.0/05, season-effect-targets-v1).
 * Measures the stamina/chemistry effects seam through the authoritative
 * engine: sensitivity (mechanism response to fatigue/chemistry inputs),
 * distribution (production deltas vs the neutral cohort), roles (rotation
 * workload ordering), and calibrate (the frozen effect-targets artifact and
 * its gates). Every cohort uses worker threads; worker counts and chunk
 * order never change the facts.
 *
 * The calibration fixture convention: fixture players carry deterministic
 * stamina (starters 80, bench 65), and the representative production state
 * carries ~600bp starter / 200bp bench fatigue with ~1,000 shared possessions
 * per same-roster pair (about ten games of shared play).
 */

export const SEASON_EFFECTS_OPTIONS: Record<string, boolean> = {
  fixture: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const SEASON_EFFECTS_CALIBRATION_SEED_COUNT = 256;
export const SEASON_EFFECTS_VALIDATION_SEED_COUNT = 64;
export const SEASON_EFFECTS_PRESET_FIXTURES = [
  'season-game-balanced',
  'season-game-tight',
  'season-game-bench-heavy',
] as const;

/** Command args as received by the registered entry points. */
export type SeasonEffectsArgs = Record<string, string | null>;

/** Option reader: value or fallback (options registered but absent are null). */
function opt(args: SeasonEffectsArgs, key: string, fallback: string): string {
  return args[key] ?? fallback;
}

export const DEFAULT_EFFECT_TARGETS = resolve(DEFAULT_SEASON_DIR, 'effect-targets.json');

/** Production envelope gates (fractions of the neutral cohort). */
export const SEASON_EFFECTS_SCORING_ENVELOPE = 0.05;
export const SEASON_EFFECTS_TURNOVER_ENVELOPE = 0.1;
export const SEASON_EFFECTS_ASSIST_ENVELOPE = 0.1;

/** Held-out pass-share gate for the production envelopes. */
export const SEASON_EFFECTS_HELD_OUT_PASS_SHARE = 0.95;

/** Chemistry separation gate (basis points after ten games). */
export const SEASON_EFFECTS_CHEMISTRY_SEPARATION_BP = 1000;

/** The artifact written by `season effects calibrate`. */
export const seasonEffectTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.union([
    z.literal(SEASON_EFFECT_TARGETS_VERSION),
    z.literal(SEASON_EFFECT_TARGETS_LEGACY_VERSION),
  ]),
  mechanismCaps: z.object({
    shooterFatiguePp: z.number().min(0).max(5),
    handlerFatiguePp: z.number().min(0).max(5),
    defenseFatiguePp: z.number().min(0).max(5),
    turnoverSecurityPp: z.number().min(0).max(5),
    assistConversionPp: z.number().min(0).max(5),
    helpDefensePp: z.number().min(0).max(5),
  }),
  productionEnvelopes: z.object({
    scoringDeltaMax: z.number().min(0).max(0.5),
    turnoverRateDeltaMax: z.number().min(0).max(0.5),
    assistRateDeltaMax: z.number().min(0).max(0.5),
  }),
  chemistrySeparationBp: z.number().int().nonnegative(),
  cohort: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  heldOut: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  measured: z.object({
    calibration: z.object({
      scoringDeltaMedian: z.number(),
      turnoverDeltaMedian: z.number(),
      assistDeltaMedian: z.number(),
      gamesSimulated: z.number().int().positive(),
      zeroFailures: z.boolean(),
      determinismFailures: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
      scoringDeltaMedian: z.number(),
      turnoverDeltaMedian: z.number(),
      assistDeltaMedian: z.number(),
      withinEnvelopeShare: z.number().min(0).max(1),
      gamesSimulated: z.number().int().positive(),
    }),
    roles: z.object({
      tightStarterMedianFatigue: z.number().int().nonnegative(),
      balancedStarterMedianFatigue: z.number().int().nonnegative(),
      benchHeavyStarterMedianFatigue: z.number().int().nonnegative(),
      tightBenchMedianFatigue: z.number().int().nonnegative(),
      balancedBenchMedianFatigue: z.number().int().nonnegative(),
      benchHeavyBenchMedianFatigue: z.number().int().nonnegative(),
    }),
    chemistry: z.object({
      stableUnitMedianBp: z.number().int().nonnegative(),
      shuffledUnitMedianBp: z.number().int().nonnegative(),
      separationBp: z.number().int().nonnegative(),
    }),
  }),
  gates: z.object({
    zeroFailures: z.boolean(),
    determinism: z.boolean(),
    productionEnvelopes: z.boolean(),
    heldOutPassShare: z.boolean(),
    rotationOrdering: z.boolean(),
    chemistrySeparation: z.boolean(),
    sensitivityMonotonic: z.boolean(),
  }),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonEffectTargets = z.infer<typeof seasonEffectTargetsSchema>;

/** Fixture stamina convention: starters 80, bench 65 (calibration). */
export function fixtureStaminaFor(rosterIndex: number): number {
  return rosterIndex < 5 ? 80 : 65;
}

/** Attaches the deterministic fixture stamina convention to a game input. */
export function withFixtureStamina(input: SeasonGameSimulationInput): SeasonGameSimulationInput {
  const attach = (
    players: SeasonGameSimulationInput['home']['players'],
  ): SeasonGameSimulationInput['home']['players'] =>
    players.map((player, index) => ({
      ...player,
      stamina: {
        schemaVersion: 1,
        playerVersionId: player.playerVersionId,
        rating: fixtureStaminaFor(index),
        historicalMpg: index < 5 ? 28 : 16,
        derivationVersion: 'season-stamina-v1' as const,
      },
    }));
  return {
    ...input,
    home: { ...input.home, players: attach(input.home.players) },
    away: { ...input.away, players: attach(input.away.players) },
  };
}

function fillerStamina(roster: number, slot: number): SeasonStaminaInput {
  return {
    schemaVersion: 1,
    playerVersionId: playerVersionId(
      `p-effects-filler-${String(roster)}-${String(slot)}`,
      `fx-${String(roster)}`,
      '1990s',
      '1995-96',
    ),
    rating: 60 + ((roster + slot) % 20),
    historicalMpg: 12 + ((roster + slot) % 20),
    derivationVersion: 'season-stamina-v1',
  };
}

function staminaInputOf(
  player: SeasonGameSimulationInput['home']['players'][number],
  index: number,
): SeasonStaminaInput {
  return {
    schemaVersion: 1,
    playerVersionId: player.playerVersionId,
    rating: player.stamina?.rating ?? fixtureStaminaFor(index),
    historicalMpg: player.stamina?.historicalMpg ?? 28,
    derivationVersion: 'season-stamina-v1',
  };
}

/**
 * The representative production state for calibration games: 300 players
 * (fixture home + away rosters first), carry-in fatigue for the fixture's
 * twenty players, and ~1,000 shared possessions per same-roster pair.
 */
export function representativeEffectsState(input: SeasonGameSimulationInput): {
  state: SeasonEffectsState;
  homeStamina: Map<string, SeasonStaminaInput>;
  awayStamina: Map<string, SeasonStaminaInput>;
  staminaByVersion: Map<string, number>;
} {
  const homeInputs = input.home.players.map((player, index) => staminaInputOf(player, index));
  const awayInputs = input.away.players.map((player, index) => staminaInputOf(player, index));
  const allInputs: SeasonStaminaInput[] = [];
  for (let roster = 0; roster < 30; roster += 1) {
    for (let slot = 0; slot < 10; slot += 1) {
      if (roster === 0) {
        const input_ = homeInputs[slot];
        if (input_ !== undefined) allInputs.push(input_);
      } else if (roster === 1) {
        const input_ = awayInputs[slot];
        if (input_ !== undefined) allInputs.push(input_);
      } else {
        allInputs.push(fillerStamina(roster, slot));
      }
    }
  }
  const base = createSeasonEffectsState(allInputs);
  const gameVersions = new Set(
    [...input.home.players, ...input.away.players].map((player) => player.playerVersionId),
  );
  const state: SeasonEffectsState = {
    schemaVersion: 1,
    playerStates: base.playerStates.map((player) => {
      if (!gameVersions.has(player.playerVersionId)) return player;
      const rosterIndex = input.home.players.findIndex(
        (p) => p.playerVersionId === player.playerVersionId,
      );
      const isStarter = rosterIndex >= 0 ? rosterIndex < 5 : true;
      return {
        ...player,
        fatigueBasisPoints: isStarter ? 600 : 200,
        recentLoadBasisPoints: 3000,
        lastCompletedRound: 10,
      };
    }),
    pairStates: base.pairStates.map((pair) => ({ ...pair, sharedPossessions: 1000 })),
  };
  return {
    state,
    homeStamina: new Map(homeInputs.map((s) => [s.playerVersionId, s])),
    awayStamina: new Map(awayInputs.map((s) => [s.playerVersionId, s])),
    staminaByVersion: new Map(allInputs.map((s) => [s.playerVersionId, s.rating])),
  };
}

export const defaultEffectsEngineDeps: SeasonEffectsEngineDeps = {
  simulateSeasonGame,
  checkSeasonGameResult,
  simulateSeasonGameWithEffects,
  createSeasonEffectsState,
};

/** Per-game facts for the distribution cohort. */
export interface SeasonEffectsGameFacts {
  fixtureId: string;
  seedIndex: number;
  completed: boolean;
  checks: string[];
  neutralScore: number;
  effectsScore: number;
  neutralTurnovers: number;
  effectsTurnovers: number;
  neutralAssists: number;
  effectsAssists: number;
  neutralFga: number;
  effectsFga: number;
  deterministic: boolean;
}

function teamStats(result: SeasonGameSimulationResult): {
  score: number;
  turnovers: number;
  assists: number;
  fga: number;
} {
  if (result.outcome !== 'completed') return { score: 0, turnovers: 0, assists: 0, fga: 0 };
  return {
    score: result.home.score + result.away.score,
    turnovers: result.home.box.turnovers + result.away.box.turnovers,
    assists: result.home.box.assists + result.away.box.assists,
    fga: result.home.box.fieldGoals.attempted + result.away.box.fieldGoals.attempted,
  };
}

export interface SeasonEffectsEngineDeps extends SeasonGameEngineDeps {
  simulateSeasonGameWithEffects: typeof simulateSeasonGameWithEffects;
  createSeasonEffectsState: typeof createSeasonEffectsState;
}

export function simulateSeasonEffectsGameFacts(
  fixtureId: string,
  seedIndex: number,
  input: SeasonGameSimulationInput,
  deps: SeasonEffectsEngineDeps,
): SeasonEffectsGameFacts {
  const context = createEngineContext();
  const neutral = deps.simulateSeasonGame(input, context);
  const { state } = representativeEffectsState(input);
  const first = deps.simulateSeasonGameWithEffects(input, context, state);
  const second = deps.simulateSeasonGameWithEffects(input, context, state);
  const checks = neutral.outcome === 'completed' ? deps.checkSeasonGameResult(neutral, input) : [];
  const completed = first.result.outcome === 'completed';
  if (completed) {
    // The effects result must pass every structural accounting check; the
    // neutral-replay determinism check inside checkSeasonGameResult is
    // expected to differ (effects change the game), so determinism is
    // verified separately by the double-run below.
    checks.push(
      ...deps
        .checkSeasonGameResult(first.result, input)
        .filter((failure) => !failure.startsWith('determinism:')),
    );
  }
  const neutralStats = teamStats(neutral);
  const effectsStats = teamStats(first.result);
  return {
    fixtureId,
    seedIndex,
    completed,
    checks,
    neutralScore: neutralStats.score,
    effectsScore: effectsStats.score,
    neutralTurnovers: neutralStats.turnovers,
    effectsTurnovers: effectsStats.turnovers,
    neutralAssists: neutralStats.assists,
    effectsAssists: effectsStats.assists,
    neutralFga: neutralStats.fga,
    effectsFga: effectsStats.fga,
    deterministic: JSON.stringify(first.result) === JSON.stringify(second.result),
  };
}

export interface SeasonEffectsCohortRequest {
  fixtures: Array<{ fixtureId: string; path: string }>;
  seedIndices: number[];
  workers: number;
}

export type SeasonEffectsCohortRunner = (
  request: SeasonEffectsCohortRequest,
) => Promise<SeasonEffectsGameFacts[]>;

/** Worker-based cohort runner: one worker per (fixture, seed-range chunk). */
export async function runSeasonEffectsCohort(
  request: SeasonEffectsCohortRequest,
): Promise<SeasonEffectsGameFacts[]> {
  const promises: Array<Promise<SeasonEffectsGameFacts[]>> = [];
  for (const fixture of request.fixtures) {
    promises.push(
      runWorkerChunks<number, SeasonEffectsGameFacts>({
        workerUrl: new URL('./season-effects-calibration-worker.ts', import.meta.url),
        workerData: (seedIndices) => ({
          fixtureId: fixture.fixtureId,
          fixturePath: fixture.path,
          seedIndices,
        }),
        items: request.seedIndices,
        workers: request.workers,
        payloadKey: 'facts',
      }),
    );
  }
  const chunks = await Promise.all(promises);
  return chunks.flat();
}

export function runSeasonEffectsCohortInProcess(
  request: SeasonEffectsCohortRequest,
  deps: SeasonEffectsEngineDeps,
): Promise<SeasonEffectsGameFacts[]> {
  const facts: SeasonEffectsGameFacts[] = [];
  for (const fixture of request.fixtures) {
    const parsed = seasonGameFixtureSchema.safeParse(readJsonFile(fixture.path));
    if (!parsed.success) {
      throw new Error(`season game fixture ${fixture.fixtureId} fails validation`);
    }
    for (const index of request.seedIndices) {
      const seed = seasonGameCalibrationSeed(index);
      const input = seasonGameSimulationInputSchema.parse({
        ...withFixtureStamina(parsed.data.input),
        seed,
      });
      facts.push(simulateSeasonEffectsGameFacts(fixture.fixtureId, index, input, deps));
    }
  }
  return Promise.resolve(facts);
}

function pct(delta: number, base: number): number {
  return base === 0 ? 0 : (delta / base) * 100;
}

/**
 * Percentile with p as a percentage (1..99) and nearest-rank rounding; kept
 * local because the frozen `effect-targets-v1` coverage envelopes were
 * authored with it (the canonical `stats.percentile` takes a fraction and
 * floors the index).
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((p / 100) * (sorted.length - 1))),
  );
  return sorted[index] ?? 0;
}

function coverageWithin(deltas: number[], low: number, high: number): number {
  if (deltas.length === 0) return 0;
  return deltas.filter((delta) => delta >= low && delta <= high).length / deltas.length;
}

/** Mini-season: ten consecutive games with between-game recovery ticks. */
export function runMiniSeason(
  input: SeasonGameSimulationInput,
  deps: SeasonEffectsEngineDeps,
  unitOverride?: { homeUnit: string[]; awayUnit: string[]; rollingUnit?: boolean },
): SeasonEffectsState {
  const { state, staminaByVersion } = representativeEffectsState(input);
  let current = state;
  let previousRound = 0;
  const homeVersions = input.home.players.map((player) => player.playerVersionId);
  const awayVersions = input.away.players.map((player) => player.playerVersionId);
  for (let round = 1; round <= 10; round += 1) {
    if (previousRound !== 0) {
      current = applySeasonRecoveryTick(current, staminaByVersion);
    }
    previousRound = round;
    let gameInput: SeasonGameSimulationInput = {
      ...input,
      seed: seasonGameCalibrationSeed(round),
    };
    if (unitOverride !== undefined) {
      const rolling = (base: readonly string[], round_: number): string[] => {
        const offset = (round_ * 2) % base.length;
        return [...base.slice(offset), ...base.slice(0, offset)].slice(0, 5);
      };
      const homeUnit =
        unitOverride.rollingUnit === true
          ? rolling(homeVersions, round)
          : [...unitOverride.homeUnit];
      const awayUnit =
        unitOverride.rollingUnit === true
          ? rolling(awayVersions, round)
          : [...unitOverride.awayUnit];
      gameInput = {
        ...gameInput,
        homeRotation: {
          ...input.homeRotation,
          starters: homeUnit,
          closingFive: homeUnit,
        },
        awayRotation: {
          ...input.awayRotation,
          starters: awayUnit,
          closingFive: awayUnit,
        },
      };
    }
    const { transition } = deps.simulateSeasonGameWithEffects(
      gameInput,
      createEngineContext(),
      current,
    );
    current = {
      schemaVersion: 1,
      playerStates: transition.postgamePlayerStates,
      pairStates: current.pairStates.map((pair) => {
        const increment = transition.pairIncrements.find(
          (inc) => inc.a === pair.a && inc.b === pair.b,
        );
        return increment === undefined
          ? pair
          : { ...pair, sharedPossessions: pair.sharedPossessions + increment.sharedPossessions };
      }),
    };
  }
  return current;
}

function medianFatigueOf(state: SeasonEffectsState, versions: readonly string[]): number {
  const values = versions
    .map((version) => state.playerStates.find((player) => player.playerVersionId === version))
    .filter((player): player is NonNullable<typeof player> => player !== undefined)
    .map((player) => player.fatigueBasisPoints);
  return median(values);
}

/** Sensitivity: per-mechanism delta response across fatigue levels. */
export function seasonEffectsSensitivity(
  args: SeasonEffectsArgs,
  deps: SeasonEffectsEngineDeps = defaultEffectsEngineDeps,
): CliReport {
  const started = Date.now();
  const fixtureId = opt(args, 'fixture', 'season-game-balanced');
  const fixture = loadSeasonGameFixture(fixtureId);
  const input = seasonGameSimulationInputSchema.parse({
    ...withFixtureStamina(fixture.input),
    seed: seasonGameCalibrationSeed(0),
  });
  const { state, homeStamina, awayStamina } = representativeEffectsState(input);
  const fatigueLevels = [0, 2000, 4000, 6000, 8000, 10000];
  const rows: Array<{
    fatigueBp: number;
    shooterDelta: number;
    handlerDelta: number;
    defenseDelta: number;
    securityDelta: number;
    assistDelta: number;
    helpDelta: number;
  }> = [];
  for (const fatigueBp of fatigueLevels) {
    const leveled: SeasonEffectsState = {
      schemaVersion: 1,
      playerStates: state.playerStates.map((player) => ({
        ...player,
        fatigueBasisPoints:
          player.fatigueBasisPoints > 0 || fatigueBp === 0 ? fatigueBp : player.fatigueBasisPoints,
      })),
      pairStates: state.pairStates,
    };
    const { transition } = deps.simulateSeasonGameWithEffects(
      input,
      createEngineContext(),
      leveled,
    );
    const row = {
      fatigueBp,
      shooterDelta: 0,
      handlerDelta: 0,
      defenseDelta: 0,
      securityDelta: 0,
      assistDelta: 0,
      helpDelta: 0,
    };
    for (const evidence of transition.evidence) {
      const delta = evidence.deltaTotals;
      const byMechanism: Partial<Record<SeasonMechanism, keyof typeof row>> = {
        'shooter-fatigue': 'shooterDelta',
        'handler-fatigue': 'handlerDelta',
        'defensive-unit-fatigue': 'defenseDelta',
        'turnover-security': 'securityDelta',
        'assist-conversion': 'assistDelta',
        'help-defense': 'helpDelta',
      };
      const field = byMechanism[evidence.mechanism];
      if (field !== undefined) row[field] = delta;
    }
    rows.push(row);
  }
  void homeStamina;
  void awayStamina;
  const payload = seasonEffectsSensitivityReportSchema.parse({
    schemaVersion: 1,
    command: 'season effects sensitivity',
    fixtureId,
    fatigueLevels,
    rows,
    durationMs: Date.now() - started,
  });
  const details = rows.map(
    (row) =>
      `fatigue ${String(row.fatigueBp).padStart(5)}bp Â· shooter ${String(row.shooterDelta)} Â· handler ${String(row.handlerDelta)} Â· defense ${String(row.defenseDelta)} Â· security ${String(row.securityDelta)} Â· assist ${String(row.assistDelta)} Â· help ${String(row.helpDelta)} (millionths)`,
  );
  return makeReport('season effects sensitivity', { fixture: fixtureId }, { details, payload });
}

/** Distribution: production deltas vs the neutral cohort across seeds. */
export async function seasonEffectsDistribution(
  args: SeasonEffectsArgs,
  runner: SeasonEffectsCohortRunner = runSeasonEffectsCohort,
): Promise<CliReport> {
  const started = Date.now();
  const from = parseCount(args['seed-from'] ?? undefined, '--seed-from', 0);
  const to = parseCount(
    args['seed-to'] ?? undefined,
    '--seed-to',
    SEASON_EFFECTS_CALIBRATION_SEED_COUNT - 1,
  );
  const workers = parseCount(args['workers'] ?? undefined, '--workers', 4);
  const fixtureRefs = opt(args, 'fixture', SEASON_EFFECTS_PRESET_FIXTURES.join(','));
  const fixtureIds = fixtureRefs.split(',').map((ref) => ref.trim());
  const fixtures = fixtureIds.map((fixtureId) => ({
    fixtureId,
    path: resolveSeasonGameFixturePath(fixtureId),
  }));
  const facts = await runner({ fixtures, seedIndices: seedIndexRange(from, to), workers });
  const completed = facts.filter((fact) => fact.completed);
  const scoringDeltas = completed.map((fact) =>
    pct(fact.effectsScore - fact.neutralScore, fact.neutralScore),
  );
  const turnoverDeltas = completed.map((fact) =>
    pct(fact.effectsTurnovers - fact.neutralTurnovers, fact.neutralTurnovers),
  );
  const assistDeltas = completed.map((fact) =>
    pct(fact.effectsAssists - fact.neutralAssists, fact.neutralAssists),
  );
  const failures = completed.flatMap((fact) => fact.checks);
  const determinismFailures = completed.filter((fact) => !fact.deterministic).length;
  const envelope = (deltas: number[], max: number): number =>
    deltas.filter((delta) => Math.abs(delta) <= max * 100).length / Math.max(1, deltas.length);
  const payload = seasonEffectsDistributionReportSchema.parse({
    schemaVersion: 1,
    command: 'season effects distribution',
    fixtureIds,
    seedFrom: from,
    seedTo: to,
    gamesSimulated: facts.length,
    completedGames: completed.length,
    scoringDeltaMedian: median(scoringDeltas),
    turnoverDeltaMedian: median(turnoverDeltas),
    assistDeltaMedian: median(assistDeltas),
    scoringWithinEnvelope: envelope(scoringDeltas, SEASON_EFFECTS_SCORING_ENVELOPE),
    turnoverWithinEnvelope: envelope(turnoverDeltas, SEASON_EFFECTS_TURNOVER_ENVELOPE),
    assistWithinEnvelope: envelope(assistDeltas, SEASON_EFFECTS_ASSIST_ENVELOPE),
    checkFailures: failures.length,
    determinismFailures,
    durationMs: Date.now() - started,
  });
  const details = [
    `${String(facts.length)} games (${String(completed.length)} completed) in ${String(Date.now() - started)}ms`,
    `scoring delta median ${payload.scoringDeltaMedian.toFixed(3)}% (gate Â±${String(SEASON_EFFECTS_SCORING_ENVELOPE * 100)}%)`,
    `turnover delta median ${payload.turnoverDeltaMedian.toFixed(3)}% (gate Â±${String(SEASON_EFFECTS_TURNOVER_ENVELOPE * 100)}%)`,
    `assist delta median ${payload.assistDeltaMedian.toFixed(3)}% (gate Â±${String(SEASON_EFFECTS_ASSIST_ENVELOPE * 100)}%)`,
  ];
  const failuresList: string[] = [];
  if (failures.length > 0)
    failuresList.push(`${String(failures.length)} accounting/invariant check failures`);
  if (determinismFailures > 0)
    failuresList.push(`${String(determinismFailures)} determinism failures`);
  return makeReport(
    'season effects distribution',
    { fixtureIds, seedFrom: from, seedTo: to },
    { details, failures: failuresList, payload },
  );
}

/** Roles: ten-game mini seasons per rotation preset; workload ordering. */
export function seasonEffectsRoles(
  args: SeasonEffectsArgs,
  deps: SeasonEffectsEngineDeps = defaultEffectsEngineDeps,
): CliReport {
  const started = Date.now();
  const fixtureIds = opt(args, 'fixture', SEASON_EFFECTS_PRESET_FIXTURES.join(','))
    .split(',')
    .map((ref) => ref.trim());
  const rows: Array<{
    fixtureId: string;
    starterMedianFatigue: number;
    benchMedianFatigue: number;
  }> = [];
  for (const fixtureId of fixtureIds) {
    const fixture = loadSeasonGameFixture(fixtureId);
    const input = seasonGameSimulationInputSchema.parse(withFixtureStamina(fixture.input));
    const finalState = runMiniSeason(input, deps);
    const starterVersions = input.homeRotation.starters;
    const benchVersions = input.home.players
      .map((player) => player.playerVersionId)
      .filter((version) => !starterVersions.includes(version));
    rows.push({
      fixtureId,
      starterMedianFatigue: medianFatigueOf(finalState, starterVersions),
      benchMedianFatigue: medianFatigueOf(finalState, benchVersions),
    });
  }
  const byId = new Map(rows.map((row) => [row.fixtureId, row]));
  const tight = byId.get('season-game-tight');
  const balanced = byId.get('season-game-balanced');
  const benchHeavy = byId.get('season-game-bench-heavy');
  const starterOrdering =
    tight !== undefined &&
    balanced !== undefined &&
    benchHeavy !== undefined &&
    tight.starterMedianFatigue > balanced.starterMedianFatigue &&
    balanced.starterMedianFatigue > benchHeavy.starterMedianFatigue;
  const benchOrdering =
    tight !== undefined &&
    balanced !== undefined &&
    benchHeavy !== undefined &&
    tight.benchMedianFatigue < balanced.benchMedianFatigue &&
    balanced.benchMedianFatigue < benchHeavy.benchMedianFatigue;
  const payload = seasonEffectsRolesReportSchema.parse({
    schemaVersion: 1,
    command: 'season effects roles',
    rows,
    starterOrderingPass: starterOrdering,
    benchOrderingPass: benchOrdering,
    durationMs: Date.now() - started,
  });
  const details = rows.map(
    (row) =>
      `${row.fixtureId}: starter median ${String(row.starterMedianFatigue)}bp Â· bench median ${String(row.benchMedianFatigue)}bp`,
  );
  const failuresList: string[] = [];
  if (!starterOrdering)
    failuresList.push('starter median fatigue ordering (tight > balanced > bench-heavy) failed');
  if (!benchOrdering) failuresList.push('bench median fatigue ordering (inverse) failed');
  return makeReport(
    'season effects roles',
    { fixtureIds },
    { details, failures: failuresList, payload },
  );
}

/** Chemistry separation: stable vs deliberately shuffled rotation after ten games. */
export function seasonEffectsChemistrySeparation(deps: SeasonEffectsEngineDeps): {
  stableMedianBp: number;
  shuffledMedianBp: number;
  separationBp: number;
} {
  const fixture = loadSeasonGameFixture('season-game-balanced');
  const input = seasonGameSimulationInputSchema.parse(withFixtureStamina(fixture.input));
  const homeVersions = input.home.players.map((player) => player.playerVersionId);
  const starters = [...input.homeRotation.starters];
  const stableState = runMiniSeason(input, deps);
  // The shuffled arm fields a different five every game (deterministic
  // rolling window), so no pair accumulates meaningful shared play.
  const shuffledState = runMiniSeason(input, deps, {
    homeUnit: homeVersions.slice(0, 5),
    awayUnit: homeVersions.slice(5),
    rollingUnit: true,
  });
  const stableMedian = unitChemistryBasisPoints(stableState.pairStates, starters);
  const shuffledMedian = unitChemistryBasisPoints(
    shuffledState.pairStates,
    homeVersions.slice(0, 5),
  );
  return {
    stableMedianBp: stableMedian,
    shuffledMedianBp: shuffledMedian,
    separationBp: stableMedian - shuffledMedian,
  };
}

export async function seasonEffectsCalibrate(
  args: SeasonEffectsArgs,
  deps: SeasonEffectsEngineDeps = defaultEffectsEngineDeps,
  runner: SeasonEffectsCohortRunner = runSeasonEffectsCohort,
): Promise<CliReport> {
  const started = Date.now();
  const workers = parseCount(args['workers'] ?? undefined, '--workers', 4);
  const outPath = args.out ?? DEFAULT_EFFECT_TARGETS;
  const validateOnly = args['validate'] !== undefined && args['validate'] !== null;
  const fixtureRefs = opt(args, 'fixture', SEASON_EFFECTS_PRESET_FIXTURES.join(','));
  const fixtureIds = fixtureRefs.split(',').map((ref) => ref.trim());

  if (validateOnly) {
    return validateSeasonEffectTargets(args, outPath);
  }

  const fixtures = fixtureIds.map((fixtureId) => ({
    fixtureId,
    path: resolveSeasonGameFixturePath(fixtureId),
  }));
  const calibrationIndices = seedIndexRange(0, SEASON_EFFECTS_CALIBRATION_SEED_COUNT - 1);
  const validationIndices = seedIndexRange(
    SEASON_EFFECTS_CALIBRATION_SEED_COUNT,
    SEASON_EFFECTS_CALIBRATION_SEED_COUNT + SEASON_EFFECTS_VALIDATION_SEED_COUNT - 1,
  );

  const calibrationFacts = await runner({ fixtures, seedIndices: calibrationIndices, workers });
  const validationFacts = await runner({
    fixtures,
    seedIndices: validationIndices,
    workers: Math.max(1, Math.min(workers, 4)),
  });

  const fold = (
    facts: SeasonEffectsGameFacts[],
  ): {
    scoringMedian: number;
    turnoverMedian: number;
    assistMedian: number;
    scoringDeltas: number[];
    turnoverDeltas: number[];
    assistDeltas: number[];
    checkFailures: number;
    determinismFailures: number;
    games: number;
  } => {
    const completed = facts.filter((fact) => fact.completed);
    const scoring = completed.map((fact) =>
      pct(fact.effectsScore - fact.neutralScore, fact.neutralScore),
    );
    const turnovers = completed.map((fact) =>
      pct(fact.effectsTurnovers - fact.neutralTurnovers, fact.neutralTurnovers),
    );
    const assists = completed.map((fact) =>
      pct(fact.effectsAssists - fact.neutralAssists, fact.neutralAssists),
    );
    return {
      scoringMedian: median(scoring),
      turnoverMedian: median(turnovers),
      assistMedian: median(assists),
      scoringDeltas: scoring,
      turnoverDeltas: turnovers,
      assistDeltas: assists,
      checkFailures: completed.flatMap((fact) => fact.checks).length,
      determinismFailures: completed.filter((fact) => !fact.deterministic).length,
      games: facts.length,
    };
  };

  const calibration = fold(calibrationFacts);
  const heldOut = fold(validationFacts);

  // Held-out coverage: per-game deltas of the held-out cohort inside the
  // calibration cohort's p1..p99 envelope per metric (binomial game noise is
  // far wider than the cohort-level envelope, so coverage is measured
  // against the calibration-derived distribution, not a fixed percentage).
  const heldOutCoverage = (deltas: number[], envelope: number[]): number =>
    coverageWithin(deltas, percentile(envelope, 1), percentile(envelope, 99));
  const heldOutWithinEnvelopeShare = Math.min(
    heldOutCoverage(heldOut.scoringDeltas, calibration.scoringDeltas),
    heldOutCoverage(heldOut.turnoverDeltas, calibration.turnoverDeltas),
    heldOutCoverage(heldOut.assistDeltas, calibration.assistDeltas),
  );

  const rolesReport = seasonEffectsRoles({ fixture: fixtureIds.join(',') }, deps);
  const rolesPayload = seasonEffectsRolesReportSchema.parse(rolesReport.payload);
  const roleRow = new Map(rolesPayload.rows.map((row) => [row.fixtureId, row]));
  const tightRow = roleRow.get('season-game-tight');
  const balancedRow = roleRow.get('season-game-balanced');
  const benchHeavyRow = roleRow.get('season-game-bench-heavy');

  const chemistry = seasonEffectsChemistrySeparation(deps);

  // Sensitivity monotonicity probe: the fatigue-driven mechanism deltas grow
  // with the fatigue input (the chemistry-driven ones are constant by design
  // and vary only with opportunity counts).
  const sensitivityReport = seasonEffectsSensitivity({ fixture: 'season-game-balanced' }, deps);
  const sensitivityPayload = seasonEffectsSensitivityReportSchema.parse(sensitivityReport.payload);
  const rows = sensitivityPayload.rows;
  let sensitivityMonotonic = rows.length >= 2;
  for (let i = 1; i < rows.length && sensitivityMonotonic; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (prev === undefined || cur === undefined) continue;
    if (Math.abs(cur.shooterDelta) < Math.abs(prev.shooterDelta)) sensitivityMonotonic = false;
    if (Math.abs(cur.handlerDelta) < Math.abs(prev.handlerDelta)) sensitivityMonotonic = false;
    if (Math.abs(cur.defenseDelta) < Math.abs(prev.defenseDelta)) sensitivityMonotonic = false;
  }

  const zeroFailures = calibration.checkFailures === 0 && heldOut.checkFailures === 0;
  const determinism = calibration.determinismFailures === 0 && heldOut.determinismFailures === 0;
  const productionEnvelopes =
    Math.abs(calibration.scoringMedian) <= SEASON_EFFECTS_SCORING_ENVELOPE * 100 &&
    Math.abs(calibration.turnoverMedian) <= SEASON_EFFECTS_TURNOVER_ENVELOPE * 100 &&
    Math.abs(calibration.assistMedian) <= SEASON_EFFECTS_ASSIST_ENVELOPE * 100 &&
    Math.abs(heldOut.scoringMedian) <= SEASON_EFFECTS_SCORING_ENVELOPE * 100 &&
    Math.abs(heldOut.turnoverMedian) <= SEASON_EFFECTS_TURNOVER_ENVELOPE * 100 &&
    Math.abs(heldOut.assistMedian) <= SEASON_EFFECTS_ASSIST_ENVELOPE * 100;
  const heldOutPassShare = heldOutWithinEnvelopeShare >= SEASON_EFFECTS_HELD_OUT_PASS_SHARE;
  const rotationOrdering = rolesPayload.starterOrderingPass && rolesPayload.benchOrderingPass;
  const chemistrySeparationPass = chemistry.separationBp >= SEASON_EFFECTS_CHEMISTRY_SEPARATION_BP;

  const gates = {
    zeroFailures,
    determinism,
    productionEnvelopes,
    heldOutPassShare,
    rotationOrdering,
    chemistrySeparation: chemistrySeparationPass,
    sensitivityMonotonic,
  };
  const pass = Object.values(gates).every(Boolean);

  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  if (pass) {
    const targets: SeasonEffectTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_EFFECT_TARGETS_VERSION,
      mechanismCaps: {
        shooterFatiguePp: SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP,
        handlerFatiguePp: SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP,
        defenseFatiguePp: SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP,
        turnoverSecurityPp: SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP,
        assistConversionPp: SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP,
        helpDefensePp: SEASON_EFFECTS_HELP_DEFENSE_MAX_PP,
      },
      productionEnvelopes: {
        scoringDeltaMax: SEASON_EFFECTS_SCORING_ENVELOPE,
        turnoverRateDeltaMax: SEASON_EFFECTS_TURNOVER_ENVELOPE,
        assistRateDeltaMax: SEASON_EFFECTS_ASSIST_ENVELOPE,
      },
      chemistrySeparationBp: SEASON_EFFECTS_CHEMISTRY_SEPARATION_BP,
      cohort: { seedFrom: 0, seedTo: SEASON_EFFECTS_CALIBRATION_SEED_COUNT - 1 },
      heldOut: {
        seedFrom: SEASON_EFFECTS_CALIBRATION_SEED_COUNT,
        seedTo: SEASON_EFFECTS_CALIBRATION_SEED_COUNT + SEASON_EFFECTS_VALIDATION_SEED_COUNT - 1,
      },
      measured: {
        calibration: {
          scoringDeltaMedian: calibration.scoringMedian,
          turnoverDeltaMedian: calibration.turnoverMedian,
          assistDeltaMedian: calibration.assistMedian,
          gamesSimulated: calibration.games,
          zeroFailures,
          determinismFailures: calibration.determinismFailures + heldOut.determinismFailures,
        },
        heldOut: {
          scoringDeltaMedian: heldOut.scoringMedian,
          turnoverDeltaMedian: heldOut.turnoverMedian,
          assistDeltaMedian: heldOut.assistMedian,
          withinEnvelopeShare: heldOutWithinEnvelopeShare,
          gamesSimulated: heldOut.games,
        },
        roles: {
          tightStarterMedianFatigue: tightRow?.starterMedianFatigue ?? 0,
          balancedStarterMedianFatigue: balancedRow?.starterMedianFatigue ?? 0,
          benchHeavyStarterMedianFatigue: benchHeavyRow?.starterMedianFatigue ?? 0,
          tightBenchMedianFatigue: tightRow?.benchMedianFatigue ?? 0,
          balancedBenchMedianFatigue: balancedRow?.benchMedianFatigue ?? 0,
          benchHeavyBenchMedianFatigue: benchHeavyRow?.benchMedianFatigue ?? 0,
        },
        chemistry: {
          stableUnitMedianBp: chemistry.stableMedianBp,
          shuffledUnitMedianBp: chemistry.shuffledMedianBp,
          separationBp: chemistry.separationBp,
        },
      },
      gates,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonEffectTargetsSchema.parse(targets);
    const commit = commitTargetsArtifact({
      outPath,
      defaultTargetsPath: DEFAULT_EFFECT_TARGETS,
      manifestPath: args.manifest ?? DEFAULT_MANIFEST,
      manifestKey: 'effectTargets',
      manifestUrl: 'season/effect-targets.json',
      content: targets,
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    if (commit.error !== null) gateFailures.push(commit.error);
  }

  const payload = seasonEffectsCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season effects calibrate',
    targetsVersion: SEASON_EFFECT_TARGETS_VERSION,
    calibrationSeedCount: calibrationIndices.length,
    validationSeedCount: validationIndices.length,
    calibrationGames: calibration.games,
    heldOutGames: heldOut.games,
    calibrationScoringDeltaMedian: calibration.scoringMedian,
    calibrationTurnoverDeltaMedian: calibration.turnoverMedian,
    calibrationAssistDeltaMedian: calibration.assistMedian,
    heldOutWithinEnvelopeShare: heldOutWithinEnvelopeShare,
    stableUnitMedianBp: chemistry.stableMedianBp,
    shuffledUnitMedianBp: chemistry.shuffledMedianBp,
    chemistrySeparationBp: chemistry.separationBp,
    gates,
    targetsWritten,
    targetsPath,
    durationMs: Date.now() - started,
  });

  const details = [
    `calibration ${String(calibration.games)} games Â· held-out ${String(heldOut.games)} games (${String(workers)} workers)`,
    `scoring delta ${calibration.scoringMedian.toFixed(3)}% Â· turnover ${calibration.turnoverMedian.toFixed(3)}% Â· assist ${calibration.assistMedian.toFixed(3)}%`,
    `held-out envelope share ${(heldOutWithinEnvelopeShare * 100).toFixed(1)}% (gate â‰¥ ${String(SEASON_EFFECTS_HELD_OUT_PASS_SHARE * 100)}%)`,
    `rotation ordering ${rolesPayload.starterOrderingPass ? 'pass' : 'fail'} Â· bench ${rolesPayload.benchOrderingPass ? 'pass' : 'fail'}`,
    `chemistry separation ${String(chemistry.separationBp)}bp (gate â‰¥ ${String(SEASON_EFFECTS_CHEMISTRY_SEPARATION_BP)}bp)`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (!zeroFailures) gateFailures.push('accounting/invariant failures in the cohort');
  if (!determinism) gateFailures.push('determinism failures in the cohort');
  if (!productionEnvelopes)
    gateFailures.push('production envelope gates failed on the calibration cohort');
  if (!heldOutPassShare)
    gateFailures.push(
      `held-out envelope share below ${String(SEASON_EFFECTS_HELD_OUT_PASS_SHARE * 100)}%`,
    );
  if (!rotationOrdering) gateFailures.push('rotation workload ordering gates failed');
  if (!chemistrySeparationPass) gateFailures.push('chemistry separation gate failed');
  if (!sensitivityMonotonic) gateFailures.push('sensitivity monotonicity gate failed');
  if (pass && !targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season effects calibrate',
    { fixtureIds, workers },
    { details, failures: gateFailures, payload },
  );
}

/** Validates a committed effect-targets artifact against the engine. */
export function validateSeasonEffectTargets(args: SeasonEffectsArgs, outPath: string): CliReport {
  void args;
  return validateTargetsArtifact({
    outPath,
    schema: seasonEffectTargetsSchema,
    command: 'season effects calibrate --validate',
    extraChecks: (parsed) => {
      const expectedCaps = {
        shooterFatiguePp: SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP,
        handlerFatiguePp: SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP,
        defenseFatiguePp: SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP,
        turnoverSecurityPp: SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP,
        assistConversionPp: SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP,
        helpDefensePp: SEASON_EFFECTS_HELP_DEFENSE_MAX_PP,
      };
      const capsMatch = Object.entries(expectedCaps).every(
        ([key, value]) => parsed.mechanismCaps[key as keyof typeof parsed.mechanismCaps] === value,
      );
      return capsMatch
        ? { details: ['mechanism caps match the engine constants'], failures: [] }
        : { details: [], failures: ['artifact mechanism caps do not match the engine constants'] };
    },
  });
}

export async function seasonEffectsCommand(
  args: SeasonEffectsArgs,
  extra: string[],
  deps: SeasonEffectsEngineDeps = {
    simulateSeasonGame,
    checkSeasonGameResult,
    simulateSeasonGameWithEffects,
    createSeasonEffectsState,
  },
  runner: SeasonEffectsCohortRunner = runSeasonEffectsCohort,
): Promise<CliReport> {
  const subcommand = extra[0] ?? '';
  switch (subcommand) {
    case 'sensitivity':
      return seasonEffectsSensitivity(args, deps);
    case 'distribution':
      return seasonEffectsDistribution(args, runner);
    case 'roles':
      return seasonEffectsRoles(args, deps);
    case 'calibrate':
      return seasonEffectsCalibrate(args, deps, runner);
    default:
      throw new UsageError(
        'season effects requires a subcommand: sensitivity | distribution | roles | calibrate',
      );
  }
}
