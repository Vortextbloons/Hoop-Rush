import type {
  ClassicCompletedDraft,
  ClassicDraftCatalog,
  ClassicDraftCatalogEntry,
  ClassicDraftState,
  ClassicPick,
  ClassicRollContext,
  ClassicVariant,
  EraSimulationProfile,
  OpponentBracket,
  PlayerId,
  Position,
  Seed,
  SimulationPlayer,
  SlotGroup,
  SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  CLASSIC_DRAFT_SCHEMA_VERSION,
  CLASSIC_ROLL_VERSION,
  LINEUP_STRUCTURE,
  classicDraftCatalogSchema,
} from '@hoop-rush/data-contracts';
import { canPlay, slotGroupOf } from '../../domain/positions.ts';
import { slotRequirement as lineupSlotRequirement, validateLineup } from '../../domain/lineup.ts';
import type { EngineContext } from '../../sim/context.ts';
import type { ClassicChallengeCreation } from '../../challenge/commands.ts';

export type ClassicRollKind = 'initial' | 'franchise-reroll' | 'era-reroll';

export function classicRollSeed(
  seed: Seed,
  version: string,
  kind: ClassicRollKind,
  round: number,
): string {
  return `${seed}:classic-roll:${version}:${kind}:${String(round)}`;
}

export function sortClassicCatalog(catalog: ClassicDraftCatalog): ClassicDraftCatalog {
  return [...catalog].sort((a, b) =>
    a.franchiseId < b.franchiseId
      ? -1
      : a.franchiseId > b.franchiseId
        ? 1
        : a.eraId < b.eraId
          ? -1
          : a.eraId > b.eraId
            ? 1
            : 0,
  );
}

export function slotRequirement(slotIndex: number): SlotGroup {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
    throw new Error(`slot index must be an integer in 0..4 (got ${String(slotIndex)})`);
  }
  return lineupSlotRequirement(slotIndex);
}

const SLOT_INDEXES: SlotIndex[] = [0, 1, 2, 3, 4];

function catalogPlayer(
  catalog: ClassicDraftCatalog,
  franchiseId: string,
  eraId: string,
  playerId: PlayerId,
): { playerId: PlayerId; positions: Position[] } | null {
  const entry = catalog.find((e) => e.franchiseId === franchiseId && e.eraId === eraId);
  return entry?.players.find((p) => p.playerId === playerId) ?? null;
}

function displacementTargetFor(
  catalog: ClassicDraftCatalog,
  incumbent: ClassicPick,
  targetSlot: SlotIndex,
  vacatingSlot: SlotIndex | null,
  picks: ClassicPick[],
): SlotIndex | null {
  const incumbentPlayer = catalogPlayer(
    catalog,
    incumbent.franchiseId,
    incumbent.eraId,
    incumbent.playerId,
  );
  if (!incumbentPlayer) return null;
  for (const slotIndex of SLOT_INDEXES) {
    if (slotIndex === targetSlot) continue;
    const occupied = picks.some((pick) => pick.slotIndex === slotIndex);
    const willBeOpen = slotIndex === vacatingSlot || !occupied;
    if (!willBeOpen) continue;
    if (canPlay(incumbentPlayer.positions, slotRequirement(slotIndex))) {
      return slotIndex;
    }
  }
  return null;
}

export function classicRollCandidates(
  catalog: ClassicDraftCatalog,
  state: ClassicDraftState,
  kind: ClassicRollKind,
): ClassicDraftCatalogEntry[] {
  if (kind !== 'initial') {
    if (state.roll === null) {
      throw new Error(`a ${kind} requires an active draft roll`);
    }
  }
  const draftedIds = new Set(state.picks.map((p) => p.playerId));
  const occupiedSlots = new Set(state.picks.map((p) => p.slotIndex));
  const requirements = new Set<SlotGroup>();
  for (let slotIndex = 0; slotIndex < LINEUP_STRUCTURE.length; slotIndex += 1) {
    if (!occupiedSlots.has(slotIndex)) {
      requirements.add(slotRequirement(slotIndex));
    }
  }
  return sortClassicCatalog(
    catalog.filter((entry) => {
      if (kind === 'franchise-reroll') {
        if (state.roll === null) return false;
        if (entry.eraId !== state.roll.eraId) return false;
        if (entry.franchiseId === state.roll.franchiseId) return false;
      }
      if (kind === 'era-reroll') {
        if (state.roll === null) return false;
        if (entry.franchiseId !== state.roll.franchiseId) return false;
        if (entry.eraId === state.roll.eraId) return false;
      }
      return entry.players.some(
        (player) =>
          !draftedIds.has(player.playerId) &&
          player.positions.some((position) => requirements.has(slotGroupOf(position))),
      );
    }),
  );
}

