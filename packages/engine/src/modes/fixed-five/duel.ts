import type {
  ClassicDraftCatalog,
  EraId,
  FranchiseId,
  PlayerId,
  Seed,
  SlotIndex,
} from '@hoop-rush/data-contracts';
import { CLASSIC_ROLL_VERSION } from '@hoop-rush/data-contracts';
import { canPlay } from '../../domain/positions.ts';
import { slotRequirement } from '../../domain/lineup.ts';
import {
  planLineupReposition,
  type LineupRepositionPlayer,
} from '../../domain/lineup-reposition.ts';
import type { EngineContext } from '../../sim/kernel.ts';
import { classicRollSeed, sortClassicCatalog } from '../classic/draft.ts';
import { fixedFiveFirstPicker } from './seeds.ts';
import type { FixedFiveCandidate } from './sandbox-builder.ts';
export interface DuelDraftPick {
  pickOrdinal: number;
  participantId: 'p1' | 'p2';
  playerId: PlayerId;
  playerVersionId: string;
  franchiseId: FranchiseId;
  eraId: EraId;
  slotIndex: SlotIndex;
}
export interface DuelDraftState {
  rootSeed: Seed;
  firstPicker: 'p1' | 'p2';
  pickOrdinal: number;
  currentRoll: {
    franchiseId: FranchiseId;
    eraId: EraId;
  } | null;
  picks: DuelDraftPick[];
  claimedPairs: string[];
  claimedVersionIds: string[];
  rerolls: {
    p1: {
      franchiseSpent: boolean;
      eraSpent: boolean;
    };
    p2: {
      franchiseSpent: boolean;
      eraSpent: boolean;
    };
  };
  status: 'drafting' | 'complete';
}
function pairKey(franchiseId: string, eraId: string): string {
  return `${franchiseId}|${eraId}`;
}
function otherParticipant(p: 'p1' | 'p2'): 'p1' | 'p2' {
  return p === 'p1' ? 'p2' : 'p1';
}
export function duelCurrentPicker(state: DuelDraftState): 'p1' | 'p2' {
  if (state.status === 'complete') throw new Error('duel draft is complete');
  return state.pickOrdinal % 2 === 0 ? state.firstPicker : otherParticipant(state.firstPicker);
}
function participantSlotUsage(state: DuelDraftState, participantId: 'p1' | 'p2'): Set<SlotIndex> {
  return new Set(
    state.picks.filter((p) => p.participantId === participantId).map((p) => p.slotIndex),
  );
}
function participantLineupPlayers(
  state: DuelDraftState,
  participantId: 'p1' | 'p2',
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
): LineupRepositionPlayer[] {
  return state.picks
    .filter((pick) => pick.participantId === participantId)
    .map((pick) => {
      const candidate = poolById.get(pick.playerId);
      const entry = catalog.find(
        (e) => e.franchiseId === pick.franchiseId && e.eraId === pick.eraId,
      );
      const positions =
        candidate?.positions ?? entry?.players.find((p) => p.playerId === pick.playerId)?.positions;
      if (!positions) throw new Error(`${pick.playerId} has no catalog record`);
      return { playerId: pick.playerId, positions, slotIndex: pick.slotIndex };
    });
}
function applyPlanToParticipantPicks(
  state: DuelDraftState,
  participantId: 'p1' | 'p2',
  placements: ReadonlyArray<{ playerId: PlayerId; slotIndex: SlotIndex }>,
): DuelDraftPick[] {
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
export function duelRollCandidates(
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  state: DuelDraftState,
  kind: 'initial' | 'franchise-reroll' | 'era-reroll',
): ClassicDraftCatalog[number][] {
  const picker = duelCurrentPicker(state);
  const usedSlots = participantSlotUsage(state, picker);
  const openRequirements = new Set<ReturnType<typeof slotRequirement>>();
  for (const slot of [0, 1, 2, 3, 4] as SlotIndex[]) {
    if (!usedSlots.has(slot)) openRequirements.add(slotRequirement(slot));
  }
  const claimedPairs = new Set(state.claimedPairs);
  const claimedVersions = new Set(state.claimedVersionIds);
  return sortClassicCatalog(
    catalog.filter((entry) => {
      if (claimedPairs.has(pairKey(entry.franchiseId, entry.eraId))) return false;
      if (kind === 'franchise-reroll') {
        if (!state.currentRoll) return false;
        if (entry.eraId !== state.currentRoll.eraId) return false;
        if (entry.franchiseId === state.currentRoll.franchiseId) return false;
      }
      if (kind === 'era-reroll') {
        if (!state.currentRoll) return false;
        if (entry.franchiseId !== state.currentRoll.franchiseId) return false;
        if (entry.eraId === state.currentRoll.eraId) return false;
      }
      return entry.players.some((player) => {
        if (claimedVersions.has(player.playerId)) return false;
        const candidate = poolById.get(player.playerId);
        const positions = candidate?.positions ?? player.positions;
        const versionId = candidate?.playerVersionId ?? player.playerId;
        if (claimedVersions.has(versionId)) return false;
        return positions.some((position) => openRequirements.has(position));
      });
    }),
  );
}
function rollPair(
  rootSeed: Seed,
  pickOrdinal: number,
  kind: 'initial' | 'franchise-reroll' | 'era-reroll',
  candidates: ClassicDraftCatalog[number][],
  context: EngineContext,
): {
  franchiseId: FranchiseId;
  eraId: EraId;
} {
  if (candidates.length === 0) {
    throw new Error(`no eligible duel pool for pick ${String(pickOrdinal)}`);
  }
  const seedMaterial = classicRollSeed(
    `${rootSeed}:duel:${String(pickOrdinal)}` as Seed,
    CLASSIC_ROLL_VERSION,
    kind === 'initial' ? 'initial' : kind,
    (pickOrdinal % 5) + 1,
  );
  const entry = context.rngFactory(seedMaterial).pick(candidates);
  return { franchiseId: entry.franchiseId, eraId: entry.eraId };
}
export function createDuelDraft(
  rootSeed: Seed,
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  context: EngineContext,
  firstPickerOverride?: 'p1' | 'p2',
): DuelDraftState {
  const firstPicker = firstPickerOverride ?? fixedFiveFirstPicker(rootSeed);
  const initial: DuelDraftState = {
    rootSeed,
    firstPicker,
    pickOrdinal: 0,
    currentRoll: null,
    picks: [],
    claimedPairs: [],
    claimedVersionIds: [],
    rerolls: {
      p1: { franchiseSpent: false, eraSpent: false },
      p2: { franchiseSpent: false, eraSpent: false },
    },
    status: 'drafting',
  };
  const candidates = duelRollCandidates(catalog, poolById, initial, 'initial');
  const roll = rollPair(rootSeed, 0, 'initial', candidates, context);
  return { ...initial, currentRoll: roll };
}
export function rerollDuel(
  state: DuelDraftState,
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  axis: 'franchise' | 'era',
  actor: 'p1' | 'p2',
  context: EngineContext,
): DuelDraftState {
  if (state.status !== 'drafting') throw new Error('duel reroll requires drafting');
  const picker = duelCurrentPicker(state);
  if (actor !== picker) throw new Error(`it is ${picker}'s pick, not ${actor}'s`);
  const tokens = state.rerolls[actor];
  if (axis === 'franchise' && tokens.franchiseSpent)
    throw new Error('duel franchise reroll already spent');
  if (axis === 'era' && tokens.eraSpent) throw new Error('duel era reroll already spent');
  if (!state.currentRoll) throw new Error('duel reroll requires an active roll');
  const kind = axis === 'franchise' ? 'franchise-reroll' : 'era-reroll';
  const candidates = duelRollCandidates(catalog, poolById, state, kind);
  if (candidates.length === 0)
    throw new Error(`no alternative duel ${axis} for pick ${String(state.pickOrdinal)}`);
  const roll = rollPair(state.rootSeed, state.pickOrdinal, kind, candidates, context);
  return {
    ...state,
    currentRoll: roll,
    rerolls: {
      ...state.rerolls,
      [actor]: {
        franchiseSpent: axis === 'franchise' ? true : tokens.franchiseSpent,
        eraSpent: axis === 'era' ? true : tokens.eraSpent,
      },
    },
  };
}
export interface DuelClaimInput {
  playerId: PlayerId;
  slotIndex: SlotIndex;
  actor: 'p1' | 'p2';
}
export interface DuelRepositionInput {
  playerId: PlayerId;
  slotIndex: SlotIndex;
  actor: 'p1' | 'p2';
}
export function claimDuelPlayer(
  state: DuelDraftState,
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  input: DuelClaimInput,
  context: EngineContext,
  options?: { allowDisplacement?: boolean },
): DuelDraftState {
  if (state.status !== 'drafting') throw new Error('duel draft is not active');
  const picker = duelCurrentPicker(state);
  if (input.actor !== picker) throw new Error(`it is ${picker}'s pick, not ${input.actor}'s`);
  if (!state.currentRoll) throw new Error('duel draft has no active roll');
  const roll = state.currentRoll;
  const entry = catalog.find((e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId);
  if (!entry) throw new Error('catalog does not contain the current duel roll pair');
  if (state.claimedPairs.includes(pairKey(roll.franchiseId, roll.eraId))) {
    throw new Error(`franchise-era pair ${roll.franchiseId}/${roll.eraId} is already claimed`);
  }
  const catalogPlayer = entry.players.find((p) => p.playerId === input.playerId);
  if (!catalogPlayer) throw new Error(`${input.playerId} is not in the rolled duel pool`);
  const candidate = poolById.get(input.playerId);
  const versionId = candidate?.playerVersionId ?? input.playerId;
  if (state.claimedVersionIds.includes(versionId)) {
    throw new Error(`player version ${versionId} is already claimed`);
  }
  const positions = candidate?.positions ?? catalogPlayer.positions;
  if (!canPlay(positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const allowDisplacement = options?.allowDisplacement ?? false;
  const usedSlots = participantSlotUsage(state, picker);
  if (!allowDisplacement && usedSlots.has(input.slotIndex)) {
    throw new Error(`slot ${String(input.slotIndex)} is already filled for ${picker}`);
  }
  let picks = [...state.picks];
  if (allowDisplacement) {
    const plan = planLineupReposition(
      participantLineupPlayers(state, picker, catalog, poolById),
      { playerId: input.playerId, positions },
      input.slotIndex,
    );
    if (plan === null) {
      throw new Error(
        `no legal placement for ${input.playerId} at slot ${String(input.slotIndex)}`,
      );
    }
    picks = applyPlanToParticipantPicks(state, picker, plan.placements);
  }
  const pick: DuelDraftPick = {
    pickOrdinal: state.pickOrdinal,
    participantId: picker,
    playerId: input.playerId,
    playerVersionId: versionId,
    franchiseId: roll.franchiseId,
    eraId: roll.eraId,
    slotIndex: input.slotIndex,
  };
  picks = [...picks, pick];
  const claimedPairs = [...state.claimedPairs, pairKey(roll.franchiseId, roll.eraId)];
  const claimedVersionIds = [...state.claimedVersionIds, versionId];
  const nextOrdinal = state.pickOrdinal + 1;
  if (picks.length === 10) {
    return {
      ...state,
      picks,
      claimedPairs,
      claimedVersionIds,
      pickOrdinal: nextOrdinal,
      currentRoll: null,
      status: 'complete',
    };
  }
  const interim: DuelDraftState = {
    ...state,
    picks,
    claimedPairs,
    claimedVersionIds,
    pickOrdinal: nextOrdinal,
    currentRoll: null,
  };
  const candidates = duelRollCandidates(catalog, poolById, interim, 'initial');
  const nextRoll = rollPair(state.rootSeed, nextOrdinal, 'initial', candidates, context);
  return { ...interim, currentRoll: nextRoll };
}
export function repositionDuelPlayer(
  state: DuelDraftState,
  catalog: ClassicDraftCatalog,
  poolById: ReadonlyMap<string, FixedFiveCandidate>,
  input: DuelRepositionInput,
): DuelDraftState {
  if (state.status !== 'drafting') {
    throw new Error(`duel reposition requires a drafting state (got ${state.status})`);
  }
  const pick = state.picks.find(
    (entry) => entry.participantId === input.actor && entry.playerId === input.playerId,
  );
  if (!pick) {
    throw new Error(`player ${input.playerId} is not on ${input.actor}'s five`);
  }
  if (pick.slotIndex === input.slotIndex) return state;
  const candidate = poolById.get(input.playerId);
  const entry = catalog.find((e) => e.franchiseId === pick.franchiseId && e.eraId === pick.eraId);
  const positions =
    candidate?.positions ?? entry?.players.find((p) => p.playerId === input.playerId)?.positions;
  if (!positions) throw new Error(`${input.playerId} has no catalog record`);
  if (!canPlay(positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const plan = planLineupReposition(
    participantLineupPlayers(state, input.actor, catalog, poolById),
    { playerId: input.playerId, positions },
    input.slotIndex,
  );
  if (plan === null) {
    throw new Error(`no legal reposition for ${input.playerId} to slot ${String(input.slotIndex)}`);
  }
  const picks = applyPlanToParticipantPicks(state, input.actor, plan.placements);
  return { ...state, picks };
}
export function isDuelComplete(state: DuelDraftState): boolean {
  return state.status === 'complete' && state.picks.length === 10;
}
export function duelAlternationHolds(state: DuelDraftState): boolean {
  for (let i = 0; i < state.picks.length; i += 1) {
    const expected = i % 2 === 0 ? state.firstPicker : otherParticipant(state.firstPicker);
    if (state.picks[i]?.participantId !== expected) return false;
  }
  return true;
}
