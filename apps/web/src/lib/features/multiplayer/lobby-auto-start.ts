/**
 * Start a mode room that was created by the shared lobby.
 *
 * The shared lobby already collected the settings and the host explicitly
 * started the match, so the created mode room would otherwise sit in its own
 * lobby waiting for a second "Start draft" click. This helper removes that
 * duplicate stop for shared-lobby matches only:
 *
 * - only the host starts (the server enforces the same rule),
 * - both seats must be online (the server enforces the same rule),
 * - one attempt is made per room; a rejection is reported through `failed` so
 *   the UI can offer a manual retry, never an automatic loop.
 *
 * Direct-invite rooms pass `sharedLobby: false` and keep the explicit button.
 */
export interface AutoStartGate {
  /** Whether this room was created by the shared lobby. */
  sharedLobby: boolean;
  isHost: boolean;
  bothOnline: boolean;
  /** Server phase name for a room that has not started yet. */
  phase: string;
  /** Stable key for this room; a new room gets a fresh attempt. */
  roomKey: string;
}

export class LobbyAutoStart {
  private attempted: string | null = null;
  private running = false;
  private failedRooms = new Set<string>();

  /** True when the current room still needs the automatic start command. */
  shouldStart(gate: AutoStartGate): boolean {
    return (
      gate.sharedLobby &&
      gate.isHost &&
      gate.bothOnline &&
      gate.phase === 'lobby' &&
      this.attempted !== gate.roomKey &&
      !this.running
    );
  }

  /**
   * Run `start` at most once per room while both seats are present. The
   * rejection is rethrown for the caller to surface; the room is marked failed
   * so the UI offers a manual retry instead of another automatic attempt.
   */
  async run(roomKey: string, start: () => Promise<unknown>): Promise<void> {
    if (this.running) return;
    this.attempted = roomKey;
    this.running = true;
    this.failedRooms.delete(roomKey);
    try {
      await start();
    } catch (error) {
      this.failedRooms.add(roomKey);
      throw error;
    } finally {
      this.running = false;
    }
  }

  /** The automatic start failed for this room; offer a manual retry. */
  failed(roomKey: string): boolean {
    return this.failedRooms.has(roomKey);
  }

  /** Allow one more automatic attempt for this room, e.g. after settings change. */
  retry(roomKey: string): void {
    this.failedRooms.delete(roomKey);
    if (this.attempted === roomKey) this.attempted = null;
  }

  reset(): void {
    this.attempted = null;
    this.running = false;
    this.failedRooms.clear();
  }
}
