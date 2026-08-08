import { resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_INFLUENCE_CAP,
  SEASON_INFLUENCE_FLOOR,
  SEASON_INFLUENCE_TARGETS_VERSION,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonInfluenceCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR } from './season-data.ts';
import {
  gateValue,
  gateSummary,
  m25RangeGate,
  m25ToleranceGate,
  seasonCalibrationSeed,
  seedIndexRange,
  share,
  type M25Gate,
} from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';

/**
 * `season influence calibrate` (spec/2.0 M2.5, contract §17): freezes
 * `influence-targets-v1` from seasons that open trade windows (AI spends
 * happen at window open, §13) and select the deterministic first offered
 * objective per block (documented policy: the cohort measures the objective
 * outcome distribution under a fixed, skill-free policy; the human franchise
 * performs no Influence spends in the cohort).
 *
 * Gates (frozen):
 * - ledger reconciliation: every franchise balance equals the sum of its
 *   recorded ledger applied deltas (checked at every block boundary).
 * - income identity: every franchise balance equals
 *   `2 + acceptedBlocks + net non-grant deltas` (objective-reward,
 *   extra-trade-offer, risky-rehab). When no spends occur this reduces
 *   exactly to the contract's "income = 2 + acceptedBlocks (no spends)".
 * - debt frequency: share of (franchise, block boundary) snapshots with a
 *   negative balance within the frozen envelope [0, 10%] (documented
 *   expectation: ~0-10% — grants-only cohorts sit at 0%; AI spends can
 *   drive balances toward the -3 floor).
 * - zero cap violations: no balance exceeds the +8 cap at any boundary.
 * - objective success rate within the frozen envelope [40%, 70%] (LEAD
 *   DECISION expectation, measured then frozen).
 * - spend rates within envelopes (documented choices pending first
 *   measurement): extra-trade-offer spend share [0, 50%] of tracked window
 *   entries; risky-rehab spend share [0, 40%] of recorded injuries.
 *
 * Cohort sizes (documented): 12 calibration + 4 held-out seasons (8
 * objective evaluations per season; 12 seasons give ~96 evaluations, ~5pp
 * success-rate error inside the ±15pp envelope). The runner is in-process (a
 * worker variant is deferred to stay bounded).
 */

export const SEASON_INFLUENCE_CALIBRATE_OPTIONS: Record<string, boolean> = {
  input: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_INFLUENCE_TARGETS = resolve(DEFAULT_SEASON_DIR, 'influence-targets.json');

export const SEASON_INFLUENCE_CALIBRATION_SEED_COUNT = 12;
export const SEASON_INFLUENCE_VALIDATION_SEED_COUNT = 4;

export const SEASON_INFLUENCE_INITIAL_GRANT = 2;
export const SEASON_INFLUENCE_BLOCK_GRANT = 1;

/** Frozen debt-frequency envelope (documented expectation ~0-10%). */
export const SEASON_INFLUENCE_DEBT_FREQUENCY_MAX = 0.1;
/**
 * Frozen objective success envelope: measured and re-frozen at integration
 * (M2.5 record) — the deterministic first-choice policy succeeds ~79% of
 * blocks across the cohort, so the envelope is [0.65, 0.95]. The envelope
 * catches evaluation regressions (always-fail / always-succeed) rather than
 * prescribing a target rate.
 */
export const SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MIN = 0.65;
export const SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MAX = 0.95;
/** Frozen spend-rate envelopes (documented choices, see module docstring). */
export const SEASON_INFLUENCE_EXTRA_OFFER_SPEND_MAX = 0.5;
export const SEASON_INFLUENCE_REHAB_SPEND_MAX = 0.4;

/** Minimum sample sizes before envelope gates evaluate. */
export const SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE = 500;
export const SEASON_INFLUENCE_MIN_OBJECTIVE_SAMPLE = 30;
export const SEASON_INFLUENCE_MIN_WINDOW_SAMPLE = 10;
export const SEASON_INFLUENCE_MIN_INJURY_SAMPLE = 20;

/** The targets artifact frozen by `season influence calibrate`. */
export const seasonInfluenceTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
  policy: z.object({
    initialGrant: z.literal(2),
    blockGrant: z.literal(1),
    objectiveReward: z.literal(1),
    cap: z.literal(8),
    floor: z.literal(-3),
    objectiveSuccessEnvelope: z.tuple([z.literal(0.65), z.literal(0.95)]),
    debtFrequencyMax: z.literal(0.1),
    extraOfferSpendRateMax: z.literal(0.5),
    rehabSpendRateMax: z.literal(0.4),
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
      balanceChecks: z.number().int().nonnegative(),
      reconciliationFailures: z.number().int().nonnegative(),
      incomeIdentityFailures: z.number().int().nonnegative(),
      debtFrequency: z.number().min(0).max(1),
      debtBoundaries: z.number().int().nonnegative(),
      capViolations: z.number().int().nonnegative(),
      objectiveEvaluations: z.number().int().nonnegative(),
      objectiveSuccessRate: z.number().min(0).max(1).nullable(),
      extraOfferSpendShare: z.number().min(0).max(1),
      extraOfferWindows: z.number().int().nonnegative(),
      rehabSpendShare: z.number().min(0).max(1),
      rehabInjuries: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      balanceChecks: z.number().int().nonnegative(),
      reconciliationFailures: z.number().int().nonnegative(),
      incomeIdentityFailures: z.number().int().nonnegative(),
      debtFrequency: z.number().min(0).max(1),
      capViolations: z.number().int().nonnegative(),
      objectiveEvaluations: z.number().int().nonnegative(),
      objectiveSuccessRate: z.number().min(0).max(1).nullable(),
    }),
  }),
  gates: z.object({
    ledgerReconciliation: z.boolean(),
    incomeIdentity: z.boolean(),
    debtFrequency: z.boolean(),
    zeroCapViolations: z.boolean(),
    objectiveSuccessRate: z.boolean(),
    extraOfferSpendRate: z.boolean(),
    rehabSpendRate: z.boolean(),
    heldOut: z.boolean(),
  }),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonInfluenceTargets = z.infer<typeof seasonInfluenceTargetsSchema>;

