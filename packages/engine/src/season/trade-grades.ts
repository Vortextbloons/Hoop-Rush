import {
  canonicalJson,
  seasonDigestHex,
  seasonTradeGradeLogSchema,
  type SeasonGameSummary,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonTradeGrade,
  type SeasonTradeGradeLabel,
  type SeasonTradeGradeLog,
} from '@hoop-rush/data-contracts';

/**
 * M2.6 trade grades (spec/2.0/07, trade-grade-v1, engine side). Grades every
 * ACCEPTED trade of a Season Run from recorded facts only: the run snapshot
 * (trade-window state), the regular-season compact summaries, and the
 * postseason summaries through the champion. The derivation is a pure
 * function of those inputs — no seed, no RNG, no narrative — and every grade
 * carries per-component scores and bounded recorded reasons.
 *
 * ## Window semantics (frozen)
 *
 * A trade window opens after the accepted checkpoint of its block (windows
 * open at blocks 2, 4, 5 — `window.blockIndex` is a recorded fact). The
 * post-trade evaluation span of a window is every recorded game AFTER that
 * block through the champion: regular-season rounds strictly after the
 * opening block's final round, plus every postseason summary. The earliest
 * possible offer application is right after that checkpoint, so this span is
 * the recorded, deterministic approximation of "games after the trade"
 * (per-game application times are not recorded).
 *
 * ## Sides
 *
 * Every accepted trade produces two sides: the `to` franchise (received =
 * offer.incoming, sent = offer.outgoing) and the `from` franchise (the
 * reverse). Each side is graded independently from its own received-vs-sent
 * view. A player traded again in a later window keeps accruing through the
 * champion (their production contributes to every earlier window's received
 * or sent pool exactly as recorded); windows never overlap in game spans, so
 * no fact is double-counted.
 *
 * ## Score (0-100, frozen weights)
 *
 * - Production (55%): nonnegative accumulated MVP-style production using the
 *   awards module's per-appearance value formula (see below). Each received
 *   and sent player accumulates max(0, Σ per-appearance value) over the
 *   post-trade span; `reference` is the best such accumulation of any player
 *   in the same span. Component = 70% absolute level against the reference
 *   plus 30% received-vs-sent edge, both monotone in the received total:
 *   `absolute = 100 * received / max(reference, ε)`,
 *   `edge = 50 + 50 * (received - sent) / max(received + sent, ε)`.
 * - Availability (15%): the received players' appearance share of the
 *   post-trade team games (`appearances / (|received| * teamGames)`).
 * - Realized minutes and starts (15%): the mean over received players of
 *   `0.7 * minutesPerGame / 48 + 0.3 * startsPerGame / 5` (full-game minute
 *   ceiling and one of five starts per game).
 * - Team-performance trend (15%): `50 + 50 * clamp(-1, 1, postWinRate -
 *   preWinRate)` where the win rates are the graded franchise's post-trade
 *   (regular + postseason) and pre-trade regular-season records.
 *
 * The score is the rounded weighted sum, clamped to 0-100. Labels are the
 * frozen display grades: A 80+, B 65-79, C 45-64, D 30-44, F < 30.
 *
 * ## Small samples
 *
 * A side with fewer than five post-trade team games
 * (`SEASON_TRADE_GRADE_MIN_SAMPLE`) — including no games at all — is graded
 * NEUTRAL: score `SEASON_TRADE_GRADE_NEUTRAL_SCORE` (50), label C,
 * `neutral` true, with the recorded reason. No component score is invented
 * for it.
 *
 * ## Production formula (awards-machinery mirror)
 *
 * The per-appearance MVP value is the awards module's exact formula: Game
 * Score (PTS + 0.4*FGM - 0.7*FGA - 0.4*(FTA-FTM) + 0.7*ORB + 0.3*DRB + STL +
 * 0.7*AST + 0.7*BLK - 0.4*PF - TOV) plus the defense bonus
 * (0.6*STL + 0.6*BLK + 0.15*DRB), the playmaking bonus (0.5*AST), the
 * efficiency bonus ((ts - leagueAvgTs) * shotsUsed with ts =
 * points/(2*shotsUsed) over every post-trade line), and the game-result
 * bonus (+0.75 win, -0.75 loss), summed per appearance. `season/awards.ts`
 * keeps these constants private (frozen for this wave), so this module
 * re-derives the identical formulas with mirrored constants; the lead may
 * export the awards primitives at integration and point this module at them
 * (the bytes must not change).
 *
 * Pure TypeScript: no Svelte, persistence, worker, or network code.
 */

