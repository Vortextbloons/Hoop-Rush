import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadSeasonDraftCatalog,
  loadSeasonLeague,
  loadSeasonRosterTargets,
  loadSeasonSchedule,
  resolveSeasonArtifact,
} from './commands/season-data.ts';
import { seasonScheduleAudit, seasonScheduleGenerate } from './commands/season-schedule.ts';
import type { SeasonScheduleAuditReport, SeasonScheduleGenerateReport } from './report-schemas.ts';
import { REPO_ROOT, withTmpDir } from './cli-test-helpers.ts';
import { sha256Hex } from './io.ts';
const SEASON_DIR = join(REPO_ROOT, 'apps/web/static/data/season');
function writeTempManifest(dir: string): {
  manifestPath: string;
  leaguePath: string;
  schedulePath: string;
} {
  const seasonDir = join(dir, 'season');
  mkdirSync(seasonDir, { recursive: true });
  const leaguePath = join(seasonDir, 'league.json');
  const schedulePath = join(seasonDir, 'schedule.json');
  copyFileSync(join(SEASON_DIR, 'league.json'), leaguePath);
  copyFileSync(join(SEASON_DIR, 'schedule.json'), schedulePath);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 4,
        dataVersion: 'test',
        season: {
          league: { url: 'season/league.json', contentHash: sha256Hex(readFileSync(leaguePath)) },
          schedule: {
            url: 'season/schedule.json',
            contentHash: sha256Hex(readFileSync(schedulePath)),
          },
          draftCatalog: {
            url: 'season/draft-catalog.json',
            contentHash: 'f'.repeat(64),
          },
        },
      },
      null,
      2,
    ),
  );
  return { manifestPath, leaguePath, schedulePath };
}
describe('season-data manifest resolution', () => {
  it('resolves declared artifacts relative to the manifest file that was passed', async () => {
    await withTmpDir((dir) => {
      const { manifestPath, leaguePath, schedulePath } = writeTempManifest(dir);
      expect(resolveSeasonArtifact(manifestPath, 'schedule').path).toBe(schedulePath);
      expect(loadSeasonLeague(manifestPath).teams).toHaveLength(30);
      const schedule = loadSeasonSchedule(manifestPath);
      expect(schedule.games).toHaveLength(1230);
      expect(resolveSeasonArtifact(manifestPath, 'league').path).toBe(leaguePath);
    });
  });
  it('fails closed when a declared entry or its contentHash is missing', async () => {
    await withTmpDir((dir) => {
      const manifestPath = join(dir, 'manifest.json');
      writeFileSync(
        manifestPath,
        JSON.stringify({ season: { draftCatalog: { url: 'season/draft-catalog.json' } } }),
      );
      expect(() => resolveSeasonArtifact(manifestPath, 'draftCatalog')).toThrow(/no contentHash/);
      expect(() => loadSeasonDraftCatalog(manifestPath)).toThrow(/no contentHash/);
      writeFileSync(manifestPath, JSON.stringify({ season: {} }));
      expect(() => loadSeasonLeague(manifestPath)).toThrow(/no season.league entry/);
      expect(() => loadSeasonRosterTargets(manifestPath)).toThrow(/no season.rosterTargets entry/);
    });
  });
  it('rejects artifacts whose bytes do not match the declared hash', async () => {
    await withTmpDir((dir) => {
      const { manifestPath, schedulePath } = writeTempManifest(dir);
      writeFileSync(schedulePath, `${readFileSync(schedulePath, 'utf8')} `);
      expect(() => loadSeasonSchedule(manifestPath)).toThrow(/schedule content hash mismatch/);
    });
  });
});
describe('season schedule manifest verification', () => {
  it('audits the declared URL and hash instead of a hardcoded path', async () => {
    await withTmpDir((dir) => {
      const { manifestPath } = writeTempManifest(dir);
      const report = seasonScheduleAudit({
        schedule: null,
        league: null,
        manifest: manifestPath,
        verbose: false,
      });
      const payload = report.payload as SeasonScheduleAuditReport;
      expect(report.exitCode).toBe(0);
      expect(payload.pass).toBe(true);
      expect(payload.manifestVerified).toBe(true);
      expect(payload.regenerationIdentical).toBe(true);
    });
  });
  it('fails the audit when the declared schedule bytes drift', async () => {
    await withTmpDir((dir) => {
      const { manifestPath, schedulePath } = writeTempManifest(dir);
      const schedule = JSON.parse(readFileSync(schedulePath, 'utf8')) as {
        games: Array<{ round: number }>;
      };
      schedule.games[0] = { ...schedule.games[0], round: 2 };
      writeFileSync(schedulePath, JSON.stringify(schedule));
      const report = seasonScheduleAudit({
        schedule: null,
        league: null,
        manifest: manifestPath,
        verbose: false,
      });
      const payload = report.payload as SeasonScheduleAuditReport;
      expect(report.exitCode).toBe(1);
      expect(payload.pass).toBe(false);
      expect(payload.manifestVerified).toBe(false);
      expect(report.failures.join('\n')).toMatch(/content hash mismatch/);
    });
  });
  it('publishes the declared hash when generating over the declared artifact', async () => {
    await withTmpDir((dir) => {
      const { manifestPath, schedulePath } = writeTempManifest(dir);
      const report = seasonScheduleGenerate({
        out: schedulePath,
        league: null,
        seed: null,
        manifest: manifestPath,
      });
      const payload = report.payload as SeasonScheduleGenerateReport;
      expect(report.exitCode).toBe(0);
      expect(payload.wrote).toBe(true);
      expect(payload.published).toBe(true);
      const updated = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        season: { schedule: { contentHash: string } };
      };
      expect(updated.season.schedule.contentHash).toBe(payload.sha256);
      expect(sha256Hex(readFileSync(schedulePath))).toBe(payload.sha256);
    });
  });
});
