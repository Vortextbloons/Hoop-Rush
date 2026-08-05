import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { replayReportSchema, simGameReportSchema } from './report-schemas.ts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';

describe('cli: replay', () => {
  it('reproduces a saved input/expected pair byte-for-byte', async () => {
    await withTmpDir(async (tmp) => {
      const inputPath = join(tmp, 'replay-input.json');
      const expectedPath = join(tmp, 'replay-expected.json');
      const { code, stdout } = await runCli([
        'sim',
        'game',
        '--input',
        'equal',
        '--seed',
        '12341234123412341234123412341234',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = simGameReportSchema.parse(jsonPayload(stdout));
      const { result } = payload;

      // Build the serialized GameSimulationInput from the fixture + seed.
      const fixture = JSON.parse(
        readFileSync(join(REPO_ROOT, 'tools/cli/src/fixtures/equal.json'), 'utf8'),
      ) as { home: unknown; away: unknown };
      const profilePath = join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json');
      const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as { dataVersion: string };
      writeFileSync(
        inputPath,
        JSON.stringify({
          schemaVersion: 2,
          gameNumber: 1,
          seed: '12341234123412341234123412341234',
          dataVersion: profile.dataVersion,
          profile,
          home: fixture.home,
          away: fixture.away,
        }),
      );
      writeFileSync(expectedPath, JSON.stringify(result));

      const replay = await runCli([
        'replay',
        '--input',
        inputPath,
        '--expected',
        expectedPath,
        '--format',
        'json',
      ]);
      expect(replay.code).toBe(0);
      const replayPayload = replayReportSchema.parse(jsonPayload(replay.stdout));
      expect(replayPayload.identical).toBe(true);
      expect(replayPayload.firstDifference).toBeNull();
      expect(replayPayload.seed).toBe('12341234123412341234123412341234');
    });
  });

  it('reports the first structured difference and exits 1 on mismatch', async () => {
    await withTmpDir(async (tmp) => {
      const inputPath = join(tmp, 'replay-diff-input.json');
      const expectedPath = join(tmp, 'replay-diff-expected.json');
      const fixture = JSON.parse(
        readFileSync(join(REPO_ROOT, 'tools/cli/src/fixtures/equal.json'), 'utf8'),
      ) as { home: unknown; away: unknown };
      const profile = JSON.parse(
        readFileSync(join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json'), 'utf8'),
      ) as { dataVersion: string };
      // The input uses seed A; the expected result comes from a DIFFERENT seed,
      // so the replay must diverge while staying schema-valid.
      const other = await runCli([
        'sim',
        'game',
        '--input',
        'equal',
        '--seed',
        'fedcfedcfedcfedcfedcfedcfedcfedc',
        '--format',
        'json',
      ]);
      expect(other.code).toBe(0);
      const otherPayload = simGameReportSchema.parse(jsonPayload(other.stdout));
      writeFileSync(
        inputPath,
        JSON.stringify({
          schemaVersion: 2,
          gameNumber: 1,
          seed: '01230123012301230123012301230123',
          dataVersion: profile.dataVersion,
          profile,
          home: fixture.home,
          away: fixture.away,
        }),
      );
      writeFileSync(expectedPath, JSON.stringify(otherPayload.result));

      const replay = await runCli([
        'replay',
        '--input',
        inputPath,
        '--expected',
        expectedPath,
        '--format',
        'json',
      ]);
      expect(replay.code).toBe(1);
      const replayPayload = replayReportSchema.parse(jsonPayload(replay.stdout, replay.stderr));
      expect(replayPayload.identical).toBe(false);
      expect(replayPayload.firstDifference).not.toBeNull();
    });
  });
});
