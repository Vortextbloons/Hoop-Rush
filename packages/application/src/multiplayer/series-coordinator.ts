import { clamp01, PlaybackProgress, type PlaybackAdvanceOutcome } from '../runtime/index.ts';

export type SeriesParticipantId = 'p1' | 'p2';

export interface SeriesMember {
  participantId: SeriesParticipantId;
  nextGameReady?: number | null;
}

export function otherSeriesParticipant(participantId: SeriesParticipantId): SeriesParticipantId {
  return participantId === 'p1' ? 'p2' : 'p1';
}

export interface ProposalCommand {
  actorParticipantId: SeriesParticipantId;
  payload: { kind: string };
}

export function proposalsForGame(
  commands: readonly ProposalCommand[],
  gameNumber: number,
  kind: 'propose-result' | 'propose-game-result' = 'propose-result',
): Partial<Record<SeriesParticipantId, string>> {
  const byParticipant: Partial<Record<SeriesParticipantId, string>> = {};
  for (const command of commands) {
    const payload = command.payload as {
      kind: string;
      gameNumber?: number;
      resultDigest?: string;
    };
    if (payload.kind !== kind) continue;
    if (payload.gameNumber !== gameNumber) continue;
    if (payload.resultDigest === undefined) continue;
    byParticipant[command.actorParticipantId] = payload.resultDigest;
  }
  return byParticipant;
}

export function withVerificationEntry<TEntry extends { gameNumber: number }>(
  entries: readonly TEntry[],
  entry: TEntry,
): TEntry[] {
  return [...entries.filter((existing) => existing.gameNumber !== entry.gameNumber), entry].sort(
    (left, right) => left.gameNumber - right.gameNumber,
  );
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
    participantId: SeriesParticipantId | null,
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

  beginBroadcast(startedAtIso: string, durationMs: number): number {
    const now = this.now();
    const startedAt = Date.parse(startedAtIso);
    this.playback.begin(now, startedAt, durationMs);
    return clamp01((now - startedAt) / durationMs);
  }

  advanceBroadcast(deltaMs: number, durationMs: number): PlaybackAdvanceOutcome {
    return this.playback.advance(deltaMs, durationMs, this.now());
  }

  continueApproved(gameNumber: number, holdMs: number): boolean {
    return this.playback.continueApproved(gameNumber, holdMs, this.now());
  }

  awaitingContinue(input: {
    phase: string;
    gameNumber: number | null;
    approved: boolean;
  }): boolean {
    if (input.phase !== 'game-results' || input.gameNumber === null) return false;
    if (this.confirmations.has(input.gameNumber)) return false;
    return !input.approved;
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

  coordinateGame<TOutput extends { gameNumber: number; resultDigest: string }>(input: {
    phase: string;
    progress: number;
    busy: boolean;
    selfId: SeriesParticipantId;
    output: TOutput | null;
    proposals: Partial<Record<SeriesParticipantId, string>>;
    current: () => boolean;
    propose: (output: TOutput) => Promise<boolean>;
    confirm: (output: TOutput, verified: boolean) => Promise<boolean>;
    verification?: (output: TOutput, verified: boolean, peerDigest: string) => void;
    mismatch?: () => void;
  }): void {
    if (!input.current() || input.busy) return;
    if (input.phase !== 'broadcasting' && input.phase !== 'game-results') return;
    const output = input.output;
    if (!output || input.progress < 1) return;
    const gameNumber = output.gameNumber;
    this.coordinate({
      gameNumber,
      localDigest: output.resultDigest,
      ownProposal: input.proposals[input.selfId],
      peerProposal: input.proposals[otherSeriesParticipant(input.selfId)],
      current: input.current,
      propose: () => input.propose(output),
      confirm: (verified) => input.confirm(output, verified),
      verification:
        input.verification === undefined
          ? undefined
          : (verified, peerDigest) => input.verification?.(output, verified, peerDigest),
      mismatch: input.mismatch,
    });
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
