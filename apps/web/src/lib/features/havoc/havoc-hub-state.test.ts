import { describe, expect, it } from 'vitest';
import { havocObjectiveStatusOf } from './havoc-presentation';
import { HavocHubState } from './havoc-hub-state.svelte.ts';
import { FakeHavocService } from './testing/havoc-fake-service.ts';

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

describe('HavocHubState', () => {
  it('continues after the first loss without blocking play', async () => {
    const service = new FakeHavocService({ outcomes: ['win', 'loss'] });
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    await hub.nextGame();
    await hub.nextGame();
    expect(hub.run?.havocWins).toBe(1);
    expect(hub.run?.havocLosses).toBe(1);
    expect(hub.run?.perfectSeason).toBe(false);
    const run = hub.run;
    if (run === null) throw new Error('hub run missing');
    expect(havocObjectiveStatusOf(run).tone).toBe('lost');
    await hub.nextGame();
    expect(hub.run?.havocCursor).toBe(3);
    expect(hub.games).toHaveLength(3);
    expect(hub.busy).toBe(false);
  });

  it('advances ten games and reports progress', async () => {
    const service = new FakeHavocService();
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    await hub.nextTen();
    expect(hub.games).toHaveLength(10);
    expect(hub.progress?.gamesCompleted).toBe(10);
    expect(hub.run?.havocCursor).toBe(10);
    expect(hub.error).toBeNull();
  });

  it('watches a game and accepts the result at the end of the tape', async () => {
    const service = new FakeHavocService();
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    await hub.watchNext();
    expect(hub.gamecast).not.toBeNull();
    expect(service.calls.watchGame).toBe(1);
    hub.gamecast?.advance(10000);
    expect(hub.gamecast?.finished).toBe(true);
    await hub.acceptWatchedGame();
    expect(service.calls.acceptGame).toBe(1);
    expect(hub.gamecast?.accepted).toBe(true);
    expect(hub.run?.havocCursor).toBe(1);
    expect(hub.games).toHaveLength(1);
    expect(hub.games[0]?.outcome).toBe('win');
    hub.destroy();
  });

  it('folds player and mutation season stats across accepted games', async () => {
    const service = new FakeHavocService();
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    await hub.nextTen();
    await hub.loadSeasonStats();
    expect(hub.seasonStats?.games).toBe(10);
    expect(hub.seasonStats?.players.length).toBeGreaterThanOrEqual(5);
    expect(hub.seasonStats?.players[0]?.displayName).toBeTruthy();
    hub.destroy();
  });

  it('abandons the active run and clears hub state', async () => {
    const service = new FakeHavocService();
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    const accepted = await hub.abandon();
    expect(accepted).toBe(true);
    expect(hub.run).toBeNull();
    expect(hub.games).toHaveLength(0);
    expect(service.calls.abandon).toBe(1);
    hub.destroy();
  });
});

describe('Havoc automatic season orchestration', () => {
  it('runs all games despite losses, then completes the comparison', async () => {
    const service = new FakeHavocService({ outcomes: ['win', 'loss'] });
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    expect(await hub.playSeason()).toBe(true);
    expect(hub.run?.havocCursor).toBe(82);
    expect(hub.run?.normalCursor).toBe(82);
    expect(hub.run?.comparisonStatus).toBe('complete');
    expect(service.calls.simulateRange).toBe(1);
    expect(service.calls.startNormalSeason).toBe(1);
    expect(service.calls.finalizeComparison).toBe(1);
    expect(await hub.playSeason()).toBe(true);
    expect(service.calls.startNormalSeason).toBe(1);
    hub.destroy();
  });
  it('does not open the report after a simulation failure and can retry', async () => {
    const service = new FakeHavocService();
    await createLockedRun(service);
    const hub = new HavocHubState(service);
    await hub.load();
    const simulate = service.simulateRange.bind(service);
    service.simulateRange = () => Promise.reject(new Error('Worker failed'));
    expect(await hub.playSeason()).toBe(false);
    expect(hub.error).toBe('Worker failed');
    expect(service.calls.startNormalSeason).toBe(0);
    service.simulateRange = simulate;
    expect(await hub.playSeason()).toBe(true);
    expect(hub.error).toBeNull();
    hub.destroy();
  });
});

it('pauses the automatic season at a saved game and resumes to the full report', async () => {
  const service = new FakeHavocService();
  await createLockedRun(service);
  const hub = new HavocHubState(service);
  await hub.load();
  const unsubscribe = service.subscribe((event) => {
    if (
      event.type === 'progress' &&
      event.progress.variant === 'havoc' &&
      event.progress.gamesCompleted === 3
    )
      void hub.cancel();
  });
  expect(await hub.playSeason()).toBe(false);
  expect(hub.run?.havocCursor).toBe(3);
  expect(service.calls.startNormalSeason).toBe(0);
  unsubscribe();
  expect(await hub.playSeason()).toBe(true);
  expect(hub.run?.havocCursor).toBe(82);
  expect(hub.run?.comparisonStatus).toBe('complete');
  hub.destroy();
});
