import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import HavocSetup from '$lib/components/havoc/HavocSetup.svelte';
import { HavocDraftController } from '$lib/havoc/havoc-draft-state.svelte';
import { FakeHavocService } from '$lib/havoc/havoc-fake-service';

async function setupDraft(): Promise<{
  controller: HavocDraftController;
  service: FakeHavocService;
}> {
  const service = new FakeHavocService();
  const controller = new HavocDraftController(service);
  await controller.load();
  await controller.createDraft();
  return { controller, service };
}

function pickButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Draft"]'));
}

function requireButton(parent: ParentNode, selector: string): HTMLButtonElement {
  const element = parent.querySelector<HTMLButtonElement>(selector);
  if (element === null) throw new Error(`expected element ${selector}`);
  return element;
}

describe('Havoc draft board', () => {
  it('explains the mode before a draft exists', async () => {
    const service = new FakeHavocService();
    const controller = new HavocDraftController(service);
    await controller.load();
    const { getByText } = render(HavocSetup, {
      props: { controller, onLocked: () => undefined },
    });
    expect(getByText(/82–0/)).toBeTruthy();
    expect(getByText(/No guarantees/)).toBeTruthy();
  });

  it('renders three comparable cards with tier labels, descriptions, and downsides', async () => {
    const { controller } = await setupDraft();
    const { container, getByText, getAllByText } = render(HavocSetup, {
      props: { controller, onLocked: () => undefined },
    });
    expect(container.querySelectorAll('[data-havoc-card]')).toHaveLength(3);
    expect(getAllByText('Tier 1')).toHaveLength(1);
    expect(getAllByText('Tier 2')).toHaveLength(1);
    expect(getAllByText('Tier 3')).toHaveLength(1);
    expect(getByText('Growth Spurt')).toBeTruthy();
    expect(getByText(/Downside: Caps pass rate at 2/)).toBeTruthy();
    expect(container.querySelector('[data-havoc-estimated]')).not.toBeNull();
    expect(container.querySelector('[data-havoc-rerolls-remaining]')?.textContent).toContain(
      '1 of 1 reroll',
    );
    expect(container.querySelectorAll('[data-havoc-changed="true"]').length).toBeGreaterThan(0);
    const affected = container.querySelector('[data-havoc-affected-attributes]');
    expect(affected?.closest('details')).toBeNull();
    expect(affected?.querySelectorAll('[data-havoc-changed="true"]').length).toBeGreaterThan(0);
  });

  it('drafts all five positions with focusable pick buttons', async () => {
    const { controller, service } = await setupDraft();
    const locked = vi.fn();
    const { container } = render(HavocSetup, {
      props: { controller, onLocked: locked },
    });
    for (let pick = 0; pick < 5; pick += 1) {
      const buttons = pickButtons(container);
      expect(buttons.length).toBeGreaterThan(0);
      const button = requireButton(container, 'button[aria-label^="Draft"]');
      button.focus();
      expect(document.activeElement).toBe(button);
      await fireEvent.click(button);
      await waitFor(() => {
        expect(controller.draft?.picks.length).toBe(pick + 1);
      });
      await tick();
    }
    expect(service.calls.pickCard).toBe(5);
    expect(controller.draft?.status).toBe('complete');
    expect(controller.draft?.picks.map((entry) => entry.slot)).toEqual([
      'PG',
      'SG',
      'SF',
      'PF',
      'C',
    ]);
    const lockButton = requireButton(container, '[data-havoc-lock]');
    await fireEvent.click(lockButton);
    await waitFor(() => {
      expect(locked).toHaveBeenCalledTimes(1);
    });
    expect(controller.run?.phase).toBe('run');
    expect(controller.run?.lineup).toHaveLength(5);
  });

  it('allows exactly one whole-offer reroll', async () => {
    const { controller, service } = await setupDraft();
    const { container } = render(HavocSetup, {
      props: { controller, onLocked: () => undefined },
    });
    const reroll = requireButton(container, '[data-havoc-reroll]');
    await fireEvent.click(reroll);
    await waitFor(() => {
      expect(controller.draft?.rerollUsed).toBe(true);
    });
    expect(container.querySelector('[data-havoc-rerolls-remaining]')?.textContent).toContain(
      '0 of 1 rerolls left',
    );
    await fireEvent.click(requireButton(container, '[data-havoc-reroll]'));
    expect(service.calls.rerollOffer).toBe(1);
  });

  it('toggles original and effective attribute views', async () => {
    const { controller } = await setupDraft();
    const { container, getByText } = render(HavocSetup, {
      props: { controller, onLocked: () => undefined },
    });
    const effective = getByText('Effective');
    const original = getByText('Original');
    expect(effective.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(original);
    await waitFor(() => {
      expect(original.getAttribute('aria-pressed')).toBe('true');
    });
    expect(effective.getAttribute('aria-pressed')).toBe('false');
    const changedCell = container.querySelector('[data-havoc-changed="true"]');
    expect(changedCell?.textContent).toContain('→');
  });
});
