import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { contentHashSchema, eraIdSchema } from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildHavocEraProfile,
  buildManifest,
  buildSeasonDraftCatalog,
} from '@hoop-rush/test-fixtures';
import { UsageError } from './args.ts';
import { withTmpDir } from './cli-test-helpers.ts';
import { sha256Hex } from './io.ts';
import { loadHavocCliAssets } from './havoc-cli-support.ts';
import {
  havocCalibrate,
  havocCalibrateReportSchema,
  type HavocCliMultiplayerStats,
} from './commands/havoc-cohorts.ts';

function writeFixtureManifest(dir: string): string {
  const write = (name: string, value: unknown) => {
    const text = JSON.stringify(value);
    writeFileSync(join(dir, name), text);
    return { url: name, contentHash: contentHashSchema.parse(sha256Hex(text)) };
  };
  const draftCatalog = write('draft-catalog.json', buildSeasonDraftCatalog());
  const bracket = write('bracket.json', buildFixtureBracket());
  const profile = write('era-2010s.json', buildHavocEraProfile());
  const manifest = buildManifest({
    eraSimulationProfiles: [{ eraId: eraIdSchema.parse('2010s'), ...profile }],
    bracket,
    draftCatalog,
  });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

const MULTIPLAYER_OPTIONS = {
  'seed-count': '3',
  'holdout-count': '2',
  mechanism: null,
  games: null,
  multiplayer: true,
  manifest: null,
} as const;

function assertCohortShape(stats: HavocCliMultiplayerStats, series: number): void {
  expect(stats.series).toBe(series);
  expect(stats.decidedSeries).toBe(series);
  expect(stats.games).toBeGreaterThanOrEqual(series * 4);
  expect(stats.games).toBeLessThanOrEqual(series * 7);
  expect(stats.averageGamesPerSeries).toBeGreaterThanOrEqual(4);
  expect(stats.averageGamesPerSeries).toBeLessThanOrEqual(7);
  expect(stats.p1Score.count).toBe(stats.games);
  expect(stats.p2Score.count).toBe(stats.games);
  expect(stats.margin.count).toBe(stats.games);
  expect(stats.totalPoints.count).toBe(stats.games);
  expect(stats.clones.seconds.count).toBe(stats.games);
  expect(stats.clones.points.count).toBe(stats.games);
  expect(stats.clones.rebounds.count).toBe(stats.games);
  expect(stats.clones.assists.count).toBe(stats.games);
  expect(stats.overtimeGames).toBeGreaterThanOrEqual(0);
  expect(stats.overtimeGames).toBeLessThanOrEqual(stats.games);
  expect(
    stats.sweeps['4-0'] + stats.sweeps['4-1'] + stats.sweeps['4-2'] + stats.sweeps['4-3'],
  ).toBe(stats.decidedSeries);
  expect(stats.firstPicker.series).toBe(stats.decidedSeries);
  expect(stats.firstPicker.wins).toBeLessThanOrEqual(stats.firstPicker.series);
  const firstPickerWinRate = stats.firstPicker.winRate;
  if (firstPickerWinRate === null) throw new Error('first-picker win rate missing');
  expect(firstPickerWinRate).toBeGreaterThanOrEqual(0);
  expect(firstPickerWinRate).toBeLessThanOrEqual(1);
  expect(stats.ratingSensitivity.higherRatedWins).toBeLessThanOrEqual(
    stats.ratingSensitivity.higherRatedSeries,
  );
  if (stats.ratingSensitivity.correlation !== null) {
    expect(stats.ratingSensitivity.correlation).toBeGreaterThanOrEqual(-1);
    expect(stats.ratingSensitivity.correlation).toBeLessThanOrEqual(1);
  }
  expect(stats.auditFailures).toBe(0);
  expect(stats.typedFailures).toBe(0);
  expect(Array.isArray(stats.mutations)).toBe(true);
  const mvpTotal = Object.values(stats.mvpSlots).reduce((sum, count) => sum + count, 0);
  expect(mvpTotal).toBe(stats.decidedSeries);
}

describe('havoc multiplayer calibration', () => {
  it('reports the structured multiplayer shape and exercises the reroll policy', async () => {
    await withTmpDir((dir) => {
      const manifestPath = writeFixtureManifest(dir);
      const assets = loadHavocCliAssets(manifestPath);
      const report = havocCalibrate(MULTIPLAYER_OPTIONS, { assets });
      expect(report.ok).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.failures).toEqual([]);
      const payload = havocCalibrateReportSchema.parse(report.payload);
      expect(payload.mode).toBe('multiplayer');
      expect(payload.cohorts).toBeNull();
      expect(payload.paired).toBeNull();
      expect(payload.mechanism).toBeNull();
      expect(payload.auditFailures).toBe(0);
      expect(payload.typedFailures).toEqual([]);
      expect(payload.pass).toBe(true);
      const multiplayer = payload.multiplayer;
      if (multiplayer === null) throw new Error('multiplayer payload missing');
      expect(multiplayer.draftPolicy).toContain('reroll');
      assertCohortShape(multiplayer.train, 3);
      assertCohortShape(multiplayer.holdout, 2);
      expect(multiplayer.train.rerollsUsed).toBeGreaterThan(0);
      expect(multiplayer.train.seriesWithReroll).toBeGreaterThan(0);
      expect(multiplayer.holdout.rerollsUsed).toBeGreaterThan(0);
      expect(multiplayer.holdout.seriesWithReroll).toBeGreaterThan(0);
    });
  });

  it('keeps the multiplayer report payload byte-identical across two runs', async () => {
    await withTmpDir((dir) => {
      const manifestPath = writeFixtureManifest(dir);
      const assets = loadHavocCliAssets(manifestPath);
      const first = havocCalibrate(MULTIPLAYER_OPTIONS, { assets });
      const second = havocCalibrate(MULTIPLAYER_OPTIONS, { assets });
      expect(havocCalibrateReportSchema.parse(second.payload)).toEqual(
        havocCalibrateReportSchema.parse(first.payload),
      );
      expect(second.details).toEqual(first.details);
    });
  });

  it('rejects --multiplayer combined with --mechanism', async () => {
    await withTmpDir((dir) => {
      const manifestPath = writeFixtureManifest(dir);
      const assets = loadHavocCliAssets(manifestPath);
      expect(() =>
        havocCalibrate({ ...MULTIPLAYER_OPTIONS, mechanism: 'clone-on' }, { assets }),
      ).toThrow(UsageError);
    });
  });
});