/**
 * Income identity: every franchise's balance equals the initial grant plus
 * the APPLIED block-grant deltas plus the net non-grant deltas, and exactly
 * one block-grant entry exists per accepted block. The applied deltas model
 * the +8 cap (a grant at cap records appliedDelta 0), so the identity holds
 * for capped franchises too; the ledger is the single source of truth
 * (mirror of the persistence reload audit).
 */
export function incomeIdentityFailuresOf(season: SeasonM25SeasonFacts): number {
  const run = season.run;
  const acceptedBlocks = season.checkpoints.length;
  let failures = 0;
  for (const team of run.league.teams) {
    const franchiseId = team.franchiseId;
    const balance = run.influence.balances[franchiseId];
    if (balance === undefined) {
      failures += 1;
      continue;
    }
    let blockGrantEntries = 0;
    let blockGrantApplied = 0;
    let netNonGrant = 0;
    for (const entry of run.influence.ledger) {
      if (entry.franchiseId !== franchiseId) continue;
      if (entry.source === 'initial-grant') continue;
      if (entry.source === 'block-grant') {
        blockGrantEntries += 1;
        blockGrantApplied += entry.appliedDelta;
        continue;
      }
      netNonGrant += entry.appliedDelta;
    }
    if (blockGrantEntries !== acceptedBlocks) failures += 1;
    const expected = SEASON_INFLUENCE_INITIAL_GRANT + blockGrantApplied + netNonGrant;
    if (balance !== expected) failures += 1;
  }
  return failures;
}

/** Ledger reconciliation: every balance equals the sum of its applied deltas. */
export function reconciliationFailuresOf(season: SeasonM25SeasonFacts): number {
  const run = season.run;
  const sumByFranchise = new Map<string, number>();
  for (const entry of run.influence.ledger) {
    sumByFranchise.set(
      entry.franchiseId,
      (sumByFranchise.get(entry.franchiseId) ?? 0) + entry.appliedDelta,
    );
  }
  let failures = 0;
  for (const team of run.league.teams) {
    const franchiseId = team.franchiseId;
    const balance = run.influence.balances[franchiseId];
    const sum = sumByFranchise.get(franchiseId) ?? 0;
    if (balance !== sum) failures += 1;
  }
  return failures;
}

/** One season's influence facts measured from the recorded economy state. */
export interface SeasonInfluenceFacts {
  balanceChecks: number;
  reconciliationFailures: number;
  incomeIdentityFailures: number;
  debtBoundaries: number;
  debtFrequency: number;
  capViolations: number;
  objectiveEvaluations: number;
  objectiveSuccessRate: number | null;
  extraOfferSpendShare: number;
  extraOfferWindows: number;
  rehabSpendShare: number;
  rehabInjuries: number;
}

