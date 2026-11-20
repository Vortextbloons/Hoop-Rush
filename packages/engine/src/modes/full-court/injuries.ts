import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  type FullCourtHealthProfileSet,
  type Seed,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { hexSeed } from '../../challenge/seeds.ts';
import { clamp } from '../../domain/math.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import type { Rng } from '../../sim/rng.ts';
import type { FullCourtPlayerLine } from './game.ts';

export const FULL_COURT_INJURY_VERSION = 'full-court-injury-v1';

/** Profile rates are quoted per 10,000 appearances, so one appearance is 1/10,000. */
const APPEARANCES_PER_RATE = 10_000;

/**
 * Exposure is actual playing time divided by the player's historical minutes per
 * game, bounded to half..double. The bound keeps one unusually long or short
 * outing from scripting an injury. This workload relationship is an initial
 * conservative design target, not a fitted effect, so it stays bounded and
 * neutral (1) when the historical workload is unknown.
 */
const MIN_EXPOSURE_FACTOR = 0.5;
const MAX_EXPOSURE_FACTOR = 2;

/**
 * Duration buckets match the packaged profile: 1, 2-3, 4-13, and 14+ games.
 * The open bucket is approximated as 14..27 games so a draw remains bounded
 * and deterministic; the packaged counts cannot identify a longer tail.
 */
const OPEN_DURATION_MIN = 14;
const OPEN_DURATION_MAX = 27;

/**
 * Beyond the known calendar, use at least two days between projected fixtures.
 * Reusing the largest observed gap makes the projected return conservative.
 */
const MIN_RETURN_SPACING_DAYS = 2;

/** Time loss only: onset, availability, and a projected return. No body part is claimed. */
export interface FullCourtInjuryEvent {
  readonly teamId: string;
  readonly playerId: SimulationPlayer['playerId'];
  /** The profile key used for the draw. */
  readonly playerVersionId: string;
  readonly cohortId: string;
  /** Day of the completed game on which the time-loss injury occurred. */
  readonly onsetDay: number;
  /** Consecutive future team games missed, sampled from the cohort duration counts. */
  readonly gamesMissed: number;
  /** First day the player is available again; always strictly after `onsetDay`. */
  readonly availableFromDay: number;
  /** True when the supplied future calendar could not cover every missed game. */
  readonly projected: boolean;
}

/** One player's completed-game exposure, kept free of narrative detail. */
export interface FullCourtInjuryParticipant {
  readonly playerId: SimulationPlayer['playerId'];
  readonly playerVersionId: string | undefined;
  /** Historical minutes per game from the simulation anchors, when available. */
  readonly historicalMpg: number | null;
  readonly seconds: number;
  readonly available: boolean;
}

export interface FullCourtInjuryDrawInput {
  readonly seed: Seed;
  readonly dayOffset: number;
  readonly teamId: string;
  readonly participants: readonly FullCourtInjuryParticipant[];
  readonly profiles: FullCourtHealthProfileSet;
  /** Team fixture days strictly after `dayOffset`. */
  readonly futureDays?: readonly number[] | undefined;
  readonly context: EngineContext;
}

export interface FullCourtInjuryReturnProjection {
  readonly availableFromDay: number;
  /** True when part of the absence was projected past the supplied calendar. */
  readonly projected: boolean;
}

/** Named per game, team, and player, so one draw never shifts another's stream. */
export function fullCourtInjurySeed(seed: Seed, teamId: string, playerVersionId: string): Seed {
  return hexSeed(`hoop-rush:${FULL_COURT_INJURY_VERSION}:${seed}:${teamId}:${playerVersionId}`);
}

/** Maps completed box-score lines onto roster players by id, keyed later by version. */
export function fullCourtInjuryParticipants(
  roster: readonly SimulationPlayer[],
  lines: readonly Pick<FullCourtPlayerLine, 'playerId' | 'seconds' | 'available'>[],
): readonly FullCourtInjuryParticipant[] {
  const byPlayerId = new Map(roster.map((player) => [player.playerId, player]));
  return lines.map((line) => {
    const player = byPlayerId.get(line.playerId);
    if (player === undefined) {
      throw new Error(`Full Court injury line references unknown player ${line.playerId}`);
    }
    return {
      playerId: line.playerId,
      playerVersionId: player.playerVersionId,
      historicalMpg: player.anchors?.minutesPerGame ?? null,
      seconds: line.seconds,
      available: line.available,
    };
  });
}

export function fullCourtInjuryExposureFactor(
  seconds: number,
  historicalMpg: number | null,
): number {
  if (historicalMpg === null || !Number.isFinite(historicalMpg) || historicalMpg <= 0) return 1;
  return clamp(seconds / (historicalMpg * 60), MIN_EXPOSURE_FACTOR, MAX_EXPOSURE_FACTOR);
}

