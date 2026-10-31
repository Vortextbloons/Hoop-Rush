import { expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256File } from '../json.ts';
import { run } from './index.ts';

it('registers Cap Rush assets when rebuilding the manifest', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hoop-manifest-'));
  try {
    writeFileSync(
      join(dataDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 3,
        dataVersion: 'test',
        eras: [],
        assets: {
          source: 'test',
          headshotUrlTemplate: null,
          headshotUrlTemplateSecondary: null,
          logoUrlTemplate: null,
          logoUrlTemplateSecondary: null,
        },
      }),
    );
    const opponentsDir = join(dataDir, 'opponents');
    mkdirSync(opponentsDir);
    for (const filename of ['cap-rush-field.json', 'cap-rush-roster-metadata.json']) {
      writeFileSync(join(opponentsDir, filename), '{}\n');
    }
    run(dataDir);
    const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as {
      capRushBracket?: unknown;
      capRushRosterMetadata?: unknown;
    };
    expect(manifest.capRushBracket).toEqual({
      url: 'opponents/cap-rush-field.json',
      contentHash: sha256File(join(opponentsDir, 'cap-rush-field.json')),
    });
    expect(manifest.capRushRosterMetadata).toEqual({
      url: 'opponents/cap-rush-roster-metadata.json',
      contentHash: sha256File(join(opponentsDir, 'cap-rush-roster-metadata.json')),
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
