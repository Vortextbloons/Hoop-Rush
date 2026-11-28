import type { MadeAttempted, PlayerBoxScore } from '@hoop-rush/data-contracts';

/**
 * Individual stat-line achievement evaluation.
 *
 * Facts are completed-game player lines and completed-season player totals.
 * Havoc is excluded here because its mutations can inflate counting stats; the
 * caller still passes the mode so eligibility stays explicit.
 */

export const INDIVIDUAL_ACHIEVEMENT_IDS = [
  'the-hakeem-special',
  'the-ak-47',
  'board-man-gets-paid',
  'the-klay-thompson-experience',
  'agent-zero',
  'the-point-god',
  'the-glove',
  'the-human-highlight-film',
  'logo-lillard',
  'the-rodman-paradox',
  'the-jokers-masterpiece',
  'the-moses-malone-special',
  'the-quiet-superstar',
  'kobes-revenge',
  'wilt-was-here',
] as const;

export type IndividualAchievementId = (typeof INDIVIDUAL_ACHIEVEMENT_IDS)[number];

export type IndividualAchievementMode =
  'classic' | 'sandbox' | 'cap-rush' | 'full-court' | 'multiplayer' | 'havoc';

export interface IndividualAchievement {
  id: IndividualAchievementId;
  evidence: string;
}

export interface IndividualGamePlayerLine {
  playerId: string;
  displayName: string | null;
  points: number;
  rebounds: { total: number; offensive: number };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fieldGoals: MadeAttempted;
  threes: MadeAttempted;
  /** Made shots in the rim zone. Absent when the mode does not record shot zones. */
  rim?: MadeAttempted;
}

export interface IndividualGameFacts {
  mode: IndividualAchievementMode;
  players: readonly IndividualGamePlayerLine[];
}

export interface IndividualSeasonPlayerFacts {
  playerId: string;
  displayName: string;
  gamesPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  fieldGoals: MadeAttempted;
}

export interface IndividualSeasonFacts {
  mode: IndividualAchievementMode;
  players: readonly IndividualSeasonPlayerFacts[];
}

/**
 * Modes where individual stat-line records are trusted. Cap Rush and Havoc are
 * intentionally absent: both can apply mutations that inflate counting stats.
 * Full Court is standard-sim but does not yet award profile achievements.
 */
const CORE_MODES: readonly IndividualAchievementMode[] = ['classic', 'sandbox', 'multiplayer'];

const MODE_ELIGIBILITY: Record<IndividualAchievementId, readonly IndividualAchievementMode[]> = {
  'the-hakeem-special': CORE_MODES,
  'the-ak-47': CORE_MODES,
  'board-man-gets-paid': CORE_MODES,
  'the-klay-thompson-experience': CORE_MODES,
  'agent-zero': CORE_MODES,
  'the-point-god': CORE_MODES,
  'the-glove': CORE_MODES,
  'the-human-highlight-film': CORE_MODES,
  'logo-lillard': CORE_MODES,
  'the-rodman-paradox': CORE_MODES,
  'the-jokers-masterpiece': CORE_MODES,
  'the-moses-malone-special': CORE_MODES,
  'the-quiet-superstar': CORE_MODES,
  'kobes-revenge': CORE_MODES,
  'wilt-was-here': CORE_MODES,
};

function isEligible(id: IndividualAchievementId, mode: IndividualAchievementMode): boolean {
  return MODE_ELIGIBILITY[id].includes(mode);
}

export function individualGameLineFromBoxScore(
  line: PlayerBoxScore,
  displayName: string | null,
): IndividualGamePlayerLine {
  const rim = line.diagnostics?.shotZones.find((zone) => zone.zone === 'rim');
  return {
    playerId: line.playerId,
    displayName,
    points: line.points,
    rebounds: line.rebounds,
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
    turnovers: line.turnovers,
    fieldGoals: line.fieldGoals,
    threes: line.threes,
    ...(rim === undefined ? {} : { rim: { made: rim.makes, attempted: rim.attempts } }),
  };
}

function playerLabel(line: { playerId: string; displayName: string | null }): string {
  const name = line.displayName?.trim();
  return name !== undefined && name.length > 0 ? name : line.playerId;
}

function decimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function perGame(total: number, games: number): number {
  return games > 0 ? total / games : 0;
}

function doubleDigitStats(line: IndividualGamePlayerLine): {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
} {
  return {
    points: line.points,
    rebounds: line.rebounds.total,
    assists: line.assists,
    steals: line.steals,
    blocks: line.blocks,
  };
}

