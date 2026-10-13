import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_ENTRY = join(REPO_ROOT, 'tools/cli/src/index.ts');
export async function runCli(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: REPO_ROOT,
      timeout: 300000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
export function jsonPayload(stdout: string, stderr = ''): unknown {
  const source = stdout.indexOf('{') >= 0 ? stdout : stderr;
  const start = source.indexOf('{');
  const parsed = JSON.parse(source.slice(start)) as {
    payload?: unknown;
  };
  return parsed.payload;
}
export async function withTmpDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'hoop-rush-cli-test-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