export function classicRerollAvailable(
  state: ClassicDraftState,
  kind: 'franchise' | 'era',
  catalog: ClassicDraftCatalog,
): boolean {
  if (state.roll === null) return false;
  const spent = kind === 'franchise' ? state.rerolls.franchiseSpent : state.rerolls.eraSpent;
  if (spent) return false;
  const rollKind: ClassicRollKind = kind === 'franchise' ? 'franchise-reroll' : 'era-reroll';
  return classicRollCandidates(catalog, state, rollKind).length > 0;
}

export function rollClassicPair(
  seed: Seed,
  round: number,
  kind: ClassicRollKind,
  candidates: ClassicDraftCatalogEntry[],
  context: EngineContext,
): ClassicRollContext {
  if (candidates.length === 0) {
    throw new Error(`no eligible pool for round ${String(round)}`);
  }
  const rollSeed = classicRollSeed(seed, CLASSIC_ROLL_VERSION, kind, round);
  const entry = context.rngFactory(rollSeed).pick(candidates);
  return { franchiseId: entry.franchiseId, eraId: entry.eraId };
}

export interface ClassicDraftInput {
  draftId: string;
  variant: ClassicVariant;
  seed: Seed;
  dataVersion: string;
  catalog: ClassicDraftCatalog;
}

export function createClassicDraft(
  input: ClassicDraftInput,
  context: EngineContext,
): ClassicDraftState {
  const parsed = classicDraftCatalogSchema.safeParse(input.catalog);
  if (!parsed.success) {
    throw new Error(`classic draft catalog is invalid: ${parsed.error.message}`);
  }
  const state: ClassicDraftState = {
    schemaVersion: CLASSIC_DRAFT_SCHEMA_VERSION,
    draftId: input.draftId,
    variant: input.variant,
    seed: input.seed,
    dataVersion: input.dataVersion,
    round: 1,
    status: 'drafting',
    roll: null,
    rerolls: { franchiseSpent: false, eraSpent: false },
    picks: [],
  };
  const candidates = classicRollCandidates(parsed.data, state, 'initial');
  if (candidates.length === 0) {
    throw new Error('no eligible pool for round 1');
  }
  const roll = rollClassicPair(input.seed, 1, 'initial', candidates, context);
  return { ...state, roll };
}

export function rerollClassicFranchise(
  state: ClassicDraftState,
  catalog: ClassicDraftCatalog,
  context: EngineContext,
): ClassicDraftState {
  if (state.status !== 'drafting') {
    throw new Error(`franchise reroll requires a drafting state (got ${state.status})`);
  }
  if (state.rerolls.franchiseSpent) {
    throw new Error('franchise reroll already spent');
  }
  if (state.roll === null) {
    throw new Error('franchise reroll requires an active roll');
  }
  const roll = state.roll;
  const candidates = classicRollCandidates(catalog, state, 'franchise-reroll');
  if (candidates.length === 0) {
    throw new Error(
      `no alternative franchise for era ${roll.eraId} in round ${String(state.round)}`,
    );
  }
  const nextRoll = rollClassicPair(
    state.seed,
    state.round,
    'franchise-reroll',
    candidates,
    context,
  );
  return {
    ...state,
    roll: nextRoll,
    rerolls: { ...state.rerolls, franchiseSpent: true, franchiseRound: state.round },
  };
}

export function rerollClassicEra(
  state: ClassicDraftState,
  catalog: ClassicDraftCatalog,
  context: EngineContext,
): ClassicDraftState {
  if (state.status !== 'drafting') {
    throw new Error(`era reroll requires a drafting state (got ${state.status})`);
  }
  if (state.rerolls.eraSpent) {
    throw new Error('era reroll already spent');
  }
  if (state.roll === null) {
    throw new Error('era reroll requires an active roll');
  }
  const roll = state.roll;
  const candidates = classicRollCandidates(catalog, state, 'era-reroll');
  if (candidates.length === 0) {
    throw new Error(
      `no alternative era for franchise ${roll.franchiseId} in round ${String(state.round)}`,
    );
  }
  const nextRoll = rollClassicPair(state.seed, state.round, 'era-reroll', candidates, context);
  return {
    ...state,
    roll: nextRoll,
    rerolls: { ...state.rerolls, eraSpent: true, eraRound: state.round },
  };
}

