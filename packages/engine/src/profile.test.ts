import { describe, expect, test } from 'bun:test';
import { PROFILE_SAVE_SCHEMA_VERSION, playerProfileSchema } from '@hoop-rush/data-contracts';
import { applyProfileGame } from './profile.ts';

const baseProfile = playerProfileSchema.parse({
  saveSchemaVersion: PROFILE_SAVE_SCHEMA_VERSION,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Player',
  avatar: 'initials',
  border: 'classic',
  nameColor: 'white',
  title: 'none',
  featuredAchievement: null,
  achievements: [],
  games: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
  multiplayerStreak: 0,
});

describe('applyProfileGame', () => {
  test('counts games without mistaking games in one series for separate multiplayer matches', () => {
    let profile = baseProfile;
    for (let game = 1; game <= 5; game += 1) {
      const result = applyProfileGame(profile, { won: true, multiplayer: true, players: [] });
      profile = result.profile;
    }
    expect(profile.games).toBe(5);
    expect(profile.multiplayerStreak).toBe(0);
    expect(profile.achievements).not.toContain('built-different');
    expect(profile.achievements).toContain('first-multiplayer-win');
  });
});
