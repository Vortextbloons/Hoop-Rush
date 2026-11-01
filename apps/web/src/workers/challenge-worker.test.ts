import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { gameResultDigest } from '@hoop-rush/engine';
import type { GameResult } from '@hoop-rush/data-contracts';
import { buildChallengeRun, buildEraSimulationProfile } from '@hoop-rush/test-fixtures';

interface PostedMessage {
  type?: string;
  requestId?: string;
  chosenRunSeed?: string;
  chosenWins?: number;
  chosenLosses?: number;
  chosenDifferential?: number;
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

function startRequest(requestId: string, run = RUN): unknown {
  return {
    schemaVersion: 1,
    type: 'start',
    requestId,
    run: { ...run, games: [] },
    profile: PROFILE,
    engineVersion: ENGINE_VERSION,
  };
}

function simulateRequest(requestId: string, chosenRunSeed: string, startGameNumber = 1): unknown {
  return {
    schemaVersion: 1,
    type: 'simulate',
    requestId,
    run: { ...RUN, runSeed: chosenRunSeed, games: [] },
    startGameNumber,
    profile: PROFILE,
    engineVersion: ENGINE_VERSION,
  };
}

interface Capture {
  posted: PostedMessage[];
  results: GameResult[];
  startResult: PostedMessage | null;
  error: PostedMessage | null;
}

function capture(): Capture {
  return { posted: [], results: [], startResult: null, error: null };
}

function install(captured: Capture, onMessage?: (message: PostedMessage) => void): void {
  fakeSelf.postMessage = (message) => {
    captured.posted.push(message);
    if (message.type === 'start-result') captured.startResult = message;
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

describe('challenge worker attempt reuse', () => {
  it('delivers the chosen attempt games without simulating them twice', async () => {
    const first = capture();
    install(first);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: startRequest('reuse-a') });
      const chosen = first.startResult?.chosenRunSeed ?? '';
      fakeSelf.onmessage?.({ data: simulateRequest('reuse-a', chosen) });
    });
    expect(first.error).toBeNull();
    expect(first.results).toHaveLength(82);

    // A second identical request must produce identical games; the worker retains
    // the winning attempt until a simulate request consumes it.
    const second = capture();
    install(second);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: startRequest('reuse-b') });
      const chosen = second.startResult?.chosenRunSeed ?? '';
      fakeSelf.onmessage?.({ data: simulateRequest('reuse-b', chosen) });
    });
    expect(second.error).toBeNull();
    expect(second.startResult).toMatchObject({
      chosenRunSeed: first.startResult?.chosenRunSeed,
      chosenWins: first.startResult?.chosenWins,
      chosenLosses: first.startResult?.chosenLosses,
      chosenDifferential: first.startResult?.chosenDifferential,
    });
    expect(digestsOf(second.results)).toEqual(digestsOf(first.results));
    expect(second.results.map((result) => result.gameNumber)).toEqual(
      Array.from({ length: 82 }, (_, index) => index + 1),
    );
  }, 60_000);

  it('falls back to simulating when the simulate request does not match the retained attempt', async () => {
    const retained = capture();
    install(retained);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: startRequest('identity-a') });
      const chosen = retained.startResult?.chosenRunSeed ?? '';
      fakeSelf.onmessage?.({ data: simulateRequest('identity-a', chosen) });
    });
    expect(retained.error).toBeNull();

    // Start a different run, then simulate a seed the worker never retained.
    const mismatched = capture();
    install(mismatched);
    const otherRun = buildChallengeRun({ runId: 'worker-run-other', runSeed: RUN.runSeed });
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: startRequest('identity-b', otherRun) });
      const otherSeed = mismatched.startResult?.chosenRunSeed ?? '';
      fakeSelf.onmessage?.({ data: simulateRequest('identity-b', otherSeed) });
    });
    expect(mismatched.error).toBeNull();
    expect(mismatched.results).toHaveLength(82);

    const fresh = capture();
    install(fresh);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({
        data: simulateRequest('identity-c', mismatched.startResult?.chosenRunSeed ?? ''),
      });
    });
    expect(fresh.error).toBeNull();
    expect(digestsOf(fresh.results)).toEqual(digestsOf(mismatched.results));
  }, 60_000);

  it('stops delivering retained games when the request is cancelled', async () => {
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
    fakeSelf.onmessage?.({ data: startRequest('cancel-a') });
    const chosen = cancelled.startResult?.chosenRunSeed ?? '';
    fakeSelf.onmessage?.({ data: simulateRequest('cancel-a', chosen) });
    await settled;
    expect(cancelled.error).toBeNull();
    expect(cancelSent).toBe(true);
    expect(cancelled.results.length).toBeGreaterThan(0);
    expect(cancelled.results.length).toBeLessThan(82);
    expect(cancelled.posted.some((message) => message.type === 'complete')).toBe(false);
  }, 60_000);

  it('does not reuse the retained attempt for a mid-season resume', async () => {
    const resumed = capture();
    install(resumed);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({ data: startRequest('resume-a') });
      const chosen = resumed.startResult?.chosenRunSeed ?? '';
      fakeSelf.onmessage?.({ data: simulateRequest('resume-a', chosen, 40) });
    });
    expect(resumed.error).toBeNull();
    expect(resumed.results[0]?.gameNumber).toBe(40);
    expect(resumed.results).toHaveLength(43);

    // A resume simulates its games rather than replaying retained ones; the games it
    // produces for those numbers must still match a full run of the same seed.
    const full = capture();
    install(full);
    await runToCompletion(() => {
      fakeSelf.onmessage?.({
        data: simulateRequest('resume-b', resumed.startResult?.chosenRunSeed ?? '', 1),
      });
    });
    expect(full.error).toBeNull();
    expect(digestsOf(resumed.results)).toEqual(digestsOf(full.results.slice(39)));
  }, 60_000);

  it('rejects an invalid request without posting results', () => {
    const invalid = capture();
    install(invalid);
    fakeSelf.onmessage?.({ data: { schemaVersion: 1, type: 'start' } });
    expect(invalid.error).toMatchObject({ type: 'error' });
    expect(invalid.results).toHaveLength(0);
  });
});
