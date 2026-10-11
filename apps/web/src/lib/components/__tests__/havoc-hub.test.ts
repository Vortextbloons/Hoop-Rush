import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import HavocHub from '$lib/components/havoc/HavocHub.svelte';
import { HavocHubState } from '$lib/havoc/havoc-hub-state.svelte';
import { FakeHavocService } from '$lib/havoc/havoc-fake-service';

async function setupHub(outcomes?: readonly ('win' | 'loss')[]): Promise<{
  service: FakeHavocService;
  state: HavocHubState;
}> {
  const service = new FakeHavocService(outcomes === undefined ? {} : { outcomes });
  await service.createDraft();
  for (let round = 0; round < 5; round += 1) {
    const snapshot = await service.loadActive();
    const card = snapshot.draft?.cards[0];
    if (card === undefined) throw new Error('fake offer missing card');
    await service.pickCard(card.cardId);
  }
  await service.lockLineup();
  const state = new HavocHubState(service);
  await state.load();
  return { service, state };
}

function renderHub(hub: HavocHubState) {
  return render(HavocHub, {
    props: { hub, onOpenResult: () => undefined, onAbandoned: () => undefined },
  });
}

function requireButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (element === null) throw new Error(`expected element ${selector}`);
  return element;
}

describe('Havoc hub', () => {
  it('shows the locked lineup with the unmutated emergency replacement rule', async () => {
    const { state } = await setupHub();
    const { container } = renderHub(state);
    expect(container.querySelector('[data-havoc-lineup]')).not.toBeNull();
    expect(container.textContent).toContain('unmutated copy');
    expect(container.querySelectorAll('[data-havoc-lineup] li')).toHaveLength(5);
    state.destroy();
  });

  it('updates the 82-0 objective after the first loss without blocking play', async () => {
    const { state } = await setupHub(['win', 'loss']);
    const { container } = renderHub(state);
    const next = requireButton(container, '[data-havoc-next-game]');
    await fireEvent.click(next);
    await waitFor(() => {
      expect(state.run?.havocCursor).toBe(1);
    });
    await waitFor(() => {
      expect(state.busy).toBe(false);
    });
    await fireEvent.click(next);
    await waitFor(() => {
      expect(state.run?.havocCursor).toBe(2);
    });
    await tick();
    await waitFor(() => {
      expect(container.textContent).toContain('1–1');
      expect(container.querySelector('[data-havoc-objective-tone="lost"]')).not.toBeNull();
    });
    await waitFor(() => {
      expect(state.busy).toBe(false);
    });
    expect(container.querySelector('[data-havoc-objective]')?.textContent).toContain(
      'off the table',
    );
    expect(requireButton(container, '[data-havoc-next-game]').disabled).toBe(false);
    state.destroy();
  });

  it('watches a game and accepts the result at the end of the tape', async () => {
    const { service, state } = await setupHub();
    const { container } = renderHub(state);
    await fireEvent.click(requireButton(container, '[data-havoc-watch]'));
    await waitFor(() => {
      expect(container.querySelector('[data-havoc-gamecast]')).not.toBeNull();
    });
    expect(service.calls.watchGame).toBe(1);
    state.gamecast?.advance(10000);
    await tick();
    await fireEvent.click(requireButton(container, '[data-havoc-gamecast-accept]'));
    await waitFor(() => {
      expect(state.run?.havocCursor).toBe(1);
    });
    await waitFor(() => {
      expect(state.busy).toBe(false);
    });
    await fireEvent.click(requireButton(container, '[data-havoc-gamecast-close]'));
    await waitFor(() => {
      expect(container.querySelector('[data-havoc-gamecast]')).toBeNull();
    });
    expect(container.querySelector('[data-havoc-game-result="1"]')).not.toBeNull();
    expect(container.textContent).toContain('1–0');
    expect(service.calls.acceptGame).toBe(1);
    state.destroy();
  });

  it('advances ten games and reports progress', async () => {
    const { state } = await setupHub();
    const { container } = renderHub(state);
    await fireEvent.click(requireButton(container, '[data-havoc-next-ten]'));
    await waitFor(() => {
      expect(state.run?.havocCursor).toBe(10);
    });
    await tick();
    await waitFor(() => {
      expect(container.querySelectorAll('[data-havoc-game-result]')).toHaveLength(10);
      expect(container.querySelector('[data-havoc-progress-label]')?.textContent).toContain(
        '10 / 82',
      );
    });
    state.destroy();
  });
});
