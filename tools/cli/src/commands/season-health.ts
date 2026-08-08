import { resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_GAME_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  type SeasonInjuryRecord,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  rollSeasonInjuryForPlayer,
  type SeasonInjuryRollInput,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonHealthCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR } from './season-data.ts';
import {
  m25ToleranceGate,
  m25LiftGate,
  m25GapGate,
  gateValue,
  gateSummary,
  mean,
  rateBasisPoints,
  seasonCalibrationSeed,
  seedIndexRange,
  share,
  type M25Gate,
} from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';

/**
 * `season health calibrate` (spec/2.0 M2.5, contract §17): freezes
 * `injury-targets-v1` from a season cohort (blocks 0-8 through the engine
 * health pipeline) plus a roll-level risk probe. The cohort observes
 * incidence (bp), severity shares, per-severity recovery means, same-game
 * return, season-ending rate, and the strong-vs-weak standings gap; its
 * mean risk sits a few bp above the 80 bp base because the additive risk
 * inputs are positive on average in the fixture — the frozen ±15 bp
 * envelope accommodates that by design. The roll-level probe isolates the
 * formula's sensitivity (season sim does not expose per-exposure inputs):
 * monotonicity (minutes↑/fatigue↑/durability↓ ⇒ incidence↑) and a frozen
 * absolute recurrence gap of ≥15 bp (a ratio gate would be unattainable at
 * this baseline; 15 bp is a measurable floor at the cohort sizes used).
 * Cohort: 16 calibration + 4 held-out seasons (~3,000 injuries); the
 * runner is in-process (a worker variant is deferred).
 */

