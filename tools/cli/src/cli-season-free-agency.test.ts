import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  type SeasonFreeAgencyState,
} from '@hoop-rush/data-contracts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';
import {
  seasonFreeAgencyAuditReportSchema,
  seasonFreeAgencyCalibrateReportSchema,
} from './report-schemas.ts';
import { auditSeasonFreeAgencyFacts } from './commands/season-free-agency-audit.ts';
import {
  SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX,
  SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN,
  SEASON_FREE_AGENCY_OWNERSHIP_MAX,
  SEASON_FREE_AGENCY_OWNERSHIP_MIN,
  SEASON_FREE_AGENCY_SKIP_SHARE_MAX,
  evaluateFreeAgencyGates,
  medianOf,
  seasonFreeAgencyTargetsSchema,
  type SeasonFreeAgencyMeasuredFacts,
} from './commands/season-free-agency-calibrate.ts';
import { packageKindOfOffer, seasonTradeValueBandOf } from './commands/season-trade.ts';
import { loadSeasonRunFixture } from './commands/season-block.ts';

/**
 * M2.6.5 free-agency CLI tests (spec/2.0/15, free-agency-targets-v1): the
 * recorded-facts audit (window order, candidates, canonical identity
 * persistence, declarations, traces, caps, ledger/transaction/ownership
 * links, effects invariants), the calibrate gate math, the targets/report
 * schema round-trips, and the CLI end-to-end audit path. The full
 * season-driving calibrate cohort is covered by the (skipped) integration
 * suite below.
 */

const RUN_FIXTURE = join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json');
const INTEGRATION_RUNS = process.env.HOOP_RUSH_INTEGRATION_RUNS === '1';

describe('season free-agency audit (recorded facts)', () => {
  it('audits the committed run clean (no windows, no signings)', () => {
    const run = loadSeasonRunFixture(RUN_FIXTURE);
    const { failures, counts } = auditSeasonFreeAgencyFacts(run);
    expect(failures).toEqual([]);
    expect(counts.windowOrderFailures).toBe(0);
  });

  it('flags inflated signing counts that do not reconcile from signings', () => {
    const run = loadSeasonRunFixture(RUN_FIXTURE);
    run.freeAgency.signingCounts = { ...run.freeAgency.signingCounts, lakers: 1 };
    const { failures, counts } = auditSeasonFreeAgencyFacts(run);
    expect(counts.signingCapFailures).toBeGreaterThanOrEqual(1);
    expect(failures.join(' ')).toContain('signingCounts records 1, signings reconcile 0');
  });

  it('flags a season spend above the six-point cap', () => {
    const run = loadSeasonRunFixture(RUN_FIXTURE);
    run.freeAgency.seasonSpend = { ...run.freeAgency.seasonSpend, lakers: 7 };
    const { failures, counts } = auditSeasonFreeAgencyFacts(run);
    expect(counts.spendCapFailures).toBeGreaterThanOrEqual(1);
    expect(failures.join(' ')).toContain('signings reconcile 0');
  });
});

