import {
  FULL_COURT_LINEUP_SUMMARY_VERSION,
  FULL_COURT_MAX_GAME_LINEUP_FACTS,
  type FullCourtGameLineups,
} from '@hoop-rush/data-contracts';
import type {
  FullCourtGameLineupFacts,
  FullCourtGameResult,
  FullCourtLineupFactRow,
  FullCourtPlayerLine,
  FullCourtTapeEvent,
} from './game.ts';
import { checkFullCourtGameResult } from './game.ts';

/**
 * Full-game reporting for Full Court.
 *
 * Lineup rows are built from the game's recorded lineup stints and the
 * possession tape. Stints own minutes and the unit on the floor; the tape owns
 * the exact offensive and defensive possessions and points, so a unit that is
 * reassembled later is still one row and a unit that changes while the opponent
 * substitutes is not credited with another unit's possessions.
 */

/**
 * Provisional ranking floor from Phase 4: ratings are shown with their sample,
 * and a unit below this many possessions is not ranked as a reliable unit.
 */
export const FULL_COURT_LINEUP_SAMPLE_POSSESSIONS = 100;

export type FullCourtReportSide = 'home' | 'away';

function oppositeSide(side: FullCourtReportSide): FullCourtReportSide {
  return side === 'home' ? 'away' : 'home';
}

/** Stable unordered identity for an on-court unit: sorted player ids joined with `|`. */
export function fullCourtLineupKey(playerIds: readonly string[]): string {
  if (playerIds.length === 0) throw new Error('Full Court lineup requires at least one player');
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error('Full Court lineup repeats a player');
  }
  return [...playerIds].sort().join('|');
}

export interface FullCourtReportedPlayer {
  readonly playerId: string;
  readonly displayName: string;
}

export interface FullCourtLineupRow {
  /** Unordered unit identity; stints with the same unit share one row. */
  readonly key: string;
  /** Sorted player ids that define the identity. */
  readonly playerIds: readonly string[];
  /** Players in id order, for display only. */
  readonly players: readonly FullCourtReportedPlayer[];
  readonly seconds: number;
  readonly minutes: number;
  readonly offensivePossessions: number;
  readonly defensivePossessions: number;
  /** Average of the unit's offensive and defensive possessions. */
  readonly pacePossessions: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly netPoints: number;
  /** True net rating (ORtg - DRtg) per 100 possessions; null when either possession count is zero. */
  readonly netRatingPer100: number | null;
  /** False below the displayed ranking threshold; the row is still reported. */
  readonly sampleMet: boolean;
}

export interface FullCourtBenchPlayer {
  readonly playerId: string;
  readonly displayName: string;
  readonly points: number;
  readonly seconds: number;
  readonly minutes: number;
}

export interface FullCourtBenchScoring {
  /** Signed bench subtotal; deductions can make it negative. */
  readonly points: number;
  readonly starterPoints: number;
  readonly teamPoints: number;
  /** Bench points divided by team points; negative when the bench subtotal is negative. */
  readonly share: number | null;
  readonly minutes: number;
  /** Only reserves who actually played (positive seconds). */
  readonly players: readonly FullCourtBenchPlayer[];
}

/**
 * Minimal completed-game facts used by the season summary. Build it with
 * `fullCourtCompletedGameFacts` so it always comes from a verified game report.
 */
export interface FullCourtCompletedGameFacts {
  readonly gameId: string;
  readonly gameNumber: number;
  readonly teamPoints: number;
  readonly starterPoints: number;
  readonly benchPoints: number;
  /** Team-level bonus points that belong to no player line. */
  readonly teamBonusPoints: number;
  readonly benchPlayerCount: number;
}

interface FullCourtGameReportBase {
  readonly gameId: string;
  readonly gameNumber: number;
  readonly userSide: FullCourtReportSide;
  readonly opponentSide: FullCourtReportSide;
  readonly sampleThreshold: number;
}