export const SEASON_HEALTH_CALIBRATE_OPTIONS: Record<string, boolean> = {
  input: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_INJURY_TARGETS = resolve(DEFAULT_SEASON_DIR, 'injury-targets.json');

export const SEASON_HEALTH_CALIBRATION_SEED_COUNT = 16;
export const SEASON_HEALTH_VALIDATION_SEED_COUNT = 4;

/** Minimum exposures before an incidence/severity gate evaluates. */
export const SEASON_HEALTH_MIN_EXPOSURES = 50_000;
/** Minimum injuries before the duration-means gates evaluate. */
export const SEASON_HEALTH_MIN_INJURIES = 300;

/** Frozen §5 profile constants the gates compare against. */
export const SEASON_HEALTH_BASE_RISK_BP = 80;
export const SEASON_HEALTH_RISK_ENVELOPE_BP = 15;
export const SEASON_HEALTH_SEVERITY_TARGETS = {
  minor: 0.6,
  moderate: 0.28,
  major: 0.1,
  seasonEnding: 0.02,
} as const;
export const SEASON_HEALTH_SEVERITY_TOLERANCE_PP = 3;
/** Recovery-range midpoints: minor 1-2, moderate 3-6, major 7-18. */
export const SEASON_HEALTH_DURATION_TARGETS = { minor: 1.5, moderate: 4.5, major: 12.5 } as const;
export const SEASON_HEALTH_DURATION_TOLERANCE_GAMES = 1;
export const SEASON_HEALTH_SAME_GAME_RETURN_TARGET = 0.35;
export const SEASON_HEALTH_SAME_GAME_RETURN_TOLERANCE_PP = 5;
export const SEASON_HEALTH_SEASON_ENDING_TOLERANCE_PP = 1;
/** Frozen absolute recurrence gap (documented choice, see module docstring). */
export const SEASON_HEALTH_RECURRENCE_MIN_GAP_BP = 15;
/** Frozen standings-independence gap (documented choice: ~3 sigma at the
 * cohort's ~180k exposures per group; the model has zero standings inputs). */
export const SEASON_HEALTH_STANDINGS_MAX_GAP_BP = 8;
/** Exposures per arm of the roll-level monotonicity/recurrence probes. */
export const SEASON_HEALTH_PROBE_EXPOSURES = 200_000;
export const SEASON_HEALTH_PROBE_MIN_EXPOSURES = 100_000;

/** The targets artifact frozen by `season health calibrate`. */
export const seasonInjuryTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  profile: z.object({
    baseRiskBasisPoints: z.literal(80),
    riskClamp: z.tuple([z.literal(20), z.literal(220)]),
    severityShares: z.object({
      minor: z.literal(0.6),
      moderate: z.literal(0.28),
      major: z.literal(0.1),
      seasonEnding: z.literal(0.02),
    }),
    recoveryRanges: z.object({
      minor: z.tuple([z.literal(1), z.literal(2)]),
      moderate: z.tuple([z.literal(3), z.literal(6)]),
      major: z.tuple([z.literal(7), z.literal(18)]),
    }),
    sameGameReturnRate: z.literal(0.35),
    recurrenceBonusBasisPoints: z.literal(40),
    recurrenceWindowTeamGames: z.literal(10),
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
    calibration: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      exposures: z.number().int().nonnegative(),
      injuries: z.number().int().nonnegative(),
      meanRiskBasisPoints: z.number().nonnegative(),
      severityShares: z.object({
        minor: z.number().min(0).max(1),
        moderate: z.number().min(0).max(1),
        major: z.number().min(0).max(1),
        seasonEnding: z.number().min(0).max(1),
      }),
      durationMeans: z.object({
        minor: z.number(),
        moderate: z.number(),
        major: z.number(),
      }),
      sameGameReturnRate: z.number().min(0).max(1),
      recurrence: z.object({
        windowIncidenceBp: z.number().nonnegative(),
        nonWindowIncidenceBp: z.number().nonnegative(),
        gapBp: z.number(),
        ratio: z.number(),
      }),
      seasonEndingRate: z.number().min(0).max(1),
      standings: z.object({
        strongTeamIncidenceBp: z.number().nonnegative(),
        weakTeamIncidenceBp: z.number().nonnegative(),
        gapBp: z.number(),
      }),
    }),
    monotonicity: z.object({
      minutes: z.object({
        lowIncidenceBp: z.number().nonnegative(),
        highIncidenceBp: z.number().nonnegative(),
      }),
      fatigue: z.object({
        lowIncidenceBp: z.number().nonnegative(),
        highIncidenceBp: z.number().nonnegative(),
      }),
      durability: z.object({
        highIncidenceBp: z.number().nonnegative(),
        lowIncidenceBp: z.number().nonnegative(),
      }),
    }),
    heldOut: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      exposures: z.number().int().nonnegative(),
      injuries: z.number().int().nonnegative(),
      meanRiskBasisPoints: z.number().nonnegative(),
      severityShares: z.object({
        minor: z.number().min(0).max(1),
        moderate: z.number().min(0).max(1),
        major: z.number().min(0).max(1),
        seasonEnding: z.number().min(0).max(1),
      }),
    }),
  }),
  gates: z.object({
    incidence: z.boolean(),
    severityDistribution: z.boolean(),
    durationMeans: z.boolean(),
    sameGameReturn: z.boolean(),
    recurrenceLift: z.boolean(),
    seasonEndingRate: z.boolean(),
    monotonicMinutes: z.boolean(),
    monotonicFatigue: z.boolean(),
    monotonicDurability: z.boolean(),
    standingsIndependent: z.boolean(),
    heldOut: z.boolean(),
  }),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonInjuryTargets = z.infer<typeof seasonInjuryTargetsSchema>;

function franchiseExposures(run: SeasonRun, franchiseId: string): number {
  const rotation = run.rotations.find((entry) => entry.franchiseId === franchiseId);
  if (rotation === undefined) return 0;
  const exposed = rotation.targetMinutes.filter((entry) => entry.minutes > 0).length;
  return exposed * 82;
}

/** Season-level injury facts measured from the recorded health state. */
export interface SeasonHealthFacts {
  exposures: number;
  injuries: SeasonInjuryRecord[];
  injuriesByFranchise: Map<string, number>;
  exposuresByFranchise: Map<string, number>;
}

