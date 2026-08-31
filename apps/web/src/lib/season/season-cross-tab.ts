export type SeasonRunAnnouncement =
  | {
      kind: 'commit';
      runId: string;
      revision: number;
      committedAt: number;
    }
  | {
      kind: 'clear';
      runId: string | null;
      committedAt: number;
    }
  | {
      kind: 'replace';
      runId: string;
      committedAt: number;
    };
export type SeasonRunMutation = SeasonRunAnnouncement & {
  sourceId: string;
};
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
  announce(mutation: SeasonRunAnnouncement): void;
  subscribe(listener: (mutation: SeasonRunMutation) => void): () => void;
  close(): void;
}
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
  const sourceId = `tab-${crypto.randomUUID()}`;
  const channel = new BroadcastChannel(SEASON_RUN_CHANNEL_NAME);
  const listeners = new Set<(mutation: SeasonRunMutation) => void>();
  channel.onmessage = (event: MessageEvent<SeasonRunMutation>) => {
    const mutation = event.data;
    if (!isSeasonRunMutation(mutation)) return;
    if (mutation.sourceId === sourceId) return;
    for (const listener of [...listeners]) listener(mutation);
  };
  return {
    announce(mutation) {
      try {
        channel.postMessage({ ...mutation, sourceId });
      } catch {}
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
