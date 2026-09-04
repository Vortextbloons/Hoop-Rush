import type {
  ClassicDraftCatalog,
  ClassicDraftState,
  FixedFiveRoomMode,
  PlayerId,
  Seed,
  SlotIndex,
} from '@hoop-rush/data-contracts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement } from '../../domain/lineup.ts';
import { classicRollCandidates } from '../classic/draft.ts';
import { createRng } from '../../sim/rng.ts';
import { fixedFiveAutopickSeed, fixedFiveAutopickSeedPath } from './seeds.ts';
import {
  enumerateSandboxSafeMoves,
  type FixedFiveCandidate,
  type SandboxBuilderState,
} from './sandbox-builder.ts';
import type { DuelDraftState } from './duel.ts';

export interface ClassicSafeMove {
  playerId: PlayerId;
  playerVersionId: string;
  slotIndex: SlotIndex;
  selectionScore: number;
}

export function enumerateClassicSafeMoves(
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  state: ClassicDraftState,
): ClassicSafeMove[] {
  if (state.status !== 'drafting' || state.roll === null) return [];
  const roll = state.roll;
  const entry = catalog.find((e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId);
  if (!entry) return [];
  const drafted = new Set(state.picks.map((p) => p.playerId));
  const occupied = new Set(state.picks.map((p) => p.slotIndex));
  const moves = enumerateRolledPoolMoves(
    entry.players,
    poolById,
    (playerId) => drafted.has(playerId),
    occupied,
  );
  const feasible = moves.filter((move) => {
    const trial = [
      ...state.picks,
      {
        round: state.round,
        playerId: move.playerId,
        franchiseId: roll.franchiseId,
        eraId: roll.eraId,
        slotIndex: move.slotIndex,
      },
    ];
    if (trial.length === 5) return true;
    const nextState: ClassicDraftState = {
      ...state,
      picks: trial,
      round: Math.min(5, state.round + 1),
    };
    try {
      const remaining = classicRollCandidates(catalog, nextState, 'initial');
      return remaining.length > 0;
    } catch {
      return false;
    }
  });
  return rankAutopickMoves(feasible);
}

export function enumerateDuelSafeMoves(
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  state: DuelDraftState,
): ClassicSafeMove[] {
  if (state.status !== 'drafting' || !state.currentRoll) return [];
  const roll = state.currentRoll;
  const entry = catalog.find((e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId);
  if (!entry) return [];
  const picker =
    state.pickOrdinal % 2 === 0 ? state.firstPicker : state.firstPicker === 'p1' ? 'p2' : 'p1';
  const usedSlots = new Set(
    state.picks.filter((p) => p.participantId === picker).map((p) => p.slotIndex),
  );
  const claimed = new Set(state.claimedVersionIds);
  const moves = enumerateRolledPoolMoves(
    entry.players,
    poolById,
    (playerId, versionId) => claimed.has(versionId) || claimed.has(playerId),
    usedSlots,
  );
  return rankAutopickMoves(moves);
}

function enumerateRolledPoolMoves(
  players: ClassicDraftCatalog[number]['players'],
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  isClaimed: (playerId: PlayerId, versionId: string) => boolean,
  usedSlots: ReadonlySet<SlotIndex>,
): ClassicSafeMove[] {
  const moves: ClassicSafeMove[] = [];
  for (const catalogPlayer of players) {
    const candidate = poolById.get(catalogPlayer.playerId);
    const versionId = candidate?.playerVersionId ?? catalogPlayer.playerId;
    if (isClaimed(catalogPlayer.playerId, versionId)) continue;
    const positions = candidate?.positions ?? catalogPlayer.positions;
    for (const slot of [0, 1, 2, 3, 4] as SlotIndex[]) {
      if (usedSlots.has(slot)) continue;
      if (!canPlay(positions, slotRequirement(slot))) continue;
      moves.push({
        playerId: catalogPlayer.playerId,
        playerVersionId: versionId,
        slotIndex: slot,
        selectionScore: candidate?.selectionScore ?? 0,
      });
    }
  }
  return moves;
}

function rankAutopickMoves<
  T extends { selectionScore: number; playerVersionId: string; slotIndex: SlotIndex },
>(moves: T[]): T[] {
  return [...moves].sort((a, b) => {
    if (b.selectionScore !== a.selectionScore) return b.selectionScore - a.selectionScore;
    if (a.playerVersionId !== b.playerVersionId)
      return a.playerVersionId < b.playerVersionId ? -1 : 1;
    return a.slotIndex - b.slotIndex;
  });
}

export interface AutopickSelection {
  playerId: PlayerId;
  playerVersionId: string;
  slotIndex: SlotIndex;
  seedPath: string;
  reason: string;
}

export function chooseAutopick(
  rootSeed: Seed,
  mode: FixedFiveRoomMode,
  participantId: 'p1' | 'p2',
  pickOrdinal: number,
  candidates: Array<{
    playerId: PlayerId;
    playerVersionId: string;
    slotIndex: SlotIndex;
    selectionScore: number;
  }>,
): AutopickSelection {
  if (candidates.length === 0) {
    throw new Error('autopick requires at least one safe move');
  }
  const ranked = rankAutopickMoves(candidates);
  const topEight = ranked.slice(0, 8);
  const seed = fixedFiveAutopickSeed(rootSeed, mode, participantId, pickOrdinal);
  const rng = createRng(seed);
  const chosen = rng.pick(topEight);
  const seedPath = fixedFiveAutopickSeedPath(mode, participantId, pickOrdinal);
  return {
    playerId: chosen.playerId,
    playerVersionId: chosen.playerVersionId,
    slotIndex: chosen.slotIndex,
    seedPath,
    reason: `timeout-autopick ${seedPath} ranked ${String(topEight.length)} safe moves by selectionScore/playerVersionId/slot and drew index via seeded RNG`,
  };
}

export function chooseSandboxAutopicksUntilFull(
  rootSeed: Seed,
  mode: FixedFiveRoomMode,
  participantId: 'p1' | 'p2',
  startOrdinal: number,
  pool: readonly FixedFiveCandidate[],
  initial: SandboxBuilderState,
): AutopickSelection[] {
  const selections: AutopickSelection[] = [];
  let working: SandboxBuilderState = {
    placements: [...initial.placements],
    locked: initial.locked,
  };
  let ordinal = startOrdinal;
  for (;;) {
    const open = [0, 1, 2, 3, 4].filter((s) => !working.placements.some((p) => p.slotIndex === s));
    if (open.length === 0) break;
    const safe = enumerateSandboxSafeMoves(pool, working);
    if (safe.length === 0) {
      throw new Error('sandbox autopick found no safe completion');
    }
    const chosen = chooseAutopick(rootSeed, mode, participantId, ordinal, safe);
    selections.push(chosen);
    working = {
      placements: [
        ...working.placements,
        { playerId: chosen.playerId, slotIndex: chosen.slotIndex },
      ],
      locked: false,
    };
    ordinal += 1;
    if (selections.length > 5) throw new Error('sandbox autopick overflow');
  }
  return selections;
}
