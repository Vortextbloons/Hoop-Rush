import { z } from 'zod';

export const PROFILE_SAVE_SCHEMA_VERSION = 1;
export const legacyAchievementIdSchema = z.enum([
  'welcome',
  'first-multiplayer-win',
  'hands-off',
  'no-easy-buckets',
  'silent-carry',
  'built-different',
]);
export const collectionAchievementIdSchema = z.enum([
  'better-than-73-9',
  'one-game-short',
  'the-popovich-way',
  'ball-dont-lie',
  'goin-to-work',
  '30-for-30',
  'we-believe',
  'brodie-mode',
  'welcome-to-the-50-40-90-club',
  'the-harden-system',
  'the-beautiful-game',
  'magic-vision',
  'leeverything',
  'the-dream-team',
  'laker-legacy',
  'old-school-legends',
  '73-9-hold-my-ring',
  'moneyball',
  'the-dirk-run',
  'going-all-in',
  'the-heatles',
  'we-believe-2-0',
  'the-cardiac-kings',
  'linsanity',
  'detroit-basketball',
  'the-shot',
  'the-curry-effect',
  'the-dynasty-effect',
  'all-star-game-numbers',
  'wilt-chamberlain-mode',
  'better-without-the-boost',
  'the-monstars',
  'space-jam',
  'manu-off-the-bench',
  'havoc-built-different',
  'cleveland-this-is-for-you',
  'the-reverse-sweep',
  'bring-out-the-brooms',
  'dame-time',
  'upset-of-the-year',
  'the-revenge-tour',
  'the-splash-brothers',
  'moneyball-champions',
  'season-sweep',
  'the-finals-rematch',
]);
export const achievementIdSchema = z.enum([
  ...legacyAchievementIdSchema.options,
  ...collectionAchievementIdSchema.options,
]);
export type AchievementId = z.infer<typeof achievementIdSchema>;
export type LegacyAchievementId = z.infer<typeof legacyAchievementIdSchema>;

export const achievementUnlockSchema = z.object({
  id: collectionAchievementIdSchema,
  evidence: z.string().min(1).max(250),
});
export type AchievementUnlock = z.infer<typeof achievementUnlockSchema>;

export const profileTitleSchema = z.enum([
  'none',
  'defensive-wall',
  'floor-general',
  'the-undefeated',
  'triple-double-machine',
  'century-club',
  'never-out',
]);

export const playerProfileSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.uuid(),
  name: z.string().trim().min(3).max(16),
  avatar: z.enum(['initials', 'ball', 'crown']),
  border: z.enum(['classic', 'gold']),
  nameColor: z.enum(['white', 'orange', 'blue']),
  title: profileTitleSchema,
  featuredAchievement: achievementIdSchema.nullable(),
  achievements: z.array(achievementIdSchema),
  achievementMoments: z.array(achievementUnlockSchema).optional(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  bestStreak: z.number().int().nonnegative(),
  multiplayerStreak: z.number().int().nonnegative(),
});
export type PlayerProfile = z.infer<typeof playerProfileSchema>;

export const profileTitles: Record<
  PlayerProfile['title'],
  { name: string; achievementId: AchievementId | null }
> = {
  none: { name: 'None', achievementId: null },
  'defensive-wall': { name: 'Defensive Wall', achievementId: 'no-easy-buckets' },
  'floor-general': { name: 'Floor General', achievementId: 'silent-carry' },
  'the-undefeated': { name: 'The Undefeated', achievementId: 'better-than-73-9' },
  'triple-double-machine': { name: 'Triple-Double Machine', achievementId: 'brodie-mode' },
  'century-club': { name: 'Century Club', achievementId: 'wilt-chamberlain-mode' },
  'never-out': { name: 'Never Out', achievementId: 'the-reverse-sweep' },
};

export function achievementTitleFor(
  id: AchievementId,
): Exclude<PlayerProfile['title'], 'none'> | undefined {
  return (Object.keys(profileTitles) as PlayerProfile['title'][]).find(
    (title): title is Exclude<PlayerProfile['title'], 'none'> =>
      title !== 'none' && profileTitles[title].achievementId === id,
  );
}

export const publicProfileSchema = playerProfileSchema
  .pick({
    name: true,
    avatar: true,
    border: true,
    nameColor: true,
    title: true,
    featuredAchievement: true,
    games: true,
    wins: true,
    bestStreak: true,
  })
  .extend({ participantId: z.enum(['p1', 'p2']) });
export type PublicProfile = z.infer<typeof publicProfileSchema>;

export const profileBindingSchema = z.object({
  saveSchemaVersion: z.literal(PROFILE_SAVE_SCHEMA_VERSION),
  id: z.string().min(1).max(128),
  profileId: z.uuid(),
  participantId: z.enum(['p1', 'p2']).optional(),
  rematchAfterLoss: z.string().min(1).max(64).optional(),
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