export interface FullCourtPlayedGameReport extends FullCourtGameReportBase {
  readonly status: 'played';
  readonly userPoints: number;
  readonly opponentPoints: number;
  readonly userWon: boolean;
  /** Team bonus points, which are not part of any player line. */
  readonly teamBonusPoints: number;
  readonly lineupRows: readonly FullCourtLineupRow[];
  readonly bench: FullCourtBenchScoring;
}

export interface FullCourtForfeitGameReport extends FullCourtGameReportBase {
  readonly status: 'forfeit';
  readonly losingSides: readonly FullCourtReportSide[];
  readonly userForfeit: boolean;
  readonly opponentForfeit: boolean;
  /** Null only for a double forfeit; no points or lineup facts are inferred. */
  readonly userWon: boolean | null;
  readonly lineupRows: readonly [];
  readonly bench: null;
}

export type FullCourtGameReport = FullCourtPlayedGameReport | FullCourtForfeitGameReport;

export interface FullCourtPlayedGameInput {
  readonly kind: 'played';
  readonly gameId: string;
  readonly userSide: FullCourtReportSide;
  readonly result: FullCourtGameResult;
  /** Required for verified possession and point attribution. */
  readonly tape: readonly FullCourtTapeEvent[];
}

export interface FullCourtPlayedGameFactsInput {
  readonly kind: 'played';
  readonly gameId: string;
  readonly userSide: FullCourtReportSide;
  readonly result: FullCourtGameResult;
  /** Compact totals accumulated during simulation, without a playback tape. */
  readonly facts: FullCourtGameLineupFacts;
}

export interface FullCourtForfeitGameInput {
  readonly kind: 'forfeit';
  readonly gameId: string;
  readonly gameNumber: number;
  readonly userSide: FullCourtReportSide;
  readonly losingSides: readonly FullCourtReportSide[];
}

export type FullCourtGameReportInput = FullCourtPlayedGameInput | FullCourtForfeitGameInput;

export interface FullCourtGameReportOptions {
  /** Override the displayed possessed-sample floor, mainly for tests or tuning. */
  readonly sampleThreshold?: number;
}

export interface FullCourtLineupFactsOptions extends FullCourtGameReportOptions {
  /** Lower values exercise the transparent cap in tests. */
  readonly maxLineups?: number;
}

interface RowAccumulator {
  readonly playerIds: readonly string[];
  readonly key: string;
  seconds: number;
  offensivePossessions: number;
  defensivePossessions: number;
  pointsFor: number;
  pointsAgainst: number;
}