export interface ClassicDraftPlayerInput {
  playerId: PlayerId;
  slotIndex: SlotIndex;
}

export function draftClassicPlayer(
  state: ClassicDraftState,
  catalog: ClassicDraftCatalog,
  input: ClassicDraftPlayerInput,
  context: EngineContext,
): ClassicDraftState {
  if (state.status !== 'drafting') {
    throw new Error(`cannot draft in status ${state.status}`);
  }
  if (state.roll === null) {
    throw new Error('draft has no active roll');
  }
  const roll = state.roll;
  if (state.picks.some((p) => p.playerId === input.playerId)) {
    throw new Error(`player ${input.playerId} is already drafted`);
  }
  const entry = catalog.find((e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId);
  if (!entry) {
    throw new Error('catalog does not contain the current roll pair');
  }
  const player = entry.players.find((p) => p.playerId === input.playerId);
  if (!player) {
    throw new Error(`${input.playerId} is not in the rolled pool`);
  }
  if (!canPlay(player.positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const incumbentAtSlot = state.picks.find((p) => p.slotIndex === input.slotIndex);
  if (incumbentAtSlot) {
    const target = displacementTargetFor(
      catalog,
      incumbentAtSlot,
      input.slotIndex,
      null,
      state.picks,
    );
    if (target === null) {
      throw new Error(`slot ${String(input.slotIndex)} is already filled`);
    }
    const picksWithDisplacement = state.picks.map((pick) =>
      pick.playerId === incumbentAtSlot.playerId ? { ...pick, slotIndex: target } : pick,
    );
    const pick: ClassicPick = {
      round: state.round,
      playerId: input.playerId,
      franchiseId: roll.franchiseId,
      eraId: roll.eraId,
      slotIndex: input.slotIndex,
    };
    const picks = [...picksWithDisplacement, pick];
    if (picks.length === 5) {
      return { ...state, picks, status: 'complete', roll: null };
    }
    const nextState: ClassicDraftState = { ...state, picks, round: state.round + 1 };
    const candidates = classicRollCandidates(catalog, nextState, 'initial');
    if (candidates.length === 0) {
      throw new Error(`no eligible pool for round ${String(nextState.round)}`);
    }
    const nextRoll = rollClassicPair(state.seed, nextState.round, 'initial', candidates, context);
    return { ...nextState, roll: nextRoll };
  }
  const pick: ClassicPick = {
    round: state.round,
    playerId: input.playerId,
    franchiseId: roll.franchiseId,
    eraId: roll.eraId,
    slotIndex: input.slotIndex,
  };
  const picks = [...state.picks, pick];
  if (picks.length === 5) {
    return { ...state, picks, status: 'complete', roll: null };
  }
  const nextState: ClassicDraftState = { ...state, picks, round: state.round + 1 };
  const candidates = classicRollCandidates(catalog, nextState, 'initial');
  if (candidates.length === 0) {
    throw new Error(`no eligible pool for round ${String(nextState.round)}`);
  }
  const nextRoll = rollClassicPair(state.seed, nextState.round, 'initial', candidates, context);
  return { ...nextState, roll: nextRoll };
}

export interface ClassicRepositionInput {
  playerId: PlayerId;
  slotIndex: SlotIndex;
}

export function repositionClassicPlayer(
  state: ClassicDraftState,
  catalog: ClassicDraftCatalog,
  input: ClassicRepositionInput,
): ClassicDraftState {
  const pick = state.picks.find((p) => p.playerId === input.playerId);
  if (!pick) {
    throw new Error(`player ${input.playerId} is not drafted`);
  }
  if (pick.slotIndex === input.slotIndex) {
    return state;
  }
  const entry = catalog.find((e) => e.franchiseId === pick.franchiseId && e.eraId === pick.eraId);
  const player = entry?.players.find((p) => p.playerId === input.playerId);
  if (!player) {
    throw new Error(`${input.playerId} has no catalog record`);
  }
  if (!canPlay(player.positions, slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
  }
  const incumbent = state.picks.find((p) => p.slotIndex === input.slotIndex);
  if (!incumbent) {
    return {
      ...state,
      picks: state.picks.map((p) =>
        p.playerId === input.playerId ? { ...p, slotIndex: input.slotIndex } : p,
      ),
    };
  }
  const incumbentPlayer = catalogPlayer(
    catalog,
    incumbent.franchiseId,
    incumbent.eraId,
    incumbent.playerId,
  );
  if (!incumbentPlayer) {
    throw new Error(`${incumbent.playerId} has no catalog record`);
  }
  if (canPlay(incumbentPlayer.positions, slotRequirement(pick.slotIndex))) {
    return {
      ...state,
      picks: state.picks.map((p) => {
        if (p.playerId === input.playerId) return { ...p, slotIndex: input.slotIndex };
        if (p.playerId === incumbent.playerId) return { ...p, slotIndex: pick.slotIndex };
        return p;
      }),
    };
  }
  const target = displacementTargetFor(
    catalog,
    incumbent,
    input.slotIndex,
    pick.slotIndex,
    state.picks,
  );
  if (target === null) {
    throw new Error(`${incumbent.playerId} cannot be moved out of slot ${String(input.slotIndex)}`);
  }
  return {
    ...state,
    picks: state.picks.map((p) => {
      if (p.playerId === input.playerId) return { ...p, slotIndex: input.slotIndex };
      if (p.playerId === incumbent.playerId) return { ...p, slotIndex: target };
      return p;
    }),
  };
}

export interface ClassicChallengeEnvironment {
  runId: string;
  runSeed: Seed;

  players: SimulationPlayer[];
  dataVersion: string;
  ratingVersion: string;
  positionNormalizationVersion: string;
  engineVersion: string;

  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  eraId: string;
  homeDisplayName: string;
}

export function createClassicChallenge(
  draft: ClassicDraftState,
  env: ClassicChallengeEnvironment,
): ClassicChallengeCreation {
  if (draft.status !== 'complete') {
    throw new Error(`classic challenge requires a complete draft (got ${draft.status})`);
  }
  if (draft.picks.length !== 5) {
    throw new Error('classic challenge requires exactly five draft picks');
  }
  const pickIds = draft.picks.map((p) => p.playerId);
  if (new Set(pickIds).size !== pickIds.length) {
    throw new Error('classic draft picks must reference distinct players');
  }
  const pickSlots = draft.picks.map((p) => p.slotIndex);
  if (new Set(pickSlots).size !== pickSlots.length) {
    throw new Error('classic draft picks must fill distinct slots');
  }
  if (env.players.length !== 5) {
    throw new Error('classic challenge requires exactly five player snapshots');
  }
  const pickBySlot = new Map(draft.picks.map((p) => [p.slotIndex, p]));
  for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
    const pick = pickBySlot.get(slotIndex);
    const player = env.players[slotIndex];
    if (!pick) {
      throw new Error(`classic draft has no pick for slot ${String(slotIndex)}`);
    }
    if (!player || player.playerId !== pick.playerId) {
      throw new Error(
        `slot ${String(slotIndex)} player ${player?.playerId ?? 'missing'} does not match the draft pick ${pick.playerId}`,
      );
    }
  }
  const assignments = env.players.map((player, slotIndex) => ({
    slotIndex: slotIndex,
    playerId: player.playerId,
    positions: player.positions,
  }));
  const lineup = { structure: LINEUP_STRUCTURE, assignments };
  const validation = validateLineup(lineup);
  if (!validation.ok) {
    throw new Error(
      `classic lineup is not legal: ${validation.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const orderedPicks = [...draft.picks].sort((a, b) => a.slotIndex - b.slotIndex);
  const classicDraft: ClassicCompletedDraft = {
    draftId: draft.draftId,
    variant: draft.variant,
    seed: draft.seed,
    picks: orderedPicks,
  };
  return {
    mode: 'classic',
    runId: env.runId,
    franchiseId: null,
    eraId: env.eraId,
    homeDisplayName: env.homeDisplayName,
    lineup,
    players: env.players,
    selections: orderedPicks.map((p) => ({
      playerId: p.playerId,
      franchiseId: p.franchiseId,
      eraId: p.eraId,
    })),
    runSeed: env.runSeed,
    dataVersion: env.dataVersion,
    ratingVersion: env.ratingVersion,
    positionNormalizationVersion: env.positionNormalizationVersion,
    engineVersion: env.engineVersion,
    profile: env.profile,
    bracket: env.bracket,
    variant: draft.variant,
    classicDraft,
  };
}
