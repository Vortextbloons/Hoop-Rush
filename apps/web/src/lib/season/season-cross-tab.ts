/**
 * Season Run cross-tab coordination (performance pass). A `BroadcastChannel`
 * announces Season Run mutations (accepted blocks, clears, replacements) so
 * every other open tab can invalidate its session cache, reload the active
 * index/snapshot, cancel stale local simulation, and surface an actionable
 * "run changed in another tab" state instead of a generic stale-command
 * failure. IndexedDB transactions are still authoritative: the guards
 * (revision/digest) already reject cross-tab overwrites; this channel only
 * makes the stale side recover promptly.
 */

/** A mutation this tab asks the channel to announce (source id attached by
 * the channel, never by callers). */
export type SeasonRunAnnouncement =
  | { kind: 'commit'; runId: string; revision: number; committedAt: number }
  | { kind: 'clear'; runId: string | null; committedAt: number }
  | { kind: 'replace'; runId: string; committedAt: number };

/** A mutation received from another tab (carries the sender's source id). */
export type SeasonRunMutation = SeasonRunAnnouncement & { sourceId: string };

export const SEASON_RUN_CHANNEL_NAME = 'hoop-rush:season-run';

function isSeasonRunMutation(value: unknown): value is SeasonRunMutation {
  if (typeof value !== 'object' || value === null) return false;
  const mutation = value as Record<string, unknown>;
  if (mutation.kind !== 'commit' && mutation.kind !== 'clear' && mutation.kind !== 'replace') {
    return false;
  }
  if (typeof mutation.committedAt !== 'number') return false;
  if (typeof mutation.sourceId !== 'string') return false;
  if (mutation.kind !== 'clear' && typeof mutation.runId !== 'string') return false;
  return true;
}

/** No-op listener used when BroadcastChannel is unavailable. */
function noopChannel(): Pick<BroadcastChannel, 'postMessage' | 'close'> & {
  onmessage: ((event: MessageEvent<SeasonRunMutation>) => void) | null;
} {
  return {
    onmessage: null,
    postMessage(): void {},
    close(): void {},
  };
}

export interface SeasonRunChannel {
  /** Sends a mutation announcement to every other tab (best effort). The
   * source id is attached by the channel, so callers omit it. */
  announce(mutation: SeasonRunAnnouncement): void;
  /** Subscribes to external mutations; returns an unsubscribe function. */
  subscribe(listener: (mutation: SeasonRunMutation) => void): () => void;
  /** Closes the channel (route teardown / tests). */
  close(): void;
}

/**
 * Creates the cross-tab channel for the Season Run group. Falls back to a
 * no-op channel when BroadcastChannel is unavailable (older browsers, some
 * workers); the app remains fully functional, it just cannot react to other
 * tabs until a reload. Every announcement carries this tab's `sourceId`;
 * BroadcastChannel delivers to the sender too, so the source filter keeps a
 * tab from reacting to its own mutations. The hub decides how to react
 * (its current run id / revision determine staleness).
 */
export function createSeasonRunChannel(): SeasonRunChannel {
  if (typeof BroadcastChannel === 'undefined') {
    const noop = noopChannel();
    return {
      announce(mutation) {
        noop.postMessage(mutation);
      },
      subscribe() {
        return () => undefined;
      },
      close() {
        noop.close();
      },
    };
  }
  const sourceId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const channel = new BroadcastChannel(SEASON_RUN_CHANNEL_NAME);
  const listeners = new Set<(mutation: SeasonRunMutation) => void>();
  channel.onmessage = (event: MessageEvent<SeasonRunMutation>) => {
    const mutation = event.data;
    if (!isSeasonRunMutation(mutation)) return;
    // Ignore this tab's own announcements (already applied locally).
    if (mutation.sourceId === sourceId) return;
    for (const listener of [...listeners]) listener(mutation);
  };
  return {
    announce(mutation) {
      try {
        channel.postMessage({ ...mutation, sourceId });
      } catch {
        // Best effort: never let a cross-tab announcement break the commit.
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      channel.onmessage = null;
      channel.close();
    },
  };
}
