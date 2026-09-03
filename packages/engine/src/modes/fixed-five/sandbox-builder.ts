import type { Position, SlotIndex } from '@hoop-rush/data-contracts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement, validateLineup } from '../../domain/lineup.ts';

export interface FixedFiveCandidate {
  playerId: string;
  playerVersionId: string;
  positions: Position[];
  selectionScore: number;
  franchiseId: string;
  eraId: string;
}

export interface SandboxBuilderState {
  placements: Array<{ playerId: string; slotIndex: SlotIndex }>;
  locked: boolean;
}

export type SandboxBuilderCommand =
  | { kind: 'sandbox-place'; playerId: string; slotIndex: SlotIndex }
  | { kind: 'sandbox-remove'; slotIndex: SlotIndex }
  | { kind: 'sandbox-lock' };

const FALLBACK_POSITIONS: Position[] = ['PG'];

export function createSandboxBuilder(): SandboxBuilderState {
  return { placements: [], locked: false };
}

function candidateById(
  pool: readonly FixedFiveCandidate[],
  playerId: string,
): FixedFiveCandidate | null {
  return pool.find((c) => c.playerId === playerId) ?? null;
}

function openSlots(state: SandboxBuilderState): SlotIndex[] {
  const occupied = new Set(state.placements.map((p) => p.slotIndex));
  const open: SlotIndex[] = [];
  for (const slot of [0, 1, 2, 3, 4] as SlotIndex[]) {
    if (!occupied.has(slot)) open.push(slot);
  }
  return open;
}

export function selectionKeepsFeasibility(
  pool: readonly FixedFiveCandidate[],
  placed: ReadonlyArray<{ playerId: string; slotIndex: SlotIndex }>,
): boolean {
  const byId = new Map(pool.map((c) => [c.playerId, c]));
  const usedIds = new Set<string>();
  for (const p of placed) {
    if (usedIds.has(p.playerId)) return false;
    usedIds.add(p.playerId);
    const candidate = byId.get(p.playerId);
    if (!candidate) return false;
    if (!canPlay(candidate.positions, slotRequirement(p.slotIndex))) return false;
  }
  if (placed.length === 5) {
    const lineup = {
      structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
      assignments: placed.map((p) => ({
        slotIndex: p.slotIndex,
        playerId: p.playerId,
        positions: byId.get(p.playerId)?.positions ?? FALLBACK_POSITIONS,
      })),
    };
    return validateLineup(lineup).ok;
  }
  const remaining = pool.filter((c) => !usedIds.has(c.playerId));
  const occupiedSlots = new Set(placed.map((p) => p.slotIndex));
  const open = ([0, 1, 2, 3, 4] as SlotIndex[]).filter((s) => !occupiedSlots.has(s));
  const tryFill = (slotIdx: number, chosen: FixedFiveCandidate[]): boolean => {
    if (slotIdx === open.length) {
      const full: Array<{ playerId: string; slotIndex: SlotIndex }> = [];
      for (const p of placed) full.push(p);
      for (const c of chosen) {
        const slotAt = open[chosen.indexOf(c)];
        if (slotAt === undefined) return false;
        full.push({ playerId: c.playerId, slotIndex: slotAt });
      }
      const lineup = {
        structure: ['G', 'G', 'F', 'F', 'C'] as ['G', 'G', 'F', 'F', 'C'],
        assignments: full.map((p) => ({
          slotIndex: p.slotIndex,
          playerId: p.playerId,
          positions:
            byId.get(p.playerId)?.positions ??
            chosen.find((c) => c.playerId === p.playerId)?.positions ??
            FALLBACK_POSITIONS,
        })),
      };
      return validateLineup(lineup).ok;
    }
    const slot = open[slotIdx];
    if (slot === undefined) return false;
    const requirement = slotRequirement(slot);
    for (const candidate of remaining) {
      if (chosen.some((c) => c.playerId === candidate.playerId)) continue;
      if (!canPlay(candidate.positions, requirement)) continue;
      if (tryFill(slotIdx + 1, [...chosen, candidate])) return true;
    }
    return false;
  };
  if (open.length > remaining.length) return false;
  if (open.length <= 3) return tryFill(0, []);
  const feasible = assignLineupFeasible(pool, placed);
  return feasible;
}

