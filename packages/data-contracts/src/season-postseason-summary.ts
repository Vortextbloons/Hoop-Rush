import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonCompactInjuryEventSchema } from './season-health.ts';
import { seasonCompactPlayerLineSchema, seasonTeamBoxSchema } from './season-game-summary.ts';
import { conferenceIdSchema } from './season-league.ts';
import {
  playInMatchupIdSchema,
  playoffRoundSchema,
  postseasonGameIdSchema,
  type PlayInMatchupId,
  type PlayoffRound,
} from './season-postseason.ts';
import { SEASON_POSTSEASON_SUMMARY_VERSION } from './season-versions.ts';
import { canonicalJson, seasonDigestHex } from './season-hash.ts';

/**
 * Postseason game summaries (M2.6, postseason-summary-v1). One summary per
 * Play-In and playoff game, stored SEPARATELY from the regular-season
 * compact summaries so regular-season statistics remain frozen for awards.
 * Each summary carries the matchup identity (phase, round, series, game
 * number, conference, teams), the result (winner, score, forfeit status),
 * player statistics (compact lines), rotation evidence, injury results, and
 * a deterministic result digest computed over the recorded facts.
 */

/** One side's compact rotation evidence for a postseason game. */
export const seasonPostseasonRotationEvidenceSchema = z.object({
  /** Distinct players that appeared (0 for forfeits). */
  playersUsed: z.number().int().min(0).max(10),
  /** Recorded substitution events (0 for forfeits). */
  substitutions: z.number().int().min(0),
});
export type SeasonPostseasonRotationEvidence = z.infer<
  typeof seasonPostseasonRotationEvidenceSchema
>;

export const seasonPostseasonPhaseSchema = z.enum(['play-in', 'playoffs']);
export type SeasonPostseasonPhase = z.infer<typeof seasonPostseasonPhaseSchema>;

/** Play-In matchup for play-in games; playoff round for playoff games. */
export const seasonPostseasonRoundSchema = z.union([playInMatchupIdSchema, playoffRoundSchema]);
export type SeasonPostseasonRound = z.infer<typeof seasonPostseasonRoundSchema>;

/** True when the round value belongs to the Play-In. */
export function postseasonRoundIsPlayIn(round: SeasonPostseasonRound): boolean {
  return round === 'seven-eight' || round === 'nine-ten' || round === 'final';
}

/**
 * Compact summary of one completed postseason game. A forfeited game's
 * official result is 2-0, its boxes are zeros, and its player arrays and
 * rotation evidence are empty; the forfeit loser is named explicitly.
 */
