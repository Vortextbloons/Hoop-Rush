import type {
  FullCourtPlayoffAdaptation,
  FullCourtPlayoffEvidence,
  FullCourtPlayoffMatchupAdaptations,
  FullCourtPlayoffScore,
  FullCourtPlayoffSideEvidence,
} from '@hoop-rush/data-contracts';
import type { FullCourtGameResult, FullCourtTeamResult } from './game.ts';

export const FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAMES = 2;
export const FULL_COURT_PLAYOFF_ADAPTATION_WINDOW_GAMES = 2;
export const FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_FGA = 20;
export const FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_USAGE_CENTIS = 2_000;
export const FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS = 4_600;
export const FULL_COURT_INSIDE_SCORING_GAME_FLOOR_BPS = 4_200;
export const FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS = 2_600;
export const FULL_COURT_OPPORTUNITY_CONCENTRATION_GAME_FLOOR_BPS = 2_400;

interface WindowSample {
  readonly fieldGoalAttempts: number;
  readonly rimAttempts: number;
  readonly leadUsageCentis: number;
  readonly teamUsageCentis: number;
  readonly rimShareBps: number;
  readonly usageShareBps: number;
}

function teamSideEvidence(team: FullCourtTeamResult): FullCourtPlayoffSideEvidence | undefined {
  const fieldGoalAttempts = team.box.fieldGoals.attempted;
  const teamUsageCentis =
    100 * fieldGoalAttempts + 44 * team.box.freeThrows.attempted + 100 * team.box.turnovers;
  if (fieldGoalAttempts <= 0 || teamUsageCentis <= 0) return undefined;
  let rimAttempts = 0;
  const usageByOwner = new Map<string, number>();
  for (const player of team.players) {
    const rim = player.diagnostics.shotZones.find((entry) => entry.zone === 'rim')?.attempts ?? 0;
    rimAttempts += rim;
    const ownerId = player.ownerPlayerId ?? player.playerId;
    const usageCentis =
      100 * player.fieldGoals.attempted + 44 * player.freeThrows.attempted + 100 * player.turnovers;
    usageByOwner.set(ownerId, (usageByOwner.get(ownerId) ?? 0) + usageCentis);
  }
  const leadUsageCentis = Math.max(0, ...usageByOwner.values());
  return {
    fieldGoalAttempts,
    rimAttempts: Math.min(rimAttempts, fieldGoalAttempts),
    leadUsageCentis: Math.min(leadUsageCentis, teamUsageCentis),
    teamUsageCentis,
  };
}

export function fullCourtPlayoffGameEvidence(
  result: FullCourtGameResult,
): FullCourtPlayoffEvidence | undefined {
  const home = teamSideEvidence(result.home);
  const away = teamSideEvidence(result.away);
  if (home === undefined || away === undefined) return undefined;
  return { home, away };
}

function shareBps(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000);
}

function validOpponentSamples(
  seriesGames: readonly FullCourtPlayoffScore[],
  adaptingTeamId: string,
  opponentTeamId: string,
): WindowSample[] {
  const samples: WindowSample[] = [];
  for (const game of seriesGames) {
    if (game.outcome.kind !== 'played' || game.evidence === undefined) continue;
    const isMatchup =
      (game.homeTeamId === adaptingTeamId && game.awayTeamId === opponentTeamId) ||
      (game.homeTeamId === opponentTeamId && game.awayTeamId === adaptingTeamId);
    if (!isMatchup) continue;
    const opponentSide =
      game.homeTeamId === opponentTeamId ? game.evidence.home : game.evidence.away;
    if (
      opponentSide.fieldGoalAttempts < FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_FGA ||
      opponentSide.teamUsageCentis < FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAME_USAGE_CENTIS
    ) {
      continue;
    }
    samples.push({
      ...opponentSide,
      rimShareBps: shareBps(opponentSide.rimAttempts, opponentSide.fieldGoalAttempts),
      usageShareBps: shareBps(opponentSide.leadUsageCentis, opponentSide.teamUsageCentis),
    });
  }
  return samples;
}

export function fullCourtPlayoffSeriesEvidenceCount(
  seriesGames: readonly FullCourtPlayoffScore[],
  adaptingTeamId: string,
  opponentTeamId: string,
): number {
  return validOpponentSamples(seriesGames, adaptingTeamId, opponentTeamId).length;
}

