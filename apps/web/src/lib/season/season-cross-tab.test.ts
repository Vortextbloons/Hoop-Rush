import { describe, expect, it } from 'vitest';
import {
  createSeasonRunChannel,
  SEASON_RUN_CHANNEL_NAME,
  type SeasonRunAnnouncement,
  type SeasonRunMutation,
} from './season-cross-tab';

describe('Season Run cross-tab channel', () => {
  it('delivers announcements to other channels and filters the sender', async () => {
    const sender = createSeasonRunChannel();
    const receiver = createSeasonRunChannel();
    const received: SeasonRunMutation[] = [];
    const unsubscribe = receiver.subscribe((mutation) => {
      received.push(mutation);
    });

    sender.announce({ kind: 'commit', runId: 'run-a', revision: 2, committedAt: 1 });
    await expect.poll(() => received.length).toBe(1);

    expect(received).toHaveLength(1);
    expect(received[0]?.kind).toBe('commit');
    expect(received[0]?.runId).toBe('run-a');
    expect(received[0]?.sourceId).toBeTruthy();
    if (received[0]?.kind === 'commit') {
      expect(received[0].revision).toBe(2);
    }

    unsubscribe();
    sender.close();
    receiver.close();
  });

  it('drops invalid payloads and unknown shapes', async () => {
    const channel = createSeasonRunChannel();
    const received: SeasonRunMutation[] = [];
    channel.subscribe((mutation) => {
      received.push(mutation);
    });

    const raw = new BroadcastChannel(SEASON_RUN_CHANNEL_NAME);
    raw.postMessage({ kind: 'bogus' });
    raw.postMessage(null);
    raw.postMessage({ kind: 'clear', committedAt: 'not-a-number', sourceId: 'x' });

    const probeChannel = createSeasonRunChannel();
    probeChannel.announce({ kind: 'commit', runId: 'probe', revision: 1, committedAt: 2 });
    await expect.poll(() => received.map((mutation) => mutation.kind)).toContain('commit');
    expect(received.filter((mutation) => mutation.kind === 'commit')).toHaveLength(1);
    raw.close();
    probeChannel.close();
    channel.close();
  });

  it('still works when BroadcastChannel is unavailable (no-op channel)', () => {
    const original: unknown = globalThis.BroadcastChannel;
    (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = undefined;
    try {
      const channel = createSeasonRunChannel();
      const received: SeasonRunAnnouncement[] = [];
      channel.subscribe((mutation) => {
        received.push(mutation);
      });
      channel.announce({ kind: 'clear', runId: 'run-a', committedAt: 1 });
      channel.close();
      expect(received).toHaveLength(0);
    } finally {
      (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = original;
    }
  });
});
