import { expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJson, writeJsonRetry } from './json.ts';

it('replaces longer JSON files without retaining stale trailing bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hoop-json-'));
  try {
    for (const write of [writeJson, writeJsonRetry]) {
      const path = join(directory, 'artifact.json');
      write(path, { payload: 'x'.repeat(10000) });
      write(path, { payload: 'short' });
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ payload: 'short' });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
