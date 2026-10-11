import type {
  DraftDuelCard,
  DraftDuelDraft,
  DraftDuelFairness,
  DraftDuelOfferedPick,
  DraftDuelParticipantId,
  DraftDuelPick,
  DraftDuelRoster,
  DraftDuelRosterSlot,
  DraftDuelRound,
  PlayerId,
  Seed,
} from '@hoop-rush/data-contracts';
import { catalogEntryForVersion } from './catalog.ts';
import type { DraftDuelCatalog } from './catalog.ts';
import {
  assessDraftDuelOffers,
  buildDraftDuelSafetyInput,
  draftDuelCardPlayableAtSlot,
  draftDuelClaimedPlayerIds,
  draftDuelFallbackPlacements,
  draftDuelOccupiedSlotIndexes,
  draftDuelPickerForOrdinal,
  otherDraftDuelParticipant,
  type DraftDuelRoundOffers,
  type DraftDuelSlotPlacement,
} from './feasibility.ts';
import { buildRoundOffers } from './offers.ts';
import { createRng } from '../../sim/rng.ts';
import { draftDuelFirstPicker, draftDuelTimeoutSeed, draftDuelTimeoutSeedPath } from './seeds.ts';

export type DraftDuelDraftErrorCode =
  'turn' | 'not-offered' | 'claimed' | 'slot' | 'position' | 'illegal' | 'phase';

export class DraftDuelDraftError extends Error {
  readonly code: DraftDuelDraftErrorCode;
  constructor(code: DraftDuelDraftErrorCode, message: string) {
    super(message);
    this.name = 'DraftDuelDraftError';
    this.code = code;
  }
}

export interface CreateDraftDuelDraftInput {
  rootSeed: Seed;
  fairness: DraftDuelFairness;
  catalog: DraftDuelCatalog;
}

export interface DraftDuelPickInput {
  participantId: DraftDuelParticipantId;
  playerId: PlayerId;
  playerVersionId: string;
  slotIndex?: number;
}

export interface DraftDuelTimeoutPick {
  pickOrdinal: number;
  playerId: PlayerId;
  playerVersionId: string;
  slotIndex: number;
  seedPath: string;
}

export { draftDuelClaimedPlayerIds };

function previewOffers(catalog: DraftDuelCatalog): DraftDuelRoundOffers {
  const cards: DraftDuelCard[] = [];
  for (const playerId of catalog.playerIds) {
    const entry = (catalog.byPlayerId.get(playerId) ?? [])[0];
    if (entry) cards.push(entry.card);
  }
  if (cards.length === 0) throw new Error('draft duel catalog has no cards');
  const pool = (start: number): DraftDuelCard[] => {
    const result: DraftDuelCard[] = [];
    for (let index = 0; index < 8; index += 1) {
      const card = cards[(start + index) % cards.length];
      if (card) result.push(card);
    }
    return result;
  };
  return { p1: pool(0), p2: pool(8) };
}

export function createDraftDuelDraft(input: CreateDraftDuelDraftInput): DraftDuelDraft {
  const firstPicker = draftDuelFirstPicker(input.rootSeed);
  const rounds: DraftDuelRound[] = [];
  for (let round = 1; round <= 5; round += 1) {
    rounds.push({ round, offers: previewOffers(input.catalog), picks: [] });
  }
  const base: DraftDuelDraft = {
    schemaVersion: 1,
    rootSeed: input.rootSeed,
    fairness: input.fairness,
    firstPicker,
    pickOrdinal: 0,
    rounds,
    status: 'drafting',
  };
  const firstOffers = buildRoundOffers(base, input.catalog);
  return {
    ...base,
    rounds: base.rounds.map((round, index) =>
      index === 0 ? { ...round, offers: firstOffers } : round,
    ),
  };
}

export function draftDuelCurrentPicker(state: DraftDuelDraft): DraftDuelParticipantId {
  if (state.status !== 'drafting') {
    throw new DraftDuelDraftError('phase', 'draft duel is complete');
  }
  return draftDuelPickerForOrdinal(state.firstPicker, state.pickOrdinal);
}

export function isDraftDuelComplete(state: DraftDuelDraft): boolean {
  return state.status === 'complete';
}

