import type { PlayerId, Seed, SlotIndex } from '@hoop-rush/data-contracts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement } from '../../domain/lineup.ts';
import {
  planLineupReposition,
  type LineupRepositionPlayer,
} from '../../domain/lineup-reposition.ts';
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
function candidateById(
  pool: readonly FixedFiveCandidate[],
  playerId: PlayerId,
): FixedFiveCandidate {
  const candidate = pool.find((c) => c.playerId === playerId);
  if (!candidate) throw new Error(`unknown player ${playerId}`);
  return candidate;
}
function participantLineupPlayers(
  state: SandboxDuelState,
  participantId: 'p1' | 'p2',
  pool: readonly FixedFiveCandidate[],
): LineupRepositionPlayer[] {
  return state.picks
    .filter((p) => p.participantId === participantId)
    .map((p) => {
      const candidate = candidateById(pool, p.playerId);
      return { playerId: p.playerId, positions: candidate.positions, slotIndex: p.slotIndex };
    });
}
function placementsWithVersions(
  pool: readonly FixedFiveCandidate[],
  placements: ReadonlyArray<{ playerId: PlayerId; slotIndex: SlotIndex }>,
): Array<{ playerId: PlayerId; slotIndex: SlotIndex; playerVersionId: string }> {
  return placements.map((placement) => ({
    playerId: placement.playerId,
    slotIndex: placement.slotIndex,
    playerVersionId: candidateById(pool, placement.playerId).playerVersionId,
  }));
}
function applyPlanToOwnPicks(
  state: SandboxDuelState,
  participantId: 'p1' | 'p2',
  placements: ReadonlyArray<{ playerId: PlayerId; slotIndex: SlotIndex }>,
): SandboxDuelPick[] {
  const slotByPlayerId = new Map(
    placements.map((placement) => [placement.playerId, placement.slotIndex]),
  );
  return state.picks.map((pick) => {
    if (pick.participantId !== participantId) return pick;
    const slotIndex = slotByPlayerId.get(pick.playerId);
    if (slotIndex === undefined) throw new Error(`no planned slot for ${pick.playerId}`);
    return { ...pick, slotIndex };
  });
}
export function claimSandboxDuelPlayer(
  state: SandboxDuelState,
  pool: readonly FixedFiveCandidate[],
  input: SandboxDuelClaimInput,
  options?: { allowDisplacement?: boolean },
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
  if (!canPlay(candidate.positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const allowDisplacement = options?.allowDisplacement ?? false;
  if (!allowDisplacement && own.some((p) => p.slotIndex === input.slotIndex)) {
    throw new Error(`slot ${String(input.slotIndex)} is already filled for ${input.actor}`);
  }
  let picks: SandboxDuelPick[];
  if (allowDisplacement) {
    const plan = planLineupReposition(
      participantLineupPlayers(state, input.actor, pool),
      { playerId: input.playerId, positions: candidate.positions },
      input.slotIndex,
    );
    if (plan === null) {
      throw new Error(
        `no legal placement for ${input.playerId} at slot ${String(input.slotIndex)}`,
      );
    }
    const trial = placementsWithVersions(pool, plan.placements);
    if (!selectionKeepsFeasibility(pool, trial)) {
      throw new Error(
        `claiming ${input.playerId} in slot ${String(input.slotIndex)} leaves no legal completion`,
      );
    }
    picks = applyPlanToOwnPicks(state, input.actor, plan.placements);
  } else {
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
    picks = [...state.picks];
  }
  const pick: SandboxDuelPick = {
    pickOrdinal: state.pickOrdinal,
    participantId: picker,
    playerId: input.playerId,
    playerVersionId: candidate.playerVersionId,
    slotIndex: input.slotIndex,
  };
  picks = [...picks, pick];
  const nextOrdinal = state.pickOrdinal + 1;
  if (picks.length === 10) {
    return { ...state, picks, pickOrdinal: nextOrdinal, status: 'complete' };
  }
  return { ...state, picks, pickOrdinal: nextOrdinal };
}
export interface SandboxDuelRepositionInput {
  playerId: PlayerId;
  slotIndex: SlotIndex;
  actor: 'p1' | 'p2';
}
export function repositionSandboxDuelPlayer(
  state: SandboxDuelState,
  pool: readonly FixedFiveCandidate[],
  input: SandboxDuelRepositionInput,
): SandboxDuelState {
  if (state.status !== 'drafting') {
    throw new Error(`sandbox duel reposition requires a drafting state (got ${state.status})`);
  }
  const pick = state.picks.find(
    (entry) => entry.participantId === input.actor && entry.playerId === input.playerId,
  );
  if (!pick) throw new Error(`player ${input.playerId} is not on ${input.actor}'s five`);
  if (pick.slotIndex === input.slotIndex) return state;
  const candidate = candidateById(pool, input.playerId);
  if (!canPlay(candidate.positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const plan = planLineupReposition(
    participantLineupPlayers(state, input.actor, pool),
    { playerId: input.playerId, positions: candidate.positions },
    input.slotIndex,
  );
  if (plan === null) {
    throw new Error(`no legal reposition for ${input.playerId} to slot ${String(input.slotIndex)}`);
  }
  if (!selectionKeepsFeasibility(pool, placementsWithVersions(pool, plan.placements))) {
    throw new Error(
      `repositioning ${input.playerId} to slot ${String(input.slotIndex)} leaves no legal completion`,
    );
  }
  return { ...state, picks: applyPlanToOwnPicks(state, input.actor, plan.placements) };
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
