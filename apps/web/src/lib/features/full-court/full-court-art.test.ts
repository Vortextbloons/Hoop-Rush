import { describe, expect, test } from 'bun:test';
import { playerVersionId, playersIndexSchema } from '@hoop-rush/data-contracts';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { playerFaceIndex } from '#lib/assets/player-face-lookup.js';
import { fullCourtArtOf } from './full-court-art';

function entry(overrides: Record<string, unknown>) {
  return {
    firstName: 'Test',
    lastName: 'Player',
    altIds: null,
    positionsPlayable: ['PG'],
    overall: 80,
    offense: 80,
    defense: 80,
    selectionScore: 1,
    ...overrides,
  };
}

const playersIndex = playersIndexSchema.parse({
  schemaVersion: 4,
  dataVersion: 'data-v1',
  players: [
    entry({
      playerId: 'p1',
      franchiseId: 'lakers',
      eraId: '1990s',
      seasonKey: '1990-91',
      displayName: 'First Version',
      playerExternalId: '123456',
    }),
    entry({
      playerId: 'p1',
      franchiseId: 'celtics',
      eraId: '2000s',
      seasonKey: '2001-02',
      displayName: 'Second Version',
      playerExternalId: '654321',
    }),
  ],
});

const art = fullCourtArtOf(buildManifest(), playerFaceIndex(playersIndex));
const firstVersion = playerVersionId('p1', 'lakers', '1990s', '1990-91');
const secondVersion = playerVersionId('p1', 'celtics', '2000s', '2001-02');

describe('fullCourtArtOf', () => {
  test('resolves the exact player version before the person', () => {
    expect(
      art.faceFor({
        playerId: 'p1',
        playerVersionId: secondVersion,
        displayName: 'Player One',
      })?.playerExternalId,
    ).toBe('654321');
    expect(
      art.faceFor({ playerId: 'p1', playerVersionId: firstVersion, displayName: 'Player One' })
        ?.playerExternalId,
    ).toBe('123456');
  });

  test('falls back to the first indexed person when the version is absent or unknown', () => {
    expect(art.faceFor({ playerId: 'p1', displayName: 'Player One' })?.playerExternalId).toBe(
      '123456',
    );
    expect(
      art.faceFor({ playerId: 'p1', playerVersionId: 'pv-unknown', displayName: 'Player One' })
        ?.playerExternalId,
    ).toBe('123456');
  });

  test('resolves version-only reports and leaves unknown players without a face', () => {
    expect(
      art.faceFor({ playerVersionId: secondVersion, displayName: 'Player One' })?.playerExternalId,
    ).toBe('654321');
    expect(art.faceFor({ playerVersionId: 'pv-unknown', displayName: 'Player One' })).toBeNull();
    expect(art.faceFor({ playerId: 'missing', displayName: 'Missing' })).toBeNull();
  });
});
