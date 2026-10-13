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

export interface DraftDuelSlotPlacement {
  slotIndex: number;
  card: DraftDuelCard;
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

export interface DraftDuelParticipantShape {
  placed: readonly DraftDuelSlotPlacement[];
  unplaced: readonly DraftDuelCard[];
}

export interface DraftDuelSafetyBase {
  firstPicker: DraftDuelParticipantId;
  currentPicker: DraftDuelParticipantId;
  pickOrdinal: number;
  rosters: { readonly p1: readonly DraftDuelCard[]; readonly p2: readonly DraftDuelCard[] };
  placements: {
    readonly p1: readonly DraftDuelSlotPlacement[];
    readonly p2: readonly DraftDuelSlotPlacement[];
  };
  unplaced: { readonly p1: readonly DraftDuelCard[]; readonly p2: readonly DraftDuelCard[] };
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

export function draftDuelCardPlayableAtSlot(card: DraftDuelCard, slotIndex: number): boolean {
  const group = slotGroupAt(slotIndex);
  return group !== undefined && cardPlayableAt(card, group);
}

function isRecordedSlot(slotIndex: number | undefined): slotIndex is number {
  return (
    typeof slotIndex === 'number' &&
    Number.isInteger(slotIndex) &&
    slotIndex >= 0 &&
    slotIndex < LINEUP_SIZE
  );
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
function collectParticipantShape(
  state: DraftDuelDraft,
  participantId: DraftDuelParticipantId,
): { shape: DraftDuelParticipantShape; cards: DraftDuelCard[] } {
  const placed: DraftDuelSlotPlacement[] = [];
  const unplaced: DraftDuelCard[] = [];
  const cards: DraftDuelCard[] = [];
  for (const round of state.rounds) {
    for (const pick of round.picks) {
      if (pick.participantId !== participantId) continue;
      cards.push(pick.card);
      if (isRecordedSlot(pick.slotIndex))
        placed.push({ slotIndex: pick.slotIndex, card: pick.card });
      else unplaced.push(pick.card);
    }
  }
  return { shape: { placed, unplaced }, cards };
}

export function draftDuelOccupiedSlotIndexes(
  state: DraftDuelDraft,
  participantId: DraftDuelParticipantId,
): Set<number> {
  const occupied = new Set<number>();
  for (const slot of collectParticipantShape(state, participantId).shape.placed) {
    occupied.add(slot.slotIndex);
  }
  return occupied;
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
      if (!draftDuelCardPlayableAtSlot(card, slot)) continue;
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

const SLOT_RANGE: readonly number[] = Array.from({ length: LINEUP_SIZE }, (_, index) => index);

interface PlacementScore {
  changed: number;
  distance: number;
  key: string;
}

function compareCardIds(a: DraftDuelCard, b: DraftDuelCard): number {
  if (a.playerVersionId === b.playerVersionId) return 0;
  return a.playerVersionId < b.playerVersionId ? -1 : 1;
}

function scorePlacements(
  prior: readonly DraftDuelSlotPlacement[],
  assignment: readonly DraftDuelSlotPlacement[],
): PlacementScore {
  const priorSlots = new Map(prior.map((slot) => [slot.card.playerVersionId, slot.slotIndex]));
  let changed = 0;
  let distance = 0;
  const keyParts: string[] = [];
  for (const placement of [...assignment].sort((a, b) => compareCardIds(a.card, b.card))) {
    const from = priorSlots.get(placement.card.playerVersionId);
    if (from !== undefined && from !== placement.slotIndex) {
      changed += 1;
      distance += Math.abs(from - placement.slotIndex);
    }
    keyParts.push(`${placement.card.playerVersionId}:${String(placement.slotIndex)}`);
  }
  return { changed, distance, key: keyParts.join('|') };
}

function isBetterScore(next: PlacementScore, current: PlacementScore | null): boolean {
  if (current === null) return true;
  if (next.changed !== current.changed) return next.changed < current.changed;
  if (next.distance !== current.distance) return next.distance < current.distance;
  return next.key < current.key;
}

export function draftDuelRepositionPlan(
  placements: readonly DraftDuelSlotPlacement[],
  subject: DraftDuelCard,
  targetSlot: number,
): DraftDuelSlotPlacement[] | null {
  if (!isRecordedSlot(targetSlot)) return null;
  if (!draftDuelCardPlayableAtSlot(subject, targetSlot)) return null;
  const others = placements
    .filter((placement) => placement.card.playerVersionId !== subject.playerVersionId)
    .map((placement) => placement.card)
    .sort(compareCardIds);
  if (others.length + 1 > LINEUP_SIZE) return null;
  const used = new Array<boolean>(LINEUP_SIZE).fill(false);
  used[targetSlot] = true;
  const assignment: DraftDuelSlotPlacement[] = [{ slotIndex: targetSlot, card: subject }];
  const best: DraftDuelSlotPlacement[][] = [];
  let bestScore: PlacementScore | null = null;
  function search(index: number): void {
    if (index === others.length) {
      const candidate = assignment.map((placement) => ({ ...placement }));
      const score = scorePlacements(placements, candidate);
      if (isBetterScore(score, bestScore)) {
        best.length = 0;
        best.push(candidate);
        bestScore = score;
      }
      return;
    }
    const card = others[index];
    if (card === undefined) return;
    for (const slot of SLOT_RANGE) {
      if (used[slot]) continue;
      if (!draftDuelCardPlayableAtSlot(card, slot)) continue;
      used[slot] = true;
      assignment.push({ slotIndex: slot, card });
      search(index + 1);
      assignment.pop();
      used[slot] = false;
    }
  }
  search(0);
  const chosen = best[0];
  return chosen === undefined ? null : [...chosen].sort((a, b) => a.slotIndex - b.slotIndex);
}

export function draftDuelFallbackPlacements(
  placed: readonly DraftDuelSlotPlacement[],
  unplaced: readonly DraftDuelCard[],
): DraftDuelSlotPlacement[] | null {
  const occupied = new Set(placed.map((slot) => slot.slotIndex));
  const result: DraftDuelSlotPlacement[] = [...placed];
  function search(index: number): boolean {
    if (index === unplaced.length) return true;
    const card = unplaced[index];
    if (card === undefined) return false;
    for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
      if (occupied.has(slot)) continue;
      if (!draftDuelCardPlayableAtSlot(card, slot)) continue;
      occupied.add(slot);
      result.push({ slotIndex: slot, card });
      if (search(index + 1)) return true;
      result.pop();
      occupied.delete(slot);
    }
    return false;
  }
  return search(0) ? result : null;
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
function placementCompletionPossible(
  placed: readonly DraftDuelSlotPlacement[],
  unplaced: readonly DraftDuelCard[],
  remainingPicks: number,
  unclaimedProfileCounts: ReadonlyMap<number, number>,
): boolean {
  const totalCards = placed.length + unplaced.length;
  if (totalCards + remainingPicks !== LINEUP_SIZE) return false;
  const occupied = new Set<number>();
  for (const slot of placed) {
    if (!isRecordedSlot(slot.slotIndex)) return false;
    if (occupied.has(slot.slotIndex)) return false;
    if (!draftDuelCardPlayableAtSlot(slot.card, slot.slotIndex)) return false;
    occupied.add(slot.slotIndex);
  }
  const openSlots: number[] = [];
  for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
    if (!occupied.has(slot)) openSlots.push(slot);
  }
  if (unplaced.length > openSlots.length) return false;
  const usedSlots = new Array<boolean>(LINEUP_SIZE).fill(false);
  function search(index: number): boolean {
    if (index === unplaced.length) {
      const needs: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
      for (const slot of openSlots) {
        if (usedSlots[slot]) continue;
        const group = slotGroupAt(slot);
        if (group === undefined) continue;
        needs[group] += 1;
      }
      if (needs.G + needs.F + needs.C !== remainingPicks) return false;
      return completionFeasible({ needed: needs, remainingPicks, unclaimedProfileCounts });
    }
    const card = unplaced[index];
    if (card === undefined) return false;
    for (const slot of openSlots) {
      if (usedSlots[slot]) continue;
      if (!draftDuelCardPlayableAtSlot(card, slot)) continue;
      usedSlots[slot] = true;
      if (search(index + 1)) return true;
      usedSlots[slot] = false;
    }
    return false;
  }
  return search(0);
}

export function rosterCompletionPossible(
  cards: readonly DraftDuelCard[],
  remainingPicks: number,
  unclaimedProfileCounts: ReadonlyMap<number, number>,
): boolean {
  return placementCompletionPossible([], cards, remainingPicks, unclaimedProfileCounts);
}

export function draftDuelParticipantCompletionPossible(
  input: DraftDuelSafetyBase,
  participantId: DraftDuelParticipantId,
): boolean {
  const placed = input.placements[participantId];
  const unplaced = input.unplaced[participantId];
  const remainingPicks = LINEUP_SIZE - placed.length - unplaced.length;
  return placementCompletionPossible(
    placed,
    unplaced,
    remainingPicks,
    input.unclaimedProfileCounts,
  );
}

export function draftDuelOpenSlotNeeds(
  input: DraftDuelSafetyBase,
  participantId: DraftDuelParticipantId,
): DraftDuelGroupNeeds {
  const placed = input.placements[participantId];
  const unplaced = input.unplaced[participantId];
  const filled = unplaced.length === 0 ? placed : draftDuelFallbackPlacements(placed, unplaced);
  if (filled === null) {
    throw new Error('draft duel roster cannot be assigned to lineup slots');
  }
  const occupied = new Set(filled.map((slot) => slot.slotIndex));
  const needs: DraftDuelGroupNeeds = { G: 0, F: 0, C: 0 };
  for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
    if (occupied.has(slot)) continue;
    const group = slotGroupAt(slot);
    if (group === undefined) continue;
    needs[group] += 1;
  }
  return needs;
}

export function draftDuelOpenSlots(
  input: DraftDuelSafetyBase,
  participantId: DraftDuelParticipantId,
): number[] {
  const occupied = new Set(input.placements[participantId].map((slot) => slot.slotIndex));
  const open: number[] = [];
  for (let slot = 0; slot < LINEUP_SIZE; slot += 1) {
    if (!occupied.has(slot)) open.push(slot);
  }
  return open;
}

export function buildDraftDuelSafetyBase(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
): DraftDuelSafetyBase {
  const claimedPlayerIds = draftDuelClaimedPlayerIds(state);
  const profileMaskByPlayerId = catalogPlayerProfileMasks(catalog);
  const p1 = collectParticipantShape(state, 'p1');
  const p2 = collectParticipantShape(state, 'p2');
  return {
    firstPicker: state.firstPicker,
    currentPicker: draftDuelPickerForOrdinal(state.firstPicker, state.pickOrdinal),
    pickOrdinal: state.pickOrdinal,
    rosters: { p1: p1.cards, p2: p2.cards },
    placements: { p1: p1.shape.placed, p2: p2.shape.placed },
    unplaced: { p1: p1.shape.unplaced, p2: p2.shape.unplaced },
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

function afterDraftDuelPlacement(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
  slotIndex: number,
): DraftDuelSafetyInput {
  const mask = input.profileMaskByPlayerId.get(card.playerId) ?? draftDuelCardProfileMask(card);
  const claimedPlayerIds = new Set(input.claimedPlayerIds);
  claimedPlayerIds.add(card.playerId);
  const placement: DraftDuelSlotPlacement = { slotIndex, card };
  const rosters =
    picker === 'p1'
      ? { ...input.rosters, p1: [...input.rosters.p1, card] }
      : { ...input.rosters, p2: [...input.rosters.p2, card] };
  const placements =
    picker === 'p1'
      ? { ...input.placements, p1: [...input.placements.p1, placement] }
      : { ...input.placements, p2: [...input.placements.p2, placement] };
  return {
    ...input,
    currentPicker: otherDraftDuelParticipant(picker),
    rosters,
    placements,
    claimedPlayerIds,
    unclaimedProfileCounts: removePlayerFromPoolCounts(input.unclaimedProfileCounts, mask),
  };
}

function afterDraftDuelDisplacement(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
  placements: readonly DraftDuelSlotPlacement[],
): DraftDuelSafetyInput {
  const mask = input.profileMaskByPlayerId.get(card.playerId) ?? draftDuelCardProfileMask(card);
  const claimedPlayerIds = new Set(input.claimedPlayerIds);
  claimedPlayerIds.add(card.playerId);
  const nextPlacements =
    picker === 'p1'
      ? { ...input.placements, p1: placements }
      : { ...input.placements, p2: placements };
  const rosters =
    picker === 'p1'
      ? { ...input.rosters, p1: [...input.rosters.p1, card] }
      : { ...input.rosters, p2: [...input.rosters.p2, card] };
  return {
    ...input,
    currentPicker: otherDraftDuelParticipant(picker),
    rosters,
    placements: nextPlacements,
    claimedPlayerIds,
    unclaimedProfileCounts: removePlayerFromPoolCounts(input.unclaimedProfileCounts, mask),
  };
}

function placementReason(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
  slotIndex: number,
  allowDisplacement: boolean,
): DraftDuelUnavailableReason | null {
  if (input.claimedPlayerIds.has(card.playerId)) return 'claimed';
  if (!isRecordedSlot(slotIndex)) return 'position';
  if (!draftDuelCardPlayableAtSlot(card, slotIndex)) return 'position';
  const occupied = input.placements[picker].some((slot) => slot.slotIndex === slotIndex);
  if (occupied) {
    if (!allowDisplacement) return 'position';
    const plan = draftDuelRepositionPlan(input.placements[picker], card, slotIndex);
    if (plan === null) return 'position';
    const after = afterDraftDuelDisplacement(input, picker, card, plan);
    if (!draftDuelParticipantCompletionPossible(after, picker)) return 'completion';
    if (!draftDuelParticipantCompletionPossible(after, otherDraftDuelParticipant(picker))) {
      return 'completion';
    }
    return null;
  }
  const after = afterDraftDuelPlacement(input, picker, card, slotIndex);
  if (!draftDuelParticipantCompletionPossible(after, picker)) return 'completion';
  if (!draftDuelParticipantCompletionPossible(after, otherDraftDuelParticipant(picker))) {
    return 'completion';
  }
  return null;
}

function placementLegal(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  card: DraftDuelCard,
  slotIndex: number,
  allowDisplacement: boolean,
): boolean {
  if (placementReason(input, picker, card, slotIndex, allowDisplacement) !== null) return false;
  if (picker !== input.firstPicker) return true;
  const occupied = input.placements[picker].some((slot) => slot.slotIndex === slotIndex);
  const after = occupied
    ? afterDraftDuelDisplacement(
        input,
        picker,
        card,
        draftDuelRepositionPlan(input.placements[picker], card, slotIndex) ?? [],
      )
    : afterDraftDuelPlacement(input, picker, card, slotIndex);
  const opponent = otherDraftDuelParticipant(picker);
  for (const candidate of after.offered[opponent]) {
    const opponentSlots = allowDisplacement
      ? SLOT_RANGE.filter((slot) => draftDuelCardPlayableAtSlot(candidate, slot))
      : draftDuelOpenSlots(after, opponent);
    for (const opponentSlot of opponentSlots) {
      if (placementReason(after, opponent, candidate, opponentSlot, allowDisplacement) === null) {
        return true;
      }
    }
  }
  return false;
}
export function assessDraftDuelOffers(
  input: DraftDuelSafetyInput,
  picker: DraftDuelParticipantId,
  options?: { allowDisplacement?: boolean },
): DraftDuelOfferedPick[] {
  const allowDisplacement = options?.allowDisplacement ?? false;
  const offers = input.offered[picker];
  const markAll = (reason: DraftDuelUnavailableReason): DraftDuelOfferedPick[] =>
    offers.map((card, slot) => ({ slot, card, available: false, reason, legalSlots: [] }));
  if (input.pickOrdinal >= 10) return markAll('phase');
  if (picker !== input.currentPicker) return markAll('turn');
  const openSlots = draftDuelOpenSlots(input, picker);
  return offers.map((card, slot) => {
    if (input.claimedPlayerIds.has(card.playerId)) {
      return { slot, card, available: false, reason: 'claimed', legalSlots: [] };
    }
    const candidateSlots = allowDisplacement
      ? SLOT_RANGE.filter((candidate) => draftDuelCardPlayableAtSlot(card, candidate))
      : openSlots.filter((candidate) => draftDuelCardPlayableAtSlot(card, candidate));
    if (candidateSlots.length === 0) {
      return { slot, card, available: false, reason: 'position', legalSlots: [] };
    }
    const legalSlots = candidateSlots.filter((candidate) =>
      placementLegal(input, picker, card, candidate, allowDisplacement),
    );
    if (legalSlots.length === 0) {
      return { slot, card, available: false, reason: 'completion', legalSlots: [] };
    }
    return { slot, card, available: true, reason: null, legalSlots };
  });
}

export function draftDuelRepositionSlots(
  state: DraftDuelDraft,
  catalog: DraftDuelCatalog,
  participantId: DraftDuelParticipantId,
  playerVersionId: string,
): number[] {
  const base = buildDraftDuelSafetyBase(state, catalog);
  if (base.unplaced[participantId].length > 0) return [];
  const placements = base.placements[participantId];
  const subject = placements.find(
    (placement) => placement.card.playerVersionId === playerVersionId,
  );
  if (!subject) return [];
  const slots: number[] = [];
  for (const slot of SLOT_RANGE) {
    if (slot === subject.slotIndex) continue;
    const plan = draftDuelRepositionPlan(placements, subject.card, slot);
    if (plan === null) continue;
    const after: DraftDuelSafetyBase = {
      ...base,
      placements: { ...base.placements, [participantId]: plan },
    };
    if (draftDuelParticipantCompletionPossible(after, participantId)) slots.push(slot);
  }
  return slots;
}

export function draftDuelRoundSafetyHolds(
  input: DraftDuelSafetyInput,
  options?: { allowDisplacement?: boolean },
): boolean {
  if (input.pickOrdinal >= 10) return false;
  const first = draftDuelPickerForOrdinal(input.firstPicker, input.pickOrdinal);
  return assessDraftDuelOffers(input, first, options).some((option) => option.available);
}
