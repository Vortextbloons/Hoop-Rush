import {
  FULL_COURT_MAX_DEFENSIVE_MATCHUPS,
  type FullCourtDefensiveMatchupAssignment,
  type FullCourtDefensiveMatchups,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { SHOT_ZONES } from '../../domain/zones.ts';
import { ENGINE_CONSTANTS } from '../../sim/constants.ts';
import type { TeamPrep } from '../../sim/prepare.ts';
import { buildTrustedWeightedPickTable, type WeightedPickTable } from '../../sim/rng.ts';

const ACTIVE_FIVE_COUNT = 5;

/**
 * Primary matchup weights applied to `defenderBase.pickTables` when both
 * the opponent target and assigned user defender are on the floor. Never
 * modifies player ratings or tendencies; shifts contest share within the active five.
 */
export const FULL_COURT_MANUAL_MATCHUP_PERIMETER_WEIGHT = 5;
export const FULL_COURT_MANUAL_MATCHUP_INTERIOR_WEIGHT = 2.5;

export interface FullCourtMatchupValidationInput {
  readonly userRoster: readonly SimulationPlayer[];
  readonly opponentTeamId: string;
  readonly opponentRoster: readonly SimulationPlayer[];
  readonly gameId?: string;
  readonly matchups: FullCourtDefensiveMatchups;
}

/** Validates per-fixture defensive matchups against both locked rosters. */
export function validateFullCourtDefensiveMatchups(
  input: FullCourtMatchupValidationInput,
): readonly string[] {
  const { userRoster, opponentTeamId, opponentRoster, gameId, matchups } = input;
  const errors: string[] = [];

  if (gameId !== undefined && matchups.gameId !== undefined && matchups.gameId !== gameId) {
    errors.push('Defensive matchups belong to a different fixture.');
  }
  if (matchups.opponentTeamId !== opponentTeamId) {
    errors.push('Defensive matchups belong to a different opponent.');
  }
  if (matchups.assignments.length > FULL_COURT_MAX_DEFENSIVE_MATCHUPS) {
    errors.push(`Assign ${String(FULL_COURT_MAX_DEFENSIVE_MATCHUPS)} defensive matchups or fewer.`);
  }

  const userIds = new Set<string>(userRoster.map((player) => player.playerId));
  const opponentIds = new Set<string>(opponentRoster.map((player) => player.playerId));
  const seenOpponents = new Set<string>();
  const seenDefenders = new Set<string>();

  for (const assignment of matchups.assignments) {
    if (!opponentIds.has(assignment.opponentPlayerId)) {
      errors.push('A matchup target is outside the opponent roster.');
    }
    if (!userIds.has(assignment.defenderPlayerId)) {
      errors.push('An assigned defender is outside your roster.');
    }
    if (seenOpponents.has(assignment.opponentPlayerId)) {
      errors.push('Each opponent player can have at most one assigned defender.');
    }
    if (seenDefenders.has(assignment.defenderPlayerId)) {
      errors.push('Each defender can guard at most one assigned opponent.');
    }
    seenOpponents.add(assignment.opponentPlayerId);
    seenDefenders.add(assignment.defenderPlayerId);
  }

  return errors;
}

export function assertFullCourtDefensiveMatchups(input: FullCourtMatchupValidationInput): void {
  const errors = validateFullCourtDefensiveMatchups(input);
  if (errors.length > 0) {
    throw new Error(errors[0] ?? 'Invalid Full Court defensive matchups.');
  }
}

/**
 * Returns the fixture matchups only when they apply to the current fixture and
 * opponent, ensuring stale assignments are never carried to another game.
 */
export function fixtureFullCourtDefensiveMatchups(
  matchups: FullCourtDefensiveMatchups | undefined,
  gameId: string,
  opponentTeamId: string,
): FullCourtDefensiveMatchups | undefined {
  if (matchups === undefined || matchups.assignments.length === 0) return undefined;
  if (matchups.opponentTeamId !== opponentTeamId) return undefined;
  if (matchups.gameId !== undefined && matchups.gameId !== gameId) return undefined;
  return matchups;
}

/**
 * Resolves valid, deduplicated `opponentPlayerId -> defenderPlayerId` pairs for
 * one game. Stale opponent IDs or unknown roster IDs are ignored safely.
 */
export function resolveFullCourtDefensiveMatchups(input: {
  readonly ownRoster: readonly SimulationPlayer[];
  readonly opponentTeamId: string;
  readonly opponentRoster: readonly SimulationPlayer[];
  readonly matchups: FullCourtDefensiveMatchups | undefined;
}): ReadonlyMap<string, string> | null {
  const { ownRoster, opponentTeamId, opponentRoster, matchups } = input;
  if (matchups === undefined || matchups.assignments.length === 0) return null;
  if (matchups.opponentTeamId !== opponentTeamId) return null;

  const ownIds = new Set<string>(ownRoster.map((player) => player.playerId));
  const opponentIds = new Set<string>(opponentRoster.map((player) => player.playerId));
  const seenDefenders = new Set<string>();
  const resolved = new Map<string, string>();

  for (const assignment of matchups.assignments) {
    if (resolved.size >= FULL_COURT_MAX_DEFENSIVE_MATCHUPS) break;
    if (!opponentIds.has(assignment.opponentPlayerId)) continue;
    if (!ownIds.has(assignment.defenderPlayerId)) continue;
    if (resolved.has(assignment.opponentPlayerId)) continue;
    if (seenDefenders.has(assignment.defenderPlayerId)) continue;
    resolved.set(assignment.opponentPlayerId, assignment.defenderPlayerId);
    seenDefenders.add(assignment.defenderPlayerId);
  }

  return resolved.size === 0 ? null : resolved;
}

export interface ActiveDefensiveMatchupSignature {
  readonly key: string;
  readonly pairs: readonly (readonly [number, number])[];
}

/**
 * Computes active `(shooterSlot, defenderSlot)` pairs on the current 5-on-5
 * floor. Returns `null` when no manual pair is simultaneously active so default
 * `TeamPrep` and seeded results stay untouched.
 */
export function activeDefensiveMatchupSignature(
  defenseSlots: readonly number[],
  defenseRoster: readonly SimulationPlayer[],
  offenseActivePlayerIds: readonly string[],
  resolvedMatchups: ReadonlyMap<string, string> | null,
): ActiveDefensiveMatchupSignature | null {
  if (
    resolvedMatchups === null ||
    resolvedMatchups.size === 0 ||
    defenseSlots.length !== ACTIVE_FIVE_COUNT ||
    offenseActivePlayerIds.length !== ACTIVE_FIVE_COUNT
  ) {
    return null;
  }

  const defenseSlotByPlayerId = new Map<string, number>();
  for (let slot = 0; slot < defenseSlots.length; slot += 1) {
    const rosterIndex = defenseSlots[slot];
    if (rosterIndex === undefined) continue;
    const player = defenseRoster[rosterIndex];
    if (player !== undefined) defenseSlotByPlayerId.set(player.playerId, slot);
  }

  const pairs: Array<readonly [number, number]> = [];
  for (let shooterSlot = 0; shooterSlot < ACTIVE_FIVE_COUNT; shooterSlot += 1) {
    const opponentId = offenseActivePlayerIds[shooterSlot];
    if (opponentId === undefined) continue;
    const defenderId = resolvedMatchups.get(opponentId);
    if (defenderId === undefined) continue;
    const defenderSlot = defenseSlotByPlayerId.get(defenderId);
    if (defenderSlot === undefined) continue;
    pairs.push([shooterSlot, defenderSlot]);
  }

  if (pairs.length === 0) return null;
  return {
    key: pairs
      .map(([shooterSlot, defenderSlot]) => `${String(shooterSlot)}:${String(defenderSlot)}`)
      .join(','),
    pairs,
  };
}

/**
 * Rebuilds `defenderBase.pickTables` for the active five using a clean 1-to-1
 * primary matching: active manual pairs take priority, natural same-slot
 * defenders stay intact where available, and displaced defenders cover remaining
 * offensive slots without overloading one defender onto two simultaneous targets.
 */
export function applyFullCourtDefensiveMatchupsToPrep(
  prep: TeamPrep,
  activePairs: readonly (readonly [number, number])[],
): TeamPrep {
  if (activePairs.length === 0) return prep;
  const { weights, rimProtection, pickTables: basePickTables } = prep.defenderBase;
  if (
    weights.length !== SHOT_ZONES.length ||
    rimProtection.length !== ACTIVE_FIVE_COUNT ||
    basePickTables[0]?.length !== ACTIVE_FIVE_COUNT
  ) {
    return prep;
  }

  const primaryDefender = new Array<number>(ACTIVE_FIVE_COUNT).fill(-1);
  const manualShooters = new Set<number>();
  const takenDefenders = new Set<number>();

  for (const [shooterSlot, defenderSlot] of activePairs) {
    if (
      shooterSlot < 0 ||
      shooterSlot >= ACTIVE_FIVE_COUNT ||
      defenderSlot < 0 ||
      defenderSlot >= ACTIVE_FIVE_COUNT
    ) {
      continue;
    }
    if (manualShooters.has(shooterSlot) || takenDefenders.has(defenderSlot)) continue;
    primaryDefender[shooterSlot] = defenderSlot;
    manualShooters.add(shooterSlot);
    takenDefenders.add(defenderSlot);
  }

  if (manualShooters.size === 0) return prep;

  for (let shooterSlot = 0; shooterSlot < ACTIVE_FIVE_COUNT; shooterSlot += 1) {
    if (primaryDefender[shooterSlot] !== -1) continue;
    if (!takenDefenders.has(shooterSlot)) {
      primaryDefender[shooterSlot] = shooterSlot;
      takenDefenders.add(shooterSlot);
    }
  }

  const remainingDefenders: number[] = [];
  for (let defenderSlot = 0; defenderSlot < ACTIVE_FIVE_COUNT; defenderSlot += 1) {
    if (!takenDefenders.has(defenderSlot)) remainingDefenders.push(defenderSlot);
  }
  let nextRemaining = 0;
  for (let shooterSlot = 0; shooterSlot < ACTIVE_FIVE_COUNT; shooterSlot += 1) {
    if (primaryDefender[shooterSlot] !== -1) continue;
    const fallback = remainingDefenders[nextRemaining];
    if (fallback === undefined) break;
    primaryDefender[shooterSlot] = fallback;
    nextRemaining += 1;
  }

  const pickTables: WeightedPickTable[][] = [];
  for (let zoneIndex = 0; zoneIndex < SHOT_ZONES.length; zoneIndex += 1) {
    const interior = zoneIndex === 0 || zoneIndex === 1;
    const zoneWeights = weights[zoneIndex] ?? [];
    const zoneTables: WeightedPickTable[] = [];
    for (let shooterSlot = 0; shooterSlot < ACTIVE_FIVE_COUNT; shooterSlot += 1) {
      const primary = primaryDefender[shooterSlot] ?? shooterSlot;
      const isManual = manualShooters.has(shooterSlot);
      const slotWeights = Array.from({ length: ACTIVE_FIVE_COUNT }, (_value, defenderSlot) => {
        let match = 1;
        if (defenderSlot === primary) {
          match = isManual
            ? interior
              ? FULL_COURT_MANUAL_MATCHUP_INTERIOR_WEIGHT
              : FULL_COURT_MANUAL_MATCHUP_PERIMETER_WEIGHT
            : interior
              ? ENGINE_CONSTANTS.positionMatchBonus
              : ENGINE_CONSTANTS.perimeterMatchBonus;
        }
        const rim = interior ? (rimProtection[defenderSlot] ?? 1) : 1;
        return (zoneWeights[defenderSlot] ?? 0) * match * rim;
      });
      zoneTables.push(buildTrustedWeightedPickTable(slotWeights));
    }
    pickTables.push(zoneTables);
  }

  return {
    ...prep,
    defenderBase: {
      weights,
      rimProtection,
      pickTables,
    },
  };
}

export function normalizeDefensiveMatchupAssignments(
  assignments: readonly FullCourtDefensiveMatchupAssignment[],
): FullCourtDefensiveMatchupAssignment[] {
  const seenOpponents = new Set<string>();
  const seenDefenders = new Set<string>();
  const normalized: FullCourtDefensiveMatchupAssignment[] = [];
  for (const assignment of assignments) {
    if (normalized.length >= FULL_COURT_MAX_DEFENSIVE_MATCHUPS) break;
    if (seenOpponents.has(assignment.opponentPlayerId)) continue;
    if (seenDefenders.has(assignment.defenderPlayerId)) continue;
    seenOpponents.add(assignment.opponentPlayerId);
    seenDefenders.add(assignment.defenderPlayerId);
    normalized.push({
      opponentPlayerId: assignment.opponentPlayerId,
      defenderPlayerId: assignment.defenderPlayerId,
    });
  }
  return normalized;
}
