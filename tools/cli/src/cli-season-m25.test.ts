import { describe, expect, it } from 'vitest';
import {
  m25ToleranceGate,
  m25RangeGate,
  m25LiftGate,
  m25GapGate,
  gateSummary,
  mean,
  share,
  rateBasisPoints,
  seasonCalibrationSeed,
  seedIndexRange,
} from './commands/season-calibration.ts';
import { durabilityRatingFrom, durabilityProfileOf } from './gen-season-draft-catalog.ts';
import {
  seasonHealthCalibrateReportSchema,
  seasonInfluenceCalibrateReportSchema,
  seasonTradeCalibrateReportSchema,
  seasonFullSimulateReportSchema,
  seasonBlockSimulateReportSchema,
} from './report-schemas.ts';

describe('season m25 gate helpers', () => {
  it('tolerance gates pass inside the envelope and skip below the sample floor', () => {
    expect(m25ToleranceGate('incidence', 85, 80, 15, 100_000, 50_000).status).toBe('pass');
    expect(m25ToleranceGate('incidence', 96, 80, 15, 100_000, 50_000).status).toBe('fail');
    const skipped = m25ToleranceGate('incidence', 85, 80, 15, 100, 50_000);
    expect(skipped.status).toBe('skippedInsufficientSample');
    expect(skipped.pass).toBe(false);
  });

  it('range gates apply the inclusive frozen envelope', () => {
    expect(m25RangeGate('aiTrades', 11, 8, 15, 8, 4).pass).toBe(true);
    expect(m25RangeGate('aiTrades', 7.9, 8, 15, 8, 4).pass).toBe(false);
    expect(m25RangeGate('aiTrades', 15, 8, 15, 8, 4).pass).toBe(true);
  });

  it('lift gates assert direction (high > low) with a sample floor', () => {
    expect(m25LiftGate('minutes', 106, 94, 400_000, 200_000).pass).toBe(true);
    expect(m25LiftGate('minutes', 94, 106, 400_000, 200_000).pass).toBe(false);
    expect(m25LiftGate('minutes', 106, 94, 10, 200_000).status).toBe('skippedInsufficientSample');
  });

  it('gap gates require the frozen absolute minimum gap', () => {
    expect(m25GapGate('recurrence', 40, 15, 400_000, 200_000).pass).toBe(true);
    expect(m25GapGate('recurrence', 10, 15, 400_000, 200_000).pass).toBe(false);
  });

  it('gateSummary folds metrics into named booleans plus skipped keys', () => {
    const { gates, skippedGates, pass } = gateSummary([
      m25ToleranceGate('a', 1, 1, 0, 10, 1),
      m25ToleranceGate('b', 2, 1, 0, 10, 1),
      m25ToleranceGate('c', 1, 1, 0, 1, 50),
    ]);
    expect(gates.a).toBe(true);
    expect(gates.b).toBe(false);
    expect(gates.c).toBe(false);
    expect(skippedGates).toEqual(['c']);
    expect(pass).toBe(false);
  });

  it('fold helpers handle empty inputs', () => {
    expect(mean([])).toBe(0);
    expect(share(0, 0)).toBe(0);
    expect(rateBasisPoints(0, 0)).toBe(0);
    expect(rateBasisPoints(5, 1000)).toBe(50);
  });

  it('derives the fixed sequential cohort seeds', () => {
    expect(seasonCalibrationSeed(0)).toBe('0'.repeat(32));
    expect(seasonCalibrationSeed(1)).toBe('0'.repeat(31) + '1');
    expect(seasonCalibrationSeed(16)).toBe('0'.repeat(30) + '10');
    expect(seedIndexRange(0, 3)).toEqual([0, 1, 2, 3]);
    expect(() => seasonCalibrationSeed(-1)).toThrow();
  });
});

describe('season m25 durability derivation (durability-v1)', () => {
  it('derives round(clamp(45, 95, 45 + 50 * games / teamGames))', () => {
    expect(durabilityRatingFrom(65, 65)).toBe(95);
    expect(durabilityRatingFrom(82, 82)).toBe(95);
    expect(durabilityRatingFrom(41, 82)).toBe(70);
    expect(durabilityRatingFrom(10, 82)).toBe(51);
    expect(durabilityRatingFrom(1, 82)).toBe(46);
    expect(durabilityRatingFrom(0, 82)).toBe(45);
  });

  it('floors at 45 when stats or eligibility are missing', () => {
    expect(durabilityRatingFrom(null, 82)).toBe(45);
    expect(durabilityRatingFrom(65, null)).toBe(45);
    expect(durabilityRatingFrom(65, 0)).toBe(45);
  });

  it('records the frozen durability-v1 derivation version', () => {
    expect(durabilityProfileOf(65, 65).derivationVersion).toBe('durability-v1');
    expect(durabilityProfileOf(65, 65).rating).toBe(95);
    expect(durabilityProfileOf(null, 82).rating).toBe(45);
  });
});

