import { z } from 'zod';
import { FULL_COURT_MAX_ROSTER_SIZE } from './full-court-draft.ts';
import { fullCourtDefensiveMatchupsSchema } from './full-court-matchups.ts';

export const FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION = 1;

const fixtureGameIdSchema = z.string().trim().min(1).max(128);
const teamRefSchema = z.string().trim().min(1).max(64);
const playerRefSchema = z.string().min(1).max(64);

/**
 * The voluntary rest and defensive matchup choices the user pinned to one
 * upcoming fixture. The fixture id is part of the plan so a stale game's clear
 * can never remove a newer fixture's choices.
 */
export const fullCourtNextGamePlanSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_NEXT_GAME_PLAN_SCHEMA_VERSION),
    gameId: fixtureGameIdSchema,
    opponentTeamId: teamRefSchema,
    restingPlayerIds: z.array(playerRefSchema).max(FULL_COURT_MAX_ROSTER_SIZE),
    defensiveMatchups: fullCourtDefensiveMatchupsSchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.restingPlayerIds).size !== plan.restingPlayerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['restingPlayerIds'],
        message: 'resting players must be unique',
      });
    }
    const matchups = plan.defensiveMatchups;
    if (matchups === undefined) return;
    if (matchups.opponentTeamId !== plan.opponentTeamId) {
      context.addIssue({
        code: 'custom',
        path: ['defensiveMatchups', 'opponentTeamId'],
        message: 'defensive matchups must target the plan opponent',
      });
    }
    if (matchups.gameId !== undefined && matchups.gameId !== plan.gameId) {
      context.addIssue({
        code: 'custom',
        path: ['defensiveMatchups', 'gameId'],
        message: 'defensive matchups must target the plan fixture',
      });
    }
  });
export type FullCourtNextGamePlan = z.infer<typeof fullCourtNextGamePlanSchema>;
