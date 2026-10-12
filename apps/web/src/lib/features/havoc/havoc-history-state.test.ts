import { describe, expect, it } from 'vitest';
import { HavocHistoryState } from './havoc-history-state.svelte.ts';
import { FakeHavocService } from './havoc-fake-service.ts';

describe('HavocHistoryState', () => {
  it('lists completed and abandoned runs, preserving unsuccessful runs', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.load();
    expect(state.entries).toHaveLength(2);
    expect(state.entries.map((entry) => entry.completionState)).toEqual(['complete', 'abandoned']);
    state.destroy();
  });

  it('reopens a completed run with its report and comparison', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.loadRun('havoc-run-1');
    expect(state.detail?.run.havocWins).toBe(55);
    expect(state.detail?.run.havocLosses).toBe(27);
    expect(state.detail?.report?.status).toBe('complete');
    expect(state.detail?.comparison?.games).toHaveLength(82);
    expect(state.detail?.report?.mvp?.displayName).toBeTruthy();
    state.destroy();
  });

  it('reopens an abandoned run with its partial report', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.loadRun('havoc-run-2');
    expect(state.detail?.run.completionState).toBe('abandoned');
    expect(state.detail?.run.havocWins).toBe(3);
    expect(state.detail?.report?.status).toBe('comparison-pending');
    expect(state.detail?.comparison).toBeNull();
    state.destroy();
  });

  it('reports an unknown run id without throwing', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.loadRun('havoc-run-missing');
    expect(state.detail).toBeNull();
    expect(state.error).toContain('havoc-run-missing');
    state.destroy();
  });
});