export const seasonPostseasonSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    summaryVersion: z.literal(SEASON_POSTSEASON_SUMMARY_VERSION),
    runId: z.string().min(1).max(64),
    /** Stable `pi-...` (Play-In) or `po-...` (playoffs) game id. */
    gameId: postseasonGameIdSchema,
    phase: seasonPostseasonPhaseSchema,
    round: seasonPostseasonRoundSchema,
    /** Series id for playoff games; null for Play-In games. */
    seriesId: z.string().min(1).max(64).nullable(),
    gameNumber: z.number().int().min(1).max(7),
    conference: conferenceIdSchema,
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    winnerFranchiseId: franchiseIdSchema,
    loserFranchiseId: franchiseIdSchema,
    status: z.enum(['final', 'forfeit']),
    homeScore: z.number().int().nonnegative(),
    awayScore: z.number().int().nonnegative(),
    /** Only on forfeits: the team that failed to field five legal players. */
    forfeitLoserFranchiseId: franchiseIdSchema.nullable(),
    homeBox: seasonTeamBoxSchema,
    awayBox: seasonTeamBoxSchema,
    /** Exactly 10 lines for final games; empty for forfeits. */
    homePlayers: z.array(seasonCompactPlayerLineSchema),
    awayPlayers: z.array(seasonCompactPlayerLineSchema),
    rotationEvidence: z.object({
      home: seasonPostseasonRotationEvidenceSchema,
      away: seasonPostseasonRotationEvidenceSchema,
    }),
    /** Compact per-game injury events (empty when none). */
    injuryEvents: z.array(seasonCompactInjuryEventSchema),
    /**
     * Canonical 32-hex digest of the recorded facts (self-excluded); a pure
     * function of the summary's facts, so reload, replay, and export agree.
     */
    resultDigest: seasonCheckpointDigestSchema,
  })
  .superRefine((summary, ctx) => {
    const teams = [summary.homeFranchiseId, summary.awayFranchiseId];
    if (summary.homeFranchiseId === summary.awayFranchiseId) {
      ctx.addIssue({ code: 'custom', message: 'postseason game cannot pair a team with itself' });
    }
    if (summary.winnerFranchiseId === summary.loserFranchiseId) {
      ctx.addIssue({ code: 'custom', message: 'winner and loser must differ' });
    }
    if (!teams.includes(summary.winnerFranchiseId)) {
      ctx.addIssue({ code: 'custom', message: 'winner must be a participant' });
    }
    if (!teams.includes(summary.loserFranchiseId)) {
      ctx.addIssue({ code: 'custom', message: 'loser must be a participant' });
    }
    if (summary.phase === 'play-in') {
      if (summary.seriesId !== null) {
        ctx.addIssue({ code: 'custom', message: 'play-in summary must not carry a series id' });
      }
      if (summary.gameNumber !== 1) {
        ctx.addIssue({ code: 'custom', message: 'play-in summary game number must be 1' });
      }
      if (!postseasonRoundIsPlayIn(summary.round)) {
        ctx.addIssue({ code: 'custom', message: 'play-in summary must carry a play-in matchup' });
      }
    } else {
      if (summary.seriesId === null) {
        ctx.addIssue({ code: 'custom', message: 'playoff summary must carry a series id' });
      }
      if (postseasonRoundIsPlayIn(summary.round)) {
        ctx.addIssue({ code: 'custom', message: 'playoff summary must carry a playoff round' });
      }
    }
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
      if (summary.homePlayers.length !== 0 || summary.awayPlayers.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no player statistics' });
      }
      if (summary.rotationEvidence.home.substitutions !== 0) {
        ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no substitutions' });
      }
    } else {
      if (summary.forfeitLoserFranchiseId !== null) {
        ctx.addIssue({ code: 'custom', message: 'final summary must not carry a forfeit loser' });
      }
      if (summary.homePlayers.length !== 10 || summary.awayPlayers.length !== 10) {
        ctx.addIssue({ code: 'custom', message: 'final summary must carry 10 lines per side' });
      }
      if (summary.homeScore === summary.awayScore) {
        ctx.addIssue({ code: 'custom', message: 'final postseason game cannot be tied' });
      }
      const homeWon = summary.homeScore > summary.awayScore;
      if (
        (homeWon && summary.winnerFranchiseId !== summary.homeFranchiseId) ||
        (!homeWon && summary.winnerFranchiseId !== summary.awayFranchiseId)
      ) {
        ctx.addIssue({ code: 'custom', message: 'winner must match the score' });
      }
    }
  });
export type SeasonPostseasonSummary = z.infer<typeof seasonPostseasonSummarySchema>;

/**
 * The digest material of a postseason summary: every recorded fact except
 * the `resultDigest` field itself.
 */
export function seasonPostseasonSummaryFacts(summary: SeasonPostseasonSummary): unknown {
  const facts: Record<string, unknown> = { ...summary };
  delete facts.resultDigest;
  return facts;
}

/** Canonical 32-hex digest of a postseason summary's recorded facts. */
export function seasonPostseasonSummaryDigest(summary: SeasonPostseasonSummary): string {
  return seasonDigestHex(canonicalJson(seasonPostseasonSummaryFacts(summary)));
}

/** Bounds one postseason round label to its schema. */
export function seasonPostseasonRoundLabel(round: SeasonPostseasonRound): string {
  if (postseasonRoundIsPlayIn(round)) {
    return `play-in ${round.replace('-', ' vs ')}`;
  }
  return round;
}

export type { PlayInMatchupId, PlayoffRound };
