import type { PlayerId, Position, SlotIndex } from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE } from '@hoop-rush/data-contracts';
import { canPlay } from './positions.ts';
import { slotRequirement, validateLineup } from './lineup.ts';

export interface LineupRepositionPlayer {
  playerId: PlayerId;
  positions: readonly Position[];
  slotIndex: SlotIndex;
}

export interface LineupRepositionSubject {
  playerId: PlayerId;
  positions: readonly Position[];
}

export interface LineupRepositionMove {
  playerId: PlayerId;
  fromSlot: SlotIndex | null;
  toSlot: SlotIndex;
}

export interface LineupRepositionPlan {
  subjectPlayerId: PlayerId;
  targetSlot: SlotIndex;
  placements: Array<{
    playerId: PlayerId;
    slotIndex: SlotIndex;
  }>;
  moves: LineupRepositionMove[];
}

const SLOT_INDEXES: SlotIndex[] = [0, 1, 2, 3, 4];

function comparePlayerIds(a: PlayerId, b: PlayerId): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function scorePlan(
  players: readonly LineupRepositionPlayer[],
  assignment: ReadonlyMap<PlayerId, SlotIndex>,
): { changed: number; distance: number; key: string } {
  let changed = 0;
  let distance = 0;
  const keyParts: string[] = [];
  for (const player of players) {
    const toSlot = assignment.get(player.playerId);
    if (toSlot === undefined) throw new Error(`lineup reposition: missing ${player.playerId}`);
    if (player.slotIndex !== toSlot) {
      changed += 1;
      distance += Math.abs(player.slotIndex - toSlot);
    }
    keyParts.push(`${player.playerId}:${String(toSlot)}`);
  }
  return { changed, distance, key: keyParts.join('|') };
}

function isBetterScore(
  next: { changed: number; distance: number; key: string },
  current: { changed: number; distance: number; key: string } | null,
): boolean {
  if (current === null) return true;
  if (next.changed !== current.changed) return next.changed < current.changed;
  if (next.distance !== current.distance) return next.distance < current.distance;
  return next.key < current.key;
}

export function planLineupReposition(
  players: readonly LineupRepositionPlayer[],
  subject: LineupRepositionSubject,
  targetSlot: SlotIndex,
): LineupRepositionPlan | null {
  if (players.length > SLOT_INDEXES.length) return null;

  const seenIds = new Set<PlayerId>();
  const seenSlots = new Set<SlotIndex>();
  for (const player of players) {
    if (seenIds.has(player.playerId) || seenSlots.has(player.slotIndex)) return null;
    seenIds.add(player.playerId);
    seenSlots.add(player.slotIndex);
  }

  const subjectIsInLineup = seenIds.has(subject.playerId);
  if (!subjectIsInLineup && players.length === SLOT_INDEXES.length) return null;
  if (!canPlay(subject.positions, slotRequirement(targetSlot))) return null;

  const allPlayers = (
    subjectIsInLineup
      ? players.map((player) =>
          player.playerId === subject.playerId
            ? { ...player, positions: subject.positions }
            : player,
        )
      : [
          ...players,
          {
            playerId: subject.playerId,
            positions: subject.positions,
            slotIndex: null,
          },
        ]
  ).sort((a, b) => comparePlayerIds(a.playerId, b.playerId));

  const assignment = new Map<PlayerId, SlotIndex>([[subject.playerId, targetSlot]]);
  const usedSlots = new Set<SlotIndex>([targetSlot]);
  const remainingPlayers = allPlayers.filter((player) => player.playerId !== subject.playerId);
  const legalAssignments: Map<PlayerId, SlotIndex>[] = [];

  function completeAssignmentIsLegal(): boolean {
    if (allPlayers.length !== SLOT_INDEXES.length) return true;
    const assignments = allPlayers.map((player) => {
      const slotIndex = assignment.get(player.playerId);
      if (slotIndex === undefined) throw new Error(`lineup reposition: missing ${player.playerId}`);
      return {
        slotIndex,
        playerId: player.playerId,
        positions: [...player.positions],
      };
    });
    return validateLineup({
      structure: LINEUP_STRUCTURE,
      assignments,
    }).ok;
  }

  function search(index: number): void {
    if (index === remainingPlayers.length) {
      if (!completeAssignmentIsLegal()) return;
      legalAssignments.push(new Map(assignment));
      return;
    }

    const player = remainingPlayers[index];
    if (player === undefined) throw new Error(`lineup reposition: missing player ${String(index)}`);
    for (const slotIndex of SLOT_INDEXES) {
      if (usedSlots.has(slotIndex)) continue;
      if (!canPlay(player.positions, slotRequirement(slotIndex))) continue;
      assignment.set(player.playerId, slotIndex);
      usedSlots.add(slotIndex);
      search(index + 1);
      usedSlots.delete(slotIndex);
      assignment.delete(player.playerId);
    }
  }

  search(0);
  const firstAssignment = legalAssignments[0];
  if (firstAssignment === undefined) return null;
  let resolvedAssignment = firstAssignment;
  let bestScore = scorePlan(
    allPlayers.filter((player) => player.slotIndex !== null),
    firstAssignment,
  );
  for (const candidate of legalAssignments.slice(1)) {
    const score = scorePlan(
      allPlayers.filter((player) => player.slotIndex !== null),
      candidate,
    );
    if (isBetterScore(score, bestScore)) {
      bestScore = score;
      resolvedAssignment = candidate;
    }
  }

  const placements = [...resolvedAssignment.entries()]
    .map(([playerId, slotIndex]) => ({ playerId, slotIndex }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
  const fromSlots = new Map(players.map((player) => [player.playerId, player.slotIndex]));
  const moves = placements
    .map(({ playerId, slotIndex }) => {
      const fromSlot = fromSlots.get(playerId) ?? null;
      return { playerId, fromSlot, toSlot: slotIndex };
    })
    .filter((move) => move.fromSlot !== move.toSlot);

  return {
    subjectPlayerId: subject.playerId,
    targetSlot,
    placements,
    moves,
  };
}
