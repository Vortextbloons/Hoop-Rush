import { z } from 'zod';

export const PROFILE_SAVE_SCHEMA_VERSION = 1;
export const achievementIdSchema = z.enum([
  'welcome',
  'first-multiplayer-win',
  'hands-off',
  'no-easy-buckets',
  'silent-carry',
  'built-different',
]);
export type AchievementId = z.infer<typeof achievementIdSchema>;

export const playerProfileSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.uuid(),
  name: z.string().trim().min(3).max(16),
  avatar: z.enum(['initials', 'ball', 'crown']),
  border: z.enum(['classic', 'gold']),
  nameColor: z.enum(['white', 'orange', 'blue']),
  title: z.enum(['none', 'defensive-wall', 'floor-general']),
  featuredAchievement: achievementIdSchema.nullable(),
  achievements: z.array(achievementIdSchema),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  bestStreak: z.number().int().nonnegative(),
  multiplayerStreak: z.number().int().nonnegative(),
});
export type PlayerProfile = z.infer<typeof playerProfileSchema>;

export const profileBindingSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.string().min(1).max(128),
  profileId: z.uuid(),
  participantId: z.enum(['p1', 'p2']).optional(),
});
export type ProfileBinding = z.infer<typeof profileBindingSchema>;

export const profileGameSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.string().min(1).max(160),
  profileId: z.uuid(),
  unlocked: z.array(achievementIdSchema),
});
export type ProfileGame = z.infer<typeof profileGameSchema>;

export const profileSelectionSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.literal('selected'),
  profileId: z.uuid(),
});
export type ProfileSelection = z.infer<typeof profileSelectionSchema>;