/**
 * Translates missed games into a return day. Games inside the supplied calendar
 * resolve to the day after the last missed fixture. Once the calendar runs out,
 * the remaining games use the calendar's largest observed spacing (at least two
 * days), which projects a later rather than earlier return.
 */
export function projectFullCourtInjuryReturn(
  dayOffset: number,
  futureDays: readonly number[],
  gamesMissed: number,
): FullCourtInjuryReturnProjection {
  if (!Number.isSafeInteger(gamesMissed) || gamesMissed < 1) {
    throw new Error(`Full Court injury games missed must be a positive integer`);
  }
  validateFullCourtFutureDays(futureDays, dayOffset);
  if (gamesMissed <= futureDays.length) {
    const missedThrough = futureDays[gamesMissed - 1];
    if (missedThrough === undefined) throw new Error('Full Court injury calendar is incomplete');
    return { availableFromDay: missedThrough + 1, projected: false };
  }
  const covered = futureDays.length;
  const lastCovered = futureDays[covered - 1] ?? dayOffset;
  const spacing = returnSpacingDays(dayOffset, futureDays);
  return {
    availableFromDay: lastCovered + (gamesMissed - covered) * spacing + 1,
    projected: true,
  };
}

/** `futureDays` must be strictly increasing days after the completed game. */
export function validateFullCourtFutureDays(
  futureDays: readonly number[],
  dayOffset: number,
): void {
  if (!Number.isSafeInteger(dayOffset) || dayOffset < 0) {
    throw new Error('Full Court injury day must be a nonnegative integer');
  }
  let previous = dayOffset;
  for (const day of futureDays) {
    if (!Number.isSafeInteger(day) || day <= previous) {
      throw new Error('Full Court future game days must be increasing integers after the game');
    }
    previous = day;
  }
}

function returnSpacingDays(dayOffset: number, futureDays: readonly number[]): number {
  let spacing = MIN_RETURN_SPACING_DAYS;
  let previous = dayOffset;
  for (const day of futureDays) {
    spacing = Math.max(spacing, day - previous);
    previous = day;
  }
  return spacing;
}

function sampleGamesMissed(
  rng: Rng,
  durationCounts: readonly [number, number, number, number],
): number {
  const episodes = durationCounts.reduce((sum, count) => sum + count, 0);
  if (episodes <= 0) {
    throw new Error('Full Court injury cohort has no duration evidence');
  }
  const bucket = rng.weightedPick([0, 1, 2, 3] as const, durationCounts);
  if (bucket === 0) return 1;
  if (bucket === 1) return rng.nextInt(2, 3);
  if (bucket === 2) return rng.nextInt(4, 13);
  return rng.nextInt(OPEN_DURATION_MIN, OPEN_DURATION_MAX);
}

/**
 * Experimental time-loss draws for one completed team game. Disabled callers
 * never reach this function, so the game RNG and result are unchanged. Every
 * sampled player uses a named seed; availability and playing time filter DNPs,
 * voluntary rest, and players already unavailable before tipoff.
 */
export function drawFullCourtInjuries(
  input: FullCourtInjuryDrawInput,
): readonly FullCourtInjuryEvent[] {
  const profileVersion: string = input.profiles.version;
  if (profileVersion !== FULL_COURT_HEALTH_PROFILE_VERSION) {
    throw new Error(`Unsupported Full Court health profile ${profileVersion}`);
  }
  const futureDays = input.futureDays ?? [];
  validateFullCourtFutureDays(futureDays, input.dayOffset);
  const events: FullCourtInjuryEvent[] = [];
  for (const participant of input.participants) {
    if (!participant.available || participant.seconds <= 0) continue;
    const playerVersionId = participant.playerVersionId;
    // A version id is the profile key; without one there is no supported prior.
    if (playerVersionId === undefined) continue;
    const profile = input.profiles.players[playerVersionId];
    if (profile === undefined) continue;
    const cohort = input.profiles.cohorts[profile.cohortId];
    if (cohort === undefined) {
      throw new Error(`Full Court injury profile references unknown cohort ${profile.cohortId}`);
    }
    const probability = Math.min(
      1,
      (profile.episodesPer10kAppearances / APPEARANCES_PER_RATE) *
        fullCourtInjuryExposureFactor(participant.seconds, participant.historicalMpg),
    );
    if (probability <= 0) continue;
    const rng = input.context.rngFactory(
      fullCourtInjurySeed(input.seed, input.teamId, playerVersionId),
    );
    if (!rng.chance(probability)) continue;
    const gamesMissed = sampleGamesMissed(rng, cohort.durationCounts);
    const projection = projectFullCourtInjuryReturn(input.dayOffset, futureDays, gamesMissed);
    events.push({
      teamId: input.teamId,
      playerId: participant.playerId,
      playerVersionId,
      cohortId: profile.cohortId,
      onsetDay: input.dayOffset,
      gamesMissed,
      availableFromDay: projection.availableFromDay,
      projected: projection.projected,
    });
  }
  return events;
}
