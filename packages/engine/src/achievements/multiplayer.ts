/**
 * Pure multiplayer achievement evaluation. Callers supply finished-room facts;
 * this module never reads saves, clocks, RNG, or display names.
 */

export type MultiplayerSeatId = 'p1' | 'p2';

export const MULTIPLAYER_ACHIEVEMENT_IDS = [
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
] as const;

export type MultiplayerAchievementId = (typeof MULTIPLAYER_ACHIEVEMENT_IDS)[number];

export interface MultiplayerAchievement {
  id: MultiplayerAchievementId;
  evidence: string;
}

export interface SeriesGameFact {
  /** 1-based game number inside the best-of-seven series. */
  gameNumber: number;
  winner: MultiplayerSeatId;
  homeScore: number;
  awayScore: number;
}

/** A rematch link captured only from explicit room commands, never inferred. */
export interface ExplicitRematchFact {
  previousSeriesId: string;
  /** Result of the prior series for the evaluated participant. */
  previousOutcome: 'won' | 'lost';
  /** Stable opposing-player identity; never a display name. */
  previousOpponentPlayerId: string;
  /** Both seats explicitly requested and confirmed the rematch. */
  accepted: boolean;
}

export interface SeriesAchievementFacts {
  seriesId: string;
  participantId: MultiplayerSeatId;
  games: readonly SeriesGameFact[];
  /** Average original OVR of each five before mode modifiers. */
  averageOriginalOverall: Readonly<Record<MultiplayerSeatId, number>>;
  /** Stable opposing-player identity when the room recorded one; never a display name. */
  opponentPlayerId?: string;
  rematch?: ExplicitRematchFact | null;
}

export interface SharedSeasonAchievementFacts {
  wins: number;
  losses: number;
  /** The shared season was played with another human player. */
  sharedWithHuman: boolean;
}

export interface CapRushHeadToHeadGameFact {
  gameId: string;
  winnerSeat: MultiplayerSeatId;
}

export interface CapRushFinalsFact {
  participantTeamId: string;
  rivalTeamId: string;
  winnerTeamId: string;
}

export interface CapRushMultiplayerAchievementFacts {
  participantId: MultiplayerSeatId;
  rivalId: MultiplayerSeatId;
  championSeat: MultiplayerSeatId | null;
  payrollDollars: Readonly<Record<MultiplayerSeatId, number>>;
  headToHead: readonly CapRushHeadToHeadGameFact[];
  finals: CapRushFinalsFact | null;
}

export type MultiplayerAchievementFacts =
  | { kind: 'series'; series: SeriesAchievementFacts }
  | { kind: 'shared-season'; season: SharedSeasonAchievementFacts }
  | { kind: 'cap-rush'; capRush: CapRushMultiplayerAchievementFacts };

const UPSET_OVR_GAP = 6;
// Averages can be fractional, so an exact gap can land just below six in
// binary floating point.
const AVERAGE_COMPARISON_EPSILON = 1e-9;
const MONEYBALL_PAYROLL_GAP_DOLLARS = 20_000_000;

function otherSeat(seat: MultiplayerSeatId): MultiplayerSeatId {
  return seat === 'p1' ? 'p2' : 'p1';
}

interface CompletedSeries {
  participantWins: number;
  opponentWins: number;
  opponentId: MultiplayerSeatId;
}

function completedSeries(facts: SeriesAchievementFacts): CompletedSeries | null {
  const games = facts.games;
  if (games.length < 4 || games.length > 7) return null;
  let p1Wins = 0;
  let p2Wins = 0;
  for (let index = 0; index < games.length; index += 1) {
    const game = games[index];
    if (game === undefined || game.gameNumber !== index + 1) return null;
    if (game.winner === 'p1') p1Wins += 1;
    else p2Wins += 1;
    const isLast = index === games.length - 1;
    if (!isLast && (p1Wins === 4 || p2Wins === 4)) return null;
  }
  if (p1Wins !== 4 && p2Wins !== 4) return null;
  const participantWins = facts.participantId === 'p1' ? p1Wins : p2Wins;
  if (participantWins !== 4) return null;
  return {
    participantWins,
    opponentWins: facts.participantId === 'p1' ? p2Wins : p1Wins,
    opponentId: otherSeat(facts.participantId),
  };
}

function winsThroughGame(
  facts: SeriesAchievementFacts,
  throughGame: number,
): { participantWins: number; opponentWins: number } {
  let p1Wins = 0;
  let p2Wins = 0;
  for (const game of facts.games) {
    if (game.gameNumber > throughGame) break;
    if (game.winner === 'p1') p1Wins += 1;
    else p2Wins += 1;
  }
  return {
    participantWins: facts.participantId === 'p1' ? p1Wins : p2Wins,
    opponentWins: facts.participantId === 'p1' ? p2Wins : p1Wins,
  };
}

