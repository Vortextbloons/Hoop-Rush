import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
import { importManifest, importOpponent, importPools, importRunAll } from './import.ts';
import { DEFAULT_MANIFEST } from './season-data.ts';
describe('pool target parsing (shared by importPools and importRunAll)', () => {
  it.each([
    ['importPools', importPools],
    ['importRunAll', importRunAll],
  ] as const)(
    '%s rejects a malformed pool target with a usage report (not a stack)',
    async (_name, command) => {
      const report = await command({ pools: 'lakers' });
      expect(report.ok).toBe(false);
      expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
      expect(report.failures[0]).toContain("invalid pool target 'lakers'");
    },
  );
});
describe('importPools', () => {
  it('rejects a target without an era id', async () => {
    const report = await importPools({ pools: 'lakers/' });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
describe('importRunAll', () => {
  it('rejects an empty pool target list', async () => {
    const report = await importRunAll({ pools: 'lakers/,celtics/1980s' });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });
});
describe('importManifest / importOpponent', () => {
  let committedManifest: Buffer;
  beforeAll(() => {
    committedManifest = readFileSync(DEFAULT_MANIFEST);
  });
  afterAll(() => {
    writeFileSync(DEFAULT_MANIFEST, committedManifest);
  });
  it('importManifest reports success with a valid packaged manifest', () => {
    const report = importManifest();
    expect(report.command).toBe('import manifest');
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);
  });
  it('importOpponent reports success with the packaged opponent artifact', () => {
    const report = importOpponent();
    expect(report.command).toBe('import opponent');
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);
  });
});
