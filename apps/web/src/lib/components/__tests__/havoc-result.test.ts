import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import HavocResultView from '$lib/components/havoc/HavocResultView.svelte';
import { HavocResultState } from '$lib/havoc/havoc-result-state.svelte';
import {
  FakeHavocService,
  buildCompleteRunState,
  buildFakeComparison,
  buildPendingComparisonRunState,
} from '$lib/havoc/havoc-fake-service';

function requireButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (element === null) throw new Error(`expected element ${selector}`);
  return element;
}

describe('Havoc result view', () => {
  it('hides baseline numbers while the normal season is pending', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildPendingComparisonRunState({ normalCursor: 40 }));
    const state = new HavocResultState(service);
    await state.load();
    const { container } = render(HavocResultView, { props: { state } });
    expect(container.querySelector('[data-havoc-comparison-pending]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-comparison]')).toBeNull();
    expect(container.querySelector('[data-havoc-mvp]')).toBeNull();
    expect(container.textContent).not.toContain('24–16');
    expect(container.textContent).toContain('40 / 82');
    state.destroy();
  });

  it('resumes the pending comparison and reveals the chart and MVP together', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildPendingComparisonRunState({ normalCursor: 40 }));
    const state = new HavocResultState(service);
    await state.load();
    const { container } = render(HavocResultView, { props: { state } });
    await fireEvent.click(requireButton(container, '[data-havoc-run-normal]'));
    await waitFor(() => {
      expect(state.run?.comparisonStatus).toBe('complete');
    });
    await waitFor(() => {
      expect(container.querySelector('[data-havoc-comparison]')).not.toBeNull();
      expect(container.querySelector('[data-havoc-mvp]')).not.toBeNull();
      expect(container.querySelector('[data-havoc-comparison-chart]')).not.toBeNull();
    });
    expect(container.querySelector('[data-havoc-mvp-havoc-index]')?.textContent).toBeTruthy();
    expect(container.textContent).toContain('62–20');
    state.destroy();
  });

  it('reveals a seeded completed comparison with the matched chart', async () => {
    const service = new FakeHavocService();
    service.seedActiveRun(buildCompleteRunState());
    service.seedComparison(buildFakeComparison('havoc-run-1'));
    const state = new HavocResultState(service);
    await state.load();
    const { container } = render(HavocResultView, { props: { state } });
    expect(container.querySelector('[data-havoc-comparison]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-mvp]')).not.toBeNull();
    expect(container.querySelectorAll('[data-havoc-chart-game]')).toHaveLength(82);
    expect(container.querySelector('[data-havoc-comparison-table]')).not.toBeNull();
    state.destroy();
  });
});
