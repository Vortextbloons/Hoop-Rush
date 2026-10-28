import type { AchievementId, PlayerProfile } from '@hoop-rush/data-contracts';

export interface ProfileGameFacts {
  won: boolean;
  multiplayer: boolean;
  players: readonly { points: number; assists: number; steals: number; blocks: number }[];
}

export function applyProfileGame(
  profile: PlayerProfile,
  facts: ProfileGameFacts,
): {
  profile: PlayerProfile;
  unlocked: AchievementId[];
} {
  const streak = facts.won ? profile.streak + 1 : 0;
  const earned: AchievementId[] = ['welcome'];
  if (facts.multiplayer && facts.won) earned.push('first-multiplayer-win');
  if (facts.players.some((player) => player.steals >= 3)) earned.push('hands-off');
  if (facts.players.some((player) => player.blocks >= 3)) earned.push('no-easy-buckets');
  if (facts.won && facts.players.some((player) => player.assists >= 8 && player.points < 5))
    earned.push('silent-carry');
  const unlocked = earned.filter((id) => !profile.achievements.includes(id));
  return {
    profile: {
      ...profile,
      games: profile.games + 1,
      wins: profile.wins + Number(facts.won),
      streak,
      bestStreak: Math.max(profile.bestStreak, streak),
      achievements: [...profile.achievements, ...unlocked],
    },
    unlocked,
  };
}
