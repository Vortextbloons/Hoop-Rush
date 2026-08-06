import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonCompactInjuryEventSchema } from './season-health.ts';
import { seasonGameSimulationResultSchema } from './season-game-simulation.ts';
import { seasonEffectsRollupSchema, seasonMechanismEvidenceSchema } from './season-effects.ts';
import { SEASON_GAME_SUMMARY_VERSION } from './season-versions.ts';

/**
 * Compact completed-game summaries (spec/2.0/02 retention policy, M2.3,
 * season-game-summary-v3). Every league game reduces to one summary that
 * carries the identity, result state, complete team boxes, 20 compact
 * player stat lines, and the M2.5 compact injury events; richer facts
 * (substitutions, unit stints, deviations, diagnostics) are retained only
 * for human-team games through `seasonRetainedGameDetailSchema` below.
 *
 * Compactness is part of the contract: stat lines carry exact integers only,
 * no per-game derived efficiencies, no shot zones, and no diagnostics, so
 * 1,230 summaries stay well inside the storage and message budgets. M2.4
 * adds the optional per-game effects rollup (≤ 12 mechanism-side rows),
 * which is compact enough to keep in every summary. M2.5 (v3) adds the
 * compact per-game injury events.
 */

/** One compact player stat line (identity = playerVersionId). */
export const seasonCompactPlayerLineSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  /** Exact on-court seconds (integer). */
  seconds: z.number().int().min(0),
  points: z.number().int().min(0),
  fieldGoalsMade: z.number().int().min(0),
  fieldGoalsAttempted: z.number().int().min(0),
  threePointersMade: z.number().int().min(0),
  threePointersAttempted: z.number().int().min(0),
  freeThrowsMade: z.number().int().min(0),
  freeThrowsAttempted: z.number().int().min(0),
  offensiveRebounds: z.number().int().min(0),
  defensiveRebounds: z.number().int().min(0),
  assists: z.number().int().min(0),
  steals: z.number().int().min(0),
  blocks: z.number().int().min(0),
  turnovers: z.number().int().min(0),
  fouls: z.number().int().min(0),
});
export type SeasonCompactPlayerLine = z.infer<typeof seasonCompactPlayerLineSchema>;

/** Complete team box derived from the ten player lines (plus possessions). */
export const seasonTeamBoxSchema = z.object({
  franchiseId: franchiseIdSchema,
  points: z.number().int().nonnegative(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  threePointersMade: z.number().int().nonnegative(),
  threePointersAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  offensiveRebounds: z.number().int().nonnegative(),
  defensiveRebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  possessions: z.number().int().nonnegative(),
});
export type SeasonTeamBox = z.infer<typeof seasonTeamBoxSchema>;

/**
 * Compact summary of one completed league game. Player lines are canonically
 * sorted by playerVersionId (ascending) so serialization is stable for
 * digests. A forfeited game's official result is 2-0, its boxes are zeros,
 * and its player arrays are empty; the forfeit loser is named explicitly.
 */
export const seasonGameSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    summaryVersion: z.literal(SEASON_GAME_SUMMARY_VERSION),
    /** Stable game id from the committed schedule artifact. */
    gameId: z.string().regex(/^s[0-9]{6}$/),
    /** 1-based synchronized round; the round groups 15 games. */
    round: z.number().int().min(1).max(82),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: z.enum(['final', 'forfeit']),
    /** Completed overtime periods beyond regulation (0 for forfeits). */
    overtimePeriods: z.number().int().min(0),
    homeScore: z.number().int().nonnegative(),
    awayScore: z.number().int().nonnegative(),
    /** Only on forfeits: the team that failed to field five legal players. */
    forfeitLoserFranchiseId: franchiseIdSchema.nullable(),
    homeBox: seasonTeamBoxSchema,
    awayBox: seasonTeamBoxSchema,
    /** Exactly 10 lines for final games; empty for forfeits. */
    homePlayers: z.array(seasonCompactPlayerLineSchema),
    awayPlayers: z.array(seasonCompactPlayerLineSchema),
    /**
     * M2.4 compact per-game effects rollup (at most one row per mechanism
     * per side). Optional so M2.3 summaries parse unchanged; a game with
     * the zero profile emits no rollup.
     */
    effectsRollup: z.array(seasonEffectsRollupSchema).max(12).optional(),
    /**
     * M2.5 compact per-game injury events (season-game-summary-v3). Every
     * summary carries them; a zero-injury game carries an empty array.
     */
    injuryEvents: z.array(seasonCompactInjuryEventSchema),
  })
  .superRefine((summary, ctx) => {
    if (summary.status === 'forfeit') {
      if (summary.homeScore + summary.awayScore !== 2) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary must be an official 2-0 result' });
      }
      const loser = summary.forfeitLoserFranchiseId;
      if (loser === null) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary must name the losing team' });
      } else if (loser !== summary.homeFranchiseId && loser !== summary.awayFranchiseId) {
        ctx.addIssue({ code: 'custom', message: 'forfeit loser must be one of the two teams' });
      }
      if (summary.overtimePeriods !== 0) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no overtime' });
      }
      if (summary.homePlayers.length !== 0 || summary.awayPlayers.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no player statistics' });
      }
    } else {
      if (summary.forfeitLoserFranchiseId !== null) {
        ctx.addIssue({ code: 'custom', message: 'final summary must not carry a forfeit loser' });
      }
      if (summary.homePlayers.length !== 10 || summary.awayPlayers.length !== 10) {
        ctx.addIssue({ code: 'custom', message: 'final summary must carry 10 lines per side' });
      }
    }
  });
export type SeasonGameSummary = z.infer<typeof seasonGameSummarySchema>;

/**
 * Retained detailed result for a human-team game (spec/2.0/02: richer detail
 * only for human-controlled games). Reuses the full M2.2 result contract, so
 * substitution logs, unit stints, rotation deviations, foul-outs, removals,
 * returns, shot-zone facts, and diagnostics are preserved exactly where the
 * product explains them; these rows exist only for the human franchise's 82
 * games. M2.4 adds the optional full mechanism evidence (≤ 12 rows) that
 * powers effect explanations; optional so M2.3 rows parse unchanged. M2.5
 * (v3) adds the explicit compact injury-event rollup for display (the full
 * removal/return events already travel inside the retained result).
 */
export const seasonRetainedGameDetailSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(64),
  gameId: z.string().regex(/^s[0-9]{6}$/),
  round: z.number().int().min(1).max(82),
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,
  /** The full M2.2 result: substitutions, stints, deviations, diagnostics. */
  result: seasonGameSimulationResultSchema,
  /** M2.4: full per-mechanism evidence for effect explanations. */
  mechanismEvidence: z.array(seasonMechanismEvidenceSchema).max(12).optional(),
  /** M2.5: compact injury-event rollup for display. */
  injuryEvents: z.array(seasonCompactInjuryEventSchema),
});
export type SeasonRetainedGameDetail = z.infer<typeof seasonRetainedGameDetailSchema>;
