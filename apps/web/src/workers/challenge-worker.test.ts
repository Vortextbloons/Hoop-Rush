import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  createEngineContext,
  createGameInput,
  gameResultDigest,
  simulateGame,
} from '@hoop-rush/engine';
import type { GameResult } from '@hoop-rush/data-contracts';
import { buildChallengeRun, buildEraSimulationProfile } from '@hoop-rush/test-fixtures';

interface PostedMessage {
  type?: string;
  requestId?: string;
  fromGameNumber?: number;
  results?: GameResult[];
  message?: string;
  gamesDelivered?: number;
  cancelled?: boolean;
}

const RUN = buildChallengeRun({ runId: 'worker-run' });
const PROFILE = buildEraSimulationProfile();
const ENGINE_VERSION = 'worker-test-engine';

const originalSelf = (globalThis as { self?: unknown }).self;
const fakeSelf = {
  postMessage: (() => {}) as (message: PostedMessage) => void,
  onmessage: null as ((event: { data: unknown }) => void) | null,
};

beforeAll(async () => {
  (globalThis as { self?: unknown }).self = fakeSelf;
  await import('./challenge-worker.ts');
});

afterAll(() => {
  if (originalSelf === undefined) {
    delete (globalThis as { self?: unknown }).self;
  } else {
    (globalThis as { self?: unknown }).self = originalSelf;
  }
});

function simulateRequest(requestId: string, startGameNumber = 1): unknown {
  return {
    schemaVersion: 1,
    type: 'simulate',
    requestId,
    run: { ...RUN, games: [] },
    startGameNumber,
    profile: PROFILE,
    engineVersion: ENGINE_VERSION,
  };
}

interface Capture {
  posted: PostedMessage[];
  results: GameResult[];
  error: PostedMessage | null;
}

function capture(): Capture {
  return { posted: [], results: [], error: null };
}

function install(captured: Capture, onMessage?: (message: PostedMessage) => void): void {
  fakeSelf.postMessage = (message) => {
    captured.posted.push(message);
    if (message.type === 'error') captured.error = message;
    if (message.type === 'results' && message.results !== undefined) {
      captured.results.push(...message.results);
    }
    onMessage?.(message);
  };
}

function runToCompletion(events: () => void): Promise<void> {
  return new Promise((resolve) => {
    const settle = (): void => {
      resolve();
    };
    const original = fakeSelf.postMessage;
    fakeSelf.postMessage = (message) => {
      original(message);
      if (message.type === 'complete' || message.type === 'error') settle();
    };
    events();
  });
}

/** Resolves once the worker has posted nothing for `quietMs`, for paths that end silently. */
function settleAfterQuiet(captured: Capture, quietMs = 50): Promise<void> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        resolve();
      }, quietMs);
    };
    const original = fakeSelf.postMessage;
    fakeSelf.postMessage = (message) => {
      original(message);
      if (captured.posted.length > 0) arm();
    };
    arm();
  });
}

function digestsOf(results: readonly GameResult[]): string[] {
  return results.map((result) => gameResultDigest(result));
}

function expectedResults(): GameResult[] {
  const context = createEngineContext({ engineVersion: ENGINE_VERSION });
  return Array.from({ length: 82 }, (_, index) =>
    simulateGame(createGameInput(RUN, PROFILE, index + 1), context),
  );
}

describe('challenge worker streaming', () => {
  it('simulates all games once in ordered batches', async () => {
    const captured = capture();
    install(captured);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: simulateRequest('stream-a') });
    });
    expect(captured.error).toBeNull();
    expect(captured.results).toHaveLength(82);
    expect(captured.results.map((result) => result.gameNumber)).toEqual(
      Array.from({ length: 82 }, (_, index) => index + 1),
    );
    expect(digestsOf(captured.results)).toEqual(digestsOf(expectedResults()));
    expect(captured.posted.at(-1)).toMatchObject({ type: 'complete', gamesDelivered: 82 });
  }, 60_000);

  it('resumes from the requested game number', async () => {
    const captured = capture();
    install(captured);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: simulateRequest('stream-resume', 40) });
    });
    expect(captured.error).toBeNull();
    expect(captured.results[0]?.gameNumber).toBe(40);
    expect(captured.results).toHaveLength(43);
    expect(digestsOf(captured.results)).toEqual(digestsOf(expectedResults().slice(39)));
  }, 60_000);

  it('stops delivering when the request is cancelled', async () => {
    const cancelled = capture();
    let cancelSent = false;
    install(cancelled, (message) => {
      if (message.type === 'results' && !cancelSent) {
        cancelSent = true;
        fakeSelf.onmessage?.({
          data: { schemaVersion: 1, type: 'cancel', requestId: message.requestId },
        });
      }
    });
    const settled = settleAfterQuiet(cancelled);
    fakeSelf.onmessage?.({ data: simulateRequest('stream-cancel') });
    await settled;
    expect(cancelled.error).toBeNull();
    expect(cancelSent).toBe(true);
    expect(cancelled.results.length).toBeGreaterThan(0);
    expect(cancelled.results.length).toBeLessThan(82);
    expect(cancelled.posted.some((message) => message.type === 'complete')).toBe(false);
  }, 60_000);

  it('rejects an invalid request without posting results', () => {
    const invalid = capture();
    install(invalid);
    fakeSelf.onmessage?.({ data: { schemaVersion: 1, type: 'simulate' } });
    expect(invalid.error).toMatchObject({ type: 'error' });
    expect(invalid.results).toHaveLength(0);
  });
});
