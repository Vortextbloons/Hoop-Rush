import { describe, expect, it } from 'vitest';

/**
 * M2.5 integration-run calibration tests (spec/2.0 M2.5, contract §17).
 *
 * These tests run the three full calibration commands (season health /
 * trade / influence calibrate) over the committed run fixture. They are
 * skipped unless `HOOP_RUSH_INTEGRATION_RUNS=1`: the commands freeze the
 * packaged targets artifacts (`injury-targets.json`, `trade-targets.json`,
 * `influence-targets.json`) after the first measured run, so the nightly
 * workflow forces them exactly once per day (the same guard the skips were
 * introduced with).
 */
const INTEGRATION_RUNS = process.env.HOOP_RUSH_INTEGRATION_RUNS === '1';

describe.skipIf(!INTEGRATION_RUNS)('season health calibrate (integration-run)', () => {
  it('freezes injury-targets-v1 with all gates passing', async () => {
    const { seasonHealthCalibrate, seasonInjuryTargetsSchema, DEFAULT_INJURY_TARGETS } =
      await import('./commands/season-health.ts');
    const report = seasonHealthCalibrate({
      input: null,
      'seed-from': '0',
      'seed-to': '1',
      workers: '1',
      out: null,
      manifest: null,
      validate: null,
    });
    expect(report.exitCode).toBe(0);
    const payload = seasonInjuryTargetsSchema.safeParse(report.payload);
    expect(payload.success).toBe(true);
    void DEFAULT_INJURY_TARGETS;
  }, 1_200_000);

  it('validates a committed injury-targets artifact', async () => {
    const { validateSeasonInjuryTargets, DEFAULT_INJURY_TARGETS } =
      await import('./commands/season-health.ts');
    const report = validateSeasonInjuryTargets(
      {
        input: null,
        'seed-from': null,
        'seed-to': null,
        workers: null,
        out: null,
        manifest: null,
        validate: null,
      },
      DEFAULT_INJURY_TARGETS,
    );
    expect(report.failures).toHaveLength(0);
  });
});

describe.skipIf(!INTEGRATION_RUNS)('season trade calibrate (integration-run)', () => {
  it('freezes trade-targets-v1 with all gates passing', async () => {
    const { seasonTradeCalibrate, seasonTradeTargetsSchema, DEFAULT_TRADE_TARGETS } =
      await import('./commands/season-trade.ts');
    const report = seasonTradeCalibrate({
      input: null,
      'seed-from': '0',
      'seed-to': '1',
      workers: '1',
      out: null,
      manifest: null,
      validate: null,
    });
    expect(report.exitCode).toBe(0);
    const payload = seasonTradeTargetsSchema.safeParse(report.payload);
    expect(payload.success).toBe(true);
    void DEFAULT_TRADE_TARGETS;
  }, 1_200_000);
});

describe.skipIf(!INTEGRATION_RUNS)('season influence calibrate (integration-run)', () => {
  it('freezes influence-targets-v1 with all gates passing', async () => {
    const { seasonInfluenceCalibrate, seasonInfluenceTargetsSchema, DEFAULT_INFLUENCE_TARGETS } =
      await import('./commands/season-influence.ts');
    const report = seasonInfluenceCalibrate({
      input: null,
      'seed-from': '0',
      'seed-to': '1',
      workers: '1',
      out: null,
      manifest: null,
      validate: null,
    });
    expect(report.exitCode).toBe(0);
    const payload = seasonInfluenceTargetsSchema.safeParse(report.payload);
    expect(payload.success).toBe(true);
    void DEFAULT_INFLUENCE_TARGETS;
  }, 1_200_000);
});
