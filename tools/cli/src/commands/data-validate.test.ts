import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildManifest, buildPlayerSeason, buildPool } from '@hoop-rush/test-fixtures';
import { dataValidate } from './data-validate.js';
import { EXIT_CHECKS_FAILED, EXIT_OK, EXIT_USAGE_OR_DATA_ERROR } from '../report.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hoop-rush-cli-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeManifest(manifest: unknown): Promise<string> {
  const path = join(dir, 'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  return path;
}

describe('dataValidate', () => {
  it('passes a valid manifest with no pools', async () => {
    const path = await writeManifest(buildManifest());
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(true);
    expect(report.exitCode).toBe(EXIT_OK);
    expect(report.failures).toEqual([]);
  });

  it('reports missing manifest as a usage/data error', async () => {
    const report = await dataValidate(join(dir, 'missing.json'), false);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
  });

  it('reports invalid JSON as a usage/data error', async () => {
    const path = join(dir, 'manifest.json');
    await writeFile(path, 'not json');
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.exitCode).toBe(EXIT_USAGE_OR_DATA_ERROR);
    expect(report.failures[0]).toMatch(/not valid JSON/);
  });

  it('lists schema issues with exact paths', async () => {
    const manifest = buildManifest({ dataVersion: '' });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('dataVersion'))).toBe(true);
  });

  it('flags duplicate franchise ids and overlapping eras', async () => {
    const manifest = buildManifest({
      franchiseLineage: [
        {
          franchiseId: 'lakers',
          displayName: 'Los Angeles Lakers',
          teamExternalId: '1610612747',
          names: [{ name: 'Los Angeles Lakers', fromSeasonKey: '1960-61', toSeasonKey: null }],
        },
        {
          franchiseId: 'lakers',
          displayName: 'Los Angeles Lakers',
          teamExternalId: '1610612747',
          names: [{ name: 'Los Angeles Lakers', fromSeasonKey: '1960-61', toSeasonKey: null }],
        },
      ],
      eras: [
        { eraId: '1960s', label: '1960s', fromSeasonKey: '1960-61', toSeasonKey: '1969-70' },
        { eraId: '1970s', label: '1970s', fromSeasonKey: '1970-71', toSeasonKey: '1979-80' },
        { eraId: '1970s-dup', label: 'dup', fromSeasonKey: '1975-76', toSeasonKey: '1984-85' },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('duplicate franchiseId'))).toBe(true);
    expect(report.failures.some((f) => f.includes('ranges overlap'))).toBe(true);
  });

  it('verifies pool content hashes against the referenced assets', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const asset = JSON.stringify({ hello: 'world' });
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');

    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
        {
          franchiseId: 'lakers',
          eraId: '2000s',
          url: 'pools/missing.json',
          contentHash: 'a'.repeat(64),
        },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, true);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('asset missing'))).toBe(true);
    expect(report.details.some((d) => d.includes('hash verified'))).toBe(true);
    expect(report.exitCode).toBe(EXIT_CHECKS_FAILED);
  });

  it('requires nbaHeadshotAvailable on every player when a primary template exists', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const pool = buildPool([buildPlayerSeason({ altIds: { bbref: 'player01' } })]);
    const asset = JSON.stringify(pool);
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');

    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.ok).toBe(false);
    expect(report.failures.some((f) => f.includes('lack nbaHeadshotAvailable'))).toBe(true);
  });

  it('accepts pools whose players carry the CDN availability marker', async () => {
    const poolDir = join(dir, 'pools');
    await mkdir(poolDir);
    const assetPath = join(poolDir, 'lakers-1990s.json');
    const pool = buildPool([
      buildPlayerSeason({ altIds: { bbref: 'player01', nbaHeadshotAvailable: false } }),
    ]);
    const asset = JSON.stringify(pool);
    await writeFile(assetPath, asset);
    const contentHash = createHash('sha256').update(asset).digest('hex');

    const manifest = buildManifest({
      pools: [
        { franchiseId: 'lakers', eraId: '1990s', url: 'pools/lakers-1990s.json', contentHash },
      ],
    });
    const path = await writeManifest(manifest);
    const report = await dataValidate(path, false);
    expect(report.failures.some((f) => f.includes('nbaHeadshotAvailable'))).toBe(false);
  });
});
