export const HAVOC_MULTIPLAYER_REVEAL_FLIP_MS = 300;
export const HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS = 80;
export const HAVOC_MULTIPLAYER_REVEAL_SELECTION_MS = 300;

export interface HavocMultiplayerOfferRevealPlan {
  readonly cardCount: number;
  readonly flipMs: number;
  readonly staggerMs: number;
  readonly totalMs: number;
  readonly delaysMs: readonly number[];
}

/**
 * Staggered flip-in plan for one offer: every card flips for ~300 ms and starts
 * 80 ms after the previous one.
 */
export function havocMultiplayerOfferRevealPlan(
  cardCount: number,
): HavocMultiplayerOfferRevealPlan {
  const count = Number.isInteger(cardCount) && cardCount > 0 ? cardCount : 0;
  const delaysMs = Array.from(
    { length: count },
    (_, index) => index * HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS,
  );
  const totalMs =
    count === 0
      ? 0
      : HAVOC_MULTIPLAYER_REVEAL_FLIP_MS + (count - 1) * HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS;
  return {
    cardCount: count,
    flipMs: HAVOC_MULTIPLAYER_REVEAL_FLIP_MS,
    staggerMs: HAVOC_MULTIPLAYER_REVEAL_STAGGER_MS,
    totalMs,
    delaysMs,
  };
}

export interface HavocMultiplayerRevealAttempt {
  readonly attempt: number;
  readonly offerId: string;
  readonly cardId: string;
}

export type HavocMultiplayerRevealSettlement = 'played' | 'rejected' | 'stale' | 'disabled';

export interface HavocMultiplayerRevealDirectorOptions {
  readonly reducedMotion: () => boolean;
  /** Removes an in-flight flyer when the offer changes, the room resumes, or the component unmounts. */
  readonly cancel: (attempt: HavocMultiplayerRevealAttempt) => void;
}

interface ActiveRevealAttempt {
  readonly attempt: HavocMultiplayerRevealAttempt;
  playing: boolean;
}

/**
 * Owns the multiplayer Havoc reveal sequence for one mounted room:
 * - one selection transition at a time (repeat clicks cannot queue doubles),
 * - accepted picks only (rejected or stale settlements never play),
 * - playing flyers are cancelled when the offer moves on,
 * - reduced motion skips the sequence entirely.
 */
export class HavocMultiplayerRevealDirector {
  private readonly options: HavocMultiplayerRevealDirectorOptions;
  private attemptCounter = 0;
  private active: ActiveRevealAttempt | null = null;
  private offerId: string | null = null;

  constructor(options: HavocMultiplayerRevealDirectorOptions) {
    this.options = options;
  }

  setOffer(offerId: string | null): void {
    if (this.offerId === offerId) return;
    this.offerId = offerId;
    if (this.active !== null && this.active.playing) {
      const playing = this.active;
      this.active = null;
      this.options.cancel(playing.attempt);
    }
  }

  beginSelection(input: {
    readonly offerId: string;
    readonly cardId: string;
  }): HavocMultiplayerRevealAttempt | null {
    if (this.options.reducedMotion()) return null;
    if (this.active !== null) return null;
    if (input.offerId !== this.offerId) return null;
    this.attemptCounter += 1;
    const attempt: HavocMultiplayerRevealAttempt = {
      attempt: this.attemptCounter,
      offerId: input.offerId,
      cardId: input.cardId,
    };
    this.active = { attempt, playing: false };
    return attempt;
  }

  settleSelection(
    attempt: HavocMultiplayerRevealAttempt,
    outcome: { readonly accepted: boolean; readonly offerId: string | null },
  ): HavocMultiplayerRevealSettlement {
    const active = this.active;
    if (active === null || active.attempt.attempt !== attempt.attempt) return 'stale';
    if (!outcome.accepted) {
      this.active = null;
      return 'rejected';
    }
    if (outcome.offerId === null || outcome.offerId === attempt.offerId) {
      this.active = null;
      return 'stale';
    }
    // The accepted pick is the offer transition we are animating; adopt it so a
    // later snapshot with the same offer does not cancel the flyer.
    this.offerId = outcome.offerId;
    active.playing = true;
    return 'played';
  }

  finishSelection(attempt: HavocMultiplayerRevealAttempt): void {
    if (this.active !== null && this.active.attempt.attempt === attempt.attempt) {
      this.active = null;
    }
  }

  cancelAll(): void {
    const active = this.active;
    this.active = null;
    if (active !== null) this.options.cancel(active.attempt);
  }
}
