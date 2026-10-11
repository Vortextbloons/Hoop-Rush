import type { LeaguePlayerTotals, PlayerBoxScore } from '@hoop-rush/data-contracts';
import { franchiseIdSchema, playerIdSchema } from '@hoop-rush/data-contracts';

const DEFENSE_WEIGHTS = {
  steal: 0.6,
  block: 0.6,
  defensiveRebound: 0.15,
  contestedShot: 0.04,
} as const;
const PLAYMAKING_WEIGHTS = {
  assist: 0.5,
  assistOpportunity: 0.25,
} as const;
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;

export function shotsUsed(box: PlayerBoxScore): number {
  return box.fieldGoals.attempted + 0.44 * box.freeThrows.attempted;
}

export function trueShooting(box: PlayerBoxScore): number {
  const shots = shotsUsed(box);
  return shots <= 0 ? 0 : box.points / (2 * shots);
}

export function gameScore(box: PlayerBoxScore): number {
  return (
    box.points +
    0.4 * box.fieldGoals.made -
    0.7 * box.fieldGoals.attempted -
    0.4 * (box.freeThrows.attempted - box.freeThrows.made) +
    0.7 * box.rebounds.offensive +
    0.3 * box.rebounds.defensive +
    box.steals +
    0.7 * box.assists +
    0.7 * box.blocks -
    0.4 * box.fouls -
    box.turnovers
  );
}

export function mvpValue(box: PlayerBoxScore, baselineTs: number, won: boolean): number {
  const diagnostics = box.diagnostics;
  return (
    gameScore(box) +
    (trueShooting(box) - baselineTs) * shotsUsed(box) +
    DEFENSE_WEIGHTS.steal * box.steals +
    DEFENSE_WEIGHTS.block * box.blocks +
    DEFENSE_WEIGHTS.defensiveRebound * box.rebounds.defensive +
    (diagnostics ? DEFENSE_WEIGHTS.contestedShot * diagnostics.contestedShots : 0) +
    PLAYMAKING_WEIGHTS.assist * box.assists +
    (diagnostics ? PLAYMAKING_WEIGHTS.assistOpportunity * diagnostics.assistOpportunities : 0) +
    (won ? TEAM_BONUS.win : TEAM_BONUS.loss)
  );
}

export function emptyLeaguePlayerTotals(teamId: string, playerId: string): LeaguePlayerTotals {
  return {
    playerId: playerIdSchema.parse(playerId),
    teamId: franchiseIdSchema.parse(teamId),
    games: 0,
    totalValueBase: 0,
    totalValueBaseSquared: 0,
    totalShots: 0,
    totalShotsSquared: 0,
    totalValueShots: 0,
    totalPoints: 0,
    totalRebounds: 0,
    totalAssists: 0,
    totalSteals: 0,
    totalBlocks: 0,
    totalGameScore: 0,
    totalTrueShooting: 0,
  };
}

export function accumulateLeagueAppearance(
  totals: LeaguePlayerTotals,
  box: PlayerBoxScore,
  won: boolean,
): void {
  const shots = shotsUsed(box);
  const valueBase = mvpValue(box, 0, won);
  totals.games += 1;
  totals.totalValueBase += valueBase;
  totals.totalValueBaseSquared += valueBase * valueBase;
  totals.totalShots += shots;
  totals.totalShotsSquared += shots * shots;
  totals.totalValueShots += valueBase * shots;
  totals.totalPoints += box.points;
  totals.totalRebounds += box.rebounds.total;
  totals.totalAssists += box.assists;
  totals.totalSteals += box.steals;
  totals.totalBlocks += box.blocks;
  totals.totalGameScore += gameScore(box);
  totals.totalTrueShooting += trueShooting(box);
}
