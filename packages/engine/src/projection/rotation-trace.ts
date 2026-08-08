import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import {
  chooseInitialUnit,
  planUnit,
  type PlannerRotationContext,
  type PlannerUnitRequest,
} from '../season/rotation-planner.ts';
import { OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS } from '../sim/periods.ts';

/**
 * Read-only rotation trace (projection milestone). The trace calls the
 * existing planner rules without simulating a game: it starts with
 * `chooseInitialUnit`, advances in deterministic one-minute planning ticks,
 * maintains abstract actual-minute totals, calls `planUnit` with the same
 * target-minute context the game controller uses, and applies the closing
 * preference during the final five minutes of regulation in a close-game
 * trace. It never uses score, fouls, injuries, fatigue, possessions, or RNG.
 * Treat traces as pregame target-minute projections; contingencies are
 * evaluated separately.
 */

const REGULATION_TICKS = 48;
const TICK_SECONDS = 60;
const CLOSING_WINDOW_SECONDS = OVERTIME_PERIOD_SECONDS;
/** Non-close traces use a margin that never triggers the closing window. */
const NON_CLOSE_MARGIN = 20;

/** One distinct on-court five and its planned minutes. */
export interface RotationTraceUnit {
  players: readonly string[];
  minutes: number;
}

export interface RotationTraceResult {
  units: RotationTraceUnit[];
  /** Regulation actual seconds per rostered player. */
  actualSeconds: ReadonlyMap<string, number>;
  /** Regulation minutes per rostered player. */
  actualMinutes: ReadonlyMap<string, number>;
  totalMinutes: number;
}

function trace(context: PlannerRotationContext, closeGame: boolean): RotationTraceResult {
  const members = [...context.members.keys()];
  const actualSeconds = new Map<string, number>(members.map((id) => [id, 0]));
  const unitMinutes = new Map<string, number>();
  const unitPlayers = new Map<string, readonly string[]>();
  const unavailable: ReadonlySet<string> = new Set();

  let currentUnit = chooseInitialUnit(context, unavailable);
  if (currentUnit === null) {
    // No legal five at the tipoff: the trace is empty (the controller turns
    // this into a typed forfeit; projection records the failure).
    return {
      units: [],
      actualSeconds,
      actualMinutes: emptyMinutes(actualSeconds),
      totalMinutes: 0,
    };
  }
  const firstKey = unitKey(currentUnit);
  unitMinutes.set(firstKey, 0);
  unitPlayers.set(firstKey, currentUnit);

  for (let tick = 0; tick < REGULATION_TICKS; tick += 1) {
    const period = Math.floor(tick / 12) + 1;
    const secondsRemaining = REGULATION_PERIOD_SECONDS - (tick % 12) * TICK_SECONDS;
    for (const player of currentUnit) {
      actualSeconds.set(player, (actualSeconds.get(player) ?? 0) + TICK_SECONDS);
    }
    const key = unitKey(currentUnit);
    unitMinutes.set(key, (unitMinutes.get(key) ?? 0) + 1);
    unitPlayers.set(key, currentUnit);

    // Plan the next segment at the same checkpoints the game controller uses
    // (whole-minute boundaries), with the closing preference active only in
    // the close-game trace's final five minutes of regulation.
    const closingWindow = closeGame && period === 4 && secondsRemaining <= CLOSING_WINDOW_SECONDS;
    const request: PlannerUnitRequest = {
      side: 'home',
      currentUnit,
      unavailable,
      actualSeconds,
      period,
      secondsRemaining,
      closingWindow,
      scoreMargin: closeGame ? 0 : NON_CLOSE_MARGIN,
    };
    const next = planUnit(context, request);
    if (next !== null) currentUnit = next;
  }

  const units: RotationTraceUnit[] = [...unitMinutes.entries()]
    .filter((entry) => entry[1] > 0)
    .map(([key, minutes]) => ({ players: unitPlayers.get(key) ?? key.split(','), minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  return {
    units,
    actualSeconds,
    actualMinutes: minutesOf(actualSeconds),
    totalMinutes: REGULATION_TICKS,
  };
}

function emptyMinutes(actualSeconds: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return minutesOf(actualSeconds);
}

function minutesOf(actualSeconds: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  return new Map([...actualSeconds.entries()].map(([id, seconds]) => [id, seconds / TICK_SECONDS]));
}

/** Canonical unit key: the five version ids in deterministic order. */
function unitKey(unit: readonly string[]): string {
  return [...unit].sort().join(',');
}

/** Planner context for a rotation: playable map plus target seconds. */
export function traceContext(input: {
  rotation: SeasonRotation;
  members: ReadonlyMap<string, readonly Position[]>;
}): PlannerRotationContext {
  const targets = new Map<string, number>();
  for (const row of input.rotation.targetMinutes) {
    targets.set(row.playerVersionId, row.minutes * TICK_SECONDS);
  }
  return { rotation: input.rotation, members: input.members, targets };
}

/** Normal (non-close) rotation trace. */
export function traceRotationNormal(context: PlannerRotationContext): RotationTraceResult {
  return trace(context, false);
}

/** Close-game rotation trace (closing-window preference in the final five). */
export function traceRotationClose(context: PlannerRotationContext): RotationTraceResult {
  return trace(context, true);
}
