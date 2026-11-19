import {
  FULL_COURT_HEALTH_VERSION,
  fullCourtTeamHealthSchema,
  type FullCourtPlayerHealth,
  type FullCourtTeamHealth,
} from '@hoop-rush/data-contracts';
import type { EngineContext } from '../../sim/kernel.ts';
import {
  runFullCourtGame,
  type FullCourtGameInput,
  type FullCourtGameRun,
  type FullCourtTeamGameInput,
  type FullCourtTeamResult,
} from './game.ts';
import { FULL_COURT_MIN_ROSTER, FULL_COURT_REGULATION_SECONDS } from './rotation.ts';

const FULL_LOAD = 10_000;
const RECOVERY_PER_DAY = 3_500;
const REGULATION_LOAD = 6_000;
const MAX_ENERGY_LOSS = 0.3;

type Side = 'home' | 'away';

export interface FullCourtGameHealthOptions {
  readonly health?: Readonly<Partial<Record<Side, FullCourtTeamHealth>>>;
  readonly restingPlayerIds?: Readonly<Partial<Record<Side, readonly string[]>>>;
  readonly record?: boolean;
}

export type FullCourtGameHealthOutcome =
  | { readonly kind: 'rest-conflict'; readonly sides: readonly Side[] }
  | {
      readonly kind: 'forfeit';
      readonly sides: readonly Side[];
      readonly winner: Side | null;
      readonly health: Readonly<Record<Side, FullCourtTeamHealth>>;
    }
  | ({
      readonly kind: 'played';
      readonly health: Readonly<Record<Side, FullCourtTeamHealth>>;
    } & FullCourtGameRun);

function prepareTeamHealth(
  team: FullCourtTeamGameInput,
  dayOffset: number,
  previous: FullCourtTeamHealth | undefined,
  restIds: readonly string[] | undefined,
) {
  const snapshot = previous === undefined ? undefined : fullCourtTeamHealthSchema.parse(previous);
  if (
    snapshot !== undefined &&
    (snapshot.teamId !== team.teamId || snapshot.throughDay >= dayOffset)
  ) {
    throw new Error(`Full Court health snapshot does not precede the fixture for ${team.teamId}`);
  }
  const rosterIds = new Set<string>(team.roster.map((player) => player.playerId));
  const rests = new Set(restIds);
  const priorAvailability = new Map(team.availability?.map((entry) => [entry.playerId, entry]));
  for (const id of [
    ...rests,
    ...priorAvailability.keys(),
    ...Object.keys(snapshot?.players ?? {}),
  ]) {
    if (!rosterIds.has(id)) throw new Error(`Full Court health references unknown player ${id}`);
  }
  const recovery =
    snapshot === undefined ? 0 : (dayOffset - snapshot.throughDay) * RECOVERY_PER_DAY;
  const players: Record<string, FullCourtPlayerHealth> = {};
  let eligible = 0;
  let playing = 0;
  const availability = team.roster.map(({ playerId }) => {
    const prior = snapshot?.players[playerId];
    const loadBasisPoints = Math.max(0, (prior?.loadBasisPoints ?? 0) - recovery);
    const returnDay = prior?.availableFromDay ?? null;
    const availableFromDay = returnDay !== null && returnDay > dayOffset ? returnDay : null;
    if (loadBasisPoints > 0 || availableFromDay !== null) {
      players[playerId] = { loadBasisPoints, availableFromDay };
    }
    const base = priorAvailability.get(playerId);
    const injured = availableFromDay !== null;
    const resting = rests.has(playerId);
    const canPlay = !injured && (base?.available ?? true);
    const available = canPlay && !resting;
    if (canPlay) eligible += 1;
    if (available) playing += 1;
    return {
      ...base,
      playerId,
      available,
      ...(injured ? { reason: 'injury' as const } : resting ? { reason: 'rest' as const } : {}),
      energy: (base?.energy ?? 1) * (1 - (MAX_ENERGY_LOSS * loadBasisPoints) / FULL_LOAD),
    };
  });
  const health: FullCourtTeamHealth = {
    version: FULL_COURT_HEALTH_VERSION,
    teamId: team.teamId,
    throughDay: dayOffset,
    players,
  };
  return { team: { ...team, availability }, health, eligible, playing };
}

function addWorkload(health: FullCourtTeamHealth, result: FullCourtTeamResult): void {
  for (const player of result.players) {
    if (player.seconds === 0) continue;
    const prior = health.players[player.playerId];
    const minutesLoad = Math.round(
      (player.seconds / FULL_COURT_REGULATION_SECONDS) * REGULATION_LOAD,
    );
    health.players[player.playerId] = {
      loadBasisPoints: Math.min(FULL_LOAD, (prior?.loadBasisPoints ?? 0) + minutesLoad),
      availableFromDay: prior?.availableFromDay ?? null,
    };
  }
}

export function runFullCourtGameWithHealth(
  game: FullCourtGameInput,
  dayOffset: number,
  context: EngineContext,
  options: FullCourtGameHealthOptions = {},
): FullCourtGameHealthOutcome {
  if (!Number.isSafeInteger(dayOffset) || dayOffset < 0)
    throw new Error('Invalid Full Court game day');
  const home = prepareTeamHealth(
    game.home,
    dayOffset,
    options.health?.home,
    options.restingPlayerIds?.home,
  );
  const away = prepareTeamHealth(
    game.away,
    dayOffset,
    options.health?.away,
    options.restingPlayerIds?.away,
  );
  const prepared = { home, away };
  const sides = ['home', 'away'] as const;
  const short = sides.filter((side) => prepared[side].playing < FULL_COURT_MIN_ROSTER);
  const restConflicts = short.filter((side) => prepared[side].eligible >= FULL_COURT_MIN_ROSTER);
  if (restConflicts.length > 0) return { kind: 'rest-conflict', sides: restConflicts };
  const health = { home: home.health, away: away.health };
  if (short.length > 0) {
    const winner = sides.find((side) => !short.includes(side)) ?? null;
    return { kind: 'forfeit', sides: short, winner, health };
  }
  const run = runFullCourtGame({ ...game, home: home.team, away: away.team }, context, {
    record: options.record === true,
  });
  addWorkload(health.home, run.result.home);
  addWorkload(health.away, run.result.away);
  return { kind: 'played', ...run, health };
}
