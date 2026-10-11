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
  assignSlots,
  buildDraftDuelSafetyInput,
  draftDuelCardsOfParticipant,
  draftDuelClaimedPlayerIds,
  draftDuelPickerForOrdinal,
  otherDraftDuelParticipant,
  type DraftDuelRoundOffers,
} from './feasibility.ts';
import { buildRoundOffers } from './offers.ts';
import { createRng } from '../../sim/rng.ts';
import { draftDuelFirstPicker, draftDuelTimeoutSeed, draftDuelTimeoutSeedPath } from './seeds.ts';

export type DraftDuelDraftErrorCode = 'turn' | 'not-offered' | 'claimed' | 'illegal' | 'phase';

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
}

export interface DraftDuelTimeoutPick {
  pickOrdinal: number;
  playerId: PlayerId;
  playerVersionId: string;
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
  const cards = draftDuelCardsOfParticipant(state, participantId);
  const assignment = assignSlots(cards);
  if (assignment === null) {
    throw new DraftDuelDraftError(
      'illegal',
      `draft duel roster for ${participantId} cannot be assigned to lineup slots`,
    );
  }
  for (const card of cards) catalogEntryForVersion(catalog, card.playerVersionId);
  const slots: DraftDuelRosterSlot[] = [];
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    const slotIndex = assignment[index];
    if (card === undefined || slotIndex === undefined) {
      throw new DraftDuelDraftError('illegal', `draft duel roster assignment is incomplete`);
    }
    slots.push({ slotIndex, card });
  }
  slots.sort((a, b) => a.slotIndex - b.slotIndex);
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
  const assessed = draftDuelLegalPicks(state, catalog)[slot];
  if (!assessed || !assessed.available) {
    throw new DraftDuelDraftError(
      'illegal',
      `pick ${input.playerId}/${input.playerVersionId} at ordinal ${String(state.pickOrdinal)} is unavailable (${assessed?.reason ?? 'unknown'})`,
    );
  }
  const pick: DraftDuelPick = {
    pickOrdinal: state.pickOrdinal,
    round: round.round,
    slot,
    participantId: picker,
    card: assessed.card,
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
  const legal = draftDuelLegalPicks(state, catalog).filter((option) => option.available);
  const players: Array<{ playerId: PlayerId; cards: DraftDuelCard[] }> = [];
  const seen = new Set<string>();
  for (const option of legal) {
    if (seen.has(option.card.playerId)) continue;
    seen.add(option.card.playerId);
    players.push({ playerId: option.card.playerId, cards: [option.card] });
  }
  if (players.length === 0) {
    throw new DraftDuelDraftError(
      'illegal',
      `no legal timeout pick for ${picker} at ordinal ${String(state.pickOrdinal)}`,
    );
  }
  const rng = createRng(draftDuelTimeoutSeed(state.rootSeed, picker, state.pickOrdinal));
  const player = rng.pick(players);
  const card = player.cards.length === 1 ? player.cards[0] : rng.pick(player.cards);
  if (!card) {
    throw new DraftDuelDraftError('illegal', 'timeout pick lost its card');
  }
  return {
    pickOrdinal: state.pickOrdinal,
    playerId: player.playerId,
    playerVersionId: card.playerVersionId,
    seedPath: draftDuelTimeoutSeedPath(picker, state.pickOrdinal),
  };
}