export function fullCourtPlayoffAdaptationForTeam(input: {
  readonly seriesGames: readonly FullCourtPlayoffScore[];
  readonly adaptingTeamId: string;
  readonly opponentTeamId: string;
  readonly userTeamId: string;
}): FullCourtPlayoffAdaptation | undefined {
  if (input.adaptingTeamId === input.userTeamId) return undefined;
  const samples = validOpponentSamples(
    input.seriesGames,
    input.adaptingTeamId,
    input.opponentTeamId,
  );
  if (samples.length < FULL_COURT_PLAYOFF_ADAPTATION_MIN_GAMES) return undefined;

  // Fixed two-game decision windows: samples [0..1] govern games 3-4, [2..3] govern games 5-6,
  // and [4..5] govern game 7 so an AI coach never oscillates on a single noisy box score.
  const windowSize = FULL_COURT_PLAYOFF_ADAPTATION_WINDOW_GAMES;
  const windowStart = Math.floor(samples.length / windowSize) * windowSize - windowSize;
  const window = samples.slice(windowStart, windowStart + windowSize);

  const totalRim = window.reduce((sum, entry) => sum + entry.rimAttempts, 0);
  const totalFga = window.reduce((sum, entry) => sum + entry.fieldGoalAttempts, 0);
  const totalLeadUsage = window.reduce((sum, entry) => sum + entry.leadUsageCentis, 0);
  const totalTeamUsage = window.reduce((sum, entry) => sum + entry.teamUsageCentis, 0);

  const rimWindowBps = shareBps(totalRim, totalFga);
  const usageWindowBps = shareBps(totalLeadUsage, totalTeamUsage);

  const insideTriggered =
    rimWindowBps >= FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS &&
    window.every((entry) => entry.rimShareBps >= FULL_COURT_INSIDE_SCORING_GAME_FLOOR_BPS);
  const concentrationTriggered =
    usageWindowBps >= FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS &&
    window.every(
      (entry) => entry.usageShareBps >= FULL_COURT_OPPORTUNITY_CONCENTRATION_GAME_FLOOR_BPS,
    );

  if (!insideTriggered && !concentrationTriggered) return undefined;

  const insideExcess = insideTriggered
    ? rimWindowBps - FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS
    : -1;
  const concentrationExcess = concentrationTriggered
    ? usageWindowBps - FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS
    : -1;

  if (insideExcess >= concentrationExcess) {
    return {
      defense: 'protect-paint',
      reason: 'persistent-inside-scoring',
      sampleGames: window.length,
      windowGames: windowSize,
      observedShareBps: rimWindowBps,
      thresholdShareBps: FULL_COURT_INSIDE_SCORING_THRESHOLD_BPS,
    };
  }
  return {
    defense: 'pressure',
    reason: 'persistent-opportunity-concentration',
    sampleGames: window.length,
    windowGames: windowSize,
    observedShareBps: usageWindowBps,
    thresholdShareBps: FULL_COURT_OPPORTUNITY_CONCENTRATION_THRESHOLD_BPS,
  };
}

export function fullCourtPlayoffMatchupAdaptations(input: {
  readonly seriesGames: readonly FullCourtPlayoffScore[];
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly userTeamId: string;
}): FullCourtPlayoffMatchupAdaptations | undefined {
  const home = fullCourtPlayoffAdaptationForTeam({
    seriesGames: input.seriesGames,
    adaptingTeamId: input.homeTeamId,
    opponentTeamId: input.awayTeamId,
    userTeamId: input.userTeamId,
  });
  const away = fullCourtPlayoffAdaptationForTeam({
    seriesGames: input.seriesGames,
    adaptingTeamId: input.awayTeamId,
    opponentTeamId: input.homeTeamId,
    userTeamId: input.userTeamId,
  });
  if (home === undefined && away === undefined) return undefined;
  return {
    ...(home === undefined ? {} : { home }),
    ...(away === undefined ? {} : { away }),
  };
}

function sameSideAdaptation(
  left: FullCourtPlayoffAdaptation | undefined,
  right: FullCourtPlayoffAdaptation | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.defense === right.defense &&
    left.reason === right.reason &&
    left.sampleGames === right.sampleGames &&
    left.windowGames === right.windowGames &&
    left.observedShareBps === right.observedShareBps &&
    left.thresholdShareBps === right.thresholdShareBps
  );
}

export function fullCourtPlayoffAdaptationsEqual(
  left: FullCourtPlayoffMatchupAdaptations | undefined,
  right: FullCourtPlayoffMatchupAdaptations | undefined,
): boolean {
  return sameSideAdaptation(left?.home, right?.home) && sameSideAdaptation(left?.away, right?.away);
}
