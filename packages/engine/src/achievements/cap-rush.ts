import type { CapRushVariant, Position } from '@hoop-rush/data-contracts';
import { POSITIONS } from '@hoop-rush/data-contracts';

/**
 * Pure Cap Rush achievement evaluation.
 *
 * `capRushAchievementFactsFromReport` maps a completed `CapRushReport` plus the
 * locked starting five into the facts below. The evaluator only reads facts and
 * never touches saves, workers, clocks, or RNG.
 */

export const CAP_RUSH_ACHIEVEMENT_IDS = [
  '73-9-hold-my-ring',
  'moneyball',
  'the-dirk-run',
  'going-all-in',
  'the-heatles',
  'we-believe-2-0',
  'the-cardiac-kings',
  'linsanity',
  'detroit-basketball',
  'the-shot',
] as const;

export type CapRushAchievementId = (typeof CAP_RUSH_ACHIEVEMENT_IDS)[number];

export interface CapRushAchievement {
  id: CapRushAchievementId;
  evidence: string;
}

export interface CapRushAchievementPlayer {
  slot: Position;
  playerId: string;
  displayName: string;
  /** Locked pick salary, before any spin purchase. */
  salaryDollars: number;
  /** Regular-season total points from the report's five player lines. */
  points: number;
  /** Pre-mutation original Overall from the locked starter source. */
  originalOverall: number | null;
}

export interface CapRushPlayoffGameFacts {
  gameId: string;
  round: number;
  seriesSlot: number;
  gameOrdinal: number;
  homeTeamId: string;
  awayTeamId: string;
  homePoints: number;
  awayPoints: number;
  winnerTeamId: string;
  userSide: 'home' | 'away' | null;
}

export interface CapRushPlayoffSeriesFacts {
  seriesId: string;
  round: number;
  seriesSlot: number;
  highTeamId: string;
  lowTeamId: string;
  games: readonly CapRushPlayoffGameFacts[];
}

export interface CapRushPostseasonFacts {
  isUserChampion: boolean;
  seed: number | null;
  series: readonly CapRushPlayoffSeriesFacts[];
}

export interface CapRushAchievementFacts {
  variant: CapRushVariant;
  /** Five locked pick salaries, before spin purchases. */
  payrollDollars: number;
  /** Number of purchased Cap Roulette spins (`spin` plus `additionalSpins`). */
  purchasedSpins: number;
  wins: number;
  losses: number;
  players: readonly CapRushAchievementPlayer[];
  postseason: CapRushPostseasonFacts | null;
}

/** The report fields the achievement facts need. `CapRushReport` satisfies this. */
export interface CapRushReportSource {
  variant: CapRushVariant;
  payrollDollars: number;
  spin: { purchase: string } | null;
  additionalSpins?: readonly { purchase: string }[] | undefined;
  aggregate: { wins: number; losses: number };
  players: readonly {
    slot: Position;
    playerId: string;
    displayName: string;
    salaryDollars: number;
    points: number;
  }[];
  postseason?: CapRushPostseasonFacts | null | undefined;
}

/** The locked starter fields the achievement facts need. */
export interface CapRushStarterSource {
  slot: Position;
  source: { originalOverall: number };
}

const MONEYBALL_MAX_PAYROLL_DOLLARS = 80_000_000;
const HEATLES_MIN_PAYROLL_DOLLARS = 115_000_000;
const LINSANITY_MAX_SALARY_DOLLARS = 12_000_000;

