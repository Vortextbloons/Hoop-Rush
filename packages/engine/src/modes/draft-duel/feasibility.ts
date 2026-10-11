import type {
  DraftDuelCard,
  DraftDuelDraft,
  DraftDuelOfferedPick,
  DraftDuelParticipantId,
  DraftDuelUnavailableReason,
  SlotGroup,
} from '@hoop-rush/data-contracts';
import { LINEUP_STRUCTURE, slotGroupOf } from '@hoop-rush/data-contracts';
import { cardPlayableAt } from './catalog.ts';
import type { DraftDuelCatalog } from './catalog.ts';

export interface DraftDuelGroupNeeds {
  G: number;
  F: number;
  C: number;
}

export interface DraftDuelRoundOffers {
  p1: DraftDuelCard[];
  p2: DraftDuelCard[];
}

export interface DraftDuelOfferPools {
  p1: readonly DraftDuelCard[];
  p2: readonly DraftDuelCard[];
}

export interface DraftDuelCompletionInput {
  needed: DraftDuelGroupNeeds;
  remainingPicks: number;
  unclaimedProfileCounts: ReadonlyMap<number, number>;
}

export interface DraftDuelSafetyBase {
  firstPicker: DraftDuelParticipantId;
  currentPicker: DraftDuelParticipantId;
  pickOrdinal: number;
  rosters: { readonly p1: readonly DraftDuelCard[]; readonly p2: readonly DraftDuelCard[] };
  claimedPlayerIds: ReadonlySet<string>;
  profileMaskByPlayerId: ReadonlyMap<string, number>;
  unclaimedProfileCounts: ReadonlyMap<number, number>;
}

export interface DraftDuelSafetyInput extends DraftDuelSafetyBase {
  offered: DraftDuelOfferPools;
}

const GROUP_ORDER: readonly SlotGroup[] = ['G', 'F', 'C'];
const GROUP_MASK: Record<SlotGroup, number> = { G: 1, F: 2, C: 4 };
const PROFILE_MASKS: readonly number[] = [1, 2, 4, 3, 5, 6, 7];
const LINEUP_SIZE = LINEUP_STRUCTURE.length;

export function slotGroupAt(slotIndex: number): SlotGroup | undefined {
  const position = LINEUP_STRUCTURE[slotIndex];
  return position === undefined ? undefined : slotGroupOf(position);
}

export function otherDraftDuelParticipant(
  participantId: DraftDuelParticipantId,
): DraftDuelParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export function draftDuelPickerForOrdinal(
  firstPicker: DraftDuelParticipantId,
  pickOrdinal: number,
): DraftDuelParticipantId {
  if (!Number.isInteger(pickOrdinal) || pickOrdinal < 0 || pickOrdinal > 10) {
    throw new Error(
      `draft duel pickOrdinal must be an integer in 0..10 (got ${String(pickOrdinal)})`,
    );
  }
  return pickOrdinal % 2 === 0 ? firstPicker : otherDraftDuelParticipant(firstPicker);
}

export function draftDuelCardProfileMask(card: DraftDuelCard): number {
  let mask = 0;
  for (const group of GROUP_ORDER) {
    if (cardPlayableAt(card, group)) mask |= GROUP_MASK[group];
  }
  return mask;
}

export function profileMaskCovers(mask: number, group: SlotGroup): boolean {
  return (mask & GROUP_MASK[group]) !== 0;
}

export function draftDuelClaimedPlayerIds(state: DraftDuelDraft): Set<string> {
  const claimed = new Set<string>();
  for (const round of state.rounds) {
    for (const pick of round.picks) claimed.add(pick.card.playerId);
  }
  return claimed;
}

export function draftDuelCardsOfParticipant(
  state: DraftDuelDraft,
  participantId: DraftDuelParticipantId,
): DraftDuelCard[] {
  const cards: DraftDuelCard[] = [];
  for (const round of state.rounds) {
    for (const pick of round.picks) {
      if (pick.participantId === participantId) cards.push(pick.card);
    }
  }
  return cards;
}

export function assignSlots(cards: readonly DraftDuelCard[]): number[] | null {
  const assignment = new Array<number>(cards.length).fill(-1);
  const used = new Array<boolean>(LINEUP_SIZE).fill(false);
  function search(index: number): boolean {
    if (index === cards.length) return true;
    const card = cards[index];
    if (card === undefined) return false;
    for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
      if (used[slot]) continue;
      const group = slotGroupAt(slot);
      if (group === undefined || !cardPlayableAt(card, group)) continue;
      assignment[index] = slot;
      used[slot] = true;
      if (search(index + 1)) return true;
      used[slot] = false;
      assignment[index] = -1;
    }
    return false;
  }
  return search(0) ? assignment : null;
}

function needsForUsedSlots(used: readonly boolean[]): DraftDuelGroupNeeds {
  const needs: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
  for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
    if (used[slot]) continue;
    const group = slotGroupAt(slot);
    if (group === undefined) continue;
    needs[group] += 1;
  }
  return needs;
}

