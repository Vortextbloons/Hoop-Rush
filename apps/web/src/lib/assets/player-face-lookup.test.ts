import { describe, expect, test } from 'bun:test';
import { playerVersionId, playersIndexSchema } from '@hoop-rush/data-contracts';
import { playerFaceIndex, resolvePlayerFace } from './player-face-lookup';

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
      displayName: 'Player One',
      playerExternalId: '123456',
    }),
    entry({
      playerId: 'p1',
      franchiseId: 'celtics',
      eraId: '2000s',
      seasonKey: '2001-02',
      displayName: 'Player One',
      playerExternalId: '654321',
    }),
  ],
});

const index = playerFaceIndex(playersIndex);
const firstVersion = playerVersionId('p1', 'lakers', '1990s', '1990-91');
const secondVersion = playerVersionId('p1', 'celtics', '2000s', '2001-02');

describe('resolvePlayerFace', () => {
  test('resolves exact playerVersionId before person or franchise/season', () => {
    expect(
      resolvePlayerFace(index, {
        playerId: 'p1',
        playerVersionId: secondVersion,
        franchiseId: 'lakers',
        seasonKey: '1990-91',
        displayName: 'Player One',
      })?.playerExternalId,
    ).toBe('654321');
    expect(
      resolvePlayerFace(index, {
        playerId: 'p1',
        playerVersionId: firstVersion,
        displayName: 'Player One',
      })?.playerExternalId,
    ).toBe('123456');
  });

  test('falls back to franchise/season, then playerId, then optional displayName', () => {
    expect(
      resolvePlayerFace(index, {
        playerId: 'p1',
        franchiseId: 'celtics',
        seasonKey: '2001-02',
        displayName: 'Player One',
      })?.playerExternalId,
    ).toBe('654321');
    expect(
      resolvePlayerFace(index, {
        playerId: 'p1',
        playerVersionId: 'pv-unknown',
        displayName: 'Player One',
      })?.playerExternalId,
    ).toBe('123456');
    expect(
      resolvePlayerFace(index, { displayName: 'Player One' }, { fallbackToDisplayName: true })
        ?.playerExternalId,
    ).toBe('123456');
    expect(resolvePlayerFace(index, { displayName: 'Player One' })).toBeNull();
  });
});
