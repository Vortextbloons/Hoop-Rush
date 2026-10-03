import {
  canonicalJson,
  idSchema,
  seasonDigestHex,
  seasonTradeGradeLogSchema,
  type SeasonGameSummary,
  type SeasonPlayerAggregate,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonTeamAggregate,
  type SeasonTradeGrade,
  type SeasonTradeGradeLabel,
  type SeasonTradeGradeLog,
} from '@hoop-rush/data-contracts';
import { foldSeasonPlayerAggregates, foldSeasonTeamAggregates } from './aggregates.ts';

export const SEASON_TRADE_GRADE_MIN_SAMPLE = 5;
export const SEASON_TRADE_GRADE_NEUTRAL_SCORE = 50;
const PRODUCTION_LEVEL_WEIGHT = 0.7;
const PRODUCTION_EDGE_WEIGHT = 0.3;
export const SEASON_TRADE_GRADE_WEIGHTS = {
  production: 0.55,
  availability: 0.15,
  minutes: 0.15,
  trend: 0.15,
} as const;
const MINUTES_FULL_GAME = 48;
const STARTS_FULL_GAME = 5;
const DEFENSE_WEIGHTS = { steal: 0.6, block: 0.6, defensiveRebound: 0.15 } as const;
const PLAYMAKING_ASSIST_WEIGHT = 0.5;
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;
const CONSISTENCY_REFERENCE_EPSILON = 1e-9;
export interface SeasonTradeGradesInput {
  runId: string;
  run: SeasonRun;
  summaries: SeasonGameSummary[];
  postseasonSummaries: SeasonPostseasonSummary[];
}
interface PlayerProduction {
  valueBases: number[];
  efficiencyValues: number[];
  shotsList: number[];
  wins: boolean[];
}
type FoldLine = SeasonGameSummary['homePlayers'][number];
function shotsUsedOf(line: { fieldGoalsAttempted: number; freeThrowsAttempted: number }): number {
  return line.fieldGoalsAttempted + 0.44 * line.freeThrowsAttempted;
}
function trueShootingOf(line: {
  points: number;
  fieldGoalsAttempted: number;
  freeThrowsAttempted: number;
}): number {
  const shots = shotsUsedOf(line);
  return shots <= 0 ? 0 : line.points / (2 * shots);
}
function mvpValueBaseOf(line: {
  points: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  turnovers: number;
}): number {
  const gameScore =
    line.points +
    0.4 * line.fieldGoalsMade -
    0.7 * line.fieldGoalsAttempted -
    0.4 * (line.freeThrowsAttempted - line.freeThrowsMade) +
    0.7 * line.offensiveRebounds +
    0.3 * line.defensiveRebounds +
    line.steals +
    0.7 * line.assists +
    0.7 * line.blocks -
    0.4 * line.fouls -
    line.turnovers;
  return (
    gameScore +
    DEFENSE_WEIGHTS.steal * line.steals +
    DEFENSE_WEIGHTS.block * line.blocks +
    DEFENSE_WEIGHTS.defensiveRebound * line.defensiveRebounds +
    PLAYMAKING_ASSIST_WEIGHT * line.assists
  );
}
function mvpValueOf(row: PlayerProduction, index: number, leagueAverageTs: number): number {
  const valueBase = row.valueBases[index] ?? 0;
  const shots = row.shotsList[index] ?? 0;
  const efficiency = row.efficiencyValues[index] ?? 0;
  const won = row.wins[index] ?? false;
  return (
    valueBase + (efficiency - leagueAverageTs) * shots + (won ? TEAM_BONUS.win : TEAM_BONUS.loss)
  );
}
function asRegularSummary(summary: SeasonPostseasonSummary, index: number): SeasonGameSummary {
  return {
    ...summary,
    schemaVersion: 1,
    summaryVersion: 'season-game-summary-v4',
    gameId: `s${String(90000 + index).padStart(6, '0')}`,
    round: 82,
    overtimePeriods: 0,
    injuryEvents: [],
  } as unknown as SeasonGameSummary;
}
function postTradeSummariesOf(
  summaries: readonly SeasonGameSummary[],
  postseason: readonly SeasonPostseasonSummary[],
  postTradeFirstRound: number,
): SeasonGameSummary[] {
  const regular = summaries.filter((summary) => summary.round >= postTradeFirstRound);
  const adapted = postseason.map((summary, index) => asRegularSummary(summary, index));
  return [...regular, ...adapted];
}
function foldProduction(games: readonly SeasonGameSummary[]): Map<string, PlayerProduction> {
  const players = new Map<string, PlayerProduction>();
  const rowOf = (playerVersionId: string): PlayerProduction => {
    let row = players.get(playerVersionId);
    if (row === undefined) {
      row = { valueBases: [], efficiencyValues: [], shotsList: [], wins: [] };
      players.set(playerVersionId, row);
    }
    return row;
  };
  for (const game of games) {
    const homeWon =
      game.status === 'forfeit'
        ? game.forfeitLoserFranchiseId !== game.homeFranchiseId
        : game.homeScore > game.awayScore;
    if (game.status === 'forfeit') continue;
    const foldLines = (lines: readonly FoldLine[], won: boolean): void => {
      for (const line of lines) {
        if (line.seconds <= 0) continue;
        const row = rowOf(line.playerVersionId);
        row.valueBases.push(mvpValueBaseOf(line));
        row.efficiencyValues.push(trueShootingOf(line));
        row.shotsList.push(shotsUsedOf(line));
        row.wins.push(won);
      }
    };
    foldLines(game.homePlayers, homeWon);
    foldLines(game.awayPlayers, !homeWon);
  }
  return players;
}
function leagueAverageTsOf(production: Map<string, PlayerProduction>): number {
  let points = 0;
  let shots = 0;
  for (const row of production.values()) {
    for (let index = 0; index < row.valueBases.length; index += 1) {
      const lineShots = row.shotsList[index] ?? 0;
      if (lineShots > 0) {
        points += (row.efficiencyValues[index] ?? 0) * 2 * lineShots;
        shots += lineShots;
      }
    }
  }
  return shots > 0 ? points / (2 * shots) : 0.5;
}
function accumulatedProductionOf(
  production: Map<string, PlayerProduction>,
  leagueAverageTs: number,
  playerVersionId: string,
): number {
  const row = production.get(playerVersionId);
  if (row === undefined || row.valueBases.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < row.valueBases.length; index += 1) {
    total += mvpValueOf(row, index, leagueAverageTs);
  }
  return Math.max(0, total);
}
function accumulatedProductionOfSet(
  production: Map<string, PlayerProduction>,
  leagueAverageTs: number,
  playerVersionIds: readonly string[],
): number {
  let total = 0;
  for (const id of playerVersionIds) {
    total += accumulatedProductionOf(production, leagueAverageTs, id);
  }
  return total;
}
function referenceProductionOf(
  production: Map<string, PlayerProduction>,
  leagueAverageTs: number,
): number {
  let best = 0;
  for (const playerVersionId of production.keys()) {
    const value = accumulatedProductionOf(production, leagueAverageTs, playerVersionId);
    if (value > best) best = value;
  }
  return best;
}
function productionComponentOf(
  production: Map<string, PlayerProduction>,
  leagueAverageTs: number,
  received: readonly string[],
  sent: readonly string[],
): number {
  const receivedValue = accumulatedProductionOfSet(production, leagueAverageTs, received);
  const sentValue = accumulatedProductionOfSet(production, leagueAverageTs, sent);
  const reference = referenceProductionOf(production, leagueAverageTs);
  const absolute = (100 * receivedValue) / Math.max(reference, CONSISTENCY_REFERENCE_EPSILON);
  const edge =
    receivedValue + sentValue <= CONSISTENCY_REFERENCE_EPSILON
      ? 50
      : 50 +
        (50 * (receivedValue - sentValue)) /
          Math.max(receivedValue + sentValue, CONSISTENCY_REFERENCE_EPSILON);
  return clampScore(PRODUCTION_LEVEL_WEIGHT * absolute + PRODUCTION_EDGE_WEIGHT * edge);
}
function availabilityComponentOf(
  players: ReadonlyMap<string, SeasonPlayerAggregate>,
  received: readonly string[],
  teamGames: number,
): number {
  if (teamGames <= 0 || received.length === 0) return 0;
  let appearances = 0;
  for (const id of received) {
    appearances += players.get(id)?.appearances ?? 0;
  }
  return clampScore((100 * appearances) / (received.length * teamGames));
}
function minutesComponentOf(
  players: ReadonlyMap<string, SeasonPlayerAggregate>,
  received: readonly string[],
  teamGames: number,
): number {
  if (teamGames <= 0 || received.length === 0) return 0;
  let total = 0;
  for (const id of received) {
    const row = players.get(id);
    if (row === undefined) continue;
    const minutesPerGame = row.seconds / 60 / teamGames;
    const startsPerGame = row.started / teamGames;
    total += (0.7 * minutesPerGame) / MINUTES_FULL_GAME + (0.3 * startsPerGame) / STARTS_FULL_GAME;
  }
  return clampScore((100 * total) / received.length);
}
function teamRecordOf(
  teams: readonly SeasonTeamAggregate[],
  franchiseId: string,
): { games: number; wins: number } {
  const row = teams.find((entry) => entry.franchiseId === franchiseId);
  return { games: row?.gamesPlayed ?? 0, wins: row?.wins ?? 0 };
}
function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}
export function seasonTradeGradeLabelOf(score: number): SeasonTradeGradeLabel {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}
function gradeIdOf(
  runId: string,
  windowIndex: number,
  offerId: string,
  franchiseId: string,
): string {
  return `tg-${seasonDigestHex(canonicalJson({ runId, windowIndex, offerId, franchiseId }))}`;
}
function tradeGradeLogDigestOf(log: SeasonTradeGradeLog): string {
  const facts: Record<string, unknown> = { ...log };
  delete facts.digest;
  return seasonDigestHex(canonicalJson(facts));
}
export function deriveSeasonTradeGrades(input: SeasonTradeGradesInput): SeasonTradeGradeLog {
  const run = input.run;
  const grades: SeasonTradeGrade[] = [];
  for (const window of run.trade?.windows ?? []) {
    const postTradeFirstRound = postTradeFirstRoundOf(window.blockIndex);
    const postTradeGames = postTradeSummariesOf(
      input.summaries,
      input.postseasonSummaries,
      postTradeFirstRound,
    );
    const teamAggregates = foldSeasonTeamAggregates(postTradeGames);
    const playerAggregates = foldSeasonPlayerAggregates(postTradeGames);
    const playerById = new Map(playerAggregates.map((row) => [row.playerVersionId, row]));
    const production = foldProduction(postTradeGames);
    const leagueAverageTs = leagueAverageTsOf(production);
    const preTradeGames = input.summaries.filter((summary) => summary.round < postTradeFirstRound);
    const preTradeTeams = foldSeasonTeamAggregates(preTradeGames);
    for (const offer of window.offers) {
      if (offer.status !== 'accepted') continue;
      const sides = [
        {
          franchiseId: offer.toFranchiseId,
          received: offer.incomingPlayerVersionIds,
          sent: offer.outgoingPlayerVersionIds,
        },
        {
          franchiseId: offer.fromFranchiseId,
          received: offer.outgoingPlayerVersionIds,
          sent: offer.incomingPlayerVersionIds,
        },
      ];
      for (const side of sides) {
        const { games: teamGames, wins: postWins } = teamRecordOf(teamAggregates, side.franchiseId);
        const receivedValue = accumulatedProductionOfSet(
          production,
          leagueAverageTs,
          side.received,
        );
        const sentValue = accumulatedProductionOfSet(production, leagueAverageTs, side.sent);
        const reference = referenceProductionOf(production, leagueAverageTs);
        const appearances = side.received.reduce(
          (total, id) => total + (playerById.get(id)?.appearances ?? 0),
          0,
        );
        let minutesPerGame = 0;
        let startsPerGame = 0;
        for (const id of side.received) {
          const row = playerById.get(id);
          if (row === undefined || teamGames <= 0) continue;
          minutesPerGame += row.seconds / 60 / teamGames / side.received.length;
          startsPerGame += row.started / teamGames / side.received.length;
        }
        const postWinRate = teamGames > 0 ? postWins / teamGames : 0.5;
        const preRecord = teamRecordOf(preTradeTeams, side.franchiseId);
        const preWinRate = preRecord.games > 0 ? preRecord.wins / preRecord.games : 0.5;
        const neutral = teamGames < SEASON_TRADE_GRADE_MIN_SAMPLE;
        const components = neutral
          ? { production: 0, availability: 0, minutes: 0, trend: 0 }
          : {
              production: Math.round(
                productionComponentOf(production, leagueAverageTs, side.received, side.sent),
              ),
              availability: Math.round(
                availabilityComponentOf(playerById, side.received, teamGames),
              ),
              minutes: Math.round(minutesComponentOf(playerById, side.received, teamGames)),
              trend: Math.round(clampScore(50 + 50 * (postWinRate - preWinRate))),
            };
        const score = neutral
          ? SEASON_TRADE_GRADE_NEUTRAL_SCORE
          : clampScore(
              Math.round(
                SEASON_TRADE_GRADE_WEIGHTS.production * components.production +
                  SEASON_TRADE_GRADE_WEIGHTS.availability * components.availability +
                  SEASON_TRADE_GRADE_WEIGHTS.minutes * components.minutes +
                  SEASON_TRADE_GRADE_WEIGHTS.trend * components.trend,
              ),
            );
        const reasons = neutral
          ? [
              `neutral grade: ${String(teamGames)} post-trade team games is below the ${String(SEASON_TRADE_GRADE_MIN_SAMPLE)}-game floor`,
            ]
          : [
              `received production ${receivedValue.toFixed(1)} vs sent ${sentValue.toFixed(1)} (league post-trade best ${reference.toFixed(1)})`,
              `availability ${String(components.availability)}/100 (${String(appearances)} of ${String(side.received.length * teamGames)} player-games)`,
              `realized minutes/starts ${String(components.minutes)}/100 (${minutesPerGame.toFixed(1)} mpg, ${((startsPerGame / STARTS_FULL_GAME) * 100).toFixed(0)}% starts)`,
              `team trend ${String(components.trend)}/100 (post-trade win rate ${(postWinRate * 100).toFixed(0)}% vs pre-trade ${(preWinRate * 100).toFixed(0)}%)`,
            ];
        grades.push({
          gradeId: idSchema.parse(
            gradeIdOf(input.runId, window.windowIndex, offer.offerId, side.franchiseId),
          ),
          windowIndex: window.windowIndex,
          offerId: offer.offerId,
          franchiseId: side.franchiseId,
          receivedPlayerVersionIds: [...side.received],
          sentPlayerVersionIds: [...side.sent],
          sample: teamGames,
          neutral,
          components,
          score,
          label: seasonTradeGradeLabelOf(score),
          reasons,
        });
      }
    }
  }
  const log: SeasonTradeGradeLog = {
    schemaVersion: 1,
    tradeGradeVersion: 'trade-grade-v1',
    runId: input.runId,
    grades,
    digest: '',
  };
  return seasonTradeGradeLogSchema.parse({ ...log, digest: tradeGradeLogDigestOf(log) });
}
function postTradeFirstRoundOf(blockIndex: number): number {
  return (blockIndex + 1) * 10 + 1;
}