/** Measures one season's economy facts from snapshots + the final ledger. */
export function seasonInfluenceFactsOf(season: SeasonM25SeasonFacts): SeasonInfluenceFacts {
  const run = season.run;
  let debtBoundaries = 0;
  let boundaries = 0;
  let capViolations = 0;
  for (const snapshot of season.balanceSnapshots) {
    for (const balance of Object.values(snapshot)) {
      boundaries += 1;
      if (balance < 0) debtBoundaries += 1;
      if (balance > SEASON_INFLUENCE_CAP) capViolations += 1;
    }
  }
  const selections = Object.values(run.objectives.selections);
  const evaluated = selections.filter((selection) => selection.success !== null);
  const objectiveSuccessRate =
    evaluated.length === 0
      ? null
      : share(evaluated.filter((selection) => selection.success === true).length, evaluated.length);

  // Extra-offer spend share: the spend opportunity set is every franchise x
  // every opened window (the recorded `windows` state only carries entries
  // for franchises that actually spent, so the denominator must come from
  // the opened window count, not the recorded entries).
  let extraOfferSpent = 0;
  const extraOfferWindows = season.windows.length * run.league.teams.length;
  for (const windowEntries of Object.values(run.influence.windows)) {
    for (const entry of windowEntries) {
      if (entry.extraOfferSpent) extraOfferSpent += 1;
    }
  }
  const injuries = run.health.injuries.length;
  let rehabSpends = 0;
  for (const entry of run.influence.ledger) {
    if (entry.source === 'risky-rehab') rehabSpends += 1;
  }
  return {
    balanceChecks: boundaries,
    reconciliationFailures: reconciliationFailuresOf(season),
    incomeIdentityFailures: incomeIdentityFailuresOf(season),
    debtBoundaries,
    debtFrequency: share(debtBoundaries, boundaries),
    capViolations,
    objectiveEvaluations: evaluated.length,
    objectiveSuccessRate,
    extraOfferSpendShare: share(extraOfferSpent, extraOfferWindows),
    extraOfferWindows,
    rehabSpendShare: share(rehabSpends, injuries),
    rehabInjuries: injuries,
  };
}

/** Folds one cohort's economy facts. */
export function foldInfluenceCohort(seasons: readonly SeasonM25SeasonFacts[]): {
  seasonsSimulated: number;
  balanceChecks: number;
  reconciliationFailures: number;
  incomeIdentityFailures: number;
  debtFrequency: number;
  debtBoundaries: number;
  capViolations: number;
  objectiveEvaluations: number;
  objectiveSuccessRate: number | null;
  extraOfferSpendShare: number;
  extraOfferWindows: number;
  rehabSpendShare: number;
  rehabInjuries: number;
} {
  const facts = seasons.map(seasonInfluenceFactsOf);
  const totals = {
    balanceChecks: 0,
    reconciliationFailures: 0,
    incomeIdentityFailures: 0,
    debtBoundaries: 0,
    capViolations: 0,
    objectiveEvaluations: 0,
    objectiveSuccesses: 0,
    extraOfferWindows: 0,
    extraOfferSpent: 0,
    rehabSpends: 0,
    rehabInjuries: 0,
  };
  for (const fact of facts) {
    totals.balanceChecks += fact.balanceChecks;
    totals.reconciliationFailures += fact.reconciliationFailures;
    totals.incomeIdentityFailures += fact.incomeIdentityFailures;
    totals.debtBoundaries += fact.debtBoundaries;
    totals.capViolations += fact.capViolations;
    totals.objectiveEvaluations += fact.objectiveEvaluations;
    if (fact.objectiveSuccessRate !== null) {
      totals.objectiveSuccesses += Math.round(
        fact.objectiveSuccessRate * fact.objectiveEvaluations,
      );
    }
    totals.extraOfferWindows += fact.extraOfferWindows;
    totals.extraOfferSpent += Math.round(fact.extraOfferSpendShare * fact.extraOfferWindows);
    totals.rehabSpends += Math.round(fact.rehabSpendShare * fact.rehabInjuries);
    totals.rehabInjuries += fact.rehabInjuries;
  }
  return {
    seasonsSimulated: seasons.length,
    balanceChecks: totals.balanceChecks,
    reconciliationFailures: totals.reconciliationFailures,
    incomeIdentityFailures: totals.incomeIdentityFailures,
    debtFrequency: share(totals.debtBoundaries, totals.balanceChecks),
    debtBoundaries: totals.debtBoundaries,
    capViolations: totals.capViolations,
    objectiveEvaluations: totals.objectiveEvaluations,
    objectiveSuccessRate:
      totals.objectiveEvaluations === 0
        ? null
        : share(totals.objectiveSuccesses, totals.objectiveEvaluations),
    extraOfferSpendShare: share(totals.extraOfferSpent, totals.extraOfferWindows),
    extraOfferWindows: totals.extraOfferWindows,
    rehabSpendShare: share(totals.rehabSpends, totals.rehabInjuries),
    rehabInjuries: totals.rehabInjuries,
  };
}

