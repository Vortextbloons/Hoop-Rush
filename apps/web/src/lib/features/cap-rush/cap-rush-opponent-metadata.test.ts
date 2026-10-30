import { describe, expect, it } from 'bun:test';
import {
  canonicalJson,
  seasonKeySchema,
  contentHashSchema,
  seedSchema,
  type CapRushRosterMetadata,
} from '@hoop-rush/data-contracts';
import { buildHavocOpponentTeam } from '@hoop-rush/engine';
import { buildFixtureBracket, DEFAULT_ERA_SIM_PROFILE } from '@hoop-rush/test-fixtures';
import {
  capRushBracketWithRosterMetadata,
  capRushOpponentMetadataOf,
} from './cap-rush-opponent-metadata.js';

function fixture() {
  const original = buildFixtureBracket();
  const bracket = {
    ...original,
    opponents: original.opponents.map((opponent) => ({
      ...opponent,
      seasonKey: seasonKeySchema.parse('2005-06'),
      players: opponent.players.map((player) => ({ ...player, overall: undefined })),
    })),
  };
  const metadata: CapRushRosterMetadata = {
    fieldHash: contentHashSchema.parse('a'.repeat(64)),
    players: bracket.opponents.flatMap((opponent) =>
      opponent.players.map((player) => ({
        teamId: opponent.teamId,
        seasonKey: opponent.seasonKey,
        playerId: player.playerId,
        overall: 95,
        ratings: player.ratings,
        tendencies: player.tendencies,
      })),
    ),
  };
  const opponent = bracket.opponents[0];
  if (opponent === undefined) throw new Error('missing fixture opponent');
  const team = buildHavocOpponentTeam({
    opponent,
    profile: DEFAULT_ERA_SIM_PROFILE,
    runSeed: seedSchema.parse('abcdef1234567890'),
  }).team;
  const source = team.starters[0]?.source;
  if (source === undefined) throw new Error('missing fixture player');
  return { bracket, metadata, source, opponent };
}

describe('Cap Rush opponent display metadata', () => {
  it('repairs derived overall and stripped season for an exact frozen source without changing its save', () => {
    const { source, metadata } = fixture();
    expect(source.overallSource).toBe('derived');
    expect(source.seasonKey).toBeNull();
    expect(source.originalOverall).not.toBe(95);
    const before = canonicalJson(source);
    expect(capRushOpponentMetadataOf(source, metadata)).toMatchObject({
      overall: 95,
      seasonKey: '2005-06',
    });
    expect(canonicalJson(source)).toBe(before);
  });

  it('rejects other player seasons, franchises, profile changes and ambiguous matches', () => {
    const { source, metadata } = fixture();
    expect(
      capRushOpponentMetadataOf(
        { ...source, seasonKey: seasonKeySchema.parse('2006-07') },
        metadata,
      ),
    ).toBeNull();
    expect(capRushOpponentMetadataOf({ ...source, franchiseId: null }, metadata)).toBeNull();
    expect(
      capRushOpponentMetadataOf(
        {
          ...source,
          profile: {
            ...source.profile,
            ratings: { ...source.profile.ratings, passing: source.profile.ratings.passing + 1 },
          },
        },
        metadata,
      ),
    ).toBeNull();
    const row = capRushOpponentMetadataOf(source, metadata);
    if (row === null) throw new Error('missing exact match');
    expect(
      capRushOpponentMetadataOf(source, { ...metadata, players: [...metadata.players, row] }),
    ).toBeNull();
  });

  it('decorates only new-run display overalls while preserving frozen simulation ratings and artifact content', () => {
    const { bracket, metadata } = fixture();
    const before = canonicalJson(bracket);
    const decorated = capRushBracketWithRosterMetadata(bracket, metadata, metadata.fieldHash);
    expect(canonicalJson(bracket)).toBe(before);
    for (let index = 0; index < bracket.opponents.length; index += 1) {
      const original = bracket.opponents[index];
      const updated = decorated.opponents[index];
      if (original === undefined || updated === undefined) throw new Error('missing opponent');
      expect(updated.seasonKey).toBe(original.seasonKey);
      updated.players.forEach((player, playerIndex) => {
        const originalPlayer = original.players[playerIndex];
        if (originalPlayer === undefined) throw new Error('missing original player');
        expect(player.overall).toBe(95);
        expect(player.ratings).toEqual(originalPlayer.ratings);
        expect(player.tendencies).toEqual(originalPlayer.tendencies);
      });
    }
    expect(() => capRushBracketWithRosterMetadata(bracket, metadata, 'b'.repeat(64))).toThrow(
      'different opponent field',
    );
  });
});
