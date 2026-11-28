import {
  FULL_COURT_HEALTH_VERSION,
  fullCourtTeamHealthSchema,
  type FullCourtHealthProfileSet,
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
import {
  drawFullCourtInjuries,
  fullCourtInjuryParticipants,
  type FullCourtInjuryEvent,
} from './injuries.ts';
import { FULL_COURT_MIN_ROSTER, FULL_COURT_REGULATION_SECONDS } from './rotation.ts';

const FULL_LOAD = 10_000;
const RECOVERY_PER_DAY = 3_500;
const REGULATION_LOAD = 6_000;
const MAX_ENERGY_LOSS = 0.3;
const CUMULATIVE_RECOVERY_PER_DAY = 240;
const OVERLOAD_PER_MINUTE = 220;
const CUMULATIVE_GRACE = 1_500;
const MAX_CUMULATIVE_ENERGY_LOSS = 0.24;
const MAX_CUMULATIVE_INJURY_INCREASE = 0.6;

function cumulativeStress(load: number): number {
  return Math.max(0, load - CUMULATIVE_GRACE) / (FULL_LOAD - CUMULATIVE_GRACE);
}

type Side = 'home' | 'away';

export interface FullCourtGameHealthOptions {
  readonly health?: Readonly<Partial<Record<Side, FullCourtTeamHealth>>>;
  readonly restingPlayerIds?: Readonly<Partial<Record<Side, readonly string[]>>>;
  readonly record?: boolean;
  /** Accumulate compact lineup facts without retaining a playback tape. */
  readonly lineupFacts?: boolean;
  /**
   * Experimental explicit opt-in for postgame time-loss injuries. There is no
   * default profile set; the caller supplies packaged profiles and checks their
   * catalog hash. Absent profiles leave the game RNG, result, and health as before.
   */
  readonly injuryProfiles?: FullCourtHealthProfileSet;
  /** Each side's future fixture days, strictly after this game's day. */
  readonly futureGameDays?: Readonly<Partial<Record<Side, readonly number[]>>>;
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
      /** Postgame time-loss events; empty when the injury slice is disabled. */
      readonly injuries: readonly FullCourtInjuryEvent[];
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
  const days = snapshot === undefined ? 0 : dayOffset - snapshot.throughDay;
  const recovery = days * RECOVERY_PER_DAY;
  const players: Record<string, FullCourtPlayerHealth> = {};
  let eligible = 0;
  let playing = 0;
  const availability = team.roster.map(({ playerId }) => {
    const prior = snapshot?.players[playerId];
    const loadBasisPoints = Math.max(0, (prior?.loadBasisPoints ?? 0) - recovery);
    const cumulativeLoadBasisPoints = Math.max(
      0,
      (prior?.cumulativeLoadBasisPoints ?? 0) - days * CUMULATIVE_RECOVERY_PER_DAY,
    );
    const returnDay = prior?.availableFromDay ?? null;
    const availableFromDay = returnDay !== null && returnDay > dayOffset ? returnDay : null;
    if (loadBasisPoints > 0 || cumulativeLoadBasisPoints > 0 || availableFromDay !== null) {
      players[playerId] = {
        loadBasisPoints,
        availableFromDay,
        ...(cumulativeLoadBasisPoints > 0 ? { cumulativeLoadBasisPoints } : {}),
      };
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
      energy:
        (base?.energy ?? 1) *
        (1 - (MAX_ENERGY_LOSS * loadBasisPoints) / FULL_LOAD) *
        (1 - MAX_CUMULATIVE_ENERGY_LOSS * cumulativeStress(cumulativeLoadBasisPoints)),
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

function playerStrainFactor(
  playerId: string,
  playerVersionId: string | undefined,
  staminaRating: number | undefined,
  injuryProfiles: FullCourtHealthProfileSet | undefined,
): number {
  const staminaScale =
    staminaRating === undefined
      ? 1
      : Math.max(0.75, Math.min(1.35, 1 - (staminaRating - 75) * 0.01));
  const rate =
    playerVersionId === undefined
      ? undefined
      : injuryProfiles?.players[playerVersionId]?.episodesPer10kAppearances;
  const durabilityScale =
    rate === undefined ? 1 : Math.max(0.8, Math.min(1.25, 0.8 + (rate / 100) * 0.2));
  void playerId;
  return Math.max(0.65, Math.min(1.45, staminaScale * durabilityScale));
}

function addWorkload(
  health: FullCourtTeamHealth,
  result: FullCourtTeamResult,
  team: FullCourtTeamGameInput,
  injuryProfiles: FullCourtHealthProfileSet | undefined,
): void {
  const playersById = new Map(team.roster.map((player) => [player.playerId, player]));
  const staminaById = new Map(
    (team.availability ?? []).map((entry) => [entry.playerId, entry.staminaRating]),
  );

  for (const player of result.players) {
    if (player.seconds === 0) continue;
    const prior = health.players[player.playerId];
    const rosterPlayer = playersById.get(player.playerId);
    const minutesLoad = Math.round(
      (player.seconds / FULL_COURT_REGULATION_SECONDS) * REGULATION_LOAD,
    );
    const normalMinutes = Math.max(18, rosterPlayer?.anchors?.minutesPerGame ?? 32);
    const excessMinutes = Math.max(0, player.seconds / 60 - normalMinutes - 1);
    const strainFactor = playerStrainFactor(
      player.playerId,
      rosterPlayer?.playerVersionId,
      staminaById.get(player.playerId),
      injuryProfiles,
    );
    const cumulativeLoadBasisPoints = Math.min(
      FULL_LOAD,
      (prior?.cumulativeLoadBasisPoints ?? 0) +
        Math.min(CUMULATIVE_GRACE, Math.round(excessMinutes * OVERLOAD_PER_MINUTE * strainFactor)),
    );
    health.players[player.playerId] = {
      ...(cumulativeLoadBasisPoints > 0 ? { cumulativeLoadBasisPoints } : {}),
      loadBasisPoints: Math.min(FULL_LOAD, (prior?.loadBasisPoints ?? 0) + minutesLoad),
      availableFromDay: prior?.availableFromDay ?? null,
    };
  }
}

/** Extends an existing return day; an injury never shortens another absence. */
function applyInjury(health: FullCourtTeamHealth, injury: FullCourtInjuryEvent): void {
  const prior = health.players[injury.playerId];
  health.players[injury.playerId] = {
    ...prior,
    loadBasisPoints: prior?.loadBasisPoints ?? 0,
    availableFromDay: Math.max(prior?.availableFromDay ?? 0, injury.availableFromDay),
  };
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
    lineupFacts: options.lineupFacts === true,
  });
  const injuries: FullCourtInjuryEvent[] = [];
  const profiles = options.injuryProfiles;
  if (profiles !== undefined) {
    for (const side of sides) {
      const drawn = drawFullCourtInjuries({
        seed: game.seed,
        dayOffset,
        teamId: prepared[side].team.teamId,
        participants: fullCourtInjuryParticipants(
          prepared[side].team.roster,
          run.result[side].players,
        ).map((participant) => ({
          ...participant,
          workloadRiskMultiplier:
            1 +
            MAX_CUMULATIVE_INJURY_INCREASE *
              cumulativeStress(
                health[side].players[participant.playerId]?.cumulativeLoadBasisPoints ?? 0,
              ),
        })),
        profiles,
        futureDays: options.futureGameDays?.[side],
        context,
      });
      for (const injury of drawn) applyInjury(health[side], injury);
      injuries.push(...drawn);
    }
  }
  for (const side of sides)
    addWorkload(health[side], run.result[side], prepared[side].team, profiles);
  return { kind: 'played', ...run, health, injuries };
}
