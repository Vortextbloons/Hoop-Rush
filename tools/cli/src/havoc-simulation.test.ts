import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contentHashSchema,
  eraIdSchema,
  eraSimulationProfileSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { buildHavocGameInput } from '@hoop-rush/engine';
import {
  buildFixtureBracket,
  buildHavocEraProfile,
  buildHavocVersionSet,
  buildManifest,
  buildSeasonDraftCatalog,
} from '@hoop-rush/test-fixtures';
import { jsonPayload, runCli, withTmpDir } from './cli-test-helpers.ts';
import { sha256Hex } from './io.ts';
import {
  havocAuditReportSchema,
  havocCatalogSourceOf,
  havocCliInputPairCheck,
  havocSimulateReportSchema,
  loadHavocCliAssets,
  replayHavocCliRunFromReport,
  type HavocCliAssets,
  type HavocSimulateReport,
} from './havoc-cli-support.ts';
import { runHavocCliSimulation } from './commands/havoc-simulate.ts';

const TEST_SEED = seedSchema.parse('a1b2c3d4e5f60718293a4b5c6d7e8f9a');

function fixtureAssets(): HavocCliAssets {
  const catalog = buildSeasonDraftCatalog();
  return {
    manifestPath: 'fixture://havoc',
    catalog,
    bracket: buildFixtureBracket(),
    profile: eraSimulationProfileSchema.parse(buildHavocEraProfile()),
    source: havocCatalogSourceOf(catalog, 'a'.repeat(64)),
    versionSet: buildHavocVersionSet(),
  };
}

function simulateFixture(
  assets: HavocCliAssets,
  games: number,
  comparison: boolean,
  seed = TEST_SEED,
): HavocSimulateReport {
  return runHavocCliSimulation({
    seed,
    plan: { pins: null, rerollRound: null },
    comparison,
    games,
    assets,
  }).report;
}

