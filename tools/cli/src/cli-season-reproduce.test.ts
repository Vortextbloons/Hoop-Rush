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
import {
  buildFreeAgencyReplayedRun,
  buildReplayedRun,
  chainLog,
  freeAgencyReplayDeps,
  replayDeps,
} from './season-reproduce-test-support.ts';
let sharedReplayDeps: ReturnType<typeof replayDeps> | null = null;
function cachedReplayDeps(): ReturnType<typeof replayDeps> {
  if (sharedReplayDeps === null) sharedReplayDeps = replayDeps();
  return sharedReplayDeps;
}
let sharedFreeAgencyReplayDeps: ReturnType<typeof freeAgencyReplayDeps> | null = null;
function cachedFreeAgencyReplayDeps(): ReturnType<typeof freeAgencyReplayDeps> {
  if (sharedFreeAgencyReplayDeps === null) sharedFreeAgencyReplayDeps = freeAgencyReplayDeps();
  return sharedFreeAgencyReplayDeps;
}
describe('season run reproduce (replay-export-v1)', () => {
  it('reproduces a real command sequence with no divergence', () => {
    const { exportArtifact } = buildReplayedRun();
    const { divergence, divergences } = replaySeasonRunExport(exportArtifact, cachedReplayDeps());
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
    const { divergence } = replaySeasonRunExport(mutated, cachedReplayDeps());
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
    const { divergence } = replaySeasonRunExport(exportArtifact, cachedReplayDeps());
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
      ...cachedReplayDeps(),
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
      const raw = JSON.parse(readFileSync(exportPath, 'utf8')) as {
        commandLog: {
          entries: SeasonCommandLogEntry[];
        };
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
describe('season run reproduce free-agency divergence (M2.6.5)', () => {
  it('reproduces a free-agency replay export with no divergence', () => {
    const { exportArtifact } = buildFreeAgencyReplayedRun();
    const { divergence, divergences } = replaySeasonRunExport(
      exportArtifact,
      cachedFreeAgencyReplayDeps(),
    );
    expect(divergence).toBeNull();
    expect(divergences).toEqual([]);
  });
  it('reports a free-agency divergence when a recorded canonical candidate is missing', () => {
    const { exportInput } = buildFreeAgencyReplayedRun((freeAgency) => {
      const first = Object.keys(freeAgency.canonicalCandidates)[0];
      if (first !== undefined) {
        freeAgency.canonicalCandidates = Object.fromEntries(
          Object.entries(freeAgency.canonicalCandidates).filter(([key]) => key !== first),
        );
      }
    });
    const { divergence } = replaySeasonRunExport(
      buildSeasonRunReplayExport(exportInput),
      cachedFreeAgencyReplayDeps(),
    );
    expect(divergence).not.toBeNull();
    expect(divergence?.kind).toBe('free-agency');
    expect(divergence?.detail).toContain('canonical identity record');
  });
  it('reports a free-agency divergence when a recorded signing count is tampered', () => {
    const { exportInput } = buildFreeAgencyReplayedRun((freeAgency) => {
      freeAgency.signingCounts = { ...freeAgency.signingCounts, lakers: 1 };
    });
    const { divergence } = replaySeasonRunExport(
      buildSeasonRunReplayExport(exportInput),
      cachedFreeAgencyReplayDeps(),
    );
    expect(divergence).not.toBeNull();
    expect(divergence?.kind).toBe('free-agency');
  });
  it('fails the CLI command on a tampered free-agency export and passes on the clean file', async () => {
    await withTmpDir(async (dir) => {
      const clean = buildFreeAgencyReplayedRun();
      const exportPath = join(dir, 'fa-replay-export.json');
      writeFileSync(
        exportPath,
        `${JSON.stringify(buildSeasonRunReplayExport(clean.exportInput), null, 2)}\n`,
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
      const okPayload = seasonRunReproduceReportSchema.parse(jsonPayload(ok.stdout, ok.stderr));
      expect(okPayload.pass).toBe(true);
      const tampered = buildFreeAgencyReplayedRun((freeAgency) => {
        const first = Object.keys(freeAgency.canonicalCandidates)[0];
        if (first !== undefined) {
          freeAgency.canonicalCandidates = Object.fromEntries(
            Object.entries(freeAgency.canonicalCandidates).filter(([key]) => key !== first),
          );
        }
      });
      const tamperedPath = join(dir, 'fa-replay-tampered.json');
      writeFileSync(
        tamperedPath,
        `${JSON.stringify(buildSeasonRunReplayExport(tampered.exportInput), null, 2)}\n`,
      );
      const bad = await runCli([
        'season',
        'run',
        'reproduce',
        '--input',
        tamperedPath,
        '--format',
        'json',
      ]);
      expect(bad.code).toBe(1);
      const badPayload = seasonRunReproduceReportSchema.parse(jsonPayload(bad.stdout, bad.stderr));
      expect(badPayload.pass).toBe(false);
      expect(badPayload.firstDivergence?.kind).toBe('free-agency');
    });
  });
});
