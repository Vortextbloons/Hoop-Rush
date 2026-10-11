import { describe, expect, it } from 'vitest';
import { eraSimulationProfileSchema } from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildHavocEraProfile,
  buildHavocVersionSet,
  buildSeasonDraftCatalog,
} from '@hoop-rush/test-fixtures';
import {
  assertHavocCliPackageCompatible,
  havocCatalogSourceOf,
  type HavocCliAssets,
} from './havoc-cli-support.ts';
import {
  HAVOC_CLI_MECHANISMS,
  havocCalibrate,
  havocCalibrateReportSchema,
  runHavocMechanismSensitivity,
  type HavocCohortSource,
} from './commands/havoc-cohorts.ts';

function fixtureCohortSource(): HavocCohortSource {
  const catalog = buildSeasonDraftCatalog();
  return {
    catalog,
    source: havocCatalogSourceOf(catalog, 'b'.repeat(64)),
    bracket: buildFixtureBracket(),
    profile: eraSimulationProfileSchema.parse(buildHavocEraProfile()),
    versionSet: buildHavocVersionSet(),
  };
}

function fixtureAssets(source: HavocCohortSource): HavocCliAssets {
  return {
    manifestPath: 'fixture://havoc',
    catalog: source.catalog,
    bracket: source.bracket,
    profile: source.profile,
    source: source.source,
    versionSet: source.versionSet,
  };
}

describe('havoc calibration cohorts', () => {
  it('reports the structured cohort shape for a tiny deterministic cohort', () => {
    const source = fixtureCohortSource();
    const report = havocCalibrate(
      {
        'seed-count': '4',
        'holdout-count': '2',
        mechanism: null,
        games: '24',
        manifest: null,
      },
      { assets: fixtureAssets(source) },
    );
    expect(report.ok).toBe(true);
    const payload = havocCalibrateReportSchema.parse(report.payload);
    expect(payload.mode).toBe('cohorts');
    expect(payload.pass).toBe(true);
    expect(payload.auditFailures).toBe(0);
    expect(payload.typedFailures).toEqual([]);
    const cohorts = payload.cohorts;
    if (cohorts === null) throw new Error('cohorts missing');
    expect(cohorts.train.seeds).toBe(4);
    expect(cohorts.holdout.seeds).toBe(2);
    for (const lineups of [cohorts.train.lineups, cohorts.holdout.lineups]) {
      for (const lineup of [lineups.ordinary, lineups.risky, lineups.extreme]) {
        expect(lineup.games).toBe(lineup.wins + lineup.losses);
        expect(lineup.score.count).toBe(lineup.games);
        expect(lineup.humanTurnovers.count).toBe(lineup.games);
        expect(lineup.humanRebounds.count).toBe(lineup.games);
        expect(lineup.humanFouls.count).toBe(lineup.games);
        expect(lineup.humanShotClockViolations.count).toBe(lineup.games);
        expect(lineup.adjustments.count).toBe(lineup.games);
        expect(lineup.auditFailures).toBe(0);
        expect(lineup.typedFailures).toBe(0);
        expect(Array.isArray(lineup.mutations)).toBe(true);
      }
    }
    expect(cohorts.train.lineups.ordinary.games).toBe(96);
    expect(cohorts.train.lineups.risky.games).toBe(96);
    expect(cohorts.train.lineups.extreme.games).toBe(96);
    expect(cohorts.holdout.lineups.ordinary.games).toBe(48);
    const paired = payload.paired;
    if (paired === null) throw new Error('paired section missing');
    expect(paired.seeds).toBe(4);
    expect(paired.havoc.games).toBe(96);
    expect(paired.normal.games).toBe(96);
    expect(paired.havoc.wins + paired.havoc.losses).toBe(96);
    expect(paired.havoc.winRate).toBeGreaterThanOrEqual(0);
    expect(paired.havoc.winRate).toBeLessThanOrEqual(1);
  });

  it('keeps a tiny cohort byte-identical across two runs', () => {
    const source = fixtureCohortSource();
    const options = {
      'seed-count': '2',
      'holdout-count': '1',
      mechanism: null,
      games: '2',
      manifest: null,
    };
    const first = havocCalibrate(options, { assets: fixtureAssets(source) });
    const second = havocCalibrate(options, { assets: fixtureAssets(source) });
    expect(havocCalibrateReportSchema.parse(second.payload)).toEqual(
      havocCalibrateReportSchema.parse(first.payload),
    );
  });
});

describe('havoc mechanism sensitivity', () => {
  it('is deterministic and the clone channel responds with exact accounting', () => {
    const source = fixtureCohortSource();
    const first = runHavocMechanismSensitivity({
      source,
      mechanismId: 'clone-on',
      seedCount: 4,
      games: 1,
    });
    const second = runHavocMechanismSensitivity({
      source,
      mechanismId: 'clone-on',
      seedCount: 4,
      games: 1,
    });
    expect(second.report).toEqual(first.report);
    expect(first.report.structuralFindings).toEqual([]);
    expect(first.report.responded).toBe(true);
    expect(first.report.pass).toBe(true);
    expect(first.report.on.auditFailures).toBe(0);
    expect(first.report.off.auditFailures).toBe(0);
    expect(first.report.on.metrics['cloneSeconds']).toBeGreaterThan(0);
    expect(first.report.off.metrics['cloneSeconds']).toBe(0);
  });

  it('exposes the time-lord rule change on the shot clock channel', () => {
    const source = fixtureCohortSource();
    const result = runHavocMechanismSensitivity({
      source,
      mechanismId: 'rule-change',
      seedCount: 4,
      games: 1,
    });
    expect(result.report.structuralFindings).toEqual([]);
    expect(result.report.onMean).toBe(30);
    expect(result.report.offMean).toBe(24);
    expect(result.report.responded).toBe(true);
    expect(result.report.pass).toBe(true);
    expect(result.report.on.metrics['opponentFullShotClock']).toBe(12);
  });

  it('defines every advertised mechanism with a compatible mutation bundle', () => {
    expect(HAVOC_CLI_MECHANISMS.length).toBeGreaterThanOrEqual(8);
    for (const mechanism of HAVOC_CLI_MECHANISMS) {
      for (const spec of mechanism.on) {
        expect(() => {
          assertHavocCliPackageCompatible(spec.tier, spec.mutationIds);
        }).not.toThrow();
      }
    }
  });
});
