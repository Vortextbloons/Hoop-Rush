import {
  FULL_COURT_BLUEPRINT_ROLE_KEYS,
  fullCourtBlueprintHierarchySchema,
  type FullCourtBlueprint,
  type FullCourtBlueprintHierarchy,
  type FullCourtBlueprintRoleKey,
  type FullCourtBlueprintRoleRef,
  type FullCourtOffensiveHierarchy,
  type Position,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { classifyArchetype } from '../../domain/archetypes.ts';
import { compareStrings } from '../../domain/math.ts';
import { playableSlotGroups } from '../../domain/positions.ts';
import { defaultFullCourtCoachingRotation } from './coaching.ts';

const SLOT_LABELS = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const AMBIGUITY_SCORE_EPSILON = 0.5;
const FLOOR_GENERAL_MIN_PLAYMAKING = 48;
const FLOOR_GENERAL_CROSS_GROUP_PLAYMAKING = 62;

export interface FullCourtBlueprintRotationRef {
  readonly startingFive?: readonly string[];
  readonly minuteTargets?: Readonly<Record<string, number>>;
}

export type FullCourtBlueprintRoleBindingStatus = 'matched' | 'fallback' | 'ambiguous' | 'vacant';

export interface FullCourtBlueprintRoleBinding {
  readonly role: FullCourtBlueprintRoleKey;
  readonly ref: FullCourtBlueprintRoleRef;
  readonly status: FullCourtBlueprintRoleBindingStatus;
  readonly playerId: string | null;
  readonly player: SimulationPlayer | null;
  readonly targetLabel: string;
  readonly reason: string | null;
  readonly tiedCandidates: readonly SimulationPlayer[];
}

export interface FullCourtBlueprintBindingPreview {
  readonly blueprintName: string;
  readonly hasHierarchy: boolean;
  readonly rotationSource: 'custom' | 'automatic';
  readonly bindings: readonly FullCourtBlueprintRoleBinding[];
  readonly hierarchy: FullCourtOffensiveHierarchy | undefined;
  readonly hasMissingOrVacant: boolean;
  readonly hasAmbiguous: boolean;
  readonly hasFallback: boolean;
}

interface ResolvedSlots {
  readonly rotationSource: 'custom' | 'automatic';
  readonly starters: readonly SimulationPlayer[];
  readonly bench: readonly SimulationPlayer[];
  readonly starterSlotById: ReadonlyMap<string, number>;
  readonly benchIndexById: ReadonlyMap<string, number>;
  readonly minutesById: ReadonlyMap<string, number>;
}

function assertUniqueRoster(roster: readonly SimulationPlayer[]): Map<string, SimulationPlayer> {
  const byId = new Map<string, SimulationPlayer>();
  for (const player of roster) {
    if (byId.has(player.playerId)) {
      throw new Error(`Full Court roster repeats player ${player.playerId}.`);
    }
    byId.set(player.playerId, player);
  }
  return byId;
}

function resolveRotationSlots(
  roster: readonly SimulationPlayer[],
  rotation: FullCourtBlueprintRotationRef | undefined,
): ResolvedSlots {
  const byId = assertUniqueRoster(roster);
  const customStarters = rotation?.startingFive;
  const customMinutes = rotation?.minuteTargets;
  const hasValidCustom =
    customStarters !== undefined &&
    customStarters.length === 5 &&
    new Set(customStarters).size === 5 &&
    customStarters.every((id) => byId.has(id)) &&
    customMinutes !== undefined;

  const activeRotation = hasValidCustom
    ? { startingFive: customStarters, minuteTargets: customMinutes }
    : defaultFullCourtCoachingRotation({
        teamId: 'blueprint',
        displayName: 'Blueprint',
        roster,
      });

  const starters = activeRotation.startingFive.map((id) => {
    const player = byId.get(id);
    if (player === undefined) throw new Error('The rotation includes a player outside the roster.');
    return player;
  });
  const starterSet = new Set(activeRotation.startingFive);
  const minutesById = new Map<string, number>(
    roster.map((player) => [player.playerId, activeRotation.minuteTargets[player.playerId] ?? 0]),
  );
  const bench = roster
    .filter((player) => !starterSet.has(player.playerId))
    .sort(
      (left, right) =>
        (minutesById.get(right.playerId) ?? 0) - (minutesById.get(left.playerId) ?? 0) ||
        compareStrings(left.displayName, right.displayName) ||
        compareStrings(left.playerId, right.playerId),
    );
  const starterSlotById = new Map(starters.map((player, index) => [player.playerId, index]));
  const benchIndexById = new Map(bench.map((player, index) => [player.playerId, index]));

  return {
    rotationSource: hasValidCustom ? 'custom' : 'automatic',
    starters,
    bench,
    starterSlotById,
    benchIndexById,
    minutesById,
  };
}

function positionsLabel(positions: readonly Position[]): string {
  return [...positions].join('/');
}

function formatRoleRefLabel(ref: FullCourtBlueprintRoleRef): string {
  if (ref.kind === 'starter-slot') {
    const pos = SLOT_LABELS[ref.slot] ?? '';
    return `Starter ${String(ref.slot + 1)}${pos === '' ? '' : ` (${pos})`}`;
  }
  if (ref.kind === 'bench-slot') {
    return `Bench ${String(ref.benchIndex + 1)}`;
  }
  const parts: string[] = [];
  if (ref.preferredPositions !== undefined) parts.push(positionsLabel(ref.preferredPositions));
  if (ref.archetype !== undefined) parts.push(ref.archetype);
  return parts.length === 0 ? 'Role fit' : `Role fit (${parts.join(' · ')})`;
}

function playmakingSkillOf(player: SimulationPlayer): number {
  const r = player.ratings;
  return r.passing * 0.42 + r.ballHandling * 0.36 + r.offensiveIq * 0.22;
}

function effectiveOverallOf(player: SimulationPlayer): number {
  const explicit = player.overall ?? player.ratingProfile?.canonicalOverall;
  if (explicit !== undefined) return explicit;
  const r = player.ratings;
  return (
    r.insideScoring * 0.25 +
    r.closeShot * 0.2 +
    r.midrange * 0.15 +
    r.threePoint * 0.2 +
    r.passing * 0.1 +
    r.ballHandling * 0.1
  );
}

function hasPositionOverlap(
  playerPositions: readonly Position[],
  preferredPositions: readonly Position[],
): { readonly exact: boolean; readonly group: boolean } {
  const exact = playerPositions.some((pos) => preferredPositions.includes(pos));
  const playerGroups = playableSlotGroups(playerPositions);
  const preferredGroups = playableSlotGroups(preferredPositions);
  const group = playerGroups.some((g) => preferredGroups.includes(g));
  return { exact, group };
}

function isCompatibleForRole(
  player: SimulationPlayer,
  role: FullCourtBlueprintRoleKey,
  ref: FullCourtBlueprintRoleRef,
): boolean {
  const playmaking = playmakingSkillOf(player);
  const overlap =
    ref.preferredPositions === undefined
      ? { exact: true, group: true }
      : hasPositionOverlap(player.positions, ref.preferredPositions);

  if (role === 'floorGeneral') {
    const isGuard = player.positions.includes('PG') || player.positions.includes('SG');
    if (
      ref.preferredPositions !== undefined &&
      !overlap.group &&
      playmaking < FLOOR_GENERAL_CROSS_GROUP_PLAYMAKING
    ) {
      return false;
    }
    if (!isGuard && playmaking < FLOOR_GENERAL_MIN_PLAYMAKING) {
      return false;
    }
    return true;
  }

  if (ref.preferredPositions !== undefined && !overlap.group) {
    if (ref.archetype !== undefined && classifyArchetype(player) === ref.archetype) {
      return true;
    }
    return false;
  }
  return true;
}

function scorePlayerForRole(
  player: SimulationPlayer,
  role: FullCourtBlueprintRoleKey,
  ref: FullCourtBlueprintRoleRef,
  slots: ResolvedSlots,
): number {
  const r = player.ratings;
  const overall = effectiveOverallOf(player);
  const usageScore = Math.min(100, Math.max(0, (player.tendencies.usageRate / 35) * 100));

  let base: number;
  if (role === 'primary') {
    const peakScoring = Math.max(r.insideScoring, r.closeShot, r.midrange, r.threePoint);
    const scoringSkill = peakScoring * 0.6 + overall * 0.4;
    base = usageScore * 0.45 + scoringSkill * 0.55;
  } else if (role === 'secondary') {
    const secondaryScoring = (r.insideScoring + r.midrange + r.threePoint) / 3;
    const scoringSkill = secondaryScoring * 0.55 + overall * 0.45;
    base =
      Math.min(100, Math.max(0, (player.tendencies.usageRate / 30) * 100)) * 0.35 +
      scoringSkill * 0.65;
  } else {
    const playmaking = playmakingSkillOf(player);
    const passTendency = Math.min(100, Math.max(0, (player.tendencies.passRate / 45) * 100));
    base = playmaking * 0.78 + passTendency * 0.22;
  }

  let bonus = 0;
  if (ref.preferredPositions !== undefined) {
    const overlap = hasPositionOverlap(player.positions, ref.preferredPositions);
    if (overlap.exact) bonus += 12;
    else if (overlap.group) bonus += 5;
    else bonus -= 10;
  }
  if (ref.archetype !== undefined && classifyArchetype(player) === ref.archetype) {
    bonus += 8;
  }

  return Math.round((base + bonus) * 100) / 100;
}

function rankCandidates(
  candidates: readonly SimulationPlayer[],
  role: FullCourtBlueprintRoleKey,
  ref: FullCourtBlueprintRoleRef,
  slots: ResolvedSlots,
): Array<{ readonly player: SimulationPlayer; readonly score: number }> {
  const sameTierOnly =
    ref.kind === 'role-fit'
      ? candidates
      : candidates.filter((player) =>
          ref.kind === 'bench-slot'
            ? !slots.starterSlotById.has(player.playerId)
            : slots.starterSlotById.has(player.playerId),
        );
  const pool = sameTierOnly.length > 0 ? sameTierOnly : candidates;
  const preferBench = ref.kind === 'bench-slot';
  return pool
    .map((player) => ({
      player,
      score: scorePlayerForRole(player, role, ref, slots),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftStarter = slots.starterSlotById.has(left.player.playerId);
      const rightStarter = slots.starterSlotById.has(right.player.playerId);
      if (leftStarter !== rightStarter) {
        return preferBench ? (leftStarter ? 1 : -1) : leftStarter ? -1 : 1;
      }
      const leftMinutes = slots.minutesById.get(left.player.playerId) ?? 0;
      const rightMinutes = slots.minutesById.get(right.player.playerId) ?? 0;
      if (rightMinutes !== leftMinutes) return rightMinutes - leftMinutes;
      const nameOrder = compareStrings(left.player.displayName, right.player.displayName);
      if (nameOrder !== 0) return nameOrder;
      return compareStrings(left.player.playerId, right.player.playerId);
    });
}

/**
 * Extracts portable, ID-free role references from a run's scoring hierarchy
 * using its active rotation (or the staff default rotation when custom minutes
 * are absent).
 */
export function buildFullCourtBlueprintHierarchy(options: {
  readonly hierarchy: FullCourtOffensiveHierarchy | undefined;
  readonly roster: readonly SimulationPlayer[];
  readonly rotation?: FullCourtBlueprintRotationRef;
}): FullCourtBlueprintHierarchy | undefined {
  const { hierarchy, roster, rotation } = options;
  if (hierarchy === undefined) return undefined;
  const byId = assertUniqueRoster(roster);
  const slots = resolveRotationSlots(roster, rotation);

  const entries: Array<readonly [FullCourtBlueprintRoleKey, string | undefined]> = [
    ['primary', hierarchy.primaryPlayerId],
    ['secondary', hierarchy.secondaryPlayerId],
    ['floorGeneral', hierarchy.floorGeneralPlayerId],
  ];

  const built: Partial<Record<FullCourtBlueprintRoleKey, FullCourtBlueprintRoleRef>> = {};
  for (const [roleKey, playerId] of entries) {
    if (playerId === undefined) continue;
    const player = byId.get(playerId);
    if (player === undefined) {
      throw new Error('The saved scoring hierarchy includes a player outside your roster.');
    }
    const preferredPositions = [...player.positions].sort();
    const archetype = classifyArchetype(player);
    const starterSlot = slots.starterSlotById.get(playerId);
    if (starterSlot !== undefined) {
      built[roleKey] = {
        kind: 'starter-slot',
        slot: starterSlot,
        preferredPositions,
        archetype,
      };
      continue;
    }
    const benchIndex = slots.benchIndexById.get(playerId);
    if (benchIndex === undefined) {
      throw new Error('The saved scoring hierarchy includes a player outside the rotation.');
    }
    built[roleKey] = {
      kind: 'bench-slot',
      benchIndex,
      preferredPositions,
      archetype,
    };
  }

  if (Object.keys(built).length === 0) return undefined;
  return fullCourtBlueprintHierarchySchema.parse(built);
}

/**
 * Deterministically previews and resolves a blueprint's portable scoring roles
 * onto a target roster without modifying the roster or existing rotation.
 */
export function resolveFullCourtBlueprintHierarchy(options: {
  readonly blueprint: FullCourtBlueprint;
  readonly roster: readonly SimulationPlayer[];
  readonly rotation?: FullCourtBlueprintRotationRef;
}): FullCourtBlueprintBindingPreview {
  const { blueprint, roster, rotation } = options;
  const slots = resolveRotationSlots(roster, rotation);

  if (blueprint.hierarchy === undefined) {
    return {
      blueprintName: blueprint.name,
      hasHierarchy: false,
      rotationSource: slots.rotationSource,
      bindings: [],
      hierarchy: undefined,
      hasMissingOrVacant: false,
      hasAmbiguous: false,
      hasFallback: false,
    };
  }

  const assignedRefs = FULL_COURT_BLUEPRINT_ROLE_KEYS.flatMap((role) => {
    const ref = blueprint.hierarchy?.[role];
    return ref === undefined ? [] : [{ role, ref }];
  });

  const resolvedByRole = new Map<FullCourtBlueprintRoleKey, FullCourtBlueprintRoleBinding>();
  const usedPlayerIds = new Set<string>();

  // Pass 1: claim direct compatible slot matches first so fallbacks never steal
  // another role's exact slot target.
  for (const { role, ref } of assignedRefs) {
    if (ref.kind === 'role-fit') continue;
    const slotPlayer =
      ref.kind === 'starter-slot' ? slots.starters[ref.slot] : slots.bench[ref.benchIndex];
    if (
      slotPlayer !== undefined &&
      !usedPlayerIds.has(slotPlayer.playerId) &&
      isCompatibleForRole(slotPlayer, role, ref)
    ) {
      usedPlayerIds.add(slotPlayer.playerId);
      resolvedByRole.set(role, {
        role,
        ref,
        status: 'matched',
        playerId: slotPlayer.playerId,
        player: slotPlayer,
        targetLabel: formatRoleRefLabel(ref),
        reason: null,
        tiedCandidates: [],
      });
    }
  }

  // Pass 2: resolve remaining roles (missing/incompatible/collided slots and
  // role-fit refs) using acceptable fallbacks or leaving vacant.
  for (const { role, ref } of assignedRefs) {
    if (resolvedByRole.has(role)) continue;
    const targetLabel = formatRoleRefLabel(ref);
    const compatibleUnused = roster.filter(
      (player) => !usedPlayerIds.has(player.playerId) && isCompatibleForRole(player, role, ref),
    );
    const ranked = rankCandidates(compatibleUnused, role, ref, slots);

    if (ref.kind === 'role-fit') {
      const winner = ranked[0];
      if (winner === undefined) {
        resolvedByRole.set(role, {
          role,
          ref,
          status: 'vacant',
          playerId: null,
          player: null,
          targetLabel,
          reason: `No unused compatible player fits ${targetLabel}.`,
          tiedCandidates: [],
        });
        continue;
      }
      const tied = ranked.filter((entry) => winner.score - entry.score <= AMBIGUITY_SCORE_EPSILON);
      usedPlayerIds.add(winner.player.playerId);
      if (tied.length > 1) {
        resolvedByRole.set(role, {
          role,
          ref,
          status: 'ambiguous',
          playerId: winner.player.playerId,
          player: winner.player,
          targetLabel,
          reason: `Ambiguous role fit: tied between ${tied.map((entry) => entry.player.displayName).join(' and ')}; selected ${winner.player.displayName}.`,
          tiedCandidates: tied.map((entry) => entry.player),
        });
      } else {
        resolvedByRole.set(role, {
          role,
          ref,
          status: 'matched',
          playerId: winner.player.playerId,
          player: winner.player,
          targetLabel,
          reason: null,
          tiedCandidates: [],
        });
      }
      continue;
    }

    const slotPlayer =
      ref.kind === 'starter-slot' ? slots.starters[ref.slot] : slots.bench[ref.benchIndex];
    const baseReason =
      slotPlayer === undefined
        ? `${targetLabel} is not available on this ${String(roster.length)}-player roster.`
        : usedPlayerIds.has(slotPlayer.playerId)
          ? `${targetLabel} (${slotPlayer.displayName}) is already assigned to another role.`
          : `${targetLabel} (${slotPlayer.displayName} · ${positionsLabel(slotPlayer.positions)}) does not fit this role.`;

    const winner = ranked[0];
    if (winner === undefined) {
      resolvedByRole.set(role, {
        role,
        ref,
        status: 'vacant',
        playerId: null,
        player: null,
        targetLabel,
        reason: `${baseReason} Left vacant because no unused compatible player fits.`,
        tiedCandidates: [],
      });
      continue;
    }

    const tied = ranked.filter((entry) => winner.score - entry.score <= AMBIGUITY_SCORE_EPSILON);
    usedPlayerIds.add(winner.player.playerId);
    if (tied.length > 1) {
      resolvedByRole.set(role, {
        role,
        ref,
        status: 'ambiguous',
        playerId: winner.player.playerId,
        player: winner.player,
        targetLabel,
        reason: `${baseReason} Ambiguous fallback between ${tied.map((entry) => entry.player.displayName).join(' and ')}; selected ${winner.player.displayName}.`,
        tiedCandidates: tied.map((entry) => entry.player),
      });
    } else {
      resolvedByRole.set(role, {
        role,
        ref,
        status: 'fallback',
        playerId: winner.player.playerId,
        player: winner.player,
        targetLabel,
        reason: `${baseReason} Using fallback ${winner.player.displayName}.`,
        tiedCandidates: [],
      });
    }
  }

  const bindings = assignedRefs.map(({ role }) => resolvedByRole.get(role)!);
  const primaryPlayerId = resolvedByRole.get('primary')?.playerId ?? null;
  const secondaryPlayerId = resolvedByRole.get('secondary')?.playerId ?? null;
  const floorGeneralPlayerId = resolvedByRole.get('floorGeneral')?.playerId ?? null;
  const hierarchy: FullCourtOffensiveHierarchy | undefined =
    primaryPlayerId === null && secondaryPlayerId === null && floorGeneralPlayerId === null
      ? undefined
      : {
          ...(primaryPlayerId === null ? {} : { primaryPlayerId }),
          ...(secondaryPlayerId === null ? {} : { secondaryPlayerId }),
          ...(floorGeneralPlayerId === null ? {} : { floorGeneralPlayerId }),
        };

  return {
    blueprintName: blueprint.name,
    hasHierarchy: true,
    rotationSource: slots.rotationSource,
    bindings,
    hierarchy,
    hasMissingOrVacant: bindings.some((binding) => binding.status === 'vacant'),
    hasAmbiguous: bindings.some((binding) => binding.status === 'ambiguous'),
    hasFallback: bindings.some((binding) => binding.status === 'fallback'),
  };
}