describe('season free-agency audit CLI', () => {
  it('passes on the committed run fixture and fails precisely on a tampered copy', async () => {
    await withTmpDir(async (dir) => {
      const ok = await runCli([
        'season',
        'free-agency',
        'audit',
        '--input',
        RUN_FIXTURE,
        '--format',
        'json',
      ]);
      expect(ok.code).toBe(0);
      const payload = seasonFreeAgencyAuditReportSchema.parse(jsonPayload(ok.stdout, ok.stderr));
      expect(payload.pass).toBe(true);
      expect(payload.windows).toBe(0);

      const tamperedPath = join(dir, 'tampered-run.json');
      const raw = JSON.parse(readFileSync(RUN_FIXTURE, 'utf8')) as {
        freeAgency: SeasonFreeAgencyState;
      };
      raw.freeAgency.signingCounts = { ...raw.freeAgency.signingCounts, lakers: 3 };
      writeFileSync(tamperedPath, `${JSON.stringify(raw, null, 2)}\n`);
      const bad = await runCli([
        'season',
        'free-agency',
        'audit',
        '--input',
        tamperedPath,
        '--format',
        'json',
      ]);
      expect(bad.code).toBe(1);
      const badPayload = seasonFreeAgencyAuditReportSchema.parse(
        jsonPayload(bad.stdout, bad.stderr),
      );
      expect(badPayload.pass).toBe(false);
      expect(badPayload.counts.signingCapFailures).toBeGreaterThanOrEqual(1);
    });
  });

  it('rejects a garbage input as a clean exit-2 data error', async () => {
    await withTmpDir(async (dir) => {
      const garbagePath = join(dir, 'garbage.json');
      writeFileSync(garbagePath, '{"not":"a run"}');
      const result = await runCli([
        'season',
        'free-agency',
        'audit',
        '--input',
        garbagePath,
        '--format',
        'json',
      ]);
      expect(result.code).toBe(2);
    });
  });
});

describe('season free-agency calibrate gates (pure)', () => {
  function measuredFixture(
    overrides: Partial<SeasonFreeAgencyMeasuredFacts> = {},
  ): SeasonFreeAgencyMeasuredFacts {
    return {
      seasonsSimulated: 4,
      windowsOpened: 12,
      windowsComplete: 12,
      candidateTotal: 144,
      candidateShortfalls: 0,
      uniqueIdentities: 140,
      canonicalReuse: 4,
      declarations: 360,
      declaredTargets: 200,
      interestByBand: { featured: 60, role: 90, development: 50, emergency: 0 },
      winsByBand: { featured: 4, role: 6, development: 2, emergency: 0 },
      interestFranchises: 45,
      skipFranchises: 75,
      skipShare: 0.6,
      signings: 12,
      signingFranchises: 11,
      signingsPerFranchiseMean: 0.4,
      signingsPerFranchiseMin: 0,
      signingsPerFranchiseMax: 2,
      signingCapReached: 0,
      bandCapViolations: 0,
      signingCapViolations: 0,
      spendCapViolations: 0,
      influenceCostsMean: 1.5,
      influenceCostsMin: 1,
      influenceCostsMax: 3,
      rosterSizesMean: 10.4,
      rosterSizesMin: 10,
      rosterSizesMax: 12,
      ownershipRows: 1240,
      activeLoads: 1200,
      activePairs: 5400,
      effectsFailures: 0,
      rosterIllegal: 0,
      rotationIllegal: 0,
      traceAuditFailures: 0,
      linkFailures: 0,
      influenceDecideFailures: 0,
      eliteExclusionFailures: 0,
      oneOutlierFailures: 0,
      signedAboveDraftedMedian: 1,
      signedAboveDraftedMedianShare: 1 / 12,
      signingsByBand: { contender: 2, playoff: 5, average: 5, weaker: 0 },
      richGetRicherFailures: 0,
      determinismProbe: { probed: true, identical: true },
      summaryIdentityProbe: { probed: false, identical: true },
      ...overrides,
    };
  }

  const heldOut = measuredFixture();

  it('passes every gate on clean measured facts', () => {
    const metrics = evaluateFreeAgencyGates(measuredFixture(), heldOut, {
      summaryIdentity: { probed: false, identical: true },
    });
    for (const metric of metrics) {
      expect(metric.status, metric.key).toBe('pass');
    }
  });

  it('fails the band-signing-cap gate on a violation', () => {
    const metrics = evaluateFreeAgencyGates(measuredFixture({ bandCapViolations: 1 }), heldOut, {
      summaryIdentity: { probed: false, identical: true },
    });
    expect(metrics.find((metric) => metric.key === 'bandSigningCaps')?.pass).toBe(false);
  });

  it('fails the determinism probe gate on a diverged window', () => {
    const metrics = evaluateFreeAgencyGates(
      measuredFixture({ determinismProbe: { probed: true, identical: false } }),
      heldOut,
      { summaryIdentity: { probed: false, identical: true } },
    );
    expect(metrics.find((metric) => metric.key === 'determinismProbe')?.pass).toBe(false);
  });

  it('passes the summary-identity gate vacuously when no zero-signing season was probed', () => {
    const metrics = evaluateFreeAgencyGates(measuredFixture(), heldOut, {
      summaryIdentity: { probed: false, identical: true },
    });
    expect(metrics.find((metric) => metric.key === 'summaryIdentity')?.pass).toBe(true);
  });

  it('fails the summary-identity gate when a zero-signing season diverged', () => {
    const metrics = evaluateFreeAgencyGates(measuredFixture(), heldOut, {
      summaryIdentity: { probed: true, identical: false },
    });
    expect(metrics.find((metric) => metric.key === 'summaryIdentity')?.pass).toBe(false);
  });

  it('skips gates below the minimum season sample (never passing)', () => {
    const metrics = evaluateFreeAgencyGates(
      measuredFixture({ seasonsSimulated: 2, windowsOpened: 6 }),
      measuredFixture({ seasonsSimulated: 0 }),
      { summaryIdentity: { probed: false, identical: true } },
    );
    expect(metrics.find((metric) => metric.key === 'bandSigningCaps')?.status).toBe(
      'skippedInsufficientSample',
    );
    expect(metrics.find((metric) => metric.key === 'bandSigningCaps')?.pass).toBe(false);
  });
});

