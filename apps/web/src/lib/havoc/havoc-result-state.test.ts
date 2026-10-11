import { describe, expect, it } from 'vitest';
import { HavocResultState } from './havoc-result-state.svelte.ts';
import {
  FakeHavocService,
  buildCompleteRunState,
  buildFakeComparison,
  buildPendingComparisonRunState,
} from './havoc-fake-service.ts';

describe('HavocResultState', () => {
  it('keeps baseline numbers hidden while the normal season is pending', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildPendingComparisonRunState({ normalCursor: 40 }));
    const state = new HavocResultState(service);
    await state.load();
    expect(state.run?.comparisonStatus).toBe('running');
    expect(state.run?.normalCursor).toBe(40);
    expect(state.comparison).toBeNull();
    expect(state.baselineVisible).toBe(false);
    expect(state.report?.status).toBe('comparison-pending');
    expect(state.report?.normal).toBeNull();
    state.destroy();
  });

  it('resumes a pending comparison and reveals the paired result', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildPendingComparisonRunState({ normalCursor: 40 }));
    const state = new HavocResultState(service);
    await state.load();
    await state.runNormalSeason();
    expect(state.run?.normalCursor).toBe(82);
    expect(state.run?.comparisonStatus).toBe('complete');
    expect(state.comparison).not.toBeNull();
    expect(state.baselineVisible).toBe(true);
    expect(state.report?.status).toBe('complete');
    expect(state.report?.normal).not.toBeNull();
    expect(state.comparison?.mvp.displayName).toBeTruthy();
    expect(service.calls.finalizeComparison).toBe(1);
    state.destroy();
  });

  it('cancels a running comparison at a game boundary and preserves progress', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildPendingComparisonRunState({ normalCursor: 0 }));
    const state = new HavocResultState(service);
    await state.load();
    service.subscribe((event) => {
      if (
        event.type === 'progress' &&
        event.progress.variant === 'normal' &&
        event.progress.gamesCompleted === 3
      ) {
        void state.cancelComparison();
      }
    });
    await state.runNormalSeason();
    expect(state.run?.normalCursor).toBe(3);
    expect(state.run?.comparisonStatus).toBe('running');
    expect(state.comparison).toBeNull();
    expect(state.notice).toContain('paused');
    expect(service.calls.cancelSimulation).toBe(1);
    state.destroy();
  });

  it('reveals a completed comparison seeded by the service', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildCompleteRunState());
    service.seedComparison(buildFakeComparison('havoc-run-1'));
    const state = new HavocResultState(service);
    await state.load();
    expect(state.comparisonComplete).toBe(true);
    expect(state.baselineVisible).toBe(true);
    expect(state.comparison?.games).toHaveLength(82);
    state.destroy();
  });
});
