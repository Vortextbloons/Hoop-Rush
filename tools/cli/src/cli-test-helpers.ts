import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from 'vitest';

/**
 * Shared harness for CLI integration tests (spec/09, spec/06): the real
 * command surface invoked through Node's native type stripping, verifying
 * argument handling, exit codes, payload schemas, worker-count independence,
 * and replay determinism.
 *
 * Each test file imports this helper, so every file gets its own scratch
 * directory; vitest runs files in parallel, which is what keeps the
 * subprocess-per-test suite fast.
 */

const execFileAsync = promisify(execFile);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_ENTRY = join(REPO_ROOT, 'tools/cli/src/index.ts');
export const TMP = mkdtempSync(join(tmpdir(), 'hoop-rush-cli-test-'));

export async function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      timeout: 300_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

export function jsonPayload(stdout: string, stderr = ''): unknown {
  const source = stdout.indexOf('{') >= 0 ? stdout : stderr;
  const start = source.indexOf('{');
  const parsed = JSON.parse(source.slice(start)) as { payload?: unknown };
  return parsed.payload;
}

/**
 * Creates a scratch dir, runs fn, and removes the dir in a finally block.
 * The fn result is awaited before cleanup so the dir outlives any async
 * work (subprocess boots) the callback starts.
 */
export async function withTmpDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'hoop-rush-cli-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs a `data` command against a bogus manifest and asserts the shared
 * exit-2 clean-report contract (spec/09): exit 2, no stack trace, a report
 * with exitCode 2 whose first failure mentions the manifest.
 */
export async function expectExit2CleanManifestReport(
  commandArgs: string[],
  dataDir: string,
): Promise<void> {
  mkdirSync(dataDir, { recursive: true });
  const manifestPath = join(dataDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 3, dataVersion: '' }));
  const { code, stderr } = await runCli([
    ...commandArgs,
    '--input',
    manifestPath,
    '--format',
    'json',
  ]);
  expect(code).toBe(2);
  expect(stderr).not.toMatch(/^\s+at /m);
  const report = JSON.parse(stderr.slice(stderr.indexOf('{'))) as {
    exitCode: number;
    failures: string[];
  };
  expect(report.exitCode).toBe(2);
  expect(report.failures[0]).toContain('manifest');
}

/** Writes the 9-field bracket manifest for `bracket audit` fixtures. */
export function writeManifestWithBracket(
  dir: string,
  bracketPath: string,
  bracketContent: string,
): string {
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      dataVersion: 'm1.5',
      franchiseLineage: [],
      eras: [],
      pools: [],
      eraSimulationProfiles: [],
      bracket: {
        url: bracketPath,
        contentHash: createHash('sha256').update(bracketContent).digest('hex'),
      },
      assets: {
        headshotUrlTemplate: null,
        headshotUrlTemplateSecondary: null,
        logoUrlTemplate: null,
        logoUrlTemplateSecondary: null,
        source: 'example',
        cacheVersion: 'v1',
      },
    }),
  );
  return manifestPath;
}
