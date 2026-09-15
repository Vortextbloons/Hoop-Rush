import type { PlayerId, Seed, SlotIndex } from '@hoop-rush/data-contracts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement } from '../../domain/lineup.ts';
import {
  fixedFiveFirstPicker,
  fixedFiveSandboxDraftPicker,
  fixedFiveSandboxFirstPicker,
} from './seeds.ts';
import { selectionKeepsFeasibility, type FixedFiveCandidate } from './sandbox-builder.ts';
export interface SandboxDuelPick {
  pickOrdinal: number;
  participantId: 'p1' | 'p2';
  playerId: PlayerId;
  playerVersionId: string;
  slotIndex: SlotIndex;
}
export interface SandboxDuelState {
  rootSeed: Seed;
  firstPicker: 'p1' | 'p2';
  order: 'alternating' | 'snake';
  pickOrdinal: number;
  picks: SandboxDuelPick[];
  status: 'drafting' | 'complete';
}
function otherParticipant(p: 'p1' | 'p2'): 'p1' | 'p2' {
  return p === 'p1' ? 'p2' : 'p1';
}
export function sandboxDuelPicker(state: SandboxDuelState): 'p1' | 'p2' {
  if (state.status === 'complete') throw new Error('sandbox duel draft is complete');
  if (state.order === 'alternating') {
    return state.pickOrdinal % 2 === 0 ? state.firstPicker : otherParticipant(state.firstPicker);
  }
  return fixedFiveSandboxDraftPicker(state.rootSeed, state.pickOrdinal, state.firstPicker);
}
export function createSandboxDuelDraft(
  rootSeed: Seed,
  firstPickerOverride?: 'p1' | 'p2',
  order: 'alternating' | 'snake' = 'snake',
): SandboxDuelState {
  return {
    rootSeed,
    firstPicker:
      firstPickerOverride ??
      (order === 'snake' ? fixedFiveSandboxFirstPicker(rootSeed) : fixedFiveFirstPicker(rootSeed)),
    order,
    pickOrdinal: 0,
    picks: [],
    status: 'drafting',
  };
}
export interface SandboxDuelClaimInput {
  playerId: PlayerId;
  playerVersionId?: string;
  slotIndex: SlotIndex;
  actor: 'p1' | 'p2';
}
function candidateForClaim(
  pool: readonly FixedFiveCandidate[],
  input: SandboxDuelClaimInput,
): FixedFiveCandidate | null {
  if (input.playerVersionId) {
    const candidate = pool.find((c) => c.playerVersionId === input.playerVersionId) ?? null;
    return candidate?.playerId === input.playerId ? candidate : null;
  }
  return pool.find((c) => c.playerId === input.playerId) ?? null;
}
export function claimSandboxDuelPlayer(
  state: SandboxDuelState,
  pool: readonly FixedFiveCandidate[],
  input: SandboxDuelClaimInput,
): SandboxDuelState {
  if (state.status !== 'drafting') throw new Error('sandbox duel draft is not active');
  const picker = sandboxDuelPicker(state);
  if (input.actor !== picker) throw new Error(`it is ${picker}'s pick, not ${input.actor}'s`);
  const candidate = candidateForClaim(pool, input);
  if (!candidate) throw new Error(`unknown player ${input.playerId}`);
  const own = state.picks.filter((p) => p.participantId === input.actor);
  if (state.picks.some((p) => p.playerId === input.playerId)) {
    throw new Error(`${input.playerId} is already claimed`);
  }
  if (own.some((p) => p.playerId === input.playerId)) {
    throw new Error(`${input.playerId} is already on ${input.actor}'s five`);
  }
  if (own.some((p) => p.slotIndex === input.slotIndex)) {
    throw new Error(`slot ${String(input.slotIndex)} is already filled for ${input.actor}`);
  }
  if (!canPlay(candidate.positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const trial = [
    ...own.map((p) => ({
      playerId: p.playerId,
      slotIndex: p.slotIndex,
      playerVersionId: p.playerVersionId,
    })),
    {
      playerId: input.playerId,
      slotIndex: input.slotIndex,
      playerVersionId: candidate.playerVersionId,
    },
  ];
  if (!selectionKeepsFeasibility(pool, trial)) {
    throw new Error(
      `claiming ${input.playerId} in slot ${String(input.slotIndex)} leaves no legal completion`,
    );
  }
  const pick: SandboxDuelPick = {
    pickOrdinal: state.pickOrdinal,
    participantId: picker,
    playerId: input.playerId,
    playerVersionId: candidate.playerVersionId,
    slotIndex: input.slotIndex,
  };
  const picks = [...state.picks, pick];
  const nextOrdinal = state.pickOrdinal + 1;
  if (picks.length === 10) {
    return { ...state, picks, pickOrdinal: nextOrdinal, status: 'complete' };
  }
  return { ...state, picks, pickOrdinal: nextOrdinal };
}
export function sandboxDuelPicksFor(
  state: SandboxDuelState,
  participantId: 'p1' | 'p2',
): SandboxDuelPick[] {
  return state.picks
    .filter((p) => p.participantId === participantId)
    .sort((a, b) => a.slotIndex - b.slotIndex);
}
export function isSandboxDuelComplete(state: SandboxDuelState): boolean {
  return state.status === 'complete' && state.picks.length === 10;
}
export function sandboxDuelAlternationHolds(state: SandboxDuelState): boolean {
  for (let i = 0; i < state.picks.length; i += 1) {
    const expected =
      state.order === 'snake'
        ? (() => {
            const roundFirst =
              Math.floor(i / 2) % 2 === 0 ? state.firstPicker : otherParticipant(state.firstPicker);
            return i % 2 === 0 ? roundFirst : otherParticipant(roundFirst);
          })()
        : i % 2 === 0
          ? state.firstPicker
          : otherParticipant(state.firstPicker);
    if (state.picks[i]?.participantId !== expected) return false;
  }
  return true;
}
export function sandboxDuelSnakeOrderHolds(state: SandboxDuelState): boolean {
  return state.order === 'snake' && sandboxDuelAlternationHolds(state);
}