export function draftDuelLegalPicks(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelOfferedPick[] {
  if (state.status === 'complete') {
    const finalRound = state.rounds[state.rounds.length - 1];
    if (!finalRound) return [];
    const picker = otherDraftDuelParticipant(state.firstPicker);
    return finalRound.offers[picker].map((card, slot) => ({
      slot,
      card,
      available: false,
      reason: 'phase',
      legalSlots: [],
    }));
  }
  const picker = draftDuelCurrentPicker(state);
  const round = state.rounds[Math.floor(state.pickOrdinal / 2)];
  if (!round) {
    throw new DraftDuelDraftError(
      'phase',
      `no round offers for pick ordinal ${String(state.pickOrdinal)}`,
    );
  }
  return assessDraftDuelOffers(buildDraftDuelSafetyInput(state, catalog, round.offers), picker);
}

export function draftDuelRoster(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
  participantId: DraftDuelParticipantId,
): DraftDuelRoster {
  const placed: DraftDuelSlotPlacement[] = [];
  const legacyCards: DraftDuelCard[] = [];
  const occupied = new Set<number>();
  for (const round of state.rounds) {
    for (const pick of round.picks) {
      if (pick.participantId !== participantId) continue;
      catalogEntryForVersion(catalog, pick.card.playerVersionId);
      if (pick.slotIndex === undefined) {
        legacyCards.push(pick.card);
        continue;
      }
      const slotIndex = pick.slotIndex;
      if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 4) {
        throw new DraftDuelDraftError(
          'illegal',
          `draft duel pick ${String(pick.pickOrdinal)} has an invalid slotIndex`,
        );
      }
      if (occupied.has(slotIndex)) {
        throw new DraftDuelDraftError(
          'illegal',
          `draft duel roster for ${participantId} has duplicate slot ${String(slotIndex)}`,
        );
      }
      if (!draftDuelCardPlayableAtSlot(pick.card, slotIndex)) {
        throw new DraftDuelDraftError(
          'illegal',
          `draft duel card ${pick.card.playerVersionId} cannot play slot ${String(slotIndex)}`,
        );
      }
      occupied.add(slotIndex);
      placed.push({ slotIndex, card: pick.card });
    }
  }
  const filled = draftDuelFallbackPlacements(placed, legacyCards);
  if (filled === null) {
    throw new DraftDuelDraftError(
      'illegal',
      `draft duel roster for ${participantId} cannot be assigned to lineup slots`,
    );
  }
  const slots: DraftDuelRosterSlot[] = [...filled].sort((a, b) => a.slotIndex - b.slotIndex);
  return { participantId, slots };
}

