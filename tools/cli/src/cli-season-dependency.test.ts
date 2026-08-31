import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './cli-test-helpers.ts';
const SEASON_DIR = join(REPO_ROOT, 'packages/engine/src/season');
const FORBIDDEN_SPECIFIER_FRAGMENTS = [
  'svelte',
  'dexie',
  'worker',
  'node:',
  'supabase',
  'indexeddb',
  'localstorage',
  'fetch',
  'browser',
];
describe('season domain dependency boundaries', () => {
  it('keeps Season Run domain modules free of UI, persistence, worker, and network imports', () => {
    const implementationFiles = readdirSync(SEASON_DIR).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
    );
    expect(implementationFiles.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of implementationFiles) {
      const source = readFileSync(join(SEASON_DIR, file), 'utf8');
      for (const line of source.split('\n')) {
        const match = line.match(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/);
        if (match === null) continue;
        const specifier = match[1] ?? '';
        if (specifier === '') continue;
        const lower = specifier.toLowerCase();
        for (const fragment of FORBIDDEN_SPECIFIER_FRAGMENTS) {
          if (lower.includes(fragment)) {
            offenders.push(`${file}: ${specifier} (matches "${fragment}")`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
