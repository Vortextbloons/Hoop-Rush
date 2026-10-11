import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import HavocGamecast from '$lib/components/havoc/HavocGamecast.svelte';
import { HavocGamecastState } from '$lib/havoc/havoc-gamecast-state.svelte';
import {
  FakeHavocService,
  buildCloneGameResult,
  buildMutationTape,
  buildNegativeScoreTape,
} from '$lib/havoc/havoc-fake-service';

async function makeState(
  configure?: (service: FakeHavocService) => void,
): Promise<{ service: FakeHavocService; state: HavocGamecastState }> {
  const service = new FakeHavocService();
  configure?.(service);
  const session = await service.watchGame({ gameNumber: 1, variant: 'havoc' });
  const result = await service.readGame({ gameNumber: 1, variant: 'havoc' });
  return { service, state: new HavocGamecastState(service, session, result) };
}

function renderGamecast(state: HavocGamecastState) {
  return render(HavocGamecast, {
    props: { state, onAccept: vi.fn(), onClose: vi.fn() },
  });
}

function requireButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (element === null) throw new Error(`expected element ${selector}`);
  return element;
}

describe('Havoc gamecast', () => {
  it('renders negative scores from the ledger', async () => {
    const { state } = await makeState((service) => {
      service.tapeBuilder = () => buildNegativeScoreTape(1);
    });
    state.advance(10000);
    const { container } = renderGamecast(state);
    expect(container.querySelector('[data-score="human"]')?.textContent.trim()).toBe('-3');
    expect(container.querySelector('[data-score="opponent"]')?.textContent.trim()).toBe('3');
    state.destroy();
  });

  it('shows clone and replacement stat lines with their roles', async () => {
    const { state } = await makeState((service) => {
      service.resultBuilder = (gameNumber) => buildCloneGameResult(gameNumber);
    });
    state.advance(10000);
    const { container } = renderGamecast(state);
    expect(container.querySelector('[data-havoc-line="clone"]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-line="replacement"]')).not.toBeNull();
    expect(container.textContent).toContain('Clone');
    state.destroy();
  });

  it('shows mutation badges and actual adjusted point values', async () => {
    const { state } = await makeState((service) => {
      service.tapeBuilder = () => buildMutationTape(1);
    });
    state.advance(10000);
    const { container } = renderGamecast(state);
    expect(container.querySelector('[data-havoc-mutation-badge="four-point-dunk"]')).not.toBeNull();
    expect(
      container.querySelector('[data-havoc-mutation-badge="possession-refund"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('+4');
    state.destroy();
  });

  it('changes playback speed without resimulating', async () => {
    const { service, state } = await makeState();
    const { container } = renderGamecast(state);
    const fast = requireButton(container, '[data-havoc-speed="4"]');
    await fireEvent.click(fast);
    await waitFor(() => {
      expect(fast.getAttribute('aria-pressed')).toBe('true');
    });
    expect(service.calls.watchGame).toBe(1);
    expect(service.calls.simulateRange).toBe(0);
    const toggle = requireButton(container, '[data-havoc-playback-toggle]');
    expect(toggle.disabled).toBe(false);
    state.destroy();
  });

  it('announces score updates for screen readers', async () => {
    const { state } = await makeState();
    state.advance(10000);
    const { container } = renderGamecast(state);
    const announcement = container.querySelector('[data-havoc-gamecast-announcement]');
    expect(announcement?.textContent).toContain('Hoop Havoc Five');
    expect(announcement?.getAttribute('aria-live')).toBe('polite');
    state.destroy();
  });
});
