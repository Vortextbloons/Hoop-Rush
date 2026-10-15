import { PlaybackProgress } from '../runtime/index.ts';

export interface SeriesMember {
  participantId: 'p1' | 'p2';
  nextGameReady?: number | null;
}

export interface SeriesCoordination {
  gameNumber: number;
  localDigest: string;
  ownProposal?: string;
  peerProposal?: string;
  current(): boolean;
  propose(): Promise<boolean>;
  confirm(verified: boolean): Promise<boolean>;
  verification?(verified: boolean, peerDigest: string): void;
  mismatch?(): void;
}

export class SeriesCoordinator {
  readonly playback = new PlaybackProgress();
  readonly proposals = new Set<number>();
  readonly confirmations = new Set<number>();
  readonly jobs = new Set<number>();
  private retryAtMs = 0;
  private preparingSinceMs: number | null = null;
  private lastAutoAttemptMs = 0;
  private phase: string | null = null;
  private broadcastGame: number | null = null;

  private readonly now: () => number;
  private readonly retryMs: number;

  constructor(now: () => number, retryMs: number) {
    this.now = now;
    this.retryMs = retryMs;
  }

  reset(): void {
    this.playback.reset();
    this.proposals.clear();
    this.confirmations.clear();
    this.jobs.clear();
    this.retryAtMs = 0;
    this.preparingSinceMs = null;
    this.lastAutoAttemptMs = 0;
    this.phase = null;
    this.broadcastGame = null;
  }

  observe(phase: string, broadcastGame: number | null): boolean {
    if (phase === 'preparing-game' && this.phase !== phase) {
      this.preparingSinceMs = this.now();
      this.lastAutoAttemptMs = 0;
    }
    if (phase !== 'preparing-game') this.preparingSinceMs = null;
    this.phase = phase;
    const changed = broadcastGame !== null && broadcastGame !== this.broadcastGame;
    if (changed) this.playback.reset();
    this.broadcastGame = broadcastGame;
    return changed;
  }

  memberReady(
    members: readonly SeriesMember[],
    participantId: 'p1' | 'p2' | null,
    game: number | null,
  ): boolean {
    return (
      participantId !== null &&
      game !== null &&
      members.some(
        (member) => member.participantId === participantId && member.nextGameReady === game,
      )
    );
  }

  readyCountdown(opponentReady: boolean, timeoutMs: number, now = this.now()): number | null {
    if (this.phase !== 'preparing-game' || this.preparingSinceMs === null || opponentReady)
      return null;
    return Math.max(0, this.preparingSinceMs + timeoutMs - now);
  }

  shouldAutoStart(
    localReady: boolean,
    opponentReady: boolean,
    timeoutMs: number,
    now = this.now(),
  ): boolean {
    if (this.phase !== 'preparing-game') return false;
    if (
      !(localReady && opponentReady) &&
      !(this.readyCountdown(opponentReady, timeoutMs, now) === 0 && !opponentReady)
    )
      return false;
    if (now - this.lastAutoAttemptMs < this.retryMs) return false;
    this.lastAutoAttemptMs = now;
    return true;
  }

  async runGame<T>(
    game: number,
    current: () => boolean,
    run: () => Promise<T>,
    accept: (output: T) => Promise<void>,
  ): Promise<void> {
    if (!current() || this.jobs.has(game)) return;
    this.jobs.add(game);
    try {
      const output = await run();
      if (current()) await accept(output);
    } finally {
      if (current()) this.jobs.delete(game);
    }
  }

  coordinate(input: SeriesCoordination): void {
    if (!input.current() || this.now() < this.retryAtMs) return;
    const game = input.gameNumber;
    if (!this.proposals.has(game)) {
      this.proposals.add(game);
      void input.propose().then((accepted) => {
        if (!input.current()) return;
        if (!accepted) {
          this.proposals.delete(game);
          this.retryAtMs = this.now() + this.retryMs;
        }
      });
      return;
    }
    if (
      input.ownProposal !== input.localDigest ||
      input.peerProposal === undefined ||
      this.confirmations.has(game)
    )
      return;
    const peerProposal = input.peerProposal;
    const verified = peerProposal === input.localDigest;
    if (verified && !this.playback.continueApproved(game, this.holdMs, this.now())) return;
    this.confirmations.add(game);
    if (!verified) input.verification?.(false, input.peerProposal);
    void input.confirm(verified).then((accepted) => {
      if (!input.current()) return;
      if (!verified) input.mismatch?.();
      else if (accepted) input.verification?.(true, peerProposal);
      else {
        this.confirmations.delete(game);
        this.retryAtMs = this.now() + this.retryMs;
      }
    });
  }

  holdMs = 0;
}
