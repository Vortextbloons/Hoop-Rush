import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import {
  chooseInitialUnit,
  planUnit,
  type PlannerRotationContext,
  type PlannerUnitRequest,
} from '../season/rotation-planner.ts';
import { OVERTIME_PERIOD_SECONDS, REGULATION_PERIOD_SECONDS } from '../sim/periods.ts';
const REGULATION_TICKS = 48;
const TICK_SECONDS = 60;
const CLOSING_WINDOW_SECONDS = OVERTIME_PERIOD_SECONDS;
const NON_CLOSE_MARGIN = 20;
export interface RotationTraceUnit {
  players: readonly string[];
  minutes: number;
}
export interface RotationTraceResult {
  units: RotationTraceUnit[];
  actualSeconds: ReadonlyMap<string, number>;
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
function unitKey(unit: readonly string[]): string {
  return [...unit].sort().join(',');
}
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
export function traceRotationNormal(context: PlannerRotationContext): RotationTraceResult {
  return trace(context, false);
}
export function traceRotationClose(context: PlannerRotationContext): RotationTraceResult {
  return trace(context, true);
}