describe('season free-agency targets artifact schema', () => {
  function targetsFixture() {
    return {
      schemaVersion: 1,
      targetsVersion: SEASON_FREE_AGENCY_TARGETS_VERSION,
      policy: {
        bandSigningCaps: { contender: 1, playoff: 2, average: 3, weaker: 3 },
        maxSigningsPerSeason: 3,
        maxSeasonSpend: 6,
        windowComposition: { featured: 1, role: 5, development: 3, emergency: 3 },
        maxCandidates: 12,
        minWindowsPerSeason: 3,
        ownershipRows: [SEASON_FREE_AGENCY_OWNERSHIP_MIN, SEASON_FREE_AGENCY_OWNERSHIP_MAX],
        activeEffects: [300, 1350],
        aboveDraftedShareEnvelope: [
          SEASON_FREE_AGENCY_ABOVE_DRAFTED_MIN,
          SEASON_FREE_AGENCY_ABOVE_DRAFTED_MAX,
        ],
        skipShareMax: SEASON_FREE_AGENCY_SKIP_SHARE_MAX,
        minSeasons: 4,
      },
      cohort: { seedFrom: 0, seedTo: 7 },
      heldOut: { seedFrom: 8, seedTo: 11 },
      measured: {
        calibration: {
          seasonsSimulated: 8,
          windowsOpened: 24,
          windowsComplete: 24,
          candidateTotal: 288,
          candidateShortfalls: 0,
          uniqueIdentities: 285,
          canonicalReuse: 3,
          declarations: 720,
          declaredTargets: 601,
          interestByBand: { featured: 200, role: 300, development: 101, emergency: 0 },
          winsByBand: { featured: 10, role: 40, development: 18, emergency: 0 },
          interestFranchises: 90,
          skipFranchises: 150,
          skipShare: 0.6,
          signings: 68,
          signingFranchises: 60,
          signingsPerFranchiseMean: 0.28,
          signingsPerFranchiseMin: 0,
          signingsPerFranchiseMax: 3,
          signingCapReached: 0,
          bandCapViolations: 0,
          signingCapViolations: 0,
          spendCapViolations: 0,
          influenceCostsMean: 1.5,
          influenceCostsMin: 1,
          influenceCostsMax: 3,
          rosterSizesMean: 10.5,
          rosterSizesMin: 10,
          rosterSizesMax: 12,
          ownershipRows: 2468,
          activeLoads: 2400,
          activePairs: 10800,
          effectsFailures: 0,
          rosterIllegal: 0,
          rotationIllegal: 0,
          traceAuditFailures: 0,
          linkFailures: 0,
          influenceDecideFailures: 0,
          eliteExclusionFailures: 0,
          oneOutlierFailures: 0,
          signedAboveDraftedMedian: 0,
          signedAboveDraftedMedianShare: 0,
          signingsByBand: { contender: 17, playoff: 36, average: 15, weaker: 0 },
          richGetRicherFailures: 0,
          determinismProbe: { probed: true, identical: true },
          summaryIdentityProbe: { probed: false, identical: true },
        },
        heldOut: {
          seasonsSimulated: 4,
          windowsOpened: 12,
          windowsComplete: 12,
          signings: 30,
          bandCapViolations: 0,
          signingCapViolations: 0,
          spendCapViolations: 0,
          linkFailures: 0,
          traceAuditFailures: 0,
          effectsFailures: 0,
          rosterIllegal: 0,
          rotationIllegal: 0,
          influenceDecideFailures: 0,
          eliteExclusionFailures: 0,
          oneOutlierFailures: 0,
          richGetRicherFailures: 0,
          ownershipRows: 1200,
          determinismProbe: { probed: true, identical: true },
          summaryIdentityProbe: { probed: false, identical: true },
        },
      },
      gates: {
        windowsOpened: true,
        bandSigningCaps: true,
        threeSigningsPerSeason: true,
        sixInfluencePerSeason: true,
        linkReconciliation: true,
        traceAudit: true,
        effectsInvariants: true,
        rosterLegality: true,
        ownershipRows: true,
        eliteExclusion: true,
        oneOutlierCeiling: true,
        noRichGetRicher: true,
        influenceTieBreak: true,
        determinismProbe: true,
        candidateQuality: true,
        interestActivity: true,
        summaryIdentity: true,
        heldOut: true,
      },
      engineVersion: 'engine-test',
      gameVersion: 'season-game-v4',
      gameTargetsVersion: 'season-game-targets-v4',
      generatedAtIso: '2026-08-14T00:00:00.000Z',
    };
  }

  it('round-trips the frozen targets artifact shape', () => {
    const input = targetsFixture();
    expect(seasonFreeAgencyTargetsSchema.parse(input)).toEqual(input);
  });

  it('rejects a band-cap policy drift from the frozen literals', () => {
    const input = targetsFixture() as {
      policy: { bandSigningCaps: { contender: number } };
    };
    input.policy.bandSigningCaps.contender = 2;
    expect(seasonFreeAgencyTargetsSchema.safeParse(input).success).toBe(false);
  });
});

