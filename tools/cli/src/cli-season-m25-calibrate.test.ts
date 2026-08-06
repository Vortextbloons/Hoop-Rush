import { describe, expect, it } from 'vitest';

/**
 * M2.5 integration-run calibration tests (spec/2.0 M2.5, contract §17).
 *
 * These tests run the three full calibration commands (season health /
 * trade / influence calibrate) over the committed run fixture. They are
 * SKIPPED during the implementation window by design: the engine's M2.5
 * seams (`rollSeasonInjuryForPlayer`, `openSeasonTradeWindow`,
 * `deriveSeasonPostBlockState`, `seasonRunStateDigest`, ...) land at lead
 * integration, the committed fixture regenerates under schema 7, and the
 * packaged targets artifacts (`injury-targets.json`, `trade-targets.json`,
 * `influence-targets.json`) freeze after the first measured run. Remove the
 * `it.skip` guards when the lead confirms integration.
 *
 * Note: these files import the awaiting-engine seams, so they fail
 * typecheck until integration (reported as awaiting-engine, not CLI-owned
 * errors).
 */

describe.skip('season health calibrate (integration-run)', () => {
  it('freezes injury-targets-v1 with all gates passing', async () => {
    const { seasonHealthCalibrate, seasonInjuryTargetsSchema, DEFAULT_INJURY_TARGETS } =
      await import('./commands/season-health.ts');
    const report = await seasonHealthCalibrate({
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

describe.skip('season trade calibrate (integration-run)', () => {
  it('freezes trade-targets-v1 with all gates passing', async () => {
    const { seasonTradeCalibrate, seasonTradeTargetsSchema, DEFAULT_TRADE_TARGETS } =
      await import('./commands/season-trade.ts');
    const report = await seasonTradeCalibrate({
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

describe.skip('season influence calibrate (integration-run)', () => {
  it('freezes influence-targets-v1 with all gates passing', async () => {
    const { seasonInfluenceCalibrate, seasonInfluenceTargetsSchema, DEFAULT_INFLUENCE_TARGETS } =
      await import('./commands/season-influence.ts');
    const report = await seasonInfluenceCalibrate({
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
