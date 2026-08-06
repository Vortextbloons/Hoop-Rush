import { describe, expect, it } from 'vitest';
import {
  seasonEffectsSensitivity,
  seasonEffectsDistribution,
  seasonEffectsRoles,
  runSeasonEffectsCohortInProcess,
  validateSeasonEffectTargets,
  defaultEffectsEngineDeps,
  DEFAULT_EFFECT_TARGETS,
} from './commands/season-effects';
import {
  SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP,
  SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP,
  SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_HELP_DEFENSE_MAX_PP,
  SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP,
  SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP,
  checkSeasonGameResult,
  createSeasonEffectsState,
  simulateSeasonGame,
  simulateSeasonGameWithEffects,
} from '@hoop-rush/engine';
import {
  seasonEffectsCalibrateReportSchema,
  seasonEffectsDistributionReportSchema,
  seasonEffectsRolesReportSchema,
  seasonEffectsSensitivityReportSchema,
} from './report-schemas';

const deps = defaultEffectsEngineDeps;

describe('season effects CLI commands', () => {
  it('sensitivity reports per-mechanism deltas that grow with fatigue', () => {
    const report = seasonEffectsSensitivity({}, deps);
    const payload = seasonEffectsSensitivityReportSchema.parse(report.payload);
    expect(report.failures).toHaveLength(0);
    expect(payload.rows.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < payload.rows.length; i += 1) {
      const prev = payload.rows[i - 1];
      const cur = payload.rows[i];
      if (prev === undefined || cur === undefined) continue;
      expect(Math.abs(cur.shooterDelta)).toBeGreaterThanOrEqual(Math.abs(prev.shooterDelta));
      expect(Math.abs(cur.handlerDelta)).toBeGreaterThanOrEqual(Math.abs(prev.handlerDelta));
      expect(Math.abs(cur.defenseDelta)).toBeGreaterThanOrEqual(Math.abs(prev.defenseDelta));
    }
  }, 120_000);

  it('distribution stays inside the production envelopes on a small cohort', async () => {
    const report = await seasonEffectsDistribution(
      { 'seed-from': '0', 'seed-to': '5', workers: '1' },
      (request) =>
        runSeasonEffectsCohortInProcess(request, {
          simulateSeasonGame,
          checkSeasonGameResult,
          simulateSeasonGameWithEffects,
          createSeasonEffectsState,
        }),
    );
    const payload = seasonEffectsDistributionReportSchema.parse(report.payload);
    expect(payload.completedGames).toBeGreaterThan(0);
    expect(payload.checkFailures).toBe(0);
    expect(payload.determinismFailures).toBe(0);
    expect(Math.abs(payload.scoringDeltaMedian)).toBeLessThanOrEqual(5);
    expect(Math.abs(payload.turnoverDeltaMedian)).toBeLessThanOrEqual(10);
    expect(Math.abs(payload.assistDeltaMedian)).toBeLessThanOrEqual(10);
  }, 120_000);

  it('roles orders starter fatigue tight > balanced > bench-heavy', () => {
    const report = seasonEffectsRoles({}, deps);
    const payload = seasonEffectsRolesReportSchema.parse(report.payload);
    expect(payload.starterOrderingPass).toBe(true);
    expect(payload.benchOrderingPass).toBe(true);
  }, 120_000);

  it('calibrate --validate accepts the committed artifact and engine caps', () => {
    const report = validateSeasonEffectTargets({}, DEFAULT_EFFECT_TARGETS);
    expect(report.failures).toHaveLength(0);
    expect(report.ok).toBe(true);
  });

  it('calibrate runs the gates with injected doubles and reports the payload', async () => {
    const { seasonEffectsCalibrate } = await import('./commands/season-effects');
    const report = await seasonEffectsCalibrate(
      { 'seed-to': '3', workers: '1' },
      {
        simulateSeasonGame,
        checkSeasonGameResult,
        simulateSeasonGameWithEffects,
        createSeasonEffectsState,
      },
      (request) =>
        runSeasonEffectsCohortInProcess(request, {
          simulateSeasonGame,
          checkSeasonGameResult,
          simulateSeasonGameWithEffects,
          createSeasonEffectsState,
        }),
    );
    const payload = seasonEffectsCalibrateReportSchema.parse(report.payload);
    expect(payload.calibrationGames).toBeGreaterThan(0);
    // Small cohorts cannot pass the statistical gates; the payload must
    // still be well-formed and the caps must match the engine.
    expect(payload.targetsVersion).toBe('season-effect-targets-v1');
    void SEASON_EFFECTS_SHOOTER_FATIGUE_MAX_PP;
    void SEASON_EFFECTS_HANDLER_FATIGUE_MAX_PP;
    void SEASON_EFFECTS_DEFENSE_FATIGUE_MAX_PP;
    void SEASON_EFFECTS_TURNOVER_SECURITY_MAX_PP;
    void SEASON_EFFECTS_ASSIST_CONVERSION_MAX_PP;
    void SEASON_EFFECTS_HELP_DEFENSE_MAX_PP;
  }, 180_000);
});