/** The frozen per-side sample floor: fewer post-trade team games is neutral. */
export const SEASON_TRADE_GRADE_MIN_SAMPLE = 5;

/** The frozen neutral score for below-floor samples (label C). */
export const SEASON_TRADE_GRADE_NEUTRAL_SCORE = 50;

/** Production component inner weights: level vs received/sent edge. */
const PRODUCTION_LEVEL_WEIGHT = 0.7;
const PRODUCTION_EDGE_WEIGHT = 0.3;

/** Frozen component weights of the final score. */
export const SEASON_TRADE_GRADE_WEIGHTS = {
  production: 0.55,
  availability: 0.15,
  minutes: 0.15,
  trend: 0.15,
} as const;

/** Full-game minute ceiling of the minutes slot (48 minutes per game). */
const MINUTES_FULL_GAME = 48;
/** Starts-per-game ceiling of the starts slot (five starters per game). */
const STARTS_FULL_GAME = 5;

/** Awards-machinery mirrors (see the module docstring; awards.ts is frozen). */
const DEFENSE_WEIGHTS = { steal: 0.6, block: 0.6, defensiveRebound: 0.15 } as const;
const PLAYMAKING_ASSIST_WEIGHT = 0.5;
const TEAM_BONUS = { win: 0.75, loss: -0.75 } as const;
const CONSISTENCY_REFERENCE_EPSILON = 1e-9;

/** The trade-grade derivation inputs: recorded facts only. */
export interface SeasonTradeGradesInput {
  runId: string;
  /** The final run snapshot (the recorded trade-window state lives on it). */
  run: SeasonRun;
  /** Regular-season compact summaries (every recorded round). */
  summaries: SeasonGameSummary[];
  /** Postseason summaries through the champion, in play order. */
  postseasonSummaries: SeasonPostseasonSummary[];
}

/** Per-player post-trade folding over the recorded summaries. */
interface PlayerPostTradeFacts {
  appearances: number;
  starts: number;
  seconds: number;
  /** Raw per-appearance MVP-value inputs (baseline resolved after folding). */
  valueBases: number[];
  efficiencyValues: number[];
  shotsList: number[];
  wins: boolean[];
}

interface PostTradeFacts {
  players: Map<string, PlayerPostTradeFacts>;
  teamGames: Map<string, number>;
  teamWins: Map<string, number>;
}

/** The shape both summary families fold (their compact lines are identical). */
type FoldLine = SeasonGameSummary['homePlayers'][number];

/** The recorded-game shape both summary families satisfy. */
interface FoldGame {
  homeFranchiseId: string;
  awayFranchiseId: string;
  status: 'final' | 'forfeit';
  forfeitLoserFranchiseId: string | null;
  homeScore: number;
  awayScore: number;
  homePlayers: readonly FoldLine[];
  awayPlayers: readonly FoldLine[];
}

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

/** The awards module's per-appearance MVP value base (mirror, docstring). */
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

/** The per-appearance MVP value of one line against the league baseline. */
function mvpValueOf(row: PlayerPostTradeFacts, index: number, leagueAverageTs: number): number {
  const valueBase = row.valueBases[index] ?? 0;
  const shots = row.shotsList[index] ?? 0;
  const efficiency = row.efficiencyValues[index] ?? 0;
  const won = row.wins[index] ?? false;
  return (
    valueBase + (efficiency - leagueAverageTs) * shots + (won ? TEAM_BONUS.win : TEAM_BONUS.loss)
  );
}

/** Folds the post-trade recorded games (regular after the window + postseason). */
function foldPostTradeFacts(games: readonly FoldGame[]): PostTradeFacts {
  const players = new Map<string, PlayerPostTradeFacts>();
  const teamGames = new Map<string, number>();
  const teamWins = new Map<string, number>();

  const rowOf = (playerVersionId: string): PlayerPostTradeFacts => {
    let row = players.get(playerVersionId);
    if (row === undefined) {
      row = {
        appearances: 0,
        starts: 0,
        seconds: 0,
        valueBases: [],
        efficiencyValues: [],
        shotsList: [],
        wins: [],
      };
      players.set(playerVersionId, row);
    }
    return row;
  };

  for (const game of games) {
    const homeWon =
      game.status === 'forfeit'
        ? game.forfeitLoserFranchiseId !== game.homeFranchiseId
        : game.homeScore > game.awayScore;
    teamGames.set(game.homeFranchiseId, (teamGames.get(game.homeFranchiseId) ?? 0) + 1);
    teamGames.set(game.awayFranchiseId, (teamGames.get(game.awayFranchiseId) ?? 0) + 1);
    if (homeWon) teamWins.set(game.homeFranchiseId, (teamWins.get(game.homeFranchiseId) ?? 0) + 1);
    else teamWins.set(game.awayFranchiseId, (teamWins.get(game.awayFranchiseId) ?? 0) + 1);
    if (game.status === 'forfeit') continue;
    const foldLines = (lines: readonly FoldLine[], won: boolean): void => {
      for (const line of lines) {
        const row = rowOf(line.playerVersionId);
        row.seconds += line.seconds;
        if (line.started === true) row.starts += 1;
        if (line.seconds > 0) {
          row.appearances += 1;
          row.valueBases.push(mvpValueBaseOf(line));
          row.efficiencyValues.push(trueShootingOf(line));
          row.shotsList.push(shotsUsedOf(line));
          row.wins.push(won);
        }
      }
    };
    foldLines(game.homePlayers, homeWon);
    foldLines(game.awayPlayers, !homeWon);
  }
  return { players, teamGames, teamWins };
}

