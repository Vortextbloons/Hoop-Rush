import type { GameTapeEvent, GameTapeStatLine } from '@hoop-rush/data-contracts';
import type { GamecastRecordedGame } from './gamecast-types';

const LINE_LENGTH = 15;

export interface GamecastVisiblePeriod {
  period: number;
  homeScore: number;
  awayScore: number;
}
export interface GamecastVisibleState {
  homeScore: number;
  awayScore: number;
  homePlayerLines: GameTapeStatLine[];
  awayPlayerLines: GameTapeStatLine[];
  periods: GamecastVisiblePeriod[];
}

export interface GamecastPlaybackPositionInput {
  startedAtIso: string;
  durationMs: number;
  serverOffsetMs: number;
  nowMs: number;
}

function zeroLine(): GameTapeStatLine {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

export function gamecastPlaybackWeights(tape: readonly GameTapeEvent[]): number[] {
  const weights: number[] = tape.map((event) => (event.kind === 'trip' ? 1 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) {
    return weights.map((_, index) => (index === weights.length - 1 ? 1 : 0));
  }
  const cumulative: number[] = [];
  let running = 0;
  for (const weight of weights) {
    running += weight;
    cumulative.push(running / total);
  }
  return cumulative;
}

export function gamecastVisibleEventCount(
  tape: readonly GameTapeEvent[],
  progress: number,
): number {
  if (tape.length === 0) return 0;
  if (Number.isNaN(progress)) return 0;
  const clamped = Math.min(1, Math.max(0, progress));
  if (clamped >= 1) return tape.length;
  const cumulative = gamecastPlaybackWeights(tape);
  let count = 0;
  while (count < tape.length && (cumulative[count] ?? Number.POSITIVE_INFINITY) <= clamped) {
    count += 1;
  }
  return count;
}

export function gamecastVisibleState(
  output: Pick<GamecastRecordedGame, 'tape'>,
  visibleCount: number,
): GamecastVisibleState {
  const events = output.tape;
  const count = Number.isNaN(visibleCount)
    ? 0
    : Math.max(0, Math.min(events.length, Math.trunc(visibleCount)));
  const homePlayerLines = Array.from({ length: 5 }, () => zeroLine());
  const awayPlayerLines = Array.from({ length: 5 }, () => zeroLine());
  const periods: GamecastVisiblePeriod[] = [];
  let homeScore = 0;
  let awayScore = 0;
  for (let index = 0; index < count; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    if (event.kind === 'period') {
      periods.push({
        period: event.period,
        homeScore: event.homeScore,
        awayScore: event.awayScore,
      });
      continue;
    }
    for (let side = 0; side < 2; side += 1) {
      const deltas = side === 0 ? event.homeDeltas : event.awayDeltas;
      const lines = side === 0 ? homePlayerLines : awayPlayerLines;
      for (let slot = 0; slot < 5; slot += 1) {
        const delta = deltas[slot];
        const line = lines[slot];
        if (delta === undefined || line === undefined) continue;
        for (let field = 0; field < LINE_LENGTH; field += 1) {
          line[field] = (line[field] ?? 0) + (delta[field] ?? 0);
        }
      }
    }
    homeScore += event.homeTeamDeltas[0];
    awayScore += event.awayTeamDeltas[0];
  }
  return { homeScore, awayScore, homePlayerLines, awayPlayerLines, periods };
}

export function gamecastPlaybackPositionMs(input: GamecastPlaybackPositionInput): number {
  const { startedAtIso, durationMs, serverOffsetMs, nowMs } = input;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const startedAtMs = Date.parse(startedAtIso);
  if (
    !Number.isFinite(startedAtMs) ||
    !Number.isFinite(serverOffsetMs) ||
    !Number.isFinite(nowMs)
  ) {
    return 0;
  }
  const elapsed = nowMs + serverOffsetMs - startedAtMs;
  return Math.min(durationMs, Math.max(0, elapsed));
}
