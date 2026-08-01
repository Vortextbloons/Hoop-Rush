import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  calibrateRunReportSchema,
  calibrateSensitivityReportSchema,
  replayReportSchema,
  simBatchReportSchema,
  simGameReportSchema,
} from './report-schemas.js';

/**
 * CLI integration tests (spec/09, spec/06): the real command surface invoked
 * through tsx, verifying argument handling, exit codes, payload schemas,
 * worker-count independence, and replay determinism.
 */

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_ENTRY = join(REPO_ROOT, 'tools/cli/src/index.ts');
const TMP = mkdtempSync(join(tmpdir(), 'hoop-rush-cli-test-'));

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [join(REPO_ROOT, 'tools/cli/node_modules/tsx/dist/cli.mjs'), CLI_ENTRY, ...args],
      { cwd: REPO_ROOT, timeout: 300_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function jsonPayload(stdout: string, stderr = ''): unknown {
  const source = stdout.indexOf('{') >= 0 ? stdout : stderr;
  const start = source.indexOf('{');
  const parsed = JSON.parse(source.slice(start)) as { payload?: unknown };
  return parsed.payload;
}

describe('cli: argument validation and exit codes', () => {
  it('prints help and exits 0 with no arguments', async () => {
    const { code, stdout } = await runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('hoop-rush — developer CLI');
  });

  it('rejects an unknown command with exit 2', async () => {
    const { code, stderr } = await runCli(['frobnicate']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown command');
  });

  it('rejects unknown options with exit 2', async () => {
    const { code, stderr } = await runCli(['sim', 'game', '--input', 'equal', '--nope', '1']);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown option');
  });

  it('requires a seed for sim game with exit 2', async () => {
    const { code, stderr } = await runCli(['sim', 'game', '--input', 'equal']);
    expect(code).toBe(2);
    expect(stderr).toContain('--seed');
  });

  it('rejects a non-hex seed with exit 2', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'game',
      '--input',
      'equal',
      '--seed',
      'not-hex!',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('hex');
  });

  it('rejects an unknown fixture with exit 2', async () => {
    const { code, stderr } = await runCli([
      'sim',
      'game',
      '--input',
      'does-not-exist',
      '--seed',
      'a'.repeat(32),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('fixture not found');
  });

  it('rejects a missing replay input with exit 2', async () => {
    const { code, stderr } = await runCli([
      'replay',
      '--input',
      join(TMP, 'missing.json'),
      '--expected',
      join(TMP, 'missing2.json'),
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('file not found');
  });
});

describe('cli: sim game', () => {
  it('runs a game and emits a validated payload with versions and invariants', async () => {
    const { code, stdout } = await runCli([
      'sim',
      'game',
      '--input',
      'equal',
      '--seed',
      '45ca740e45ca740e45ca740e45ca740e',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = simGameReportSchema.parse(jsonPayload(stdout));
    expect(payload.invariants).toEqual([]);
    expect(payload.engineVersion).toMatch(/^m2-engine/);
    expect(payload.profileVersion).toMatch(/^m2-1990s/);
    expect(payload.fixture).toBe('equal');
    expect(payload.result).toBeDefined();
    expect(payload.timingMs).toBeGreaterThan(0);
  });

  it('is reproducible: the same seed and fixture produce the same score', async () => {
    const run = async () => {
      const { code, stdout } = await runCli([
        'sim',
        'game',
        '--input',
        'strong-weak',
        '--seed',
        'abcdefabcdefabcdefabcdefabcdef',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      const payload = simGameReportSchema.parse(jsonPayload(stdout));
      const result = payload.result as {
        home: { box: { points: number } };
        away: { box: { points: number } };
      };
      return `${String(result.home.box.points)}-${String(result.away.box.points)}`;
    };
    expect(await run()).toBe(await run());
  });
});

describe('cli: sim batch worker independence', () => {
  it('produces identical aggregates with 1 and 4 workers', async () => {
    const runWith = async (workers: string) => {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        '0',
        '--seed-to',
        '99',
        '--workers',
        workers,
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return simBatchReportSchema.parse(jsonPayload(stdout));
    };
    const single = await runWith('1');
    const many = await runWith('4');
    expect(many.games).toBe(100);
    expect(single.homeWins).toBe(many.homeWins);
    expect(single.awayWins).toBe(many.awayWins);
    expect(single.invariantFailures).toBe(0);
    expect(single.homeWinRate).toBe(many.homeWinRate);
    expect(single.averagePoints).toBe(many.averagePoints);
  });

  it('seed assignment depends only on the requested range', async () => {
    const full = await (async () => {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        '0',
        '--seed-to',
        '49',
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      return simBatchReportSchema.parse(jsonPayload(stdout));
    })();
    const halves = [];
    for (const [from, to] of [
      [0, 24],
      [25, 49],
    ] as const) {
      const { code, stdout } = await runCli([
        'sim',
        'batch',
        '--fixture',
        'equal',
        '--seed-from',
        String(from),
        '--seed-to',
        String(to),
        '--format',
        'json',
      ]);
      expect(code).toBe(0);
      halves.push(simBatchReportSchema.parse(jsonPayload(stdout)));
    }
    const firstHalf = halves[0];
    const secondHalf = halves[1];
    if (!firstHalf || !secondHalf) throw new Error('batch halves missing');
    expect(firstHalf.homeWins + secondHalf.homeWins).toBe(full.homeWins);
    expect(firstHalf.awayWins + secondHalf.awayWins).toBe(full.awayWins);
  });
});

describe('cli: replay', () => {
  it('reproduces a saved input/expected pair byte-for-byte', async () => {
    const inputPath = join(TMP, 'replay-input.json');
    const expectedPath = join(TMP, 'replay-expected.json');
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
    const report = JSON.parse(stdout.slice(stdout.indexOf('{'))) as { input: { seed?: string } };
    const input = report.input;

    // Build the serialized GameSimulationInput from the fixture + seed.
    const fixture = JSON.parse(
      readFileSync(join(REPO_ROOT, 'tools/cli/src/fixtures/equal.json'), 'utf8'),
    ) as { home: unknown; away: unknown };
    const profilePath = join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json');
    const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as { dataVersion: string };
    writeFileSync(
      inputPath,
      JSON.stringify({
        schemaVersion: 1,
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
    void input;
  });

  it('reports the first structured difference and exits 1 on mismatch', async () => {
    const inputPath = join(TMP, 'replay-diff-input.json');
    const expectedPath = join(TMP, 'replay-diff-expected.json');
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
        schemaVersion: 1,
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

describe('cli: calibrate commands', () => {
  it('calibrate run passes the frozen profile and emits a validated payload', async () => {
    const { code, stdout } = await runCli([
      'calibrate',
      'run',
      '--samples',
      '1200',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = calibrateRunReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.metrics.length).toBeGreaterThan(20);
    expect(payload.profileVersion).toMatch(/^m2-1990s/);
    for (const metric of payload.metrics) {
      expect(metric.observed).toBeGreaterThanOrEqual(metric.target - metric.tolerance - 0.02);
      expect(metric.observed).toBeLessThanOrEqual(metric.target + metric.tolerance + 0.02);
    }
  });

  it('calibrate run exits 1 when a gate fails', async () => {
    // A tolerance of zero on one metric cannot be satisfied by a seeded batch.
    const badProfile = JSON.parse(
      readFileSync(join(REPO_ROOT, 'apps/web/static/data/era-sim/1990s.json'), 'utf8'),
    ) as { targets: Record<string, { tolerance: number }> };
    const pointsTarget = badProfile.targets.pointsPerGame;
    if (!pointsTarget) throw new Error('profile lacks pointsPerGame target');
    pointsTarget.tolerance = 0;
    const badPath = join(TMP, 'bad-profile.json');
    writeFileSync(badPath, JSON.stringify(badProfile));
    const { code } = await runCli(['calibrate', 'run', '--samples', '600', '--profile', badPath]);
    expect(code).toBe(1);
  });

  it('calibrate run rejects an invalid profile with exit 2', async () => {
    const badPath = join(TMP, 'invalid-profile.json');
    writeFileSync(badPath, JSON.stringify({ not: 'a profile' }));
    const { code, stderr } = await runCli(['calibrate', 'run', '--profile', badPath]);
    expect(code).toBe(2);
    expect(stderr).toContain('profile');
  });

  it('calibrate sensitivity passes every family', async () => {
    const { code, stdout } = await runCli([
      'calibrate',
      'sensitivity',
      '--samples',
      '150',
      '--format',
      'json',
    ]);
    expect(code).toBe(0);
    const payload = calibrateSensitivityReportSchema.parse(jsonPayload(stdout));
    expect(payload.pass).toBe(true);
    expect(payload.metrics.length).toBe(9);
  });
});