/** The league-average true-shooting baseline over the same folded lines. */
function leagueAverageTsOf(facts: PostTradeFacts): number {
  let points = 0;
  let shots = 0;
  for (const row of facts.players.values()) {
    for (let index = 0; index < row.appearances; index += 1) {
      const lineShots = row.shotsList[index] ?? 0;
      if (lineShots > 0) {
        points += (row.efficiencyValues[index] ?? 0) * 2 * lineShots;
        shots += lineShots;
      }
    }
  }
  return shots > 0 ? points / (2 * shots) : 0.5;
}

/** The accumulated per-appearance value of one player (nonnegative). */
function accumulatedProductionOf(facts: PostTradeFacts, playerVersionId: string): number {
  const row = facts.players.get(playerVersionId);
  if (row === undefined || row.appearances === 0) return 0;
  const baseline = leagueAverageTsOf(facts);
  let total = 0;
  for (let index = 0; index < row.appearances; index += 1) {
    total += mvpValueOf(row, index, baseline);
  }
  return Math.max(0, total);
}

/** Accumulated production of a player set, nonnegative per player. */
function accumulatedProductionOfSet(
  facts: PostTradeFacts,
  playerVersionIds: readonly string[],
): number {
  let total = 0;
  for (const id of playerVersionIds) {
    total += accumulatedProductionOf(facts, id);
  }
  return total;
}

/** The best nonnegative accumulated production of any player in the span. */
function referenceProductionOf(facts: PostTradeFacts): number {
  let best = 0;
  for (const playerVersionId of facts.players.keys()) {
    const value = accumulatedProductionOf(facts, playerVersionId);
    if (value > best) best = value;
  }
  return best;
}

/** 55% component: production level (vs reference) plus the received/sent edge. */
function productionComponentOf(
  facts: PostTradeFacts,
  received: readonly string[],
  sent: readonly string[],
): number {
  const receivedValue = accumulatedProductionOfSet(facts, received);
  const sentValue = accumulatedProductionOfSet(facts, sent);
  const reference = referenceProductionOf(facts);
  const absolute = (100 * receivedValue) / Math.max(reference, CONSISTENCY_REFERENCE_EPSILON);
  const edge =
    receivedValue + sentValue <= CONSISTENCY_REFERENCE_EPSILON
      ? 50
      : 50 +
        (50 * (receivedValue - sentValue)) /
          Math.max(receivedValue + sentValue, CONSISTENCY_REFERENCE_EPSILON);
  return clampScore(PRODUCTION_LEVEL_WEIGHT * absolute + PRODUCTION_EDGE_WEIGHT * edge);
}

/** 15% component: received players' appearance share of the team games. */
function availabilityComponentOf(
  facts: PostTradeFacts,
  received: readonly string[],
  teamGames: number,
): number {
  if (teamGames <= 0 || received.length === 0) return 0;
  let appearances = 0;
  for (const id of received) {
    appearances += facts.players.get(id)?.appearances ?? 0;
  }
  return clampScore((100 * appearances) / (received.length * teamGames));
}

/** 15% component: realized minutes and starts of the received players. */
function minutesComponentOf(
  facts: PostTradeFacts,
  received: readonly string[],
  teamGames: number,
): number {
  if (teamGames <= 0 || received.length === 0) return 0;
  let total = 0;
  for (const id of received) {
    const row = facts.players.get(id);
    if (row === undefined) continue;
    const minutesPerGame = row.seconds / 60 / teamGames;
    const startsPerGame = row.starts / teamGames;
    total += (0.7 * minutesPerGame) / MINUTES_FULL_GAME + (0.3 * startsPerGame) / STARTS_FULL_GAME;
  }
  return clampScore((100 * total) / received.length);
}

