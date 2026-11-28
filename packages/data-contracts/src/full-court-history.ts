import { z } from 'zod';
import { CAP_RUSH_CONFERENCE_GAMES_PER_TEAM } from './cap-rush-league.ts';
import { CAP_RUSH_PLAYOFF_ROUNDS, CAP_RUSH_SERIES_WINS } from './cap-rush-postseason.ts';
import { fullCourtCoachingPlanSchema } from './full-court-coaching.ts';
import { fullCourtDraftStateSchema } from './full-court-draft.ts';
import { idSchema } from './ids.ts';

export const FULL_COURT_HISTORY_SCHEMA_VERSION = 1;

const FULL_COURT_MAX_COMPLETED_GAMES =
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM + CAP_RUSH_PLAYOFF_ROUNDS * (CAP_RUSH_SERIES_WINS * 2 - 1);

export const fullCourtHistoryBenchGameSchema = z.object({
  gameId: z.string().min(1),
  gameNumber: z.number().int().min(1).max(FULL_COURT_MAX_COMPLETED_GAMES),
  benchPoints: z.number().int(),
});
export type FullCourtHistoryBenchGame = z.infer<typeof fullCourtHistoryBenchGameSchema>;

/**
 * Compact season bench totals. Bench points are signed because deductions
 * can push a bench subtotal below zero; legacy records omit this
 * whole object and still load.
 */
export const fullCourtHistoryBenchSchema = z
  .object({
    gamesRecorded: z.number().int().min(0).max(FULL_COURT_MAX_COMPLETED_GAMES),
    totalBenchPoints: z.number().int(),
    averageBenchPoints: z.number(),
    bestGame: fullCourtHistoryBenchGameSchema.nullable(),
  })
  .superRefine((bench, context) => {
    if (bench.gamesRecorded === 0) {
      if (
        bench.totalBenchPoints !== 0 ||
        bench.averageBenchPoints !== 0 ||
        bench.bestGame !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Empty bench history requires zero totals and no best game',
        });
      }
      return;
    }
    if (bench.bestGame === null) {
      context.addIssue({
        code: 'custom',
        path: ['bestGame'],
        message: 'Recorded bench history requires a best game',
      });
    }
    const average = Math.round((bench.totalBenchPoints / bench.gamesRecorded) * 10) / 10;
    if (average !== bench.averageBenchPoints) {
      context.addIssue({
        code: 'custom',
        path: ['averageBenchPoints'],
        message: 'Bench average must match its total and game count',
      });
    }
  });
export type FullCourtHistoryBench = z.infer<typeof fullCourtHistoryBenchSchema>;

export const fullCourtHistoryRecordSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_HISTORY_SCHEMA_VERSION),
    runId: idSchema,
    completedAtIso: z.iso.datetime(),
    draft: fullCourtDraftStateSchema,
    teamId: z.string().min(1),
    teamName: z.string().min(1),
    coaching: fullCourtCoachingPlanSchema,
    regularSeason: z.object({
      wins: z.number().int().nonnegative(),
      losses: z.number().int().nonnegative(),
      pointDifferential: z.number().int(),
    }),
    bench: fullCourtHistoryBenchSchema.optional(),
    playoffs: z.object({
      status: z.enum(['champion', 'eliminated', 'not-qualified']),
      championTeamId: z.string().min(1),
      championName: z.string().min(1),
      seriesWon: z.number().int().min(0).max(CAP_RUSH_PLAYOFF_ROUNDS),
      eliminatedRound: z.number().int().min(1).max(CAP_RUSH_PLAYOFF_ROUNDS).nullable(),
    }),
    achievements: z.array(z.enum(['bench-mob', 'the-chess-match'])).max(2),
  })
  .superRefine((record, context) => {
    if (record.draft.runId !== record.runId || record.draft.stage !== 'complete') {
      context.addIssue({
        code: 'custom',
        path: ['draft'],
        message: 'History requires the confirmed draft for this run',
      });
    }
    if (
      record.regularSeason.wins + record.regularSeason.losses !==
      CAP_RUSH_CONFERENCE_GAMES_PER_TEAM
    ) {
      context.addIssue({
        code: 'custom',
        path: ['regularSeason'],
        message: 'History requires every regular-season result',
      });
    }
    const { playoffs } = record;
    const validFinish =
      playoffs.status === 'champion'
        ? playoffs.championTeamId === record.teamId &&
          playoffs.seriesWon === CAP_RUSH_PLAYOFF_ROUNDS &&
          playoffs.eliminatedRound === null
        : playoffs.championTeamId !== record.teamId &&
          (playoffs.status === 'eliminated'
            ? playoffs.eliminatedRound === playoffs.seriesWon + 1
            : playoffs.eliminatedRound === null && playoffs.seriesWon === 0);
    if (!validFinish)
      context.addIssue({
        code: 'custom',
        path: ['playoffs'],
        message: 'Playoff history must agree with the bracket finish',
      });
    if (new Set(record.achievements).size !== record.achievements.length) {
      context.addIssue({
        code: 'custom',
        path: ['achievements'],
        message: 'History achievements must be unique',
      });
    }
  });
export type FullCourtHistoryRecord = z.infer<typeof fullCourtHistoryRecordSchema>;