describe('season free-agency calibrate report schema', () => {
  it('parses a complete calibrate report payload and preserves every field', () => {
    const input = {
      schemaVersion: 1,
      command: 'season free-agency calibrate',
      targetsVersion: 'free-agency-targets-v1',
      calibrationSeeds: 8,
      validationSeeds: 4,
      seasonsSimulated: 12,
      windowsOpened: 36,
      signings: 98,
      uniqueIdentities: 285,
      canonicalReuse: 3,
      candidateTotal: 432,
      candidateShortfalls: 0,
      declaredTargets: 900,
      signingsByBand: { contender: 17, playoff: 36, average: 15, weaker: 0 },
      interestByBand: { featured: 300, role: 450, development: 150, emergency: 0 },
      winsByBand: { featured: 12, role: 60, development: 26, emergency: 0 },
      skipShare: 0.6,
      bandCapViolations: 0,
      signingCapViolations: 0,
      spendCapViolations: 0,
      linkFailures: 0,
      traceAuditFailures: 0,
      effectsFailures: 0,
      influenceDecideFailures: 0,
      eliteExclusionFailures: 0,
      oneOutlierFailures: 0,
      richGetRicherFailures: 0,
      signedAboveDraftedMedianShare: 0,
      determinismProbe: { probed: true, identical: true },
      summaryIdentityProbe: { probed: false, identical: true },
      gates: {
        windowsOpened: true,
        bandSigningCaps: true,
        threeSigningsPerSeason: true,
        sixInfluencePerSeason: true,
        linkReconciliation: true,
        traceAudit: true,
        effectsInvariants: true,
        rosterLegality: true,
        ownershipRows: true,
        eliteExclusion: true,
        oneOutlierCeiling: true,
        noRichGetRicher: true,
        influenceTieBreak: true,
        determinismProbe: true,
        candidateQuality: true,
        interestActivity: true,
        summaryIdentity: true,
        heldOut: true,
      },
      metrics: [],
      skippedGates: [],
      targetsWritten: true,
      targetsPath: 'apps/web/static/data/season/free-agency-targets.json',
      durationMs: 900_000,
    };
    expect(seasonFreeAgencyCalibrateReportSchema.parse(input)).toEqual(input);
  });
});

