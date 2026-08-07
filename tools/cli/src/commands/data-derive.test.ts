import { describe, expect, it } from 'vitest';
import { EXIT_USAGE_OR_DATA_ERROR } from '../report.ts';
import { dataDerive } from './data-derive.ts';

/**
 * `data derive` tests (spec/09): the argument/lineage/source validation
 * boundaries of the derivation trace command. Full derivation traces read
 * the packaged raw snapshot and are exercised by the pipeline itself.
 */

describe('dataDerive', () => {
  it('requires --player, --season, and --franchise', () => {
    const report = dataDerive({ player: '101', season: '1996-97' });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
    expect(report.failures[0]).toContain('all required');
  });

  it('reports an unknown franchise/season lineage', () => {
    const report = dataDerive({ player: '101', season: '1996-97', franchise: 'atlantis' });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
    expect(report.failures[0]).toContain('no NBA lineage');
  });

  it('reports unreadable cached source data for a lineage-valid season without a snapshot', () => {
    // 'lakers' has lineage from 1948-49 (Minneapolis), but the packaged raw
    // snapshot only covers modern seasons, so the source read must fail
    // cleanly with a usage/data error instead of a stack.
    const report = dataDerive({ player: '101', season: '1959-60', franchise: 'lakers' });
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
    expect(report.failures[0]).toMatch(/cached source data unreadable|no NBA lineage/);
  });
});