export function neededGroups(cards: readonly DraftDuelCard[]): DraftDuelGroupNeeds {
  const assignment = assignSlots(cards);
  if (assignment === null) {
    throw new Error('draft duel roster cannot be assigned to lineup slots');
  }
  const used = new Array<boolean>(LINEUP_SIZE).fill(false);
  for (const slot of assignment) {
    if (slot >= 0 && slot < LINEUP_SIZE) used[slot] = true;
  }
  return needsForUsedSlots(used);
}

export function completionFeasible(input: DraftDuelCompletionInput): boolean {
  const { needed } = input;
  if (needed.G < 0 || needed.F < 0 || needed.C < 0) return false;
  const total = needed.G + needed.F + needed.C;
  if (total === 0) return true;
  if (total > input.remainingPicks) return false;
  const memo = new Map<string, boolean>();
  function search(maskIndex: number, g: number, f: number, c: number): boolean {
    if (g === 0 && f === 0 && c === 0) return true;
    if (maskIndex >= PROFILE_MASKS.length) return false;
    const key = `${String(maskIndex)}:${String(g)}:${String(f)}:${String(c)}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const mask = PROFILE_MASKS[maskIndex];
    if (mask === undefined) return false;
    const count = input.unclaimedProfileCounts.get(mask) ?? 0;
    const maxG = profileMaskCovers(mask, 'G') ? Math.min(count, g) : 0;
    const maxF = profileMaskCovers(mask, 'F') ? Math.min(count, f) : 0;
    const maxC = profileMaskCovers(mask, 'C') ? Math.min(count, c) : 0;
    let result = false;
    for (let useG = maxG; useG >= 0 && !result; useG -= 1) {
      for (let useF = maxF; useF >= 0 && !result; useF -= 1) {
        for (let useC = maxC; useC >= 0 && !result; useC -= 1) {
          if (useG + useF + useC > count) continue;
          if (search(maskIndex + 1, g - useG, f - useF, c - useC)) result = true;
        }
      }
    }
    memo.set(key, result);
    return result;
  }
  return search(0, needed.G, needed.F, needed.C);
}

export function catalogPlayerProfileMasks(catalog: DraftDuelCatalog): Map<string, number> {
  const masks = new Map<string, number>();
  for (const playerId of catalog.playerIds) {
    const entries = catalog.byPlayerId.get(playerId) ?? [];
    let mask = 0;
    for (const entry of entries) {
      mask |= draftDuelCardProfileMask(entry.card);
    }
    if (mask !== 0) masks.set(playerId, mask);
  }
  return masks;
}

export function unclaimedProfileCountsFromMasks(
  profileMaskByPlayerId: ReadonlyMap<string, number>,
  claimedPlayerIds: ReadonlySet<string>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [playerId, mask] of profileMaskByPlayerId) {
    if (claimedPlayerIds.has(playerId)) continue;
    counts.set(mask, (counts.get(mask) ?? 0) + 1);
  }
  return counts;
}

export function unclaimedProfileCounts(
  catalog: DraftDuelCatalog,
  claimedPlayerIds: ReadonlySet<string>,
): Map<number, number> {
  return unclaimedProfileCountsFromMasks(catalogPlayerProfileMasks(catalog), claimedPlayerIds);
}

export function unclaimedGroupAvailability(
  unclaimedProfileCounts: ReadonlyMap<number, number>,
): DraftDuelGroupNeeds {
  const availability: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
  for (const [mask, count] of unclaimedProfileCounts) {
    for (const group of GROUP_ORDER) {
      if (profileMaskCovers(mask, group)) availability[group] += count;
    }
  }
  return availability;
}

export function draftDuelRosterNeedsOptions(
  cards: readonly DraftDuelCard[],
): DraftDuelGroupNeeds[] {
  const options = new Map<string, DraftDuelGroupNeeds>();
  const used = new Array<boolean>(LINEUP_SIZE).fill(false);
  function visit(index: number): void {
    if (index === cards.length) {
      const needs = needsForUsedSlots(used);
      options.set(`${String(needs.G)}-${String(needs.F)}-${String(needs.C)}`, needs);
      return;
    }
    const card = cards[index];
    if (card === undefined) return;
    for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
      if (used[slot]) continue;
      const group = slotGroupAt(slot);
      if (group === undefined || !cardPlayableAt(card, group)) continue;
      used[slot] = true;
      visit(index + 1);
      used[slot] = false;
    }
  }
  visit(0);
  return [...options.values()];
}

export function rosterCompletionPossible(
  cards: readonly DraftDuelCard[],
  remainingPicks: number,
  unclaimedProfileCounts: ReadonlyMap<number, number>,
): boolean {
  if (cards.length + remainingPicks !== LINEUP_SIZE) return false;
  for (const needed of draftDuelRosterNeedsOptions(cards)) {
    if (needed.G + needed.F + needed.C !== remainingPicks) continue;
    if (completionFeasible({ needed, remainingPicks, unclaimedProfileCounts })) return true;
  }
  return false;
}

export function buildDraftDuelSafetyBase(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelSafetyBase {
  const claimedPlayerIds = draftDuelClaimedPlayerIds(state);
  const profileMaskByPlayerId = catalogPlayerProfileMasks(catalog);
  return {
    firstPicker: state.firstPicker,
    currentPicker: draftDuelPickerForOrdinal(state.firstPicker, state.pickOrdinal),
    pickOrdinal: state.pickOrdinal,
    rosters: {
      p1: draftDuelCardsOfParticipant(state, 'p1'),
      p2: draftDuelCardsOfParticipant(state, 'p2'),
    },
    claimedPlayerIds,
    profileMaskByPlayerId,
    unclaimedProfileCounts: unclaimedProfileCountsFromMasks(
      profileMaskByPlayerId,
      claimedPlayerIds,
    ),
  };
}

export function withDraftDuelOffers(
  base: DraftDuelSafetyBase,
  offered: DraftDuelOfferPools,
): DraftDuelSafetyInput {
  return { ...base, offered };
}

export function buildDraftDuelSafetyInput(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
  offered: DraftDuelOfferPools,
): DraftDuelSafetyInput {
  return withDraftDuelOffers(buildDraftDuelSafetyBase(state, catalog), offered);
}

function removePlayerFromPoolCounts(
  counts: ReadonlyMap<number, number>,
  mask: number,
): Map<number, number> {
  const next = new Map(counts);
  const current = next.get(mask) ?? 0;
  if (current <= 1) next.delete(mask);
  else next.set(mask, current - 1);
  return next;
}

function afterDraftDuelClaim(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
): DraftDuelSafetyInput {
  const mask = input.profileMaskByPlayerId.get(card.playerId) ?? draftDuelCardProfileMask(card);
  const claimedPlayerIds = new Set(input.claimedPlayerIds);
  claimedPlayerIds.add(card.playerId);
  const rosters =
    picker === 'p1'
      ? { ...input.rosters, p1: [...input.rosters.p1, card] }
      : { ...input.rosters, p2: [...input.rosters.p2, card] };
  return {
    ...input,
    currentPicker: otherDraftDuelParticipant(picker),
    rosters,
    claimedPlayerIds,
    unclaimedProfileCounts: removePlayerFromPoolCounts(input.unclaimedProfileCounts, mask),
  };
}

export function draftDuelPickSafety(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
): DraftDuelUnavailableReason | null {
  if (input.claimedPlayerIds.has(card.playerId)) return 'claimed';
  const own = input.rosters[picker];
  const other = input.rosters[otherDraftDuelParticipant(picker)];
  const ownTrial = [...own, card];
  if (assignSlots(ownTrial) === null) return 'position';
  const after = afterDraftDuelClaim(input, picker, card);
  if (
    !rosterCompletionPossible(ownTrial, LINEUP_SIZE - ownTrial.length, after.unclaimedProfileCounts)
  ) {
    return 'completion';
  }
  if (!rosterCompletionPossible(other, LINEUP_SIZE - other.length, after.unclaimedProfileCounts)) {
    return 'completion';
  }
  return null;
}

export function assessDraftDuelOffers(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
): DraftDuelOfferedPick[] {
  const offers = input.offered[picker];
  const markAll = (reason: DraftDuelUnavailableReason): DraftDuelOfferedPick[] =>
    offers.map((card, slot) => ({ slot, card, available: false, reason }));
  if (input.pickOrdinal >= 10) return markAll('phase');
  if (picker !== input.currentPicker) return markAll('turn');
  return offers.map((card, slot) => {
    let reason = draftDuelPickSafety(input, picker, card);
    if (reason === null && picker === input.firstPicker) {
      const after = afterDraftDuelClaim(input, picker, card);
      const opponent = otherDraftDuelParticipant(picker);
      let opponentHasLegalPick = false;
      for (const candidate of after.offered[opponent]) {
        if (draftDuelPickSafety(after, opponent, candidate) === null) {
          opponentHasLegalPick = true;
          break;
        }
      }
      if (!opponentHasLegalPick) reason = 'completion';
    }
    return { slot, card, available: reason === null, reason };
  });
}

export function draftDuelRoundSafetyHolds(input: DraftDuelSafetyInput): boolean {
  if (input.pickOrdinal >= 10) return false;
  const first = draftDuelPickerForOrdinal(input.firstPicker, input.pickOrdinal);
  const firstAssessments = assessDraftDuelOffers(input, first);
  let firstHasLegalPick = false;
  for (const option of firstAssessments) {
    if (option.available) {
      firstHasLegalPick = true;
      break;
    }
  }
  if (!firstHasLegalPick) return false;
  for (const option of firstAssessments) {
    if (!option.available) continue;
    const after = afterDraftDuelClaim(input, first, option.card);
    const second = otherDraftDuelParticipant(first);
    const secondAssessments = assessDraftDuelOffers(after, second);
    let secondHasLegalPick = false;
    for (const candidate of secondAssessments) {
      if (candidate.available) {
        secondHasLegalPick = true;
        break;
      }
    }
    if (!secondHasLegalPick) return false;
  }
  return true;
}
