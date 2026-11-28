import { z } from 'zod';
import { CAP_RUSH_CONFERENCE_GAMES_PER_TEAM, CAP_RUSH_TAKEOVER_TEAMS } from './cap-rush-league.ts';
import { fullCourtTeamHealthSchema } from './full-court-health.ts';
import { idSchema, seedSchema } from './ids.ts';

export const FULL_COURT_SEASON_SAVE_SCHEMA_VERSION = 1;

export const fullCourtSeasonCheckpointSchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_SEASON_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    lockDigest: seedSchema,
    completedThroughSlot: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    healthByTeam: z.record(z.string().min(1), fullCourtTeamHealthSchema),
  })
  .refine((checkpoint) => {
    const teams = Object.entries(checkpoint.healthByTeam);
    return (
      teams.length === (checkpoint.completedThroughSlot === 0 ? 0 : CAP_RUSH_TAKEOVER_TEAMS) &&
      teams.every(([teamId, health]) => health.teamId === teamId)
    );
  }, 'Full Court checkpoint health must cover the completed slot');
export type FullCourtSeasonCheckpoint = z.infer<typeof fullCourtSeasonCheckpointSchema>;

const sideSchema = z.enum(['home', 'away']);

export const FULL_COURT_LINEUP_SUMMARY_VERSION = 1;
/** Above this many distinct user lineups per game, the smallest groups are omitted and counted. */
export const FULL_COURT_MAX_GAME_LINEUP_FACTS = 64;

/**
 * One actual five recorded for the user's game. `playerIds` is the canonical
 * sorted identity, so a unit that breaks and returns is the same fact. Players
 * are carried for display only.
 */
export const fullCourtLineupFactSchema = z
  .object({
    playerIds: z.array(z.string().min(1).max(64)).min(5).max(10),
    players: z
      .array(
        z.object({
          playerId: z.string().min(1).max(64),
          displayName: z.string().min(1).max(96),
        }),
      )
      .min(5)
      .max(10),
    seconds: z.number().int().nonnegative(),
    offensivePossessions: z.number().int().nonnegative(),
    defensivePossessions: z.number().int().nonnegative(),
    /** Signed live points; technicals are recorded in tape order. */
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
  })
  .superRefine((fact, context) => {
    const sorted = [...fact.playerIds].sort();
    if (fact.playerIds.some((playerId, index) => playerId !== sorted[index])) {
      context.addIssue({
        code: 'custom',
        path: ['playerIds'],
        message: 'Lineup player ids must use canonical sorted order',
      });
    }
    if (new Set(fact.playerIds).size !== fact.playerIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['playerIds'],
        message: 'Lineup player ids must be unique',
      });
    }
    if (
      fact.players.length !== fact.playerIds.length ||
      fact.players.some((player, index) => player.playerId !== fact.playerIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['players'],
        message: 'Lineup players must match the canonical player ids in order',
      });
    }
  });
export type FullCourtLineupFact = z.infer<typeof fullCourtLineupFactSchema>;

export const fullCourtLineupOmittedSchema = z.object({
  lineups: z.number().int().nonnegative(),
  seconds: z.number().int().nonnegative(),
  offensivePossessions: z.number().int().nonnegative(),
  defensivePossessions: z.number().int().nonnegative(),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
});
export type FullCourtLineupOmitted = z.infer<typeof fullCourtLineupOmittedSchema>;

/**
 * Compact per-game lineup facts for the user fixture only. AI boxes and full
 * tapes are never retained in season scores. `omitted` keeps dropped rows
 * transparent so totals still reconcile.
 */
export const fullCourtGameLineupsSchema = z
  .object({
    version: z.literal(FULL_COURT_LINEUP_SUMMARY_VERSION),
    side: sideSchema,
    sampleThreshold: z.number().int().nonnegative(),
    lineups: z.array(fullCourtLineupFactSchema).max(FULL_COURT_MAX_GAME_LINEUP_FACTS),
    omitted: fullCourtLineupOmittedSchema,
  })
  .superRefine((summary, context) => {
    const keys = new Set<string>();
    for (const lineup of summary.lineups) {
      const key = lineup.playerIds.join('|');
      if (keys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['lineups'],
          message: `Lineup ${key} appears twice`,
        });
      }
      keys.add(key);
    }
    if (summary.lineups.length === 0 && summary.omitted.lineups === 0) {
      context.addIssue({
        code: 'custom',
        path: ['lineups'],
        message: 'A recorded lineup summary requires at least one lineup',
      });
    }
  });
export type FullCourtGameLineups = z.infer<typeof fullCourtGameLineupsSchema>;

const signedSidePointsSchema = z.object({
  home: z.number().int(),
  away: z.number().int(),
});

const nonnegativeSidePointsSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});

