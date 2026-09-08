import { z } from 'zod';
import { collectionCardIdSchema } from './collection.ts';
import { COLLECTION_TEAM_VERSION } from './collection-versions.ts';

export const COLLECTION_ACTIVE_TEAM_MIN_SIZE = 5;
export const COLLECTION_ACTIVE_TEAM_MAX_SIZE = 12;
export const COLLECTION_ACTIVE_TEAM_GAME_MINUTES = 240;
export const COLLECTION_ACTIVE_TEAM_MAX_TARGET_MINUTES = 48;

export const collectionActiveTeamMinutesSchema = z
  .object({
    cardId: collectionCardIdSchema,
    minutes: z.number().int().min(0).max(COLLECTION_ACTIVE_TEAM_MAX_TARGET_MINUTES),
  })
  .strict();
export type CollectionActiveTeamMinutes = z.infer<typeof collectionActiveTeamMinutesSchema>;

export const collectionActiveTeamSchema = z
  .object({
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    starters: z.array(collectionCardIdSchema).length(5),
    bench: z.array(collectionCardIdSchema).max(7),
    targetMinutes: z
      .array(collectionActiveTeamMinutesSchema)
      .min(COLLECTION_ACTIVE_TEAM_MIN_SIZE)
      .max(COLLECTION_ACTIVE_TEAM_MAX_SIZE),
  })
  .superRefine((team, ctx) => {
    const roster = [...team.starters, ...team.bench];
    const seen = new Set<string>();
    for (const cardId of roster) {
      if (seen.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate card ${cardId} in active team` });
      }
      seen.add(cardId);
    }
    if (roster.length < COLLECTION_ACTIVE_TEAM_MIN_SIZE) {
      ctx.addIssue({
        code: 'custom',
        message: `active team needs at least ${String(COLLECTION_ACTIVE_TEAM_MIN_SIZE)} cards`,
      });
    }
    const minuteIds = new Set<string>();
    let total = 0;
    for (const entry of team.targetMinutes) {
      if (minuteIds.has(entry.cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate minutes entry ${entry.cardId}` });
      }
      minuteIds.add(entry.cardId);
      total += entry.minutes;
    }
    for (const cardId of roster) {
      if (!minuteIds.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `missing minutes entry ${cardId}` });
      }
    }
    for (const cardId of minuteIds) {
      if (!seen.has(cardId)) {
        ctx.addIssue({ code: 'custom', message: `minutes entry ${cardId} is not rostered` });
      }
    }
    if (total !== COLLECTION_ACTIVE_TEAM_GAME_MINUTES) {
      ctx.addIssue({
        code: 'custom',
        message: `target minutes total ${String(total)} != ${String(COLLECTION_ACTIVE_TEAM_GAME_MINUTES)}`,
      });
    }
    const minutesById = new Map(team.targetMinutes.map((entry) => [entry.cardId, entry.minutes]));
    for (const cardId of team.starters) {
      if ((minutesById.get(cardId) ?? 0) < 1) {
        ctx.addIssue({ code: 'custom', message: `starter ${cardId} needs at least one minute` });
      }
    }
  });
export type CollectionActiveTeam = z.infer<typeof collectionActiveTeamSchema>;
