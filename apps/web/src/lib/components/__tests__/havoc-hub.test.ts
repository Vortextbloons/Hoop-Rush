import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import HavocHub from '$lib/components/havoc/HavocHub.svelte';
import { HavocHubState } from '$lib/havoc/havoc-hub-state.svelte';
import { FakeHavocService } from '$lib/havoc/havoc-fake-service';
async function setupHub() {
  const service = new FakeHavocService();
  await service.createDraft();
  for (let round = 0; round < 5; round += 1) {
    const card = (await service.loadActive()).draft?.cards[0];
    if (!card) throw new Error('missing card');
    await service.pickCard(card.cardId);
  }
  await service.lockLineup();
  const state = new HavocHubState(service);
  await state.load();
  return { service, state };
}
describe('Havoc automatic season screen', () => {
  it('shows the squad without manual simulation choices', async () => {
    const { state } = await setupHub();
    const { container } = render(HavocHub, {
      props: { hub: state, onOpenResult: vi.fn(), onAbandoned: vi.fn() },
    });
    expect(container.querySelectorAll('[data-havoc-lineup] li')).toHaveLength(5);
    expect(container.textContent).toContain('unmutated copy');
    expect(container.querySelector('[data-havoc-watch]')).toBeNull();
    expect(container.querySelector('[data-havoc-next-game]')).toBeNull();
    expect(container.querySelector('[data-havoc-next-ten]')).toBeNull();
    state.destroy();
  });
  it('resumes both seasons and opens the finished report once', async () => {
    const { state, service } = await setupHub();
    const open = vi.fn();
    const { getByRole } = render(HavocHub, {
      props: { hub: state, onOpenResult: open, onAbandoned: vi.fn() },
    });
    await fireEvent.click(getByRole('button', { name: 'Continue automatic season' }));
    await waitFor(() => {
      expect(open).toHaveBeenCalledTimes(1);
    });
    expect(state.run?.havocCursor).toBe(82);
    expect(state.run?.normalCursor).toBe(82);
    expect(state.run?.comparisonStatus).toBe('complete');
    expect(service.calls.watchGame).toBe(0);
    state.destroy();
  });
});