export function applyDraftDuelPick(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
  input: DraftDuelPickInput,
): DraftDuelDraft {
  if (state.status !== 'drafting' || state.pickOrdinal >= 10) {
    throw new DraftDuelDraftError('phase', 'draft duel is not drafting');
  }
  const picker = draftDuelCurrentPicker(state);
  if (input.participantId !== picker) {
    throw new DraftDuelDraftError('turn', `it is ${picker}'s pick, not ${input.participantId}'s`);
  }
  const roundIndex = Math.floor(state.pickOrdinal / 2);
  const round = state.rounds[roundIndex];
  if (!round) {
    throw new DraftDuelDraftError(
      'phase',
      `no round offers for pick ordinal ${String(state.pickOrdinal)}`,
    );
  }
  const slot = round.offers[picker].findIndex(
    (card) => card.playerId === input.playerId && card.playerVersionId === input.playerVersionId,
  );
  if (slot < 0) {
    throw new DraftDuelDraftError(
      'not-offered',
      `${input.playerId}/${input.playerVersionId} is not offered to ${picker} in round ${String(round.round)}`,
    );
  }
  if (draftDuelClaimedPlayerIds(state).has(input.playerId)) {
    throw new DraftDuelDraftError('claimed', `player ${input.playerId} is already claimed`);
  }
  const card = round.offers[picker][slot];
  if (!card) {
    throw new DraftDuelDraftError(
      'not-offered',
      `${input.playerId}/${input.playerVersionId} is missing from the offers`,
    );
  }
  const assessed = draftDuelLegalPicks(state, catalog)[slot];
  let slotIndex: number;
  if (input.slotIndex !== undefined) {
    const requested = input.slotIndex;
    if (!Number.isInteger(requested) || requested < 0 || requested > 4) {
      throw new DraftDuelDraftError(
        'slot',
        `slot ${String(requested)} is outside the lineup range 0..4`,
      );
    }
    if (draftDuelOccupiedSlotIndexes(state, picker).has(requested)) {
      throw new DraftDuelDraftError(
        'slot',
        `slot ${String(requested)} is already occupied for ${picker}`,
      );
    }
    if (!draftDuelCardPlayableAtSlot(card, requested)) {
      throw new DraftDuelDraftError(
        'position',
        `${card.playerId}/${card.playerVersionId} cannot play slot ${String(requested)}`,
      );
    }
    const legalSlots = assessed?.legalSlots ?? [];
    if (!assessed?.available || !legalSlots.includes(requested)) {
      throw new DraftDuelDraftError(
        'illegal',
        `pick ${input.playerId}/${input.playerVersionId} at slot ${String(requested)} is unavailable (${assessed?.reason ?? 'unknown'})`,
      );
    }
    slotIndex = requested;
  } else {
    const legalSlots = assessed?.legalSlots ?? [];
    if (!assessed?.available || legalSlots.length === 0) {
      throw new DraftDuelDraftError(
        'illegal',
        `pick ${input.playerId}/${input.playerVersionId} at ordinal ${String(state.pickOrdinal)} is unavailable (${assessed?.reason ?? 'unknown'})`,
      );
    }
    slotIndex = Math.min(...legalSlots);
  }
  const pick: DraftDuelPick = {
    pickOrdinal: state.pickOrdinal,
    round: round.round,
    slot,
    participantId: picker,
    card,
    slotIndex,
  };
  const pickOrdinal = state.pickOrdinal + 1;
  const next: DraftDuelDraft = {
    ...state,
    pickOrdinal,
    rounds: state.rounds.map((entry, index) =>
      index === roundIndex ? { ...entry, picks: [...entry.picks, pick] } : entry,
    ),
    status: pickOrdinal === 10 ? 'complete' : 'drafting',
  };
  if (pickOrdinal < 10 && pickOrdinal % 2 === 0) {
    const offers = buildRoundOffers(next, catalog);
    const nextRoundIndex = Math.floor(pickOrdinal / 2);
    return {
      ...next,
      rounds: next.rounds.map((entry, index) =>
        index === nextRoundIndex ? { ...entry, offers } : entry,
      ),
    };
  }
  return next;
}

export function draftDuelTimeoutPick(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelTimeoutPick {
  if (state.status !== 'drafting') {
    throw new DraftDuelDraftError('phase', 'draft duel is not drafting');
  }
  const picker = draftDuelCurrentPicker(state);
  const legal = draftDuelLegalPicks(state, catalog).filter(
    (option) => option.available && (option.legalSlots?.length ?? 0) > 0,
  );
  const optionsByPlayer = new Map<string, DraftDuelOfferedPick[]>();
  for (const option of legal) {
    const list = optionsByPlayer.get(option.card.playerId);
    if (list) list.push(option);
    else optionsByPlayer.set(option.card.playerId, [option]);
  }
  const players = [...optionsByPlayer.values()];
  if (players.length === 0) {
    throw new DraftDuelDraftError(
      'illegal',
      `no legal timeout pick for ${picker} at ordinal ${String(state.pickOrdinal)}`,
    );
  }
  const rng = createRng(draftDuelTimeoutSeed(state.rootSeed, picker, state.pickOrdinal));
  const options = rng.pick(players);
  const option = options.length === 1 ? options[0] : rng.pick(options);
  if (!option) {
    throw new DraftDuelDraftError('illegal', 'timeout pick lost its card');
  }
  const legalSlots = option.legalSlots ?? [];
  if (legalSlots.length === 0) {
    throw new DraftDuelDraftError('illegal', 'timeout pick lost its legal slots');
  }
  return {
    pickOrdinal: state.pickOrdinal,
    playerId: option.card.playerId,
    playerVersionId: option.card.playerVersionId,
    slotIndex: Math.min(...legalSlots),
    seedPath: draftDuelTimeoutSeedPath(picker, state.pickOrdinal),
  };
}