export function seasonHealthFactsOf(
  run: SeasonRun,
  facts: SeasonM25SeasonFacts,
): SeasonHealthFacts {
  const injuries = facts.checkpoints[facts.checkpoints.length - 1]?.health.injuries ?? [];
  const exposuresByFranchise = new Map<string, number>();
  const injuriesByFranchise = new Map<string, number>();
  let exposures = 0;
  for (const team of run.league.teams) {
    const count = franchiseExposures(run, team.franchiseId);
    exposuresByFranchise.set(team.franchiseId, count);
    exposures += count;
    injuriesByFranchise.set(team.franchiseId, 0);
  }
  for (const injury of injuries) {
    injuriesByFranchise.set(
      injury.franchiseId,
      (injuriesByFranchise.get(injury.franchiseId) ?? 0) + 1,
    );
  }
  return { exposures, injuries, injuriesByFranchise, exposuresByFranchise };
}

export function severitySharesOf(injuries: readonly SeasonInjuryRecord[]): {
  minor: number;
  moderate: number;
  major: number;
  seasonEnding: number;
} {
  const counts = { minor: 0, moderate: 0, major: 0, seasonEnding: 0 };
  for (const injury of injuries) {
    if (injury.severity === 'season-ending') counts.seasonEnding += 1;
    else counts[injury.severity] += 1;
  }
  const total = Math.max(1, injuries.length);
  return {
    minor: counts.minor / total,
    moderate: counts.moderate / total,
    major: counts.major / total,
    seasonEnding: counts.seasonEnding / total,
  };
}

/**
 * Per-severity recovery means in missed games. Same-game returns (0 missed
 * games by definition) and season-ending injuries (the 10,000 sentinel) are
 * excluded; the targets are the recovery-range midpoints (1.5 / 4.5 / 12.5).
 */
export function durationMeansOf(injuries: readonly SeasonInjuryRecord[]): {
  minor: number;
  moderate: number;
  major: number;
} {
  const bySeverity = { minor: [] as number[], moderate: [] as number[], major: [] as number[] };
  for (const injury of injuries) {
    if (injury.severity === 'season-ending') continue;
    if (injury.missedGamesTotal <= 0) continue;
    bySeverity[injury.severity].push(injury.missedGamesTotal);
  }
  return {
    minor: mean(bySeverity.minor),
    moderate: mean(bySeverity.moderate),
    major: mean(bySeverity.major),
  };
}

/** Same-game-return rate: minor-before-halftime injuries with the 35% roll. */
export function sameGameReturnRateOf(injuries: readonly SeasonInjuryRecord[]): number {
  const eligible = injuries.filter(
    (injury) => injury.severity === 'minor' && injury.occurredBeforeHalftime,
  );
  return share(eligible.filter((injury) => injury.sameGameReturn).length, eligible.length);
}

/**
 * The roll-level risk probe: one arm of exposures through the engine's
 * seeded injury roll with fixed inputs, returning the observed occurrence
 * count. The probe uses a deterministic game id so every call reproduces.
 */
export function runInjuryRollProbe(
  rootSeed: string,
  input: Omit<SeasonInjuryRollInput, 'rootSeed' | 'gameId' | 'playerVersionId' | 'franchiseId'>,
  exposures: number,
): number {
  let occurred = 0;
  for (let i = 0; i < exposures; i += 1) {
    const result = rollSeasonInjuryForPlayer({
      rootSeed,
      gameId: `s${String((i % 82) + 1).padStart(6, '0')}`,
      playerVersionId: `p-probe-${String(i % 300).padStart(3, '0')}`,
      franchiseId: `franchise-${String(i % 30)}`,
      ...input,
    });
    if (result.occurred) occurred += 1;
  }
  return occurred;
}

/** Measured calibration facts for one season cohort. */
export interface SeasonHealthCohortFacts {
  seasonsSimulated: number;
  exposures: number;
  injuries: number;
  meanRiskBasisPoints: number;
  severityShares: { minor: number; moderate: number; major: number; seasonEnding: number };
  durationMeans: { minor: number; moderate: number; major: number };
  sameGameReturnRate: number;
  seasonEndingRate: number;
  strongTeamIncidenceBp: number;
  weakTeamIncidenceBp: number;
  standingsGapBp: number;
  injuryRecords: SeasonInjuryRecord[];
}

