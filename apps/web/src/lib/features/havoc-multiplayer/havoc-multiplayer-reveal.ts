export const HAVOC_REVEAL_FLIP_MS = 300;
export const HAVOC_REVEAL_STAGGER_MS = 80;
export const HAVOC_REVEAL_SELECTION_MS = 300;

export interface HavocRevealState {
  readonly offerId: string | null;
  readonly cardIds: readonly string[];
  readonly pendingCardId: string | null;
}

export function initialHavocRevealState(): HavocRevealState {
  return { offerId: null, cardIds: [], pendingCardId: null };
}

export function havocRevealDelayMs(index: number, reducedMotion = false): number {
  if (reducedMotion) return 0;
  return Math.max(0, index) * HAVOC_REVEAL_STAGGER_MS;
}

export function havocRevealFlipMs(cardCount: number, reducedMotion = false): number {
  if (reducedMotion || cardCount <= 0) return 0;
  return havocRevealDelayMs(cardCount - 1) + HAVOC_REVEAL_FLIP_MS;
}

/**
 * Starts a fresh reveal for an offer. Any in-flight selection from a previous
 * offer is stale by definition and is dropped, which is what lets the room
 * resume or an opponent timeout interrupt a pending pick safely.
 */
export function havocRevealBeginOffer(
  offerId: string | null,
  cardIds: readonly string[],
): HavocRevealState {
  return { offerId, cardIds: [...cardIds], pendingCardId: null };
}

/** Returns null when a submission is already pending or the card is stale. */
export function havocRevealSelect(
  state: HavocRevealState,
  cardId: string,
): HavocRevealState | null {
  if (state.pendingCardId !== null) return null;
  if (!state.cardIds.includes(cardId)) return null;
  return { ...state, pendingCardId: cardId };
}

export function havocRevealResolve(
  state: HavocRevealState,
  accepted: boolean,
): HavocRevealResolution {
  if (state.pendingCardId === null) return { state, acceptedCardId: null };
  return {
    state: { ...state, pendingCardId: null },
    acceptedCardId: accepted ? state.pendingCardId : null,
  };
}

export interface HavocRevealResolution {
  readonly state: HavocRevealState;
  /** The card to animate into the lineup, or null for a rejected pick. */
  readonly acceptedCardId: string | null;
}
