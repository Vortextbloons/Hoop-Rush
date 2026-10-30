import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import assert from 'node:assert';
import { describe, expect, it } from 'bun:test';

describe('worker bundling', () => {
  it('compiles workers used through runner helpers into JavaScript assets', async () => {
    const result = await build({
      configFile: false,
      root: fileURLToPath(new URL('../../../', import.meta.url)),
      logLevel: 'silent',
      build: {
        write: false,
        rollupOptions: {
          preserveEntrySignatures: 'strict',
          input: [
            'src/lib/features/havoc-multiplayer/havoc-multiplayer-runner.ts',
            'src/lib/features/draft-duel/draft-duel-runner.ts',
            'src/lib/features/cap-rush/cap-rush-runner.ts',
            'src/lib/features/havoc/havoc-runner.ts',
          ],
        },
      },
    });
    const output = (Array.isArray(result) ? result : [result]).flatMap((item) => {
      assert('output' in item);
      return 'output' in item ? item.output : [];
    });

    for (const item of output) {
      expect(item.fileName).not.toMatch(/\.ts$/);
      if (item.type === 'chunk') expect(item.code).not.toContain('data:video/mp2t');
    }
    for (const worker of [
      'havoc-multiplayer-worker',
      'draft-duel-game-worker',
      'cap-rush-worker',
      'havoc-worker',
    ]) {
      expect(
        output.some(
          (item) => item.fileName.includes(`${worker}-`) && item.fileName.endsWith('.js'),
        ),
      ).toBe(true);
    }
  });
});