function foldSeasonCohort(seasons: readonly SeasonM25SeasonFacts[]): SeasonHealthCohortFacts {
  let exposures = 0;
  const injuries: SeasonInjuryRecord[] = [];
  let strongInjuries = 0;
  let strongExposures = 0;
  let weakInjuries = 0;
  let weakExposures = 0;
  for (const season of seasons) {
    const facts = seasonHealthFactsOf(season.run, season);
    exposures += facts.exposures;
    injuries.push(...facts.injuries);
    const strong = new Set(
      season.run.aiAssignments
        .filter((assignment) => assignment.band === 'contender' || assignment.band === 'playoff')
        .map((assignment) => assignment.franchiseId),
    );
    for (const [franchiseId, count] of facts.injuriesByFranchise) {
      const groupExposures = facts.exposuresByFranchise.get(franchiseId) ?? 0;
      if (strong.has(franchiseId)) {
        strongInjuries += count;
        strongExposures += groupExposures;
      } else {
        weakInjuries += count;
        weakExposures += groupExposures;
      }
    }
  }
  const strongIncidenceBp = rateBasisPoints(strongInjuries, strongExposures);
  const weakIncidenceBp = rateBasisPoints(weakInjuries, weakExposures);
  const severityShares = severitySharesOf(injuries);
  return {
    seasonsSimulated: seasons.length,
    exposures,
    injuries: injuries.length,
    meanRiskBasisPoints: rateBasisPoints(injuries.length, exposures),
    severityShares,
    durationMeans: durationMeansOf(injuries),
    sameGameReturnRate: sameGameReturnRateOf(injuries),
    seasonEndingRate: severityShares.seasonEnding,
    strongTeamIncidenceBp: strongIncidenceBp,
    weakTeamIncidenceBp: weakIncidenceBp,
    standingsGapBp: strongIncidenceBp - weakIncidenceBp,
    injuryRecords: injuries,
  };
}