function assignLineupFeasible(
  pool: readonly FixedFiveCandidate[],
  placed: ReadonlyArray<{ playerId: string; slotIndex: SlotIndex }>,
): boolean {
  const byId = new Map(pool.map((c) => [c.playerId, c]));
  const occupied = new Set(placed.map((p) => p.slotIndex));
  const open = ([0, 1, 2, 3, 4] as SlotIndex[]).filter((s) => !occupied.has(s));
  const remaining = pool.filter((c) => ![...placed].some((p) => p.playerId === c.playerId));
  const backtrack = (index: number, used: Set<string>): boolean => {
    if (index === open.length) return true;
    const slot = open[index];
    if (slot === undefined) return false;
    const requirement = slotRequirement(slot);
    for (const candidate of remaining) {
      if (used.has(candidate.playerId)) continue;
      if (!canPlay(candidate.positions, requirement)) continue;
      used.add(candidate.playerId);
      const usedList = [...used];
      const trial = [
        ...placed,
        ...usedList.map((id) => {
          const c = byId.get(id) ?? remaining.find((r) => r.playerId === id);
          const slotIndex = usedList.indexOf(id);
          const slotFor = open[slotIndex];
          if (slotFor === undefined) throw new Error('sandbox feasibility ran out of slots');
          return {
            playerId: id,
            slotIndex: slotFor,
            positions: c?.positions ?? FALLBACK_POSITIONS,
          };
        }),
      ];
      void trial;
      if (backtrack(index + 1, used)) return true;
      used.delete(candidate.playerId);
    }
    return false;
  };
  return backtrack(0, new Set());
}

export function applySandboxBuilderCommand(
  state: SandboxBuilderState,
  pool: readonly FixedFiveCandidate[],
  command: SandboxBuilderCommand,
): SandboxBuilderState {
  if (state.locked) {
    throw new Error('sandbox builder is locked');
  }
  if (command.kind === 'sandbox-place') {
    const candidate = candidateById(pool, command.playerId);
    if (!candidate) {
      throw new Error(`unknown player ${command.playerId}`);
    }
    if (state.placements.some((p) => p.playerId === command.playerId)) {
      throw new Error(`player ${command.playerId} is already placed`);
    }
    if (!canPlay(candidate.positions, slotRequirement(command.slotIndex))) {
      throw new Error(`${command.playerId} cannot play slot ${String(command.slotIndex)}`);
    }
    const withoutSlot = state.placements.filter((p) => p.slotIndex !== command.slotIndex);
    const next = [...withoutSlot, { playerId: command.playerId, slotIndex: command.slotIndex }];
    if (!selectionKeepsFeasibility(pool, next)) {
      throw new Error(
        `placing ${command.playerId} in slot ${String(command.slotIndex)} leaves no legal completion`,
      );
    }
    return { placements: [...next].sort((a, b) => a.slotIndex - b.slotIndex), locked: false };
  }
  if (command.kind === 'sandbox-remove') {
    return {
      placements: state.placements.filter((p) => p.slotIndex !== command.slotIndex),
      locked: false,
    };
  }
  if (nextIsFull(state) && selectionKeepsFeasibility(pool, state.placements)) {
    return { ...state, locked: true };
  }
  throw new Error('sandbox builder requires five feasible placements before lock');
}

function nextIsFull(state: SandboxBuilderState): boolean {
  return state.placements.length === 5;
}

export function isSandboxBuilderComplete(state: SandboxBuilderState): boolean {
  return state.locked && state.placements.length === 5;
}

export function listSandboxOpenSlots(state: SandboxBuilderState): SlotIndex[] {
  return openSlots(state);
}

export interface SandboxSafeMove {
  playerId: string;
  playerVersionId: string;
  slotIndex: SlotIndex;
  selectionScore: number;
}

export function enumerateSandboxSafeMoves(
  pool: readonly FixedFiveCandidate[],
  state: SandboxBuilderState,
): SandboxSafeMove[] {
  if (state.locked) return [];
  const used = new Set(state.placements.map((p) => p.playerId));
  const open = openSlots(state);
  const moves: SandboxSafeMove[] = [];
  for (const slotIndex of open) {
    for (const candidate of pool) {
      if (used.has(candidate.playerId)) continue;
      if (!canPlay(candidate.positions, slotRequirement(slotIndex))) continue;
      const trial = [...state.placements, { playerId: candidate.playerId, slotIndex }];
      if (!selectionKeepsFeasibility(pool, trial)) continue;
      moves.push({
        playerId: candidate.playerId,
        playerVersionId: candidate.playerVersionId,
        slotIndex,
        selectionScore: candidate.selectionScore,
      });
    }
  }
  return moves.sort((a, b) => {
    if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
    if (a.playerVersionId !== b.playerVersionId)
      return a.playerVersionId < b.playerVersionId ? -1 : 1;
    return a.slotIndex - b.slotIndex;
  });
}

export function missingSandboxSlots(state: SandboxBuilderState): SlotIndex[] {
  return openSlots(state);
}