function doubleDigitCount(line: IndividualGamePlayerLine): number {
  return Object.values(doubleDigitStats(line)).filter((value) => value >= 10).length;
}

function statLine(line: IndividualGamePlayerLine): string {
  return (
    `${String(line.points)} PTS / ${String(line.rebounds.total)} REB / ` +
    `${String(line.assists)} AST / ${String(line.steals)} STL / ${String(line.blocks)} BLK`
  );
}

export function evaluateIndividualGameAchievements(
  facts: IndividualGameFacts,
): IndividualAchievement[] {
  const unlocks: IndividualAchievement[] = [];
  const add = (id: IndividualAchievementId, evidence: string): void => {
    if (isEligible(id, facts.mode)) unlocks.push({ id, evidence });
  };

  for (const line of facts.players) {
    const name = playerLabel(line);

    if (doubleDigitCount(line) >= 4) {
      add('the-hakeem-special', `${name}: ${statLine(line)}`);
    }

    if (
      line.points >= 5 &&
      line.rebounds.total >= 5 &&
      line.assists >= 5 &&
      line.steals >= 5 &&
      line.blocks >= 5
    ) {
      add('the-ak-47', `${name}: ${statLine(line)}`);
    }

    if (line.rebounds.total >= 30) {
      add('board-man-gets-paid', `${name}: ${String(line.rebounds.total)} rebounds`);
    }

    if (line.points >= 40 && line.assists <= 1 && line.turnovers <= 1) {
      add(
        'the-klay-thompson-experience',
        `${name}: ${String(line.points)} PTS with ${String(line.assists)} AST and ${String(line.turnovers)} TOV`,
      );
    }

    if (line.points >= 50 && line.turnovers === 0) {
      add('agent-zero', `${name}: ${String(line.points)} PTS with zero turnovers`);
    }

    if (line.assists >= 20 && line.turnovers === 0) {
      add('the-point-god', `${name}: ${String(line.assists)} AST with zero turnovers`);
    }

    if (line.steals >= 10) {
      add('the-glove', `${name}: ${String(line.steals)} steals`);
    }

    if (line.rim !== undefined && line.rim.made >= 10) {
      add('the-human-highlight-film', `${name}: ${String(line.rim.made)} made rim shots`);
    }

    if (line.threes.made >= 12) {
      add('logo-lillard', `${name}: ${String(line.threes.made)} three-pointers made`);
    }

    if (line.rebounds.total >= 20 && line.points === 0) {
      add('the-rodman-paradox', `${name}: ${String(line.rebounds.total)} rebounds without scoring`);
    }

    if (
      doubleDigitCount(line) >= 3 &&
      line.fieldGoals.attempted >= 8 &&
      line.fieldGoals.made === line.fieldGoals.attempted
    ) {
      add(
        'the-jokers-masterpiece',
        `${name}: ${statLine(line)} on ${String(line.fieldGoals.made)}-for-${String(line.fieldGoals.attempted)} FG`,
      );
    }

    if (line.rebounds.offensive >= 15) {
      add(
        'the-moses-malone-special',
        `${name}: ${String(line.rebounds.offensive)} offensive rebounds`,
      );
    }

    if (line.points >= 81) {
      add('kobes-revenge', `${name}: ${String(line.points)} points`);
    }

    if (line.points >= 100) {
      add('wilt-was-here', `${name}: ${String(line.points)} points`);
    }
  }

  return unlocks;
}

export function evaluateIndividualSeasonAchievements(
  facts: IndividualSeasonFacts,
): IndividualAchievement[] {
  if (!isEligible('the-quiet-superstar', facts.mode)) return [];
  for (const player of facts.players) {
    if (player.gamesPlayed <= 0) continue;
    const pointsPerGame = perGame(player.points, player.gamesPlayed);
    const reboundsPerGame = perGame(player.rebounds, player.gamesPlayed);
    const assistsPerGame = perGame(player.assists, player.gamesPlayed);
    const doubleDoubles = [pointsPerGame, reboundsPerGame, assistsPerGame].filter(
      (value) => value >= 10,
    ).length;
    if (doubleDoubles < 2) continue;
    const fieldGoalsPerGame = perGame(player.fieldGoals.attempted, player.gamesPlayed);
    if (fieldGoalsPerGame >= 10) continue;
    return [
      {
        id: 'the-quiet-superstar',
        evidence:
          `${playerLabel(player)}: ${decimal(pointsPerGame)} PPG / ` +
          `${decimal(reboundsPerGame)} RPG / ${decimal(assistsPerGame)} APG ` +
          `on ${decimal(fieldGoalsPerGame)} FGA per game`,
      },
    ];
  }
  return [];
}