describe('season m25 report schema round-trips', () => {
  it('parses a complete health calibrate report payload and preserves every field', () => {
    const input = {
      schemaVersion: 1,
      command: 'season health calibrate',
      targetsVersion: 'injury-targets-v1',
      calibrationSeeds: 16,
      validationSeeds: 4,
      seasonsSimulated: 20,
      exposures: 413_280,
      injuries: 3150,
      meanRiskBasisPoints: 86.2,
      severityShares: { minor: 0.61, moderate: 0.27, major: 0.1, seasonEnding: 0.02 },
      durationMeans: { minor: 1.52, moderate: 4.6, major: 12.4 },
      sameGameReturnRate: 0.34,
      recurrenceGapBp: 39.5,
      seasonEndingRate: 0.02,
      standingsGapBp: 0.8,
      monotonic: { minutes: true, fatigue: true, durability: true },
      gates: {
        incidence: true,
        severityDistribution: true,
        durationMeans: true,
        sameGameReturn: true,
        recurrenceLift: true,
        seasonEndingRate: true,
        monotonicMinutes: true,
        monotonicFatigue: true,
        monotonicDurability: true,
        standingsIndependent: true,
        heldOut: true,
      },
      metrics: [
        {
          key: 'incidence',
          observed: 86.2,
          target: 80,
          tolerance: 15,
          min: null,
          max: null,
          status: 'pass',
          pass: true,
          sample: 413_280,
          minimumSample: 50_000,
        },
      ],
      skippedGates: [],
      targetsWritten: true,
      targetsPath: 'apps/web/static/data/season/injury-targets.json',
      durationMs: 900_000,
    };
    expect(seasonHealthCalibrateReportSchema.parse(input)).toEqual(input);
  });

  it('parses a complete trade calibrate report payload and preserves every field', () => {
    const input = {
      schemaVersion: 1,
      command: 'season trade calibrate',
      targetsVersion: 'trade-targets-v2',
      calibrationSeeds: 8,
      validationSeeds: 4,
      seasonsSimulated: 12,
      aiTradesMean: 11.25,
      aiTradesMin: 9,
      aiTradesMax: 14,
      acceptedTrades: 90,
      packageMix: { '1-1': 38, '2-2': 27, '1-2': 13, '2-1': 12 },
      illegalRosterFailures: 0,
      duplicateOwnershipFailures: 0,
      valueBandFailures: 0,
      chemistryPairs: 10_800,
      chemistryPairFailures: 0,
      zeroStateNewPairFailures: 0,
      deterministicOffers: true,
      gates: {
        aiTradesPerSeason: true,
        zeroIllegal: true,
        zeroDuplicateOwnership: true,
        valueBands: true,
        deterministicOffers: true,
        chemistryInvariants: true,
        packageMix: true,
        heldOut: true,
      },
      metrics: [],
      skippedGates: [],
      targetsWritten: true,
      targetsPath: 'apps/web/static/data/season/trade-targets.json',
      durationMs: 600_000,
    };
    expect(seasonTradeCalibrateReportSchema.parse(input)).toEqual(input);
  });

  it('parses a complete influence calibrate report payload and preserves every field', () => {
    const input = {
      schemaVersion: 1,
      command: 'season influence calibrate',
      targetsVersion: 'influence-targets-v1',
      calibrationSeeds: 12,
      validationSeeds: 4,
      seasonsSimulated: 16,
      balanceChecks: 3240,
      reconciliationFailures: 0,
      incomeIdentityFailures: 0,
      debtFrequency: 0.02,
      debtBoundaries: 65,
      capViolations: 0,
      objectiveEvaluations: 96,
      objectiveSuccessRate: 0.55,
      extraOfferSpendShare: 0.1,
      extraOfferWindows: 1080,
      rehabSpendShare: 0.05,
      rehabInjuries: 2400,
      gates: {
        ledgerReconciliation: true,
        incomeIdentity: true,
        debtFrequency: true,
        zeroCapViolations: true,
        objectiveSuccessRate: true,
        extraOfferSpendRate: true,
        rehabSpendRate: true,
        heldOut: true,
      },
      metrics: [],
      skippedGates: [],
      targetsWritten: true,
      targetsPath: 'apps/web/static/data/season/influence-targets.json',
      durationMs: 700_000,
    };
    expect(seasonInfluenceCalibrateReportSchema.parse(input)).toEqual(input);
  });

  it('parses the M2.5-extended block and full-simulate report payloads and preserves every field', () => {
    const blockInput = {
      schemaVersion: 1,
      command: 'season block simulate',
      runId: 'fixture-season-run-1',
      blockIndex: 0,
      expectedRevision: 0,
      rotationDigest: '0'.repeat(32),
      completedRounds: 10,
      summaryCount: 150,
      retainedDetailCount: 10,
      objectiveId: null,
      stateRevision: 1,
      stateDigest: 'a'.repeat(32),
      digest: 'b'.repeat(32),
      durationMs: 2600,
      auditFailures: [],
      rejection: null,
      pass: true,
    };
    expect(seasonBlockSimulateReportSchema.parse(blockInput)).toEqual(blockInput);

    const fullInput = {
      schemaVersion: 1,
      command: 'season full simulate',
      runId: 'fixture-season-run-1',
      blockDigests: Array.from({ length: 9 }, (_, blockIndex) => ({
        blockIndex,
        digest: 'c'.repeat(32),
        durationMs: 2600,
      })),
      finalDigest: 'c'.repeat(32),
      totalDurationMs: 24_000,
      summaries: 1230,
      stateRevision: 9,
      stateDigest: 'd'.repeat(32),
      stateChainContinuity: true,
      finalInjuryCount: 0,
      finalTransactionCount: 0,
      tradeWindowsOpened: 0,
      auditFailures: [],
      pass: true,
    };
    expect(seasonFullSimulateReportSchema.parse(fullInput)).toEqual(fullInput);
  });
});
