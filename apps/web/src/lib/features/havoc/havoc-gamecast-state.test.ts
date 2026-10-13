import { afterEach, describe, expect, it, vi } from 'vitest';
import { HavocGamecastState } from './havoc-gamecast-state.svelte.ts';
import {
  buildCloneGameResult,
  buildMutationTape,
  buildNegativeScoreTape,
} from './testing/havoc-fixtures.ts';
import { FakeHavocService } from './testing/havoc-service-double.ts';

async function createLockedRun(service: FakeHavocService): Promise<void> {
  await service.createDraft();
  for (let round = 0; round < 5; round += 1) {
    const snapshot = await service.loadActive();
    const card = snapshot.draft?.cards[0];
    if (card === undefined) throw new Error('fake draft offer is missing a card');
    await service.pickCard(card.cardId);
  }
  await service.lockLineup();
}

async function openGamecast(
  service: FakeHavocService,
  gameNumber = 1,
): Promise<HavocGamecastState> {
  if (service.activeRunState()?.phase !== 'run') await createLockedRun(service);
  const session = await service.watchGame({ gameNumber, variant: 'havoc' });
  const result = await service.readGame({ gameNumber, variant: 'havoc' });
  return new HavocGamecastState(service, session, result);
}

describe('HavocGamecastState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders negative scores from the scoring ledger', async () => {
    const service = new FakeHavocService();
    service.tapeBuilder = () => buildNegativeScoreTape(1);
    const gamecast = await openGamecast(service);
    gamecast.advance(10000);
    expect(gamecast.finished).toBe(true);
    expect(gamecast.humanScore).toBe(-3);
    expect(gamecast.opponentScore).toBe(3);
    expect(gamecast.announcement).toContain('-3');
    gamecast.destroy();
  });

  it('tracks clone and replacement stat lines from visible events', async () => {
    const service = new FakeHavocService();
    service.resultBuilder = (gameNumber) => buildCloneGameResult(gameNumber);
    const gamecast = await openGamecast(service);
    gamecast.advance(10000);
    const lines = gamecast.liveLines();
    const clone = lines.find((line) => line.kind === 'clone');
    const replacement = lines.find((line) => line.kind === 'replacement');
    expect(clone).toBeDefined();
    expect(replacement).toBeDefined();
    expect(clone?.displayName).toContain('Clone');
    gamecast.destroy();
  });

  it('exposes mutation events as feed badges with real point values', async () => {
    const service = new FakeHavocService();
    service.tapeBuilder = () => buildMutationTape(1);
    const gamecast = await openGamecast(service);
    gamecast.advance(10000);
    const mutationItems = gamecast.items.filter((item) => item.mutationId !== null);
    expect(mutationItems.map((item) => item.mutationId)).toContain('four-point-dunk');
    expect(mutationItems.map((item) => item.mutationId)).toContain('possession-refund');
    const scoring = gamecast.items.find((item) =>
      item.scoring?.addends.some((addend) => addend.source === 'four-point-dunk'),
    );
    expect(scoring?.scoring?.points).toBe(3);
    expect(scoring?.text).toContain('+3');
    gamecast.destroy();
  });

  it('does not resimulate when pausing or changing speed', async () => {
    vi.useFakeTimers();
    const service = new FakeHavocService();
    const gamecast = await openGamecast(service);
    gamecast.play();
    vi.advanceTimersByTime(600);
    const advanced = gamecast.cursor;
    expect(advanced).toBeGreaterThan(0);
    gamecast.pause();
    const pausedAt = gamecast.cursor;
    vi.advanceTimersByTime(5000);
    expect(gamecast.cursor).toBe(pausedAt);
    gamecast.setSpeed(4);
    expect(gamecast.cursor).toBe(pausedAt);
    expect(service.calls.watchGame).toBe(1);
    expect(service.calls.simulateRange).toBe(0);
    gamecast.play();
    vi.advanceTimersByTime(600);
    expect(gamecast.cursor).toBeGreaterThan(pausedAt);
    gamecast.destroy();
  });

  it('cleans up its playback timer on destroy', async () => {
    vi.useFakeTimers();
    const service = new FakeHavocService();
    const gamecast = await openGamecast(service);
    gamecast.play();
    vi.advanceTimersByTime(300);
    const atDestroy = gamecast.cursor;
    gamecast.destroy();
    vi.advanceTimersByTime(5000);
    expect(gamecast.cursor).toBe(atDestroy);
    expect(gamecast.playing).toBe(false);
  });

  it('accepts the watched game through the service exactly once', async () => {
    const service = new FakeHavocService();
    const gamecast = await openGamecast(service);
    gamecast.advance(10000);
    expect(await gamecast.accept()).toBe(true);
    expect(await gamecast.accept()).toBe(true);
    expect(service.calls.acceptGame).toBe(1);
    expect(gamecast.accepted).toBe(true);
    gamecast.destroy();
  });
});