export const fullCourtPlayerGameStatsSchema = z.object({
  playerId: z.string().min(1).max(64),
  started: z.boolean(),
  seconds: z.number().int().nonnegative(),
  points: z.number().int(),
  rebounds: z.number().int().nonnegative(),
  offRebounds: z.number().int().nonnegative(),
  defRebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  fgm: z.number().int().nonnegative(),
  fga: z.number().int().nonnegative(),
  tpm: z.number().int().nonnegative(),
  tpa: z.number().int().nonnegative(),
  ftm: z.number().int().nonnegative(),
  fta: z.number().int().nonnegative(),
});
export type FullCourtPlayerGameStats = z.infer<typeof fullCourtPlayerGameStatsSchema>;

export const fullCourtGamePlayerStatsSchema = z.object({
  home: z.array(fullCourtPlayerGameStatsSchema),
  away: z.array(fullCourtPlayerGameStatsSchema),
});
export type FullCourtGamePlayerStats = z.infer<typeof fullCourtGamePlayerStatsSchema>;

/**
 * Signed player-attributed scoring can make a bench or starter subtotal
 * negative. `starterPoints` is the explicit signed component contract for those
 * records; without it the legacy nonnegative accounting checks still apply.
 */
const playedScoreSchema = z
  .object({
    kind: z.literal('played'),
    homePoints: z.number().int().nonnegative(),
    awayPoints: z.number().int().nonnegative(),
    benchPoints: signedSidePointsSchema.optional(),
    benchPlayers: nonnegativeSidePointsSchema.optional(),
    teamBonusPoints: nonnegativeSidePointsSchema.optional(),
    starterPoints: signedSidePointsSchema.optional(),
    /** Present only on the user's played fixture; legacy scores omit it. */
    lineups: fullCourtGameLineupsSchema.optional(),
    /** Compact per-player box stats for season leaders, player averages, and awards. */
    playerStats: fullCourtGamePlayerStatsSchema.optional(),
  })
  .superRefine((score, context) => {
    if (score.starterPoints !== undefined && score.benchPoints === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['starterPoints'],
        message: 'Signed starter points require bench points',
      });
      return;
    }
    if (score.lineups !== undefined) {
      const side = score.lineups.side;
      const teamPoints = side === 'home' ? score.homePoints : score.awayPoints;
      const opponentPoints = side === 'home' ? score.awayPoints : score.homePoints;
      const pointsFor =
        score.lineups.lineups.reduce((total, lineup) => total + lineup.pointsFor, 0) +
        score.lineups.omitted.pointsFor;
      const pointsAgainst =
        score.lineups.lineups.reduce((total, lineup) => total + lineup.pointsAgainst, 0) +
        score.lineups.omitted.pointsAgainst;
      if (pointsFor !== teamPoints) {
        context.addIssue({
          code: 'custom',
          path: ['lineups', side, 'pointsFor'],
          message: 'Lineup points for must match the team score',
        });
      }
      if (pointsAgainst !== opponentPoints) {
        context.addIssue({
          code: 'custom',
          path: ['lineups', side, 'pointsAgainst'],
          message: 'Lineup points against must match the opponent score',
        });
      }
    }
    for (const side of ['home', 'away'] as const) {
      const benchPoints = score.benchPoints?.[side];
      if (benchPoints === undefined) continue;
      const teamPoints = side === 'home' ? score.homePoints : score.awayPoints;
      const teamBonusPoints = score.teamBonusPoints?.[side] ?? 0;
      const starterPoints = score.starterPoints?.[side];
      if (starterPoints !== undefined) {
        if (starterPoints + benchPoints + teamBonusPoints !== teamPoints) {
          context.addIssue({
            code: 'custom',
            path: ['starterPoints', side],
            message: 'Starter, bench, and team bonus points must sum to team points',
          });
        }
        continue;
      }
      if (benchPoints < 0) {
        context.addIssue({
          code: 'custom',
          path: ['benchPoints', side],
          message: 'Signed bench points require starter points',
        });
      } else if (benchPoints + teamBonusPoints > teamPoints) {
        context.addIssue({
          code: 'custom',
          path: ['benchPoints', side],
          message:
            'Bench scoring and team bonus cannot exceed team scoring without signed starter points',
        });
      }
    }
  });

export const fullCourtScoreOutcomeSchema = z.discriminatedUnion('kind', [
  playedScoreSchema,
  z.object({
    kind: z.literal('forfeit'),
    losingSides: z
      .array(sideSchema)
      .min(1)
      .max(2)
      .refine((sides) => new Set(sides).size === sides.length),
  }),
]);

export const fullCourtSeasonScoreSchema = z
  .object({
    gameId: z.string().min(1),
    slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    homeTeamId: z.string().min(1),
    awayTeamId: z.string().min(1),
    outcome: fullCourtScoreOutcomeSchema,
  })
  .refine(
    (score) =>
      score.homeTeamId !== score.awayTeamId &&
      (score.outcome.kind !== 'played' || score.outcome.homePoints !== score.outcome.awayPoints),
    'Full Court results require distinct teams and a winner in a played game',
  );
export type FullCourtSeasonScore = z.infer<typeof fullCourtSeasonScoreSchema>;