/** Pre-trade regular-season win rate of a franchise (0.5 when no pre-trade games). */
function preTradeWinRateOf(
  summaries: readonly SeasonGameSummary[],
  franchiseId: string,
  postTradeFirstRound: number,
): number {
  let games = 0;
  let wins = 0;
  for (const summary of summaries) {
    if (summary.round >= postTradeFirstRound) continue;
    const home = summary.homeFranchiseId === franchiseId;
    const away = summary.awayFranchiseId === franchiseId;
    if (!home && !away) continue;
    games += 1;
    const won =
      summary.status === 'forfeit'
        ? summary.forfeitLoserFranchiseId !== franchiseId
        : home
          ? summary.homeScore > summary.awayScore
          : summary.awayScore > summary.homeScore;
    if (won) wins += 1;
  }
  return games > 0 ? wins / games : 0.5;
}

/** Clamps a value into [0, 100]. */
function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** The label of a bounded score under the frozen cutoffs. */
export function seasonTradeGradeLabelOf(score: number): SeasonTradeGradeLabel {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 45) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

/** The deterministic grade id of one side of one accepted trade. */
function gradeIdOf(
  runId: string,
  windowIndex: number,
  offerId: string,
  franchiseId: string,
): string {
  return `tg-${seasonDigestHex(canonicalJson({ runId, windowIndex, offerId, franchiseId }))}`;
}

/** The canonical self-excluded digest of a grade log. */
function tradeGradeLogDigestOf(log: SeasonTradeGradeLog): string {
  const facts: Record<string, unknown> = { ...log };
  delete facts.digest;
  return seasonDigestHex(canonicalJson(facts));
}

/**
 * Derives the trade-grade log of a completed run: one grade per side of
 * every accepted trade, from recorded post-trade facts through the
 * champion. Deterministic and explainable; the log carries a self-consistent
 * canonical digest.
 */
export function deriveSeasonTradeGrades(input: SeasonTradeGradesInput): SeasonTradeGradeLog {
  const run = input.run;
  const grades: SeasonTradeGrade[] = [];
  for (const window of run.trade?.windows ?? []) {
    const postTradeFirstRound = postTradeFirstRoundOf(window.blockIndex);
    const postTradeGames: FoldGame[] = [
      ...input.summaries.filter((summary) => summary.round >= postTradeFirstRound),
      ...input.postseasonSummaries,
    ];
    const postTradeFacts = foldPostTradeFacts(postTradeGames);
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
        const teamGames = postTradeFacts.teamGames.get(side.franchiseId) ?? 0;
        const receivedValue = accumulatedProductionOfSet(postTradeFacts, side.received);
        const sentValue = accumulatedProductionOfSet(postTradeFacts, side.sent);
        const reference = referenceProductionOf(postTradeFacts);
        const appearances = side.received.reduce(
          (total, id) => total + (postTradeFacts.players.get(id)?.appearances ?? 0),
          0,
        );
        let minutesPerGame = 0;
        let startsPerGame = 0;
        for (const id of side.received) {
          const row = postTradeFacts.players.get(id);
          if (row === undefined) continue;
          minutesPerGame += row.seconds / 60 / teamGames / side.received.length;
          startsPerGame += row.starts / teamGames / side.received.length;
        }
        const postWins = postTradeFacts.teamWins.get(side.franchiseId) ?? 0;
        const postWinRate = teamGames > 0 ? postWins / teamGames : 0.5;
        const preWinRate = preTradeWinRateOf(
          input.summaries,
          side.franchiseId,
          postTradeFirstRound,
        );

        const neutral = teamGames < SEASON_TRADE_GRADE_MIN_SAMPLE;
        const components = neutral
          ? { production: 0, availability: 0, minutes: 0, trend: 0 }
          : {
              production: Math.round(
                productionComponentOf(postTradeFacts, side.received, side.sent),
              ),
              availability: Math.round(
                availabilityComponentOf(postTradeFacts, side.received, teamGames),
              ),
              minutes: Math.round(minutesComponentOf(postTradeFacts, side.received, teamGames)),
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
          gradeId: gradeIdOf(input.runId, window.windowIndex, offer.offerId, side.franchiseId),
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

/** The first regular-season round strictly after a window's opening block. */
function postTradeFirstRoundOf(blockIndex: number): number {
  return (blockIndex + 1) * 10 + 1;
}