function writeFixtureManifest(dir: string): string {
  const write = (name: string, value: unknown) => {
    const text = JSON.stringify(value);
    writeFileSync(join(dir, name), text);
    return { url: name, contentHash: contentHashSchema.parse(sha256Hex(text)) };
  };
  const draftCatalog = write('draft-catalog.json', buildSeasonDraftCatalog());
  const bracket = write('bracket.json', buildFixtureBracket());
  const profile = write('era-2010s.json', buildHavocEraProfile());
  const placeholder = write('placeholder.json', {});
  const manifest = buildManifest({
    eraSimulationProfiles: [{ eraId: eraIdSchema.parse('2010s'), ...profile }],
    bracket,
    season: {
      league: placeholder,
      schedule: placeholder,
      draftCatalog,
      rosterTargets: placeholder,
    },
  });
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

describe('havoc CLI simulation determinism', () => {
  it('replays the same seed and picks to identical digests across two runs', () => {
    const assets = fixtureAssets();
    const first = simulateFixture(assets, 4, false);
    const second = simulateFixture(assets, 4, false);
    expect(second).toEqual(first);
    expect(second.reportDigest).toBe(first.reportDigest);
    expect(second.draft.lockedDigest).toBe(first.draft.lockedDigest);
    expect(second.havoc.games.map((game) => game.resultDigest)).toEqual(
      first.havoc.games.map((game) => game.resultDigest),
    );
    expect(second.havoc.games.map((game) => game.inputDigest)).toEqual(
      first.havoc.games.map((game) => game.inputDigest),
    );
    expect(second.havoc.games.map((game) => game.tapeDigest)).toEqual(
      first.havoc.games.map((game) => game.tapeDigest),
    );
  });

  it('pins the five source versions from a completed lineup and reproduces it', () => {
    const assets = fixtureAssets();
    const report = simulateFixture(assets, 3, false);
    const pins = report.lineup.map((entry) => {
      if (entry.playerVersionId === null) throw new Error('fixture lineup has no version id');
      return { slot: entry.slot, playerVersionId: entry.playerVersionId };
    });
    const pinned = runHavocCliSimulation({
      seed: TEST_SEED,
      plan: { pins, rerollRound: null },
      comparison: false,
      games: 3,
      assets,
    }).report;
    expect(pinned.lineup).toEqual(report.lineup);
    expect(pinned.draft.lockedDigest).toBe(report.draft.lockedDigest);
    expect(pinned.havoc.games.map((game) => game.resultDigest)).toEqual(
      report.havoc.games.map((game) => game.resultDigest),
    );
  });

  it('rejects a pinned version that no offer can satisfy', () => {
    const assets = fixtureAssets();
    expect(() =>
      runHavocCliSimulation({
        seed: TEST_SEED,
        plan: {
          pins: ['PG', 'SG', 'SF', 'PF', 'C'].map((slot) => ({
            slot: slot as 'PG' | 'SG' | 'SF' | 'PF' | 'C',
            playerVersionId: `pv-${'f'.repeat(32)}`,
          })),
          rerollRound: null,
        },
        comparison: false,
        games: 1,
        assets,
      }),
    ).toThrow(/does not contain pinned version/);
  });

  it('keeps havoc and normal games paired by number, opponent, home and seed for all 82 games', () => {
    const assets = fixtureAssets();
    const report = simulateFixture(assets, 82, true);
    expect(report.havoc.games).toHaveLength(82);
    expect(report.normal?.games).toHaveLength(82);
    const replayed = replayHavocCliRunFromReport(report, assets);
    report.havoc.games.forEach((havocGame, index) => {
      expect(havocGame.gameNumber).toBe(index + 1);
      const normalGame = report.normal?.games.find(
        (candidate) => candidate.gameNumber === havocGame.gameNumber,
      );
      expect(normalGame).toBeDefined();
      if (normalGame === undefined) return;
      expect(normalGame.opponentId).toBe(havocGame.opponentId);
      expect(normalGame.humanHome).toBe(havocGame.humanHome);
      expect(normalGame.seed).toBe(havocGame.seed);
      const havocInput = buildHavocGameInput({
        locked: replayed.locked,
        gameNumber: havocGame.gameNumber,
        variant: 'havoc',
      });
      const normalInput = buildHavocGameInput({
        locked: replayed.locked,
        gameNumber: havocGame.gameNumber,
        variant: 'normal',
      });
      expect(havocCliInputPairCheck(havocInput, normalInput)).toEqual([]);
    });
    const comparison = report.comparison;
    if (comparison === null) throw new Error('comparison missing');
    expect(comparison.games).toHaveLength(82);
    expect(comparison.havoc.games).toBe(82);
    expect(comparison.normal.games).toBe(82);
    for (const pair of comparison.games) {
      expect(pair.havoc.humanScore).toBe(
        report.havoc.games.find((game) => game.gameNumber === pair.gameNumber)?.summary.humanScore,
      );
      expect(pair.normal.humanScore).toBe(
        report.normal?.games.find((game) => game.gameNumber === pair.gameNumber)?.summary
          .humanScore,
      );
    }
    const derived = report.report;
    if (derived === null) throw new Error('derived report missing');
    expect(derived.status).toBe('complete');
    expect(derived.mvp).toEqual(comparison.mvp);
    expect(derived.lineup).toHaveLength(5);
    expect(derived.comparison?.runId).toBe(report.runId);
  });
});

describe('havoc CLI audit command', () => {
  it('passes on a simulated set and fails on a corrupted result digest', async () => {
    await withTmpDir(async (dir) => {
      const manifestPath = writeFixtureManifest(dir);
      const assets = loadHavocCliAssets(manifestPath);
      const report = simulateFixture(assets, 82, true);
      expect(havocSimulateReportSchema.safeParse(report).success).toBe(true);
      const reportPath = join(dir, 'report.json');
      writeFileSync(reportPath, JSON.stringify(report));
      const ok = await runCli([
        'havoc',
        'audit',
        '--input',
        reportPath,
        '--manifest',
        manifestPath,
        '--format',
        'json',
      ]);
      expect(ok.code).toBe(0);
      const payload = havocAuditReportSchema.parse(jsonPayload(ok.stdout, ok.stderr));
      expect(payload.pass).toBe(true);
      expect(payload.findings).toEqual([]);
      expect(payload.checks.draftReplay).toBe(true);
      expect(payload.checks.paired).toBe(true);
      expect(payload.checks.aggregates).toBe(true);
      expect(payload.checks.digests).toBe(true);
      expect(payload.checks.havocGames).toBe(82);
      expect(payload.checks.normalGames).toBe(82);

      const corrupted = structuredClone(report);
      const firstGame = corrupted.havoc.games[0];
      if (firstGame === undefined) throw new Error('report has no havoc games');
      firstGame.resultDigest = 'f'.repeat(32);
      writeFileSync(reportPath, JSON.stringify(corrupted));
      const bad = await runCli([
        'havoc',
        'audit',
        reportPath,
        '--manifest',
        manifestPath,
        '--format',
        'json',
      ]);
      expect(bad.code).toBe(1);
      const badPayload = havocAuditReportSchema.parse(jsonPayload(bad.stdout, bad.stderr));
      expect(badPayload.pass).toBe(false);
      expect(badPayload.checks.digests).toBe(false);
      expect(badPayload.findings.join('\n')).toContain('result digest');
    });
  });

  it('rejects a report that fails the shared schema', async () => {
    await withTmpDir(async (dir) => {
      const reportPath = join(dir, 'garbage.json');
      writeFileSync(reportPath, '{"not":"a havoc report"}');
      const result = await runCli(['havoc', 'audit', '--input', reportPath, '--format', 'json']);
      expect(result.code).toBe(2);
    });
  });
});
