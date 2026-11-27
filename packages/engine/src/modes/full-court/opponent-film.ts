import type {
  Position,
  PlayerVersionId,
  SimulationRatings,
  SimulationTendencies,
} from '@hoop-rush/data-contracts';
import { compareStrings } from '../../domain/math.ts';
import type { FullCourtHistoricalTeam } from './league.ts';
import {
  fullCourtUsageTier,
  type FullCourtShotZoneRead,
  type FullCourtUsageTier,
} from './scouting.ts';

/**
 * Opponent film for a future fixture. It reads the opponent's historical rotation input
 * (minutes and catalog tendencies) and reports what that rotation does; it never claims a
 * score, record, or other actual result.
 */

export interface FullCourtFilmPlayer {
  readonly playerId: string;
  readonly playerVersionId: PlayerVersionId;
  readonly displayName: string;
  readonly positions: readonly Position[];
  readonly minutes: number;
  readonly starter: boolean;
  readonly ratings: SimulationRatings;
  readonly tendencies: SimulationTendencies;
}

export interface FullCourtFreeOpponentReport {
  readonly tier: 'free';
  readonly teamId: string;
  readonly seasonKey: string;
  readonly rosterSize: number;
  readonly starters: readonly {
    readonly playerVersionId: PlayerVersionId;
    readonly displayName: string;
  }[];
}

export interface FullCourtFilmPlayerRead {
  readonly playerVersionId: PlayerVersionId;
  readonly displayName: string;
  readonly starter: boolean;
  readonly minutes: number;
  readonly minutesShare: number;
  readonly usageRate: number;
  readonly usageTier: FullCourtUsageTier;
}

export type FullCourtFilmFindingCode =
  | 'three-point-volume'
  | 'rim-oriented'
  | 'post-up-volume'
  | 'isolation-volume'
  | 'pick-and-roll-volume'
  | 'pressure-defense'
  | 'shot-blocking'
  | 'foul-prone'
  | 'offensive-glass-pressure';

export interface FullCourtFilmFinding {
  readonly code: FullCourtFilmFindingCode;
  readonly metric: keyof SimulationTendencies;
  readonly value: number;
}

export interface FullCourtFilmReport {
  readonly tier: 'paid';
  readonly basis: 'historical-rotation-input';
  readonly teamId: string;
  readonly seasonKey: string;
  readonly rotationSize: number;
  readonly rotation: readonly FullCourtFilmPlayerRead[];
  readonly creationOrder: readonly FullCourtFilmPlayerRead[];
  readonly shotProfile: readonly FullCourtShotZoneRead[];
  readonly defensiveProfile: {
    readonly stealAttemptRate: number;
    readonly blockAttemptRate: number;
    readonly foulRate: number;
    readonly crashOffensiveGlassRate: number;
  };
  readonly notes: readonly FullCourtFilmFinding[];
}