export function evaluateHealthGates(args: {
  calibration: ReturnType<typeof foldSeasonCohort>;
  heldOut: ReturnType<typeof foldSeasonCohort>;
  probes: {
    minutes: { lowIncidenceBp: number; highIncidenceBp: number };
    fatigue: { lowIncidenceBp: number; highIncidenceBp: number };
    durability: { highIncidenceBp: number; lowIncidenceBp: number };
    recurrence: {
      windowIncidenceBp: number;
      nonWindowIncidenceBp: number;
      gapBp: number;
      ratio: number;
    };
  };
}): M25Gate[] {
  const c = args.calibration;
  const h = args.heldOut;
  const p = args.probes;
  const exposureSample = c.exposures;
  const injurySample = c.injuries;
  const minorEligible = c.injuryRecords.filter(
    (injury) => injury.severity === 'minor' && injury.occurredBeforeHalftime,
  ).length;
  const metrics: M25Gate[] = [
    m25ToleranceGate(
      'incidence',
      c.meanRiskBasisPoints,
      SEASON_HEALTH_BASE_RISK_BP,
      SEASON_HEALTH_RISK_ENVELOPE_BP,
      exposureSample,
      SEASON_HEALTH_MIN_EXPOSURES,
    ),
    m25ToleranceGate(
      'severity.minor',
      c.severityShares.minor,
      SEASON_HEALTH_SEVERITY_TARGETS.minor,
      SEASON_HEALTH_SEVERITY_TOLERANCE_PP / 100,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'severity.moderate',
      c.severityShares.moderate,
      SEASON_HEALTH_SEVERITY_TARGETS.moderate,
      SEASON_HEALTH_SEVERITY_TOLERANCE_PP / 100,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'severity.major',
      c.severityShares.major,
      SEASON_HEALTH_SEVERITY_TARGETS.major,
      SEASON_HEALTH_SEVERITY_TOLERANCE_PP / 100,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'duration.minor',
      c.durationMeans.minor,
      SEASON_HEALTH_DURATION_TARGETS.minor,
      SEASON_HEALTH_DURATION_TOLERANCE_GAMES,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'duration.moderate',
      c.durationMeans.moderate,
      SEASON_HEALTH_DURATION_TARGETS.moderate,
      SEASON_HEALTH_DURATION_TOLERANCE_GAMES,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'duration.major',
      c.durationMeans.major,
      SEASON_HEALTH_DURATION_TARGETS.major,
      SEASON_HEALTH_DURATION_TOLERANCE_GAMES,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25ToleranceGate(
      'sameGameReturn',
      c.sameGameReturnRate,
      SEASON_HEALTH_SAME_GAME_RETURN_TARGET,
      SEASON_HEALTH_SAME_GAME_RETURN_TOLERANCE_PP / 100,
      minorEligible,
      Math.max(SEASON_HEALTH_MIN_INJURIES / 3, 100),
    ),
    m25ToleranceGate(
      'seasonEndingRate',
      c.seasonEndingRate,
      SEASON_HEALTH_SEVERITY_TARGETS.seasonEnding,
      SEASON_HEALTH_SEASON_ENDING_TOLERANCE_PP / 100,
      injurySample,
      SEASON_HEALTH_MIN_INJURIES,
    ),
    m25GapGate(
      'recurrenceLift',
      p.recurrence.gapBp,
      SEASON_HEALTH_RECURRENCE_MIN_GAP_BP,
      SEASON_HEALTH_PROBE_EXPOSURES * 2,
      SEASON_HEALTH_PROBE_MIN_EXPOSURES * 2,
    ),
    m25LiftGate(
      'monotonic.minutes',
      p.minutes.highIncidenceBp,
      p.minutes.lowIncidenceBp,
      SEASON_HEALTH_PROBE_EXPOSURES * 2,
      SEASON_HEALTH_PROBE_MIN_EXPOSURES * 2,
    ),
    m25LiftGate(
      'monotonic.fatigue',
      p.fatigue.highIncidenceBp,
      p.fatigue.lowIncidenceBp,
      SEASON_HEALTH_PROBE_EXPOSURES * 2,
      SEASON_HEALTH_PROBE_MIN_EXPOSURES * 2,
    ),
    m25LiftGate(
      'monotonic.durability',
      p.durability.lowIncidenceBp,
      p.durability.highIncidenceBp,
      SEASON_HEALTH_PROBE_EXPOSURES * 2,
      SEASON_HEALTH_PROBE_MIN_EXPOSURES * 2,
    ),
    m25ToleranceGate(
      'standingsIndependent',
      c.standingsGapBp,
      0,
      SEASON_HEALTH_STANDINGS_MAX_GAP_BP,
      exposureSample,
      SEASON_HEALTH_MIN_EXPOSURES,
    ),
    m25ToleranceGate(
      'heldOut.incidence',
      h.meanRiskBasisPoints,
      SEASON_HEALTH_BASE_RISK_BP,
      SEASON_HEALTH_RISK_ENVELOPE_BP,
      h.exposures,
      SEASON_HEALTH_MIN_EXPOSURES,
    ),
    m25ToleranceGate(
      'heldOut.seasonEnding',
      h.seasonEndingRate,
      SEASON_HEALTH_SEVERITY_TARGETS.seasonEnding,
      SEASON_HEALTH_SEASON_ENDING_TOLERANCE_PP / 100,
      h.injuries,
      Math.max(SEASON_HEALTH_MIN_INJURIES / 2, 150),
    ),
  ];
  return metrics;
}

export interface SeasonHealthArgs {
  input: string | null;
  'seed-from': string | null;
  'seed-to': string | null;
  workers: string | null;
  out: string | null;
  manifest: string | null;
  validate: string | null;
  format?: string | null;
}

/** Runs the calibration cohort (in-process; worker counts never change facts). */
export function runSeasonHealthCohort(
  args: SeasonHealthArgs,
  seedIndices: number[],
  probeRootSeed: string,
): {
  seasons: SeasonM25SeasonFacts[];
  probes: {
    minutes: { lowIncidenceBp: number; highIncidenceBp: number };
    fatigue: { lowIncidenceBp: number; highIncidenceBp: number };
    durability: { highIncidenceBp: number; lowIncidenceBp: number };
    recurrence: {
      windowIncidenceBp: number;
      nonWindowIncidenceBp: number;
      gapBp: number;
      ratio: number;
    };
  };
} {
  const seasons = seedIndices.map((index) =>
    runSeasonM25({
      runPath: args.input,
      manifestPath: args.manifest,
      rootSeed: seasonCalibrationSeed(index),
      driveWindows: false,
      pickObjectives: false,
    }),
  );
  const low = (
    input: Omit<SeasonInjuryRollInput, 'rootSeed' | 'gameId' | 'playerVersionId' | 'franchiseId'>,
    exposures: number,
  ): number => runInjuryRollProbe(probeRootSeed, input, exposures);
  const exposures = SEASON_HEALTH_PROBE_EXPOSURES;
  const minutesLow = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 10,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const minutesHigh = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 40,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const fatigueLow = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 1000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const fatigueHigh = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 9000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const durabilityHigh = low(
    {
      durabilityRating: 90,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const durabilityLow = low(
    {
      durabilityRating: 50,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const nonWindow = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 0,
    },
    exposures,
  );
  const window = low(
    {
      durabilityRating: 70,
      fatigueBasisPoints: 3000,
      recentLoadBasisPoints: 3000,
      targetMinutes: 30,
      recurrenceWindowRoundsRemaining: 10,
    },
    exposures,
  );
  const gapBp = rateBasisPoints(window, exposures) - rateBasisPoints(nonWindow, exposures);
  return {
    seasons,
    probes: {
      minutes: {
        lowIncidenceBp: rateBasisPoints(minutesLow, exposures),
        highIncidenceBp: rateBasisPoints(minutesHigh, exposures),
      },
      fatigue: {
        lowIncidenceBp: rateBasisPoints(fatigueLow, exposures),
        highIncidenceBp: rateBasisPoints(fatigueHigh, exposures),
      },
      durability: {
        highIncidenceBp: rateBasisPoints(durabilityHigh, exposures),
        lowIncidenceBp: rateBasisPoints(durabilityLow, exposures),
      },
      recurrence: {
        windowIncidenceBp: rateBasisPoints(window, exposures),
        nonWindowIncidenceBp: rateBasisPoints(nonWindow, exposures),
        gapBp,
        ratio:
          nonWindow === 0
            ? 0
            : rateBasisPoints(window, exposures) / rateBasisPoints(nonWindow, exposures),
      },
    },
  };
}

export function validateSeasonInjuryTargets(args: SeasonHealthArgs, outPath: string): CliReport {
  void args;
  return validateTargetsArtifact({
    outPath,
    schema: seasonInjuryTargetsSchema,
    command: 'season health calibrate --validate',
    extraChecks: () => ({
      details: [
        // The schema literal already pins the base risk to 80 bp.
        `base risk matches the frozen ${String(SEASON_HEALTH_BASE_RISK_BP)} bp profile`,
      ],
      failures: [],
    }),
  });
}

/** `season health calibrate`: runs the gates and freezes injury-targets-v1. */
export function seasonHealthCalibrate(args: SeasonHealthArgs): CliReport {
  const started = Date.now();
  const { from, to } = parseSeedRange(args, SEASON_HEALTH_CALIBRATION_SEED_COUNT - 1);
  const outPath = args.out ?? DEFAULT_INJURY_TARGETS;
  const validateOnly = args['validate'] !== null;
  const probeRootSeed = seasonCalibrationSeed(
    SEASON_HEALTH_CALIBRATION_SEED_COUNT + SEASON_HEALTH_VALIDATION_SEED_COUNT,
  );

  if (validateOnly) {
    return validateSeasonInjuryTargets(args, resolve(args.validate ?? outPath));
  }

  const workers = parseWorkers(args, 1);
  const calibrationIndices = seedIndexRange(from, to);
  const validationIndices = seedIndexRange(to + 1, to + SEASON_HEALTH_VALIDATION_SEED_COUNT);

  let calibrationCohort: ReturnType<typeof foldSeasonCohort>;
  let heldOutCohort: ReturnType<typeof foldSeasonCohort>;
  let probes: ReturnType<typeof runSeasonHealthCohort>['probes'];
  try {
    const calibration = runSeasonHealthCohort(args, calibrationIndices, probeRootSeed);
    probes = calibration.probes;
    calibrationCohort = foldSeasonCohort(calibration.seasons);
    const heldOut = runSeasonHealthCohort(args, validationIndices, probeRootSeed);
    heldOutCohort = foldSeasonCohort(heldOut.seasons);
  } catch (error) {
    return makeReport(
      'season health calibrate',
      { seedFrom: from, seedTo: to, workers },
      { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }

  const metrics = evaluateHealthGates({
    calibration: calibrationCohort,
    heldOut: heldOutCohort,
    probes,
  });
  const { skippedGates, pass } = gateSummary(metrics);
  const gates = {
    incidence: gateValue(metrics, 'incidence'),
    severityDistribution:
      gateValue(metrics, 'severity.minor') &&
      gateValue(metrics, 'severity.moderate') &&
      gateValue(metrics, 'severity.major'),
    durationMeans:
      gateValue(metrics, 'duration.minor') &&
      gateValue(metrics, 'duration.moderate') &&
      gateValue(metrics, 'duration.major'),
    sameGameReturn: gateValue(metrics, 'sameGameReturn'),
    recurrenceLift: gateValue(metrics, 'recurrenceLift'),
    seasonEndingRate: gateValue(metrics, 'seasonEndingRate'),
    monotonicMinutes: gateValue(metrics, 'monotonic.minutes'),
    monotonicFatigue: gateValue(metrics, 'monotonic.fatigue'),
    monotonicDurability: gateValue(metrics, 'monotonic.durability'),
    standingsIndependent: gateValue(metrics, 'standingsIndependent'),
    heldOut: gateValue(metrics, 'heldOut.incidence') && gateValue(metrics, 'heldOut.seasonEnding'),
  };

  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  if (pass) {
    const targets: SeasonInjuryTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_INJURY_TARGETS_VERSION,
      profile: {
        baseRiskBasisPoints: 80,
        riskClamp: [20, 220],
        severityShares: { minor: 0.6, moderate: 0.28, major: 0.1, seasonEnding: 0.02 },
        recoveryRanges: { minor: [1, 2], moderate: [3, 6], major: [7, 18] },
        sameGameReturnRate: 0.35,
        recurrenceBonusBasisPoints: 40,
        recurrenceWindowTeamGames: 10,
      },
      cohort: { seedFrom: from, seedTo: to },
      heldOut: { seedFrom: to + 1, seedTo: to + SEASON_HEALTH_VALIDATION_SEED_COUNT },
      measured: {
        calibration: {
          seasonsSimulated: calibrationCohort.seasonsSimulated,
          exposures: calibrationCohort.exposures,
          injuries: calibrationCohort.injuries,
          meanRiskBasisPoints: calibrationCohort.meanRiskBasisPoints,
          severityShares: calibrationCohort.severityShares,
          durationMeans: calibrationCohort.durationMeans,
          sameGameReturnRate: calibrationCohort.sameGameReturnRate,
          recurrence: probes.recurrence,
          seasonEndingRate: calibrationCohort.seasonEndingRate,
          standings: {
            strongTeamIncidenceBp: calibrationCohort.strongTeamIncidenceBp,
            weakTeamIncidenceBp: calibrationCohort.weakTeamIncidenceBp,
            gapBp: calibrationCohort.standingsGapBp,
          },
        },
        monotonicity: {
          minutes: probes.minutes,
          fatigue: probes.fatigue,
          durability: probes.durability,
        },
        heldOut: {
          seasonsSimulated: heldOutCohort.seasonsSimulated,
          exposures: heldOutCohort.exposures,
          injuries: heldOutCohort.injuries,
          meanRiskBasisPoints: heldOutCohort.meanRiskBasisPoints,
          severityShares: heldOutCohort.severityShares,
        },
      },
      gates,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonInjuryTargetsSchema.parse(targets);
    const commit = commitTargetsArtifact({
      outPath,
      defaultTargetsPath: DEFAULT_INJURY_TARGETS,
      manifestPath: args.manifest ?? DEFAULT_MANIFEST,
      manifestKey: 'injuryTargets',
      manifestUrl: 'season/injury-targets.json',
      content: targets,
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    if (commit.error !== null) gateFailures.push(commit.error);
  }

  const payload = seasonHealthCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season health calibrate',
    targetsVersion: SEASON_INJURY_TARGETS_VERSION,
    calibrationSeeds: calibrationIndices.length,
    validationSeeds: validationIndices.length,
    seasonsSimulated: calibrationCohort.seasonsSimulated + heldOutCohort.seasonsSimulated,
    exposures: calibrationCohort.exposures,
    injuries: calibrationCohort.injuries,
    meanRiskBasisPoints: calibrationCohort.meanRiskBasisPoints,
    severityShares: calibrationCohort.severityShares,
    durationMeans: calibrationCohort.durationMeans,
    sameGameReturnRate: calibrationCohort.sameGameReturnRate,
    recurrenceGapBp: probes.recurrence.gapBp,
    seasonEndingRate: calibrationCohort.seasonEndingRate,
    standingsGapBp: calibrationCohort.standingsGapBp,
    monotonic: {
      minutes: probes.minutes.highIncidenceBp > probes.minutes.lowIncidenceBp,
      fatigue: probes.fatigue.highIncidenceBp > probes.fatigue.lowIncidenceBp,
      durability: probes.durability.lowIncidenceBp > probes.durability.highIncidenceBp,
    },
    gates,
    metrics,
    skippedGates,
    targetsWritten,
    targetsPath,
    durationMs: Date.now() - started,
  });

  const details = [
    `calibration ${String(calibrationCohort.seasonsSimulated)} seasons (${String(calibrationCohort.exposures)} exposures, ${String(calibrationCohort.injuries)} injuries) · held-out ${String(heldOutCohort.seasonsSimulated)} seasons · ${String(workers)} workers`,
    `mean risk ${calibrationCohort.meanRiskBasisPoints.toFixed(1)}bp (gate ±${String(SEASON_HEALTH_RISK_ENVELOPE_BP)}bp around ${String(SEASON_HEALTH_BASE_RISK_BP)}bp)`,
    `severity minor ${(calibrationCohort.severityShares.minor * 100).toFixed(1)}% · moderate ${(calibrationCohort.severityShares.moderate * 100).toFixed(1)}% · major ${(calibrationCohort.severityShares.major * 100).toFixed(1)}% · season-ending ${(calibrationCohort.seasonEndingRate * 100).toFixed(2)}%`,
    `duration means minor ${calibrationCohort.durationMeans.minor.toFixed(2)} · moderate ${calibrationCohort.durationMeans.moderate.toFixed(2)} · major ${calibrationCohort.durationMeans.major.toFixed(2)} (gate ±${String(SEASON_HEALTH_DURATION_TOLERANCE_GAMES)} game)`,
    `same-game return ${(calibrationCohort.sameGameReturnRate * 100).toFixed(1)}% (gate ±${String(SEASON_HEALTH_SAME_GAME_RETURN_TOLERANCE_PP)}pp) · recurrence gap ${probes.recurrence.gapBp.toFixed(1)}bp (gate ≥ ${String(SEASON_HEALTH_RECURRENCE_MIN_GAP_BP)}bp)`,
    `standings gap ${calibrationCohort.standingsGapBp.toFixed(1)}bp (gate ≤ ${String(SEASON_HEALTH_STANDINGS_MAX_GAP_BP)}bp)`,
    `monotonic minutes ${probes.minutes.highIncidenceBp.toFixed(1)}>${probes.minutes.lowIncidenceBp.toFixed(1)} · fatigue ${probes.fatigue.highIncidenceBp.toFixed(1)}>${probes.fatigue.lowIncidenceBp.toFixed(1)} · durability ${probes.durability.lowIncidenceBp.toFixed(1)}>${probes.durability.highIncidenceBp.toFixed(1)}`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (skippedGates.length > 0) {
    gateFailures.push(`gates skipped (insufficient sample): ${skippedGates.join(', ')}`);
  }
  if (!pass) {
    for (const metric of metrics) {
      if (!metric.pass) {
        gateFailures.push(
          `gate ${metric.key}: observed ${String(metric.observed)} (${metric.status})`,
        );
      }
    }
  }
  if (pass && !targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season health calibrate',
    { seedFrom: from, seedTo: to, workers },
    { details, failures: gateFailures, payload },
  );
}
