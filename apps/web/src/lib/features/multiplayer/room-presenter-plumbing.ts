import { isLiteMode } from '#lib/device-capabilities.js';
import { PlaybackCadence, presentationIntervalMs } from '#lib/playback-cadence.js';

const CONSIDERATION_CLEAR_MS = 2000;

export interface RoomPlaybackDriver {
  isDisposed(): boolean;
  hasBroadcast(): boolean;
  beginPlayback(): void;
  advancePlayback(advanceMs: number): void;
  progress(): number;
}

/**
 * Drives one room's replay playback. Both presenters run the same frame loop
 * and only differ in which session snapshot they read from.
 */
export class RoomPlaybackLoop {
  private rafId: number | null = null;
  private lastFrameMs: number | null = null;
  private cadence: PlaybackCadence | null = null;

  start(driver: RoomPlaybackDriver): void {
    if (driver.isDisposed()) return;
    if (!driver.hasBroadcast()) return;
    this.lastFrameMs = null;
    this.cadence = new PlaybackCadence(presentationIntervalMs(isLiteMode()));
    if (this.rafId !== null) return;
    driver.beginPlayback();
    driver.advancePlayback(0);
    const loop = () => {
      if (driver.isDisposed() || !driver.hasBroadcast()) {
        this.rafId = null;
        return;
      }
      const nowMs = Date.now();
      const lastFrameMs = this.lastFrameMs ?? nowMs;
      this.lastFrameMs = nowMs;
      const advanceMs = this.cadence?.add(nowMs - lastFrameMs) ?? null;
      if (advanceMs === null) {
        this.rafId = requestAnimationFrame(loop);
        return;
      }
      driver.advancePlayback(advanceMs);
      if (driver.progress() >= 1) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.cadence = null;
  }

  get active(): boolean {
    return this.rafId !== null;
  }
}

interface RematchCommand {
  payload: { kind: string };
  actorParticipantId: string;
}

/** Whether the local player (or the rival) has already requested a rematch. */
export function rematchRequested(
  commands: readonly RematchCommand[],
  participantId: string | null,
  bySelf: boolean,
): boolean {
  return commands.some(
    (command) =>
      command.payload.kind === 'rematch-request' &&
      (command.actorParticipantId === participantId) === bySelf,
  );
}

interface TransientReaction<ParticipantId, ReactionKey> {
  participantId: ParticipantId;
  reaction: ReactionKey;
  sentAtMs: number;
}

/** Map a peer reaction onto the displayed reaction, or null when ignored. */
export function reactionFromTransient<ParticipantId, ReactionKey>(
  event: TransientReaction<ParticipantId, ReactionKey>,
  options: { muted: boolean; participantId: ParticipantId | null },
): { participantId: ParticipantId; reaction: ReactionKey; atMs: number } | null {
  if (options.muted) return null;
  if (event.participantId === options.participantId) return null;
  return {
    participantId: event.participantId,
    reaction: event.reaction,
    atMs: event.sentAtMs,
  };
}

/**
 * Clears an ephemeral consideration hint after the shared display window.
 * The presenter keeps ownership of the reactive value; this only owns the
 * timer and the identity check that prevents an older hint clearing a newer one.
 */
export class RoomConsiderationTimer<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly setValue: (value: T | null) => void,
    private readonly getValue: () => T | null,
  ) {}

  show(value: T): void {
    this.setValue(value);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.getValue() === value) this.setValue(null);
    }, CONSIDERATION_CLEAR_MS);
  }

  clear(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
