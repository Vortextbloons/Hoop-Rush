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
  SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  CLASSIC_DRAFT_SCHEMA_VERSION,
  CLASSIC_ROLL_VERSION,
  LINEUP_STRUCTURE,
  classicDraftCatalogSchema,
} from '@hoop-rush/data-contracts';
import { validateLineup } from '../../domain/lineup.js';
import type { EngineContext } from '../../sim/context.js';
import type { ClassicChallengeCreation } from '../../challenge/commands.js';

/**
 * Classic draft commands (spec/01 Classic game mode): the single authoritative
 * path from a validated franchise-era catalog to a completed five-player draft.
 * Every roll and reroll derives from the saved draft seed plus the round and
 * reroll kind, so drafts are reproducible byte-for-byte. Commands are pure:
 * all randomness flows through the injected EngineContext RNG factory.
 */

export type ClassicRollKind = 'initial' | 'franchise-reroll' | 'era-reroll';

/** Deterministic roll seed string: saved draft seed + roll version + kind + round. */
export function classicRollSeed(
  seed: Seed,
  version: string,
  kind: ClassicRollKind,
  round: number,
): string {
  return `${seed}:classic-roll:${version}:${kind}:${round}`;
}

/** Canonically sorted copy of the catalog: franchiseId asc, then eraId asc. */
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

/** Slot requirement (position union) for a slot index. */
export function slotRequirement(slotIndex: number): 'G' | 'F' | 'C' {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
    throw new Error(`slot index must be an integer in 0..4 (got ${String(slotIndex)})`);
  }
  return LINEUP_STRUCTURE[slotIndex]!;
}

/**
 * Candidate pairs for a roll, filtered to pairs containing a player who is
 * not yet drafted AND can legally fill an open slot, then sorted canonically.
 * Rerolls filter on a single axis (spec/01): a 'franchise-reroll' preserves
 * the current roll's era and requires a different eligible franchise; an
 * 'era-reroll' preserves the current roll's franchise and requires a
 * different eligible era. Pairs that differ on both axes are never eligible.
 */
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
  const requirements = new Set<Position>();
  for (let slotIndex = 0; slotIndex < LINEUP_STRUCTURE.length; slotIndex += 1) {
    if (!occupiedSlots.has(slotIndex as SlotIndex)) {
      requirements.add(slotRequirement(slotIndex));
    }
  }
  return sortClassicCatalog(
    catalog.filter((entry) => {
      if (kind === 'franchise-reroll') {
        if (entry.eraId !== state.roll!.eraId) return false;
        if (entry.franchiseId === state.roll!.franchiseId) return false;
      }
      if (kind === 'era-reroll') {
        if (entry.franchiseId !== state.roll!.franchiseId) return false;
        if (entry.eraId === state.roll!.eraId) return false;
      }
      return entry.players.some(
        (player) =>
          !draftedIds.has(player.playerId) &&
          player.positions.some((position) => requirements.has(position)),
      );
    }),
  );
}

/** True when a reroll kind has an alternative candidate pair and is unspent. */
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

/** Rolls one pair from the given candidate entries via the context RNG. */
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
  if (state.picks.some((p) => p.slotIndex === input.slotIndex)) {
    throw new Error(`slot ${String(input.slotIndex)} is already filled`);
  }
  const entry = catalog.find((e) => e.franchiseId === roll.franchiseId && e.eraId === roll.eraId);
  if (!entry) {
    throw new Error('catalog does not contain the current roll pair');
  }
  const player = entry.players.find((p) => p.playerId === input.playerId);
  if (!player) {
    throw new Error(`${input.playerId} is not in the rolled pool`);
  }
  if (!player.positions.includes(slotRequirement(input.slotIndex))) {
    throw new Error(`${input.playerId} cannot play slot ${String(input.slotIndex)}`);
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

/**
 * Moves a drafted player to another legal slot. When the target is occupied,
 * both picks swap only if the incumbent can fill the vacated slot. Never
 * removes or replaces a player, and never changes round, status, roll, or
 * rerolls. The catalog resolves the playable position unions.
 */
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
  if (!player.positions.includes(slotRequirement(input.slotIndex))) {
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
  const incumbentEntry = catalog.find(
    (e) => e.franchiseId === incumbent.franchiseId && e.eraId === incumbent.eraId,
  );
  const incumbentPlayer = incumbentEntry?.players.find((p) => p.playerId === incumbent.playerId);
  if (!incumbentPlayer) {
    throw new Error(`${incumbent.playerId} has no catalog record`);
  }
  if (!incumbentPlayer.positions.includes(slotRequirement(pick.slotIndex))) {
    throw new Error(`${incumbent.playerId} cannot play slot ${String(pick.slotIndex)}`);
  }
  return {
    ...state,
    picks: state.picks.map((p) => {
      if (p.playerId === input.playerId) return { ...p, slotIndex: input.slotIndex };
      if (p.playerId === incumbent.playerId) return { ...p, slotIndex: pick.slotIndex };
      return p;
    }),
  };
}

export interface ClassicChallengeEnvironment {
  runId: string;
  runSeed: Seed;
  /** Five resolved SimulationPlayer snapshots in SLOT order 0..4. */
  players: SimulationPlayer[];
  dataVersion: string;
  ratingVersion: string;
  positionNormalizationVersion: string;
  engineVersion: string;
  /** Era simulation profile (fixed '2010s' for every run). */
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  eraId: string;
  homeDisplayName: string;
}

/**
 * Turns a completed classic draft into a ClassicChallengeCreation whose lineup,
 * players, and selections agree exactly with the draft picks. The challenge
 * command layer re-validates the creation (mode, variant, classicDraft, and
 * every existing sandbox rule) before a run is accepted.
 */
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
    const pick = pickBySlot.get(slotIndex as SlotIndex);
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
    slotIndex: slotIndex as SlotIndex,
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