function roundHundredths(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Historical minutes are the rotation input; no played-game data is required. */
export function fullCourtFilmRotationOf(
  team: Pick<FullCourtHistoricalTeam, 'players' | 'starterVersionIds'>,
): readonly FullCourtFilmPlayer[] {
  const starters = new Set<string>(team.starterVersionIds);
  return team.players.map((player) => ({
    playerId: player.playerId,
    playerVersionId: player.playerVersionId,
    displayName: player.displayName,
    positions: player.positions.playable,
    minutes: player.stamina.historicalMpg,
    starter: starters.has(player.playerVersionId),
    ratings: player.detailedRatings,
    tendencies: player.tendencies,
  }));
}

function totalMinutes(rotation: readonly FullCourtFilmPlayer[]): number {
  const total = rotation.reduce((sum, player) => sum + Math.max(0, player.minutes), 0);
  if (total <= 0) throw new Error('opponent film requires a rotation with positive minutes');
  return total;
}

function weightedTendency(
  rotation: readonly FullCourtFilmPlayer[],
  minutes: number,
  field: keyof SimulationTendencies,
): number {
  let total = 0;
  for (const player of [...rotation].sort((left, right) =>
    compareStrings(left.playerVersionId, right.playerVersionId),
  )) {
    total += player.tendencies[field] * Math.max(0, player.minutes);
  }
  return roundHundredths(total / minutes);
}

function filmNotes(
  rotation: readonly FullCourtFilmPlayer[],
  minutes: number,
): readonly FullCourtFilmFinding[] {
  const read = (field: keyof SimulationTendencies) => weightedTendency(rotation, minutes, field);
  const rules: ReadonlyArray<{
    readonly code: FullCourtFilmFindingCode;
    readonly metric: keyof SimulationTendencies;
    readonly minimum: number;
  }> = [
    { code: 'three-point-volume', metric: 'threePointRate', minimum: 30 },
    { code: 'rim-oriented', metric: 'rimFrequency', minimum: 30 },
    { code: 'post-up-volume', metric: 'postUpRate', minimum: 9 },
    { code: 'isolation-volume', metric: 'isolationRate', minimum: 4 },
    { code: 'pick-and-roll-volume', metric: 'pickAndRollBallHandlerRate', minimum: 28 },
    { code: 'pressure-defense', metric: 'stealAttemptRate', minimum: 10.2 },
    { code: 'shot-blocking', metric: 'blockAttemptRate', minimum: 10.2 },
    { code: 'foul-prone', metric: 'foulRate', minimum: 7.5 },
    { code: 'offensive-glass-pressure', metric: 'crashOffensiveGlassRate', minimum: 17 },
  ];
  return rules.flatMap((rule) => {
    const value = read(rule.metric);
    return value >= rule.minimum ? [{ code: rule.code, metric: rule.metric, value }] : [];
  });
}

export function fullCourtFreeOpponentReport(
  team: Pick<FullCourtHistoricalTeam, 'teamId' | 'seasonKey' | 'players' | 'starterVersionIds'>,
): FullCourtFreeOpponentReport {
  const byVersionId = new Map(team.players.map((player) => [player.playerVersionId, player]));
  return {
    tier: 'free',
    teamId: team.teamId,
    seasonKey: team.seasonKey,
    rosterSize: team.players.length,
    starters: team.starterVersionIds.map((playerVersionId) => {
      const player = byVersionId.get(playerVersionId);
      if (player === undefined) {
        throw new Error(`opponent rotation names unknown player version ${playerVersionId}`);
      }
      return { playerVersionId, displayName: player.displayName };
    }),
  };
}

export function fullCourtFilmReport(input: {
  readonly teamId: string;
  readonly seasonKey: string;
  readonly rotation: readonly FullCourtFilmPlayer[];
}): FullCourtFilmReport {
  const minutes = totalMinutes(input.rotation);
  const rotation = [...input.rotation]
    .sort(
      (left, right) =>
        right.tendencies.usageRate - left.tendencies.usageRate ||
        compareStrings(left.playerVersionId, right.playerVersionId),
    )
    .map((player) => ({
      playerVersionId: player.playerVersionId,
      displayName: player.displayName,
      starter: player.starter,
      minutes: player.minutes,
      minutesShare: Math.round((Math.max(0, player.minutes) / minutes) * 1000) / 1000,
      usageRate: player.tendencies.usageRate,
      usageTier: fullCourtUsageTier(player.tendencies.usageRate),
    }));
  return {
    tier: 'paid',
    basis: 'historical-rotation-input',
    teamId: input.teamId,
    seasonKey: input.seasonKey,
    rotationSize: rotation.length,
    rotation,
    creationOrder: rotation,
    shotProfile: [
      { zone: 'rim', frequency: weightedTendency(input.rotation, minutes, 'rimFrequency') },
      {
        zone: 'short-mid',
        frequency: weightedTendency(input.rotation, minutes, 'shortMidFrequency'),
      },
      {
        zone: 'long-mid',
        frequency: weightedTendency(input.rotation, minutes, 'longMidFrequency'),
      },
      {
        zone: 'corner-three',
        frequency: weightedTendency(input.rotation, minutes, 'cornerThreeFrequency'),
      },
      {
        zone: 'above-break-three',
        frequency: weightedTendency(input.rotation, minutes, 'aboveBreakThreeFrequency'),
      },
    ],
    defensiveProfile: {
      stealAttemptRate: weightedTendency(input.rotation, minutes, 'stealAttemptRate'),
      blockAttemptRate: weightedTendency(input.rotation, minutes, 'blockAttemptRate'),
      foulRate: weightedTendency(input.rotation, minutes, 'foulRate'),
      crashOffensiveGlassRate: weightedTendency(input.rotation, minutes, 'crashOffensiveGlassRate'),
    },
    notes: filmNotes(input.rotation, minutes),
  };
}