function roundToTenth(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Full Court report produced a non-finite value');
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function playerMapOf(
  result: FullCourtGameResult,
  side: FullCourtReportSide,
): Map<string, FullCourtPlayerLine> {
  return new Map(result[side].players.map((player) => [String(player.playerId), player]));
}

function accumulatorFor(
  rows: Map<string, RowAccumulator>,
  playerIds: readonly string[],
): RowAccumulator {
  const key = fullCourtLineupKey(playerIds);
  const existing = rows.get(key);
  if (existing !== undefined) return existing;
  const sorted = [...playerIds].sort();
  const created: RowAccumulator = {
    playerIds: sorted,
    key,
    seconds: 0,
    offensivePossessions: 0,
    defensivePossessions: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  };
  rows.set(key, created);
  return created;
}

function buildRows(
  result: FullCourtGameResult,
  side: FullCourtReportSide,
): Map<string, RowAccumulator> {
  const rows = new Map<string, RowAccumulator>();
  const team = result[side];
  for (const stint of team.stints) {
    const row = accumulatorFor(rows, stint.playerIds);
    row.seconds += stint.seconds;
  }
  const seconds = [...rows.values()].reduce((total, row) => total + row.seconds, 0);
  if (seconds !== team.liveSeconds) {
    throw new Error(
      `Full Court report: ${side} stints cover ${String(seconds)}s, expected ${String(team.liveSeconds)}s`,
    );
  }
  return rows;
}

function addPoints(offense: RowAccumulator, defense: RowAccumulator, points: number): void {
  if (points === 0) return;
  offense.pointsFor += points;
  defense.pointsAgainst += points;
}

function rowForSide(
  side: FullCourtReportSide,
  rows: Readonly<Record<FullCourtReportSide, Map<string, RowAccumulator>>>,
  playerIds: readonly string[],
): RowAccumulator {
  return accumulatorFor(rows[side], playerIds);
}

function scanTape(
  result: FullCourtGameResult,
  tape: readonly FullCourtTapeEvent[],
  rowsBySide: Readonly<Record<FullCourtReportSide, Map<string, RowAccumulator>>>,
): void {
  let homeScore = 0;
  let awayScore = 0;
  const currentUnits: Record<FullCourtReportSide, readonly string[]> = {
    home: result.home.stints[0]?.playerIds ?? [],
    away: result.away.stints[0]?.playerIds ?? [],
  };

  for (const event of tape) {
    if (event.kind === 'trip') {
      currentUnits.home = event.homeUnit;
      currentUnits.away = event.awayUnit;
      const homeDelta = event.homeScore - homeScore;
      const awayDelta = event.awayScore - awayScore;
      homeScore = event.homeScore;
      awayScore = event.awayScore;

      const homeRow = rowForSide('home', rowsBySide, event.homeUnit);
      const awayRow = rowForSide('away', rowsBySide, event.awayUnit);
      addPoints(homeRow, awayRow, homeDelta);
      addPoints(awayRow, homeRow, awayDelta);
      if (event.ended) {
        const offenseRow = event.offense === 0 ? homeRow : awayRow;
        const defenseRow = event.offense === 0 ? awayRow : homeRow;
        offenseRow.offensivePossessions += 1;
        defenseRow.defensivePossessions += 1;
      }
      continue;
    }

    if (event.kind === 'substitution') {
      const side: FullCourtReportSide = event.side === 0 ? 'home' : 'away';
      currentUnits[side] = currentUnits[side].map((playerId) =>
        playerId === event.outPlayerId ? event.inPlayerId : playerId,
      );
      continue;
    }

    if (event.kind === 'technical') {
      const homeUnit = event.homeUnit ?? currentUnits.home;
      const awayUnit = event.awayUnit ?? currentUnits.away;
      const homeRow = rowForSide('home', rowsBySide, homeUnit);
      const awayRow = rowForSide('away', rowsBySide, awayUnit);
      if (event.made) {
        if (event.side === 0) {
          addPoints(homeRow, awayRow, 1);
          homeScore += 1;
        } else {
          addPoints(awayRow, homeRow, 1);
          awayScore += 1;
        }
      }
    }
  }

  if (homeScore !== result.home.box.points || awayScore !== result.away.box.points) {
    throw new Error(
      `Full Court report: tape score ${String(homeScore)}-${String(awayScore)} ` +
        `does not match ${String(result.home.box.points)}-${String(result.away.box.points)}`,
    );
  }
}

function verifyRows(
  result: FullCourtGameResult,
  rowsBySide: Readonly<Record<FullCourtReportSide, Map<string, RowAccumulator>>>,
): void {
  for (const side of ['home', 'away'] as const) {
    const opponent = oppositeSide(side);
    const team = result[side];
    const expectedByKey = new Map<
      string,
      { seconds: number; points: number; possessions: number }
    >();
    for (const stint of team.stints) {
      const key = fullCourtLineupKey(stint.playerIds);
      const current = expectedByKey.get(key) ?? { seconds: 0, points: 0, possessions: 0 };
      current.seconds += stint.seconds;
      current.points += stint.points;
      current.possessions += stint.possessions;
      expectedByKey.set(key, current);
    }
    const rows = [...rowsBySide[side].values()];
    if (rows.length !== expectedByKey.size) {
      throw new Error(`Full Court report: ${side} lineup rows do not match recorded stints`);
    }
    for (const row of rows) {
      const expected = expectedByKey.get(row.key);
      if (
        expected === undefined ||
        row.seconds !== expected.seconds ||
        row.pointsFor !== expected.points ||
        row.offensivePossessions !== expected.possessions
      ) {
        throw new Error(
          `Full Court report: ${side} lineup ${row.key} does not reconcile with stints`,
        );
      }
    }
    const totals = rows.reduce(
      (sum, row) => ({
        seconds: sum.seconds + row.seconds,
        offensivePossessions: sum.offensivePossessions + row.offensivePossessions,
        defensivePossessions: sum.defensivePossessions + row.defensivePossessions,
        pointsFor: sum.pointsFor + row.pointsFor,
        pointsAgainst: sum.pointsAgainst + row.pointsAgainst,
      }),
      {
        seconds: 0,
        offensivePossessions: 0,
        defensivePossessions: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      },
    );
    const failures: string[] = [];
    if (totals.seconds !== team.liveSeconds) failures.push('lineup seconds');
    if (totals.offensivePossessions !== team.box.possessions)
      failures.push('offensive possessions');
    if (totals.defensivePossessions !== result[opponent].box.possessions) {
      failures.push('defensive possessions');
    }
    if (totals.pointsFor !== team.box.points) failures.push('points for');
    if (totals.pointsAgainst !== result[opponent].box.points) failures.push('points against');
    if (failures.length > 0) {
      throw new Error(`Full Court report: ${side} lineup ${failures.join(', ')} do not reconcile`);
    }
  }
}

function benchOf(result: FullCourtGameResult, side: FullCourtReportSide): FullCourtBenchScoring {
  const team = result[side];
  const benchPlayers = team.players
    .filter((player) => !player.startedGame && (player.seconds > 0 || player.points !== 0))
    .map((player) => ({
      playerId: player.playerId,
      displayName: player.displayName,
      points: player.points,
      seconds: player.seconds,
      minutes: roundToTenth(player.seconds / 60),
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        right.seconds - left.seconds ||
        left.playerId.localeCompare(right.playerId),
    );
  const points = benchPlayers.reduce((total, player) => total + player.points, 0);
  const starterPoints = team.players
    .filter((player) => player.startedGame)
    .reduce((total, player) => total + player.points, 0);
  const teamPoints = team.box.points;
  const teamBonusPoints = team.teamBonusPoints ?? 0;
  if (starterPoints + points + teamBonusPoints !== teamPoints) {
    throw new Error(
      'Full Court report: starter, bench, and bonus points do not match the team total',
    );
  }
  return {
    points,
    starterPoints,
    teamPoints,
    share: teamPoints <= 0 ? null : Math.round((points / teamPoints) * 1000) / 1000,
    minutes: roundToTenth(benchPlayers.reduce((total, player) => total + player.seconds, 0) / 60),
    players: benchPlayers,
  };
}

function sampleThresholdOf(options: FullCourtGameReportOptions): number {
  const threshold = options.sampleThreshold ?? FULL_COURT_LINEUP_SAMPLE_POSSESSIONS;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Full Court report: sample threshold must be a nonnegative number');
  }
  return threshold;
}

function lineupCapOf(options: FullCourtLineupFactsOptions): number {
  const maxLineups = options.maxLineups ?? FULL_COURT_MAX_GAME_LINEUP_FACTS;
  if (!Number.isSafeInteger(maxLineups) || maxLineups < 1) {
    throw new Error('Full Court lineups: the lineup cap must be a positive integer');
  }
  return maxLineups;
}

function checkedPlayedResult(result: FullCourtGameResult, gameId: string): void {
  const failures = checkFullCourtGameResult(result);
  if (failures.length > 0) {
    throw new Error(`Full Court report: game ${gameId} failed accounting: ${failures.join(', ')}`);
  }
}

function verifiedTapeRows(
  result: FullCourtGameResult,
  tape: readonly FullCourtTapeEvent[],
  gameId: string,
): Record<FullCourtReportSide, Map<string, RowAccumulator>> {
  if (tape.length === 0) {
    throw new Error(`Full Court report: game ${gameId} has no possession tape`);
  }
  const rowsBySide = {
    home: buildRows(result, 'home'),
    away: buildRows(result, 'away'),
  };
  scanTape(result, tape, rowsBySide);
  verifyRows(result, rowsBySide);
  return rowsBySide;
}

function factRowsOf(facts: readonly FullCourtLineupFactRow[]): Map<string, RowAccumulator> {
  const rows = new Map<string, RowAccumulator>();
  for (const fact of facts) {
    const key = fullCourtLineupKey(fact.playerIds);
    if (rows.has(key)) throw new Error(`Full Court report: lineup ${key} appears twice`);
    rows.set(key, {
      key,
      playerIds: [...fact.playerIds].sort(),
      seconds: fact.seconds,
      offensivePossessions: fact.offensivePossessions,
      defensivePossessions: fact.defensivePossessions,
      pointsFor: fact.pointsFor,
      pointsAgainst: fact.pointsAgainst,
    });
  }
  return rows;
}

function verifiedFactRows(
  result: FullCourtGameResult,
  facts: FullCourtGameLineupFacts,
): Record<FullCourtReportSide, Map<string, RowAccumulator>> {
  const rowsBySide = {
    home: factRowsOf(facts.home),
    away: factRowsOf(facts.away),
  };
  verifyRows(result, rowsBySide);
  return rowsBySide;
}

function lineupRowsOf(
  result: FullCourtGameResult,
  side: FullCourtReportSide,
  rows: Readonly<Record<FullCourtReportSide, Map<string, RowAccumulator>>>,
  threshold: number,
): FullCourtLineupRow[] {
  const names = playerMapOf(result, side);
  return [...rows[side].values()]
    .map((row): FullCourtLineupRow => {
      const pacePossessions = (row.offensivePossessions + row.defensivePossessions) / 2;
      const netPoints = row.pointsFor - row.pointsAgainst;
      const players = row.playerIds.map((playerId) => {
        const player = names.get(playerId);
        if (player === undefined) {
          throw new Error(`Full Court report: lineup references unknown player ${playerId}`);
        }
        return { playerId, displayName: player.displayName };
      });
      return {
        key: row.key,
        playerIds: row.playerIds,
        players,
        seconds: row.seconds,
        minutes: roundToTenth(row.seconds / 60),
        offensivePossessions: row.offensivePossessions,
        defensivePossessions: row.defensivePossessions,
        pacePossessions,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        netPoints,
        netRatingPer100:
          row.offensivePossessions === 0 || row.defensivePossessions === 0
            ? null
            : roundToTenth(
                (row.pointsFor / row.offensivePossessions -
                  row.pointsAgainst / row.defensivePossessions) *
                  100,
              ),
        sampleMet: pacePossessions >= threshold,
      };
    })
    .sort((left, right) => right.seconds - left.seconds || left.key.localeCompare(right.key));
}

function lineupSummary(
  result: FullCourtGameResult,
  side: FullCourtReportSide,
  rows: Readonly<Record<FullCourtReportSide, Map<string, RowAccumulator>>>,
  threshold: number,
  maxLineups: number,
): FullCourtGameLineups {
  const lineupRows = lineupRowsOf(result, side, rows, threshold);
  const retained = lineupRows.slice(0, maxLineups);
  const dropped = lineupRows.slice(maxLineups);
  return {
    version: FULL_COURT_LINEUP_SUMMARY_VERSION,
    side,
    sampleThreshold: threshold,
    lineups: retained.map((row) => ({
      playerIds: [...row.playerIds],
      players: row.players.map((player) => ({
        playerId: player.playerId,
        displayName: player.displayName,
      })),
      seconds: row.seconds,
      offensivePossessions: row.offensivePossessions,
      defensivePossessions: row.defensivePossessions,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    })),
    omitted: {
      lineups: dropped.length,
      seconds: dropped.reduce((total, row) => total + row.seconds, 0),
      offensivePossessions: dropped.reduce((total, row) => total + row.offensivePossessions, 0),
      defensivePossessions: dropped.reduce((total, row) => total + row.defensivePossessions, 0),
      pointsFor: dropped.reduce((total, row) => total + row.pointsFor, 0),
      pointsAgainst: dropped.reduce((total, row) => total + row.pointsAgainst, 0),
    },
  };
}

function playedReport(
  input: FullCourtPlayedGameInput,
  options: FullCourtGameReportOptions,
): FullCourtPlayedGameReport {
  const threshold = sampleThresholdOf(options);
  checkedPlayedResult(input.result, input.gameId);
  const rowsBySide = verifiedTapeRows(input.result, input.tape, input.gameId);

  const opponentSide = oppositeSide(input.userSide);
  const team = input.result[input.userSide];
  const opponent = input.result[opponentSide];
  return {
    status: 'played',
    gameId: input.gameId,
    gameNumber: input.result.gameNumber,
    userSide: input.userSide,
    opponentSide,
    sampleThreshold: threshold,
    userPoints: team.box.points,
    opponentPoints: opponent.box.points,
    userWon: team.box.points > opponent.box.points,
    teamBonusPoints: team.teamBonusPoints ?? 0,
    lineupRows: lineupRowsOf(input.result, input.userSide, rowsBySide, threshold),
    bench: benchOf(input.result, input.userSide),
  };
}

function forfeitReport(input: FullCourtForfeitGameInput): FullCourtForfeitGameReport {
  const sides = new Set(input.losingSides);
  if (
    input.losingSides.length < 1 ||
    input.losingSides.length > 2 ||
    sides.size !== input.losingSides.length
  ) {
    throw new Error('Full Court report: a forfeit requires one or two distinct losing sides');
  }
  const opponentSide = oppositeSide(input.userSide);
  const userForfeit = sides.has(input.userSide);
  const opponentForfeit = sides.has(opponentSide);
  return {
    status: 'forfeit',
    gameId: input.gameId,
    gameNumber: input.gameNumber,
    userSide: input.userSide,
    opponentSide,
    sampleThreshold: FULL_COURT_LINEUP_SAMPLE_POSSESSIONS,
    losingSides: [...input.losingSides],
    userForfeit,
    opponentForfeit,
    userWon: userForfeit ? (opponentForfeit ? null : false) : true,
    lineupRows: [],
    bench: null,
  };
}

export function buildFullCourtGameReport(
  input: FullCourtGameReportInput,
  options: FullCourtGameReportOptions = {},
): FullCourtGameReport {
  return input.kind === 'played' ? playedReport(input, options) : forfeitReport(input);
}

/**
 * Compact season-facing facts for one user game, built from an explicit tape.
 * The full report remains the detailed tape scanner; this keeps only the actual
 * fives and drops the detailed rows. The smallest groups are capped and
 * explicitly counted rather than merged into a synthetic lineup.
 */
export function buildFullCourtGameLineups(
  input: FullCourtPlayedGameInput,
  options: FullCourtLineupFactsOptions = {},
): FullCourtGameLineups {
  const maxLineups = lineupCapOf(options);
  const threshold = sampleThresholdOf(options);
  checkedPlayedResult(input.result, input.gameId);
  const rowsBySide = verifiedTapeRows(input.result, input.tape, input.gameId);
  return lineupSummary(input.result, input.userSide, rowsBySide, threshold, maxLineups);
}

/**
 * The same compact facts, read from the game's accumulated per-lineup totals.
 * Used by season summaries that never build a playback tape.
 */
export function buildFullCourtGameLineupsFromFacts(
  input: FullCourtPlayedGameFactsInput,
  options: FullCourtLineupFactsOptions = {},
): FullCourtGameLineups {
  const maxLineups = lineupCapOf(options);
  const threshold = sampleThresholdOf(options);
  checkedPlayedResult(input.result, input.gameId);
  const rowsBySide = verifiedFactRows(input.result, input.facts);
  return lineupSummary(input.result, input.userSide, rowsBySide, threshold, maxLineups);
}

/** Maps a verified played report to the minimal facts the season summary accepts. */
export function fullCourtCompletedGameFacts(
  report: FullCourtGameReport,
): FullCourtCompletedGameFacts | null {
  if (report.status === 'forfeit') return null;
  return {
    gameId: report.gameId,
    gameNumber: report.gameNumber,
    teamPoints: report.userPoints,
    starterPoints: report.bench.starterPoints,
    benchPoints: report.bench.points,
    teamBonusPoints: report.teamBonusPoints,
    benchPlayerCount: report.bench.players.length,
  };
}