function formatDollars(value: number): string {
  const grouped = String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}`;
}

export function evaluateSeriesAchievements(
  facts: SeriesAchievementFacts,
): MultiplayerAchievement[] {
  const series = completedSeries(facts);
  if (series === null) return [];
  const achievements: MultiplayerAchievement[] = [];
  const afterThree = winsThroughGame(facts, 3);
  const afterFour = winsThroughGame(facts, 4);

  if (afterFour.participantWins === 1 && afterFour.opponentWins === 3) {
    achievements.push({
      id: 'cleveland-this-is-for-you',
      evidence: 'Came back from 1–3 to win 4–3',
    });
  }
  if (
    series.opponentWins === 3 &&
    afterThree.participantWins === 0 &&
    afterThree.opponentWins === 3
  ) {
    achievements.push({
      id: 'the-reverse-sweep',
      evidence: 'Won four straight after falling behind 0–3',
    });
  }
  if (series.opponentWins === 0) {
    achievements.push({
      id: 'bring-out-the-brooms',
      evidence: 'Swept the series 4–0',
    });
  }

  const finalGame = facts.games[facts.games.length - 1];
  const afterSix = winsThroughGame(facts, 6);
  if (
    facts.games.length === 7 &&
    finalGame !== undefined &&
    finalGame.winner === facts.participantId &&
    afterSix.participantWins === 3 &&
    afterSix.opponentWins === 3 &&
    Number.isFinite(finalGame.homeScore) &&
    Number.isFinite(finalGame.awayScore) &&
    Math.abs(finalGame.homeScore - finalGame.awayScore) === 1
  ) {
    achievements.push({
      id: 'dame-time',
      evidence:
        `Won Game 7 by one point ` +
        `(${String(finalGame.homeScore)}-${String(finalGame.awayScore)})`,
    });
  }

  const participantOverall = facts.averageOriginalOverall[facts.participantId];
  const opponentOverall = facts.averageOriginalOverall[series.opponentId];
  if (
    Number.isFinite(participantOverall) &&
    Number.isFinite(opponentOverall) &&
    opponentOverall - participantOverall >= UPSET_OVR_GAP - AVERAGE_COMPARISON_EPSILON
  ) {
    achievements.push({
      id: 'upset-of-the-year',
      evidence:
        `Won with a ${String(participantOverall)} average original OVR lineup ` +
        `against ${String(opponentOverall)}`,
    });
  }

  const rematch = facts.rematch;
  const opponentPlayerId = facts.opponentPlayerId;
  if (
    rematch !== undefined &&
    rematch !== null &&
    rematch.accepted &&
    rematch.previousOutcome === 'lost' &&
    rematch.previousSeriesId !== facts.seriesId &&
    opponentPlayerId !== undefined &&
    opponentPlayerId.length > 0 &&
    rematch.previousOpponentPlayerId === opponentPlayerId
  ) {
    achievements.push({
      id: 'the-revenge-tour',
      evidence: 'Won the rematch after dropping the first series',
    });
  }

  return achievements;
}

export function evaluateSharedSeasonAchievements(
  facts: SharedSeasonAchievementFacts,
): MultiplayerAchievement[] {
  if (!facts.sharedWithHuman || facts.wins !== 82 || facts.losses !== 0) return [];
  return [
    {
      id: 'the-splash-brothers',
      evidence: 'Went 82–0 in a shared season',
    },
  ];
}

export function evaluateCapRushMultiplayerAchievements(
  facts: CapRushMultiplayerAchievementFacts,
): MultiplayerAchievement[] {
  if (facts.participantId === facts.rivalId) return [];
  const achievements: MultiplayerAchievement[] = [];
  const participantPayroll = facts.payrollDollars[facts.participantId];
  const rivalPayroll = facts.payrollDollars[facts.rivalId];
  if (
    facts.championSeat === facts.participantId &&
    Number.isFinite(participantPayroll) &&
    participantPayroll >= 0 &&
    Number.isFinite(rivalPayroll) &&
    rivalPayroll >= 0 &&
    rivalPayroll - participantPayroll >= MONEYBALL_PAYROLL_GAP_DOLLARS
  ) {
    const savings = rivalPayroll - participantPayroll;
    achievements.push({
      id: 'moneyball-champions',
      evidence:
        `Won the Cap Rush championship with ${formatDollars(participantPayroll)} payroll ` +
        `against ${formatDollars(rivalPayroll)} (${formatDollars(savings)} less)`,
    });
  }

  const headToHeadIds = new Set(facts.headToHead.map((game) => game.gameId));
  if (
    facts.headToHead.length === 2 &&
    headToHeadIds.size === 2 &&
    facts.headToHead.every(
      (game) => game.gameId.length > 0 && game.winnerSeat === facts.participantId,
    )
  ) {
    achievements.push({
      id: 'season-sweep',
      evidence: 'Won both regular-season matchups against your rival',
    });
  }

  const finals = facts.finals;
  if (
    finals !== null &&
    finals.participantTeamId.length > 0 &&
    finals.rivalTeamId.length > 0 &&
    finals.participantTeamId !== finals.rivalTeamId &&
    finals.winnerTeamId === finals.participantTeamId
  ) {
    achievements.push({
      id: 'the-finals-rematch',
      evidence: 'Beat your rival in the Cap Rush Finals',
    });
  }

  return achievements;
}

export function evaluateMultiplayerAchievements(
  facts: MultiplayerAchievementFacts,
): MultiplayerAchievement[] {
  switch (facts.kind) {
    case 'series':
      return evaluateSeriesAchievements(facts.series);
    case 'shared-season':
      return evaluateSharedSeasonAchievements(facts.season);
    case 'cap-rush':
      return evaluateCapRushMultiplayerAchievements(facts.capRush);
  }
}
