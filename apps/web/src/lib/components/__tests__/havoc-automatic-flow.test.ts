import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import RunPage from '../../../routes/havoc/run/+page.svelte';
import { FakeHavocService } from '$lib/havoc/havoc-fake-service';
const mocks = vi.hoisted(() => ({ getService: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/havoc/havoc-service', () => ({ getHavocService: mocks.getService }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
describe('Havoc launch flow', () => {
  it('automatically plays both seasons and navigates to the report', async () => {
    const service = new FakeHavocService();
    await service.createDraft();
    for (let round = 0; round < 5; round += 1) {
      const card = (await service.loadActive()).draft?.cards[0];
      if (!card) throw new Error('missing draft card');
      await service.pickCard(card.cardId);
    }
    await service.lockLineup();
    mocks.getService.mockReturnValue(service);
    mocks.goto.mockClear();
    const screen = render(RunPage);
    await waitFor(() => {
      expect(mocks.goto).toHaveBeenCalledWith('/havoc/result');
    });
    expect(service.calls.simulateRange).toBe(1);
    expect(service.calls.startNormalSeason).toBe(1);
    expect(service.calls.finalizeComparison).toBe(1);
    expect((await service.loadActive()).run?.comparisonStatus).toBe('complete');
    screen.unmount();
  });
});
