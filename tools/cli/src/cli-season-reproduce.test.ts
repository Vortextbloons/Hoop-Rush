import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSeasonRunReplayExport,
  seasonCommandLogDigest,
  seasonRunReplayExportSchema,
  type SeasonAlmanac,
  type SeasonCommandLogEntry,
} from '@hoop-rush/data-contracts';
import { jsonPayload, runCli, withTmpDir } from './cli-test-helpers.ts';
import { seasonRunReproduceReportSchema } from './report-schemas.ts';
import { replaySeasonRunExport } from './commands/season-reproduce.ts';
import { buildReplayedRun, chainLog, replayDeps } from './season-reproduce-test-support.ts';

/**
 * M2.6 `season run reproduce` tests (replay-export-v1, full-run): the
 * authoritative replay over a real command sequence (trade window, accept,
 * objective selection, decline) driven through the engine, first-divergence
 * reporting (corrupted logs fail at the exact ordinal with expected-vs-actual
 * facts), chain-fact and schema rejection, and the CLI end-to-end path.
 */

describe('season run reproduce (replay-export-v1)', () => {
  it('reproduces a real command sequence with no divergence', () => {
    const { exportArtifact } = buildReplayedRun();
    const { divergence, divergences } = replaySeasonRunExport(exportArtifact, replayDeps());
    expect(divergence).toBeNull();
    expect(divergences).toEqual([]);
    expect(() => seasonRunReplayExportSchema.parse(exportArtifact)).not.toThrow();
  });

  it('fails at the exact ordinal when a command post-state digest diverges', () => {
    const { exportInput } = buildReplayedRun();
    const log = exportInput.commandLog;
    const mutatedEntries = log.entries.map((entry, index) =>
      index === log.entries.length - 1 ? { ...entry, postStateDigest: 'f'.repeat(32) } : entry,
    );
    const mutatedLog = chainLog(mutatedEntries);
    const mutated = buildSeasonRunReplayExport({
      ...exportInput,
      commandLog: mutatedLog,
      almanac: {
        ...exportInput.almanac,
        commandLogDigest: seasonCommandLogDigest(mutatedLog.entries),
      },
    });
    const { divergence } = replaySeasonRunExport(mutated, replayDeps());
    expect(divergence).not.toBeNull();
    expect(divergence?.ordinal).toBe(mutatedEntries.length - 1);
    expect(divergence?.kind).toBe('state-digest');
    expect(divergence?.detail).toContain('expected');
    expect(divergence?.commandId).toBe(
      mutatedEntries[mutatedEntries.length - 1]?.command.commandId,
    );
  });

  it('rejects an ordinal gap as a chain-fact divergence', () => {
    const { exportInput } = buildReplayedRun();
    const entries = exportInput.commandLog.entries;
    const gapped = [entries[0], entries[2]].filter(
      (entry): entry is SeasonCommandLogEntry => entry !== undefined,
    );
    const gappedLog = chainLog(gapped);
    const exportArtifact = buildSeasonRunReplayExport({
      ...exportInput,
      commandLog: gappedLog,
      almanac: {
        ...exportInput.almanac,
        commandLogDigest: seasonCommandLogDigest(gappedLog.entries),
      },
    });
    const { divergence } = replaySeasonRunExport(exportArtifact, replayDeps());
    expect(divergence).not.toBeNull();
    expect(divergence?.kind).toBe('chain-fact');
    expect(divergence?.detail).toContain('ordinal gap');
  });

  it('reports asset-hash mismatches before replaying', () => {
    const { exportInput } = buildReplayedRun();
    const exportArtifact = buildSeasonRunReplayExport({
      ...exportInput,
      assetHashes: { ...exportInput.assetHashes, draftCatalog: 'f'.repeat(64) },
    });
    const { divergence } = replaySeasonRunExport(exportArtifact, {
      ...replayDeps(),
      verifyAssetHashes: () => ['draftCatalog content hash mismatch'],
    });
    expect(divergence).not.toBeNull();
    expect(divergence?.kind).toBe('chain-fact');
    expect(divergence?.detail).toContain('draftCatalog');
  });

  it('reproduces through the CLI end-to-end and fails precisely on a corrupted log', async () => {
    await withTmpDir(async (dir) => {
      const { exportInput } = buildReplayedRun();
      const exportPath = join(dir, 'replay-export.json');
      writeFileSync(
        exportPath,
        `${JSON.stringify(buildSeasonRunReplayExport(exportInput), null, 2)}\n`,
      );
      const ok = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        exportPath,
        '--format',
        'json',
      ]);
      expect(ok.code).toBe(0);
      const payload = seasonRunReproduceReportSchema.parse(jsonPayload(ok.stdout, ok.stderr));
      expect(payload.pass).toBe(true);
      expect(payload.commandCount).toBe(exportInput.commandLog.entries.length);
      expect(payload.verifiedChainFacts).toBe(true);
      expect(payload.verifiedInitialRun).toBe(true);

      // Corrupt the last entry's post-state digest and reproduce again.
      const raw = JSON.parse(readFileSync(exportPath, 'utf8')) as {
        commandLog: { entries: SeasonCommandLogEntry[] };
        almanac: SeasonAlmanac;
      };
      const last = raw.commandLog.entries.length - 1;
      raw.commandLog.entries[last] = {
        ...(raw.commandLog.entries[last] as SeasonCommandLogEntry),
        postStateDigest: 'e'.repeat(32),
      };
      const commandLog = chainLog(raw.commandLog.entries);
      raw.commandLog = commandLog;
      raw.almanac = {
        ...raw.almanac,
        commandLogDigest: seasonCommandLogDigest(commandLog.entries),
      };
      writeFileSync(exportPath, `${JSON.stringify(raw, null, 2)}\n`);
      const bad = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        exportPath,
        '--format',
        'json',
      ]);
      expect(bad.code).toBe(1);
      const badPayload = seasonRunReproduceReportSchema.parse(jsonPayload(bad.stdout, bad.stderr));
      expect(badPayload.pass).toBe(false);
      expect(badPayload.firstDivergence?.ordinal).toBe(last);
      expect(badPayload.firstDivergence?.kind).toBe('state-digest');
      expect(badPayload.firstDivergence?.detail).toContain('expected');

      // A garbage input is a clean exit-2 data error.
      const garbagePath = join(dir, 'garbage.json');
      writeFileSync(garbagePath, '{"not":"an export"}');
      const garbage = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        garbagePath,
        '--format',
        'json',
      ]);
      expect(garbage.code).toBe(2);
    });
  });

  it('reproduces a byte-identical pass on the same file twice', async () => {
    await withTmpDir(async (dir) => {
      const { exportInput } = buildReplayedRun();
      const exportPath = join(dir, 'replay-export.json');
      writeFileSync(
        exportPath,
        `${JSON.stringify(buildSeasonRunReplayExport(exportInput), null, 2)}\n`,
      );
      const first = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        exportPath,
        '--format',
        'json',
      ]);
      const second = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        exportPath,
        '--format',
        'json',
      ]);
      const firstPayload = seasonRunReproduceReportSchema.parse(
        jsonPayload(first.stdout, first.stderr),
      );
      const secondPayload = seasonRunReproduceReportSchema.parse(
        jsonPayload(second.stdout, second.stderr),
      );
      expect(secondPayload).toEqual(firstPayload);
      expect(firstPayload.pass).toBe(true);
    });
  });
});