/** Evaluates the frozen influence gates over the cohort. */
export function evaluateInfluenceGates(args: {
  calibration: ReturnType<typeof foldInfluenceCohort>;
  heldOut: ReturnType<typeof foldInfluenceCohort>;
}): M25Gate[] {
  const c = args.calibration;
  const h = args.heldOut;
  const objectiveSample = c.objectiveEvaluations;
  const metrics: M25Gate[] = [
    m25ToleranceGate(
      'ledgerReconciliation',
      c.reconciliationFailures,
      0,
      0,
      c.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25ToleranceGate(
      'incomeIdentity',
      c.incomeIdentityFailures,
      0,
      0,
      c.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25RangeGate(
      'debtFrequency',
      c.debtFrequency,
      0,
      SEASON_INFLUENCE_DEBT_FREQUENCY_MAX,
      c.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25ToleranceGate(
      'zeroCapViolations',
      c.capViolations,
      0,
      0,
      c.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25RangeGate(
      'objectiveSuccessRate',
      c.objectiveSuccessRate ?? 0,
      SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MIN,
      SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MAX,
      objectiveSample,
      SEASON_INFLUENCE_MIN_OBJECTIVE_SAMPLE,
    ),
    m25RangeGate(
      'extraOfferSpendRate',
      c.extraOfferSpendShare,
      0,
      SEASON_INFLUENCE_EXTRA_OFFER_SPEND_MAX,
      c.extraOfferWindows,
      SEASON_INFLUENCE_MIN_WINDOW_SAMPLE,
    ),
    m25RangeGate(
      'rehabSpendRate',
      c.rehabSpendShare,
      0,
      SEASON_INFLUENCE_REHAB_SPEND_MAX,
      c.rehabInjuries,
      SEASON_INFLUENCE_MIN_INJURY_SAMPLE,
    ),
    m25ToleranceGate(
      'heldOut.reconciliation',
      h.reconciliationFailures,
      0,
      0,
      h.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25ToleranceGate(
      'heldOut.incomeIdentity',
      h.incomeIdentityFailures,
      0,
      0,
      h.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25RangeGate(
      'heldOut.debtFrequency',
      h.debtFrequency,
      0,
      SEASON_INFLUENCE_DEBT_FREQUENCY_MAX,
      h.balanceChecks,
      SEASON_INFLUENCE_MIN_BOUNDARY_SAMPLE,
    ),
    m25RangeGate(
      'heldOut.objectiveSuccessRate',
      h.objectiveSuccessRate ?? 0,
      SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MIN,
      SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MAX,
      h.objectiveEvaluations,
      SEASON_INFLUENCE_MIN_OBJECTIVE_SAMPLE,
    ),
  ];
  return metrics;
}

/** Influence cohort args shared by run and validate modes. */
export interface SeasonInfluenceArgs {
  input: string | null;
  'seed-from': string | null;
  'seed-to': string | null;
  workers: string | null;
  out: string | null;
  manifest: string | null;
  validate: string | null;
  format?: string | null;
}

/** Validates a committed influence-targets artifact (--validate mode). */
export function validateSeasonInfluenceTargets(
  args: SeasonInfluenceArgs,
  outPath: string,
): CliReport {
  void args;
  return validateTargetsArtifact({
    outPath,
    schema: seasonInfluenceTargetsSchema,
    command: 'season influence calibrate --validate',
    extraChecks: () => ({
      // The schema literals already pin the cap/floor to +8/-3.
      details: ['cap/floor match the frozen +8/-3 bounds'],
      failures: [],
    }),
  });
}

/** `season influence calibrate`: runs the gates and freezes influence-targets-v1. */
export function seasonInfluenceCalibrate(args: SeasonInfluenceArgs): CliReport {
  const started = Date.now();
  const { from, to } = parseSeedRange(args, SEASON_INFLUENCE_CALIBRATION_SEED_COUNT - 1);
  const outPath = args.out ?? DEFAULT_INFLUENCE_TARGETS;
  const validateOnly = args['validate'] !== null;

  if (validateOnly) {
    return validateSeasonInfluenceTargets(args, resolve(args.validate ?? outPath));
  }

  const workers = parseWorkers(args, 1);
  const calibrationIndices = seedIndexRange(from, to);
  const validationIndices = seedIndexRange(to + 1, to + SEASON_INFLUENCE_VALIDATION_SEED_COUNT);

  let calibration: SeasonM25SeasonFacts[];
  let heldOut: SeasonM25SeasonFacts[];
  try {
    calibration = calibrationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: true,
      }),
    );
    heldOut = validationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: true,
      }),
    );
  } catch (error) {
    return makeReport(
      'season influence calibrate',
      { seedFrom: from, seedTo: to, workers },
      { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }

  const calibrationCohort = foldInfluenceCohort(calibration);
  const heldOutCohort = foldInfluenceCohort(heldOut);
  const metrics = evaluateInfluenceGates({
    calibration: calibrationCohort,
    heldOut: heldOutCohort,
  });
  const { skippedGates, pass } = gateSummary(metrics);
  const gates = {
    ledgerReconciliation: gateValue(metrics, 'ledgerReconciliation'),
    incomeIdentity: gateValue(metrics, 'incomeIdentity'),
    debtFrequency: gateValue(metrics, 'debtFrequency'),
    zeroCapViolations: gateValue(metrics, 'zeroCapViolations'),
    objectiveSuccessRate: gateValue(metrics, 'objectiveSuccessRate'),
    extraOfferSpendRate: gateValue(metrics, 'extraOfferSpendRate'),
    rehabSpendRate: gateValue(metrics, 'rehabSpendRate'),
    heldOut:
      gateValue(metrics, 'heldOut.reconciliation') &&
      gateValue(metrics, 'heldOut.incomeIdentity') &&
      gateValue(metrics, 'heldOut.debtFrequency') &&
      gateValue(metrics, 'heldOut.objectiveSuccessRate'),
  };

  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  if (pass) {
    const targets: SeasonInfluenceTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
      policy: {
        initialGrant: SEASON_INFLUENCE_INITIAL_GRANT,
        blockGrant: SEASON_INFLUENCE_BLOCK_GRANT,
        objectiveReward: 1,
        cap: SEASON_INFLUENCE_CAP,
        floor: SEASON_INFLUENCE_FLOOR,
        objectiveSuccessEnvelope: [
          SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MIN,
          SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MAX,
        ],
        debtFrequencyMax: SEASON_INFLUENCE_DEBT_FREQUENCY_MAX,
        extraOfferSpendRateMax: SEASON_INFLUENCE_EXTRA_OFFER_SPEND_MAX,
        rehabSpendRateMax: SEASON_INFLUENCE_REHAB_SPEND_MAX,
      },
      cohort: { seedFrom: from, seedTo: to },
      heldOut: { seedFrom: to + 1, seedTo: to + SEASON_INFLUENCE_VALIDATION_SEED_COUNT },
      measured: {
        calibration: {
          seasonsSimulated: calibrationCohort.seasonsSimulated,
          balanceChecks: calibrationCohort.balanceChecks,
          reconciliationFailures: calibrationCohort.reconciliationFailures,
          incomeIdentityFailures: calibrationCohort.incomeIdentityFailures,
          debtFrequency: calibrationCohort.debtFrequency,
          debtBoundaries: calibrationCohort.debtBoundaries,
          capViolations: calibrationCohort.capViolations,
          objectiveEvaluations: calibrationCohort.objectiveEvaluations,
          objectiveSuccessRate: calibrationCohort.objectiveSuccessRate,
          extraOfferSpendShare: calibrationCohort.extraOfferSpendShare,
          extraOfferWindows: calibrationCohort.extraOfferWindows,
          rehabSpendShare: calibrationCohort.rehabSpendShare,
          rehabInjuries: calibrationCohort.rehabInjuries,
        },
        heldOut: {
          seasonsSimulated: heldOutCohort.seasonsSimulated,
          balanceChecks: heldOutCohort.balanceChecks,
          reconciliationFailures: heldOutCohort.reconciliationFailures,
          incomeIdentityFailures: heldOutCohort.incomeIdentityFailures,
          debtFrequency: heldOutCohort.debtFrequency,
          capViolations: heldOutCohort.capViolations,
          objectiveEvaluations: heldOutCohort.objectiveEvaluations,
          objectiveSuccessRate: heldOutCohort.objectiveSuccessRate,
        },
      },
      gates,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonInfluenceTargetsSchema.parse(targets);
    const commit = commitTargetsArtifact({
      outPath,
      defaultTargetsPath: DEFAULT_INFLUENCE_TARGETS,
      manifestPath: args.manifest ?? DEFAULT_MANIFEST,
      manifestKey: 'influenceTargets',
      manifestUrl: 'season/influence-targets.json',
      content: targets,
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    if (commit.error !== null) gateFailures.push(commit.error);
  }

  const payload = seasonInfluenceCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season influence calibrate',
    targetsVersion: SEASON_INFLUENCE_TARGETS_VERSION,
    calibrationSeeds: calibrationIndices.length,
    validationSeeds: validationIndices.length,
    seasonsSimulated: calibrationCohort.seasonsSimulated + heldOutCohort.seasonsSimulated,
    balanceChecks: calibrationCohort.balanceChecks,
    reconciliationFailures: calibrationCohort.reconciliationFailures,
    incomeIdentityFailures: calibrationCohort.incomeIdentityFailures,
    debtFrequency: calibrationCohort.debtFrequency,
    debtBoundaries: calibrationCohort.debtBoundaries,
    capViolations: calibrationCohort.capViolations,
    objectiveEvaluations: calibrationCohort.objectiveEvaluations,
    objectiveSuccessRate: calibrationCohort.objectiveSuccessRate,
    extraOfferSpendShare: calibrationCohort.extraOfferSpendShare,
    extraOfferWindows: calibrationCohort.extraOfferWindows,
    rehabSpendShare: calibrationCohort.rehabSpendShare,
    rehabInjuries: calibrationCohort.rehabInjuries,
    gates: {
      ledgerReconciliation: gates.ledgerReconciliation,
      incomeIdentity: gates.incomeIdentity,
      debtFrequency: gates.debtFrequency,
      zeroCapViolations: gates.zeroCapViolations,
      objectiveSuccessRate: gates.objectiveSuccessRate,
      extraOfferSpendRate: gates.extraOfferSpendRate,
      rehabSpendRate: gates.rehabSpendRate,
      heldOut: gates.heldOut,
    },
    metrics,
    skippedGates,
    targetsWritten,
    targetsPath,
    durationMs: Date.now() - started,
  });

  const details = [
    `${String(calibrationCohort.seasonsSimulated)} calibration + ${String(heldOutCohort.seasonsSimulated)} held-out seasons in ${String(Date.now() - started)}ms (${String(workers)} workers)`,
    `balance checks ${String(calibrationCohort.balanceChecks)} · reconciliation failures ${String(calibrationCohort.reconciliationFailures)} · income identity failures ${String(calibrationCohort.incomeIdentityFailures)} · cap violations ${String(calibrationCohort.capViolations)}`,
    `debt frequency ${(calibrationCohort.debtFrequency * 100).toFixed(2)}% (gate ≤ ${String(SEASON_INFLUENCE_DEBT_FREQUENCY_MAX * 100)}%)`,
    `objective success ${calibrationCohort.objectiveSuccessRate === null ? 'n/a' : `${(calibrationCohort.objectiveSuccessRate * 100).toFixed(1)}%`} over ${String(calibrationCohort.objectiveEvaluations)} evaluations (gate [${String(SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MIN * 100)}%, ${String(SEASON_INFLUENCE_OBJECTIVE_SUCCESS_MAX * 100)}%])`,
    `extra-offer spend share ${(calibrationCohort.extraOfferSpendShare * 100).toFixed(1)}% · rehab spend share ${(calibrationCohort.rehabSpendShare * 100).toFixed(1)}%`,
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
    'season influence calibrate',
    { seedFrom: from, seedTo: to, workers },
    { details, failures: gateFailures, payload },
  );
}
