import { z } from 'zod';
import { idSchema, seedSchema } from './ids.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { HAVOC_GAME_COUNT, HAVOC_SCHEMA_VERSION, havocVersionSetSchema } from './havoc-versions.ts';
import { havocDraftStateSchema, havocDraftPickSchema } from './havoc-draft.ts';
import { havocTeamInputSchema } from './havoc-game.ts';

export const havocScheduleEntrySchema = z.object({
  gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
});
export type HavocScheduleEntry = z.infer<typeof havocScheduleEntrySchema>;

export const havocFrozenOpponentSchema = z.object({
  opponentId: z.string().min(1).max(64),
  team: havocTeamInputSchema,
});
export type HavocFrozenOpponent = z.infer<typeof havocFrozenOpponentSchema>;

export const havocLockedInputsSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    runId: idSchema,
    runSeed: seedSchema,
    versionSet: havocVersionSetSchema,
    profile: eraSimulationProfileSchema,
    human: havocTeamInputSchema,
    schedule: z.array(havocScheduleEntrySchema).length(HAVOC_GAME_COUNT),
    opponents: z.array(havocFrozenOpponentSchema).min(1).max(64),
    picks: z.array(havocDraftPickSchema).length(5),
  })
  .superRefine((locked, ctx) => {
    if (locked.human.side !== 'human' || locked.human.clones.length > 5) {
      ctx.addIssue({ code: 'custom', message: 'locked human team must carry the human side' });
    }
    locked.schedule.forEach((entry, index) => {
      if (entry.gameNumber !== index + 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'schedule game numbers must be sequential from 1',
        });
      }
      const opponent = locked.opponents.find(
        (candidate) => candidate.opponentId === entry.opponentId,
      );
      if (opponent === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `schedule references unknown opponent ${entry.opponentId}`,
        });
      } else if (opponent.team.side !== 'opponent' || opponent.team.clones.length !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'frozen opponents must be opponent-side teams without clones',
        });
      }
    });
    const starterIds = new Set(locked.human.starters.map((starter) => starter.instanceId));
    locked.picks.forEach((pick, index) => {
      if (pick.pickOrdinal !== index) {
        ctx.addIssue({ code: 'custom', message: 'locked picks must be in draft order' });
      }
    });
    if (starterIds.size !== 5) {
      ctx.addIssue({
        code: 'custom',
        message: 'locked human starters must be five distinct instances',
      });
    }
  });
export type HavocLockedInputs = z.infer<typeof havocLockedInputsSchema>;

export const havocSeasonAggregateSchema = z
  .object({
    games: z.number().int().min(0).max(HAVOC_GAME_COUNT),
    wins: z.number().int().min(0).max(HAVOC_GAME_COUNT),
    losses: z.number().int().min(0).max(HAVOC_GAME_COUNT),
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    adjustments: z.number().int(),
  })
  .superRefine((aggregate, ctx) => {
    if (aggregate.wins + aggregate.losses !== aggregate.games) {
      ctx.addIssue({ code: 'custom', message: 'aggregate wins and losses must sum to games' });
    }
  });
export type HavocSeasonAggregate = z.infer<typeof havocSeasonAggregateSchema>;

export const havocComparisonStatusSchema = z.enum([
  'not-started',
  'running',
  'complete',
  'unsupported',
]);
export type HavocComparisonStatus = z.infer<typeof havocComparisonStatusSchema>;

export const havocCompletionStateSchema = z.enum([
  'draft',
  'season',
  'comparison',
  'complete',
  'abandoned',
]);
export type HavocCompletionState = z.infer<typeof havocCompletionStateSchema>;

export const havocRunStateSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    runSeed: seedSchema,
    versionSet: havocVersionSetSchema,
    phase: z.enum(['draft', 'run']),
    draft: havocDraftStateSchema.nullable(),
    locked: havocLockedInputsSchema.nullable(),
    havocCursor: z.number().int().min(0).max(HAVOC_GAME_COUNT),
    normalCursor: z.number().int().min(0).max(HAVOC_GAME_COUNT),
    havocAggregate: havocSeasonAggregateSchema,
    normalAggregate: havocSeasonAggregateSchema,
    perfectSeason: z.boolean(),
    comparisonStatus: havocComparisonStatusSchema,
    completionState: havocCompletionStateSchema,
  })
  .superRefine((state, ctx) => {
    if (state.phase === 'draft') {
      if (state.draft === null || state.locked !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'draft phase requires a draft and no locked inputs',
        });
      }
      if (state.havocCursor !== 0 || state.normalCursor !== 0) {
        ctx.addIssue({ code: 'custom', message: 'draft phase cannot have advanced cursors' });
      }
      if (state.completionState !== 'draft') {
        ctx.addIssue({
          code: 'custom',
          message: 'draft phase must report the draft completion state',
        });
      }
    } else {
      if (state.draft !== null || state.locked === null) {
        ctx.addIssue({ code: 'custom', message: 'run phase requires locked inputs and no draft' });
      }
    }
    if (state.normalCursor > 0 && state.havocCursor < HAVOC_GAME_COUNT) {
      ctx.addIssue({
        code: 'custom',
        message: 'the normal season starts only after havoc game 82',
      });
    }
    if (state.havocCursor < HAVOC_GAME_COUNT && state.perfectSeason) {
      ctx.addIssue({ code: 'custom', message: 'a perfect season requires all 82 havoc games' });
    }
    if (state.havocCursor === HAVOC_GAME_COUNT) {
      const perfect =
        state.havocAggregate.games === HAVOC_GAME_COUNT && state.havocAggregate.losses === 0;
      if (state.perfectSeason !== perfect) {
        ctx.addIssue({
          code: 'custom',
          message: 'perfect-season flag disagrees with the aggregate',
        });
      }
    }
    if (state.completionState === 'complete' && state.comparisonStatus !== 'complete') {
      ctx.addIssue({ code: 'custom', message: 'complete runs require a complete comparison' });
    }
  });
export type HavocRunState = z.infer<typeof havocRunStateSchema>;
