import { describe, expect, it } from 'vitest';
import { seasonKeySchema } from '@hoop-rush/data-contracts';
import { buildStats } from '../pools/compute.ts';
import { recoverRosterAdvanced, recoverRosterShooting } from './roster-advanced.ts';

const player = {
  seasonKey: seasonKeySchema.parse('1962-63'),
  altIds: { bbref: 'chambwi01' },
  lastName: 'Chamberlain',
  stats: buildStats({ gamesPlayed: 80, minutes: 3806, points: 3586, rebounds: 1946, assists: 275 }),
};
const source = {
  schemaVersion: 1,
  seasonKey: '1962-63',
  sourceUrl: 'https://www.basketball-reference.com/leagues/NBA_1963_advanced.html',
  players: [
    {
      bbrefId: 'chambwi01',
      gamesPlayed: 80,
      minutes: 3806,
      per: 31.8,
      boxPlusMinus: null,
      usageRate: null,
    },
  ],
};

describe('published roster advanced stats', () => {
  it('recovers missing identities only with a unique surname and workload match', () => {
    const named = {
      ...source,
      players: [{ ...source.players[0], displayName: 'Wilt Chamberlain' }],
    };
    expect(recoverRosterAdvanced({ ...player, altIds: null }, named).per).toBe(31.8);
    const ambiguous = {
      ...named,
      players: [...named.players, { ...named.players[0], bbrefId: 'chambwi02' }],
    };
    expect(recoverRosterAdvanced({ ...player, altIds: null }, ambiguous).per).toBeNull();
    expect(
      recoverRosterAdvanced({ ...player, altIds: null, lastName: 'Russell' }, named).per,
    ).toBeNull();
  });
  it('matches accented historical surnames without weakening workload checks', () => {
    const supplied = {
      ...source,
      players: [{ ...source.players[0], bbrefId: 'gudmupe01', displayName: 'Pétur Guðmundsson' }],
    };
    expect(
      recoverRosterAdvanced({ ...player, altIds: null, lastName: 'Gudmundsson' }, supplied).per,
    ).toBe(31.8);
  });
  it('recovers observed zero threes without applying them to pre-three-point seasons', () => {
    const modern = {
      ...player,
      playerExternalId: '76375',
      seasonKey: seasonKeySchema.parse('1980-81'),
    };
    const raw = { playerExternalId: '76375', gamesPlayed: 80, minutes: 3806, tpm: 0, tpa: 0 };
    expect(recoverRosterShooting(modern, raw).threesAttempted).toBe(0);
    expect(
      recoverRosterShooting({ ...modern, seasonKey: seasonKeySchema.parse('1962-63') }, raw)
        .threesAttempted,
    ).toBeNull();
    expect(recoverRosterShooting(modern, { ...raw, tpa: null }).threesAttempted).toBeNull();
  });
  it('recovers published PER without inventing absent historical statistics', () => {
    const stats = recoverRosterAdvanced(player, source);
    expect(stats.per).toBe(31.8);
    expect(stats.usageRate).toBeNull();
    expect(stats.boxPlusMinus).toBeNull();
    expect(stats.blocks).toBeNull();
    expect(stats.gamesPlayed).toBe(80);
    expect(stats.points).toBe(3586);
    expect(player.stats.per).toBeNull();
  });
  it('recovers a published zero and preserves existing source values', () => {
    const supplied = {
      ...source,
      players: [{ ...source.players[0], boxPlusMinus: 0, usageRate: 22 }],
    };
    expect(recoverRosterAdvanced(player, supplied).boxPlusMinus).toBe(0);
    expect(
      recoverRosterAdvanced({ ...player, stats: { ...player.stats, per: 32 } }, source).per,
    ).toBe(32);
  });
  it('rejects mismatched seasons, duplicate identities, and invalid source values', () => {
    expect(() => recoverRosterAdvanced(player, { ...source, seasonKey: '1961-62' })).toThrow();
    expect(() =>
      recoverRosterAdvanced(player, { ...source, players: [...source.players, ...source.players] }),
    ).toThrow();
    expect(() =>
      recoverRosterAdvanced(player, {
        ...source,
        players: [{ ...source.players[0], usageRate: 101 }],
      }),
    ).toThrow();
  });
  it('does not apply a different workload or player record', () => {
    for (const change of [{ gamesPlayed: 79 }, { minutes: 3000 }, { bbrefId: 'russebi01' }]) {
      expect(
        recoverRosterAdvanced(player, {
          ...source,
          players: [{ ...source.players[0], ...change }],
        }),
      ).toEqual(player.stats);
    }
  });
});