describe('season free-agency helpers (pure)', () => {
  it('computes the nearest-rank lower mid of a sorted array', () => {
    expect(medianOf([1, 2, 3])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(3);
    expect(medianOf([])).toBe(0);
  });

  it('maps trade offer sizes to the v2 package kinds and bands', () => {
    expect(
      packageKindOfOffer({ outgoingPlayerVersionIds: [1], incomingPlayerVersionIds: [1] }),
    ).toBe('1-1');
    expect(
      packageKindOfOffer({ outgoingPlayerVersionIds: [1, 2], incomingPlayerVersionIds: [3, 4] }),
    ).toBe('2-2');
    expect(
      packageKindOfOffer({ outgoingPlayerVersionIds: [1], incomingPlayerVersionIds: [2, 3] }),
    ).toBe('1-2');
    expect(
      packageKindOfOffer({ outgoingPlayerVersionIds: [1, 2], incomingPlayerVersionIds: [3] }),
    ).toBe('2-1');
    expect(seasonTradeValueBandOf('1-1')).toEqual({ min: 850, max: 1150 });
    expect(seasonTradeValueBandOf('2-2')).toEqual({ min: 800, max: 1200 });
    expect(seasonTradeValueBandOf('1-2')).toEqual({ min: 800, max: 1200 });
    expect(seasonTradeValueBandOf('2-1')).toEqual({ min: 800, max: 1200 });
  });
});

describe.skipIf(!INTEGRATION_RUNS)('season free-agency calibrate (integration-run)', () => {
  it('freezes free-agency-targets-v1 with all gates passing over the full cohort', async () => {
    const { seasonFreeAgencyCalibrate, DEFAULT_FREE_AGENCY_TARGETS } =
      await import('./commands/season-free-agency-calibrate.ts');
    const report = seasonFreeAgencyCalibrate({
      input: null,
      'seed-from': '0',
      'seed-to': '7',
      workers: '1',
      out: null,
      manifest: null,
      validate: null,
    });
    expect(report.exitCode).toBe(0);
    const payload = seasonFreeAgencyCalibrateReportSchema.parse(report.payload);
    expect(payload.targetsWritten).toBe(true);
    const committed = JSON.parse(readFileSync(DEFAULT_FREE_AGENCY_TARGETS, 'utf8')) as unknown;
    expect(seasonFreeAgencyTargetsSchema.safeParse(committed).success).toBe(true);
  }, 2_400_000);

  it('validates the committed free-agency targets artifact', async () => {
    const { validateSeasonFreeAgencyTargets, DEFAULT_FREE_AGENCY_TARGETS } =
      await import('./commands/season-free-agency-calibrate.ts');
    const report = validateSeasonFreeAgencyTargets(
      {
        input: null,
        'seed-from': null,
        'seed-to': null,
        workers: null,
        out: null,
        manifest: null,
        validate: null,
      },
      DEFAULT_FREE_AGENCY_TARGETS,
    );
    expect(report.failures).toHaveLength(0);
  });
});
