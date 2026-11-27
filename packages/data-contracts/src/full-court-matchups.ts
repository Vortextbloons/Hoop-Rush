import { z } from 'zod';

export const FULL_COURT_MAX_DEFENSIVE_MATCHUPS = 3;

const playerRefSchema = z.string().min(1).max(64);

export const fullCourtDefensiveMatchupAssignmentSchema = z
  .object({
    opponentPlayerId: playerRefSchema,
    defenderPlayerId: playerRefSchema,
  })
  .strict();
export type FullCourtDefensiveMatchupAssignment = z.infer<
  typeof fullCourtDefensiveMatchupAssignmentSchema
>;

/**
 * Per-fixture defensive matchup assignments for the upcoming user game.
 * Kept additive and fixture-scoped so stale opponent or defender IDs never
 * carry across fixtures or into older saves.
 */
export const fullCourtDefensiveMatchupsSchema = z
  .object({
    gameId: z.string().trim().min(1).max(128).optional(),
    opponentTeamId: z.string().trim().min(1).max(64),
    assignments: z
      .array(fullCourtDefensiveMatchupAssignmentSchema)
      .max(
        FULL_COURT_MAX_DEFENSIVE_MATCHUPS,
        `Assign ${String(FULL_COURT_MAX_DEFENSIVE_MATCHUPS)} defensive matchups or fewer.`,
      ),
  })
  .strict()
  .superRefine((plan, context) => {
    const opponents = new Set<string>();
    const defenders = new Set<string>();
    plan.assignments.forEach((assignment, index) => {
      if (opponents.has(assignment.opponentPlayerId)) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'opponentPlayerId'],
          message: 'each opponent player can have at most one assigned defender',
        });
      }
      opponents.add(assignment.opponentPlayerId);
      if (defenders.has(assignment.defenderPlayerId)) {
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'defenderPlayerId'],
          message: 'each defender can guard at most one assigned opponent',
        });
      }
      defenders.add(assignment.defenderPlayerId);
    });
  });
export type FullCourtDefensiveMatchups = z.infer<typeof fullCourtDefensiveMatchupsSchema>;
