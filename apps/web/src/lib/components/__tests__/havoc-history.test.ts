import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import HavocHistoryList from '$lib/components/havoc/HavocHistoryList.svelte';
import HavocRunDetail from '$lib/components/havoc/HavocRunDetail.svelte';
import { HavocHistoryState } from '$lib/havoc/havoc-history-state.svelte';
import { FakeHavocService } from '$lib/havoc/havoc-fake-service';

describe('Havoc Hall of Freaks', () => {
  it('lists completed and abandoned runs with links to their detail pages', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.load();
    const { container } = render(HavocHistoryList, { props: { state } });
    expect(container.querySelectorAll('[data-havoc-history-entry]')).toHaveLength(2);
    const complete = container.querySelector('[data-havoc-history-entry="havoc-run-1"]');
    const abandoned = container.querySelector('[data-havoc-history-entry="havoc-run-2"]');
    expect(complete?.textContent).toContain('55–27');
    expect(abandoned?.textContent).toContain('Abandoned');
    expect(complete?.getAttribute('href')).toContain('havoc-run-1');
    state.destroy();
  });

  it('reopens a completed run with its report, comparison, and normal record', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.loadRun('havoc-run-1');
    const { container } = render(HavocRunDetail, { props: { state, runId: 'havoc-run-1' } });
    expect(container.querySelector('[data-havoc-run-detail]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-report]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-comparison]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-comparison-mutations]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-detail-normal-record]')?.textContent).toContain(
      '62–20',
    );
    expect(container.textContent).toContain('havoc-rules-v2');
    expect(container.textContent).toContain('Normal combined');
    expect(container.textContent).toContain('Production index');
    state.destroy();
  });

  it('keeps an abandoned run visible without revealing baseline numbers', async () => {
    const service = new FakeHavocService();
    const state = new HavocHistoryState(service);
    await state.loadRun('havoc-run-2');
    const { container } = render(HavocRunDetail, { props: { state, runId: 'havoc-run-2' } });
    expect(container.textContent).toContain('Unsuccessful run preserved');
    expect(container.querySelector('[data-havoc-detail-normal-record]')?.textContent).toContain(
      'Hidden until the comparison completes',
    );
    expect(container.querySelector('[data-havoc-report]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-comparison]')).toBeNull();
    state.destroy();
  });
});