function formatDollars(value: number): string {
  const grouped = String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}`;
}

export function capRushAchievementFactsFromReport(
  report: CapRushReportSource,
  starters: readonly CapRushStarterSource[],
): CapRushAchievementFacts {
  const overallBySlot = new Map<Position, number>();
  for (const starter of starters) {
    overallBySlot.set(starter.slot, starter.source.originalOverall);
  }
  return {
    variant: report.variant,
    payrollDollars: report.payrollDollars,
    purchasedSpins: report.spin === null ? 0 : 1 + (report.additionalSpins?.length ?? 0),
    wins: report.aggregate.wins,
    losses: report.aggregate.losses,
    players: report.players.map((player) => ({
      ...player,
      originalOverall: overallBySlot.get(player.slot) ?? null,
    })),
    postseason: report.postseason ?? null,
  };
}

interface UserSeriesRecord {
  series: CapRushPlayoffSeriesFacts;
  userWins: number;
  opponentWins: number;
}

function userTeamIdOf(series: CapRushPlayoffSeriesFacts): string | null {
  for (const game of series.games) {
    if (game.userSide === 'home') return game.homeTeamId;
    if (game.userSide === 'away') return game.awayTeamId;
  }
  return null;
}

function userSeriesRecords(postseason: CapRushPostseasonFacts): UserSeriesRecord[] {
  const records: UserSeriesRecord[] = [];
  for (const series of postseason.series) {
    const userTeamId = userTeamIdOf(series);
    if (userTeamId === null) continue;
    const userWins = series.games.filter((game) => game.winnerTeamId === userTeamId).length;
    records.push({
      series,
      userWins,
      opponentWins: series.games.length - userWins,
    });
  }
  return records;
}

function hasFourDistinctRounds(records: readonly UserSeriesRecord[]): boolean {
  return records.length === 4 && new Set(records.map((record) => record.series.round)).size === 4;
}

function scoringLeaderOf(
  players: readonly CapRushAchievementPlayer[],
): CapRushAchievementPlayer | null {
  const sorted = [...players].sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points;
    const slotOrder = POSITIONS.indexOf(left.slot) - POSITIONS.indexOf(right.slot);
    if (slotOrder !== 0) return slotOrder;
    return left.playerId < right.playerId ? -1 : left.playerId > right.playerId ? 1 : 0;
  });
  return sorted[0] ?? null;
}

interface FinalsGameSeven {
  userPoints: number;
  opponentPoints: number;
}

function finalsGameSevenOf(postseason: CapRushPostseasonFacts): FinalsGameSeven | null {
  for (const series of postseason.series) {
    if (series.round !== 4) continue;
    const userTeamId = userTeamIdOf(series);
    if (userTeamId === null) continue;
    for (const game of series.games) {
      if (game.gameOrdinal !== 7 || game.userSide === null) continue;
      return {
        userPoints: game.userSide === 'home' ? game.homePoints : game.awayPoints,
        opponentPoints: game.userSide === 'home' ? game.awayPoints : game.homePoints,
      };
    }
  }
  return null;
}

export function evaluateCapRushAchievements(facts: CapRushAchievementFacts): CapRushAchievement[] {
  const unlocks: CapRushAchievement[] = [];
  const postseason = facts.postseason;
  const champion = postseason?.isUserChampion === true;
  const records = postseason === null ? [] : userSeriesRecords(postseason);
  const fourSeries = hasFourDistinctRounds(records);
  const playoffSweep =
    fourSeries && records.every((record) => record.userWins === 4 && record.opponentWins === 0);

  if (champion && facts.wins + facts.losses === 82 && facts.wins >= 74 && playoffSweep) {
    unlocks.push({
      id: '73-9-hold-my-ring',
      evidence: `${String(facts.wins)}-${String(facts.losses)} season with a 16-0 playoff sweep`,
    });
  }

  if (champion && facts.payrollDollars <= MONEYBALL_MAX_PAYROLL_DOLLARS) {
    unlocks.push({
      id: 'moneyball',
      evidence: `Won the title with a ${formatDollars(facts.payrollDollars)} starting-five payroll`,
    });
  }

  if (champion && facts.variant === 'roulette' && facts.purchasedSpins === 0) {
    unlocks.push({
      id: 'the-dirk-run',
      evidence: 'Won the Cap Roulette title without purchasing a spin',
    });
  }

  if (champion && facts.purchasedSpins >= 2) {
    unlocks.push({
      id: 'going-all-in',
      evidence: `Won the title after purchasing ${String(facts.purchasedSpins)} spins`,
    });
  }

  if (champion && facts.payrollDollars >= HEATLES_MIN_PAYROLL_DOLLARS) {
    unlocks.push({
      id: 'the-heatles',
      evidence: `Won the title with a ${formatDollars(facts.payrollDollars)} starting-five payroll`,
    });
  }

  if (
    postseason !== null &&
    postseason.isUserChampion &&
    (postseason.seed === 7 || postseason.seed === 8)
  ) {
    unlocks.push({
      id: 'we-believe-2-0',
      evidence: `Won the title as the ${String(postseason.seed)} seed`,
    });
  }

  if (
    champion &&
    fourSeries &&
    records.every((record) => record.userWins === 4 && record.opponentWins === 3)
  ) {
    unlocks.push({
      id: 'the-cardiac-kings',
      evidence: 'Won all four playoff series in seven games',
    });
  }

  const scoringLeader = scoringLeaderOf(facts.players);
  if (
    champion &&
    scoringLeader !== null &&
    scoringLeader.salaryDollars <= LINSANITY_MAX_SALARY_DOLLARS
  ) {
    unlocks.push({
      id: 'linsanity',
      evidence:
        `${scoringLeader.displayName} led the team with ${String(scoringLeader.points)} points ` +
        `on a ${formatDollars(scoringLeader.salaryDollars)} salary`,
    });
  }

  const fivePlayers = facts.players.length === 5;
  const distinctSlots = new Set(facts.players.map((player) => player.slot)).size === 5;
  const overalls = facts.players.map((player) => player.originalOverall);
  if (
    champion &&
    fivePlayers &&
    distinctSlots &&
    overalls.every((overall): overall is number => overall !== null) &&
    overalls.every((overall) => overall < 90)
  ) {
    unlocks.push({
      id: 'detroit-basketball',
      evidence: `Won the title with no 90+ OVR starter (highest ${String(Math.max(...overalls))})`,
    });
  }

  const finalsGameSeven = postseason === null ? null : finalsGameSevenOf(postseason);
  if (
    champion &&
    finalsGameSeven !== null &&
    finalsGameSeven.userPoints - finalsGameSeven.opponentPoints === 1
  ) {
    unlocks.push({
      id: 'the-shot',
      evidence: `Won Finals Game 7 ${String(finalsGameSeven.userPoints)}-${String(finalsGameSeven.opponentPoints)}`,
    });
  }

  return unlocks;
}
