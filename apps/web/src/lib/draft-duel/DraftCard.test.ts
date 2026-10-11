// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { draftDuelCardSchema, type DraftDuelCard } from '@hoop-rush/data-contracts';
import DraftCard from './DraftCard.svelte';

function cardFixture(overrides: Partial<DraftDuelCard> = {}): DraftDuelCard {
  return draftDuelCardSchema.parse({
    cardId: 'card-00000000000000000000000000000001',
    playerId: 'alpha-1984',
    playerVersionId: 'pv-00000000000000000000000000000001',
    displayName: 'Test Player',
    seasonKey: '1984-85',
    franchiseId: 'lakers',
    eraId: '1980s',
    positions: ['SG'],
    overall: 97,
    bandIndex: 0,
    ...overrides,
  });
}

describe('DraftCard', () => {
  it('shows the overall and band label in ratings mode', () => {
    const { container } = render(DraftCard, {
      props: { card: cardFixture(), presentation: 'ratings' },
    });
    expect(container.textContent).toContain('97');
    expect(container.textContent).toContain('97-99');
    expect(container.querySelector('[data-overall]')?.getAttribute('data-overall')).toBe('97');
    expect(container.querySelector('[data-band]')?.getAttribute('data-band')).toBe('97-99');
    expect(container.querySelector('[data-elite="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Test Player');
    expect(container.textContent).toContain('1984-85');
  });

  it('hides every strength number and band label in ball-knowledge mode', () => {
    const { container } = render(DraftCard, {
      props: { card: cardFixture(), presentation: 'ball-knowledge' },
    });
    expect(container.textContent).not.toContain('97');
    expect(container.textContent).not.toContain('97-99');
    expect(container.querySelector('[data-overall]')).toBeNull();
    expect(container.querySelector('[data-band]')).toBeNull();
    expect(container.querySelector('[data-elite]')).toBeNull();
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).not.toContain('97');
    expect(container.textContent).toContain('Test Player');
    expect(container.textContent).toContain('1984-85');
  });

  it('keeps disabled cards focusable but not selectable, with a factual reason', async () => {
    const onselect = vi.fn();
    const { container } = render(DraftCard, {
      props: {
        card: cardFixture(),
        presentation: 'ratings',
        disabled: true,
        reason: 'claimed',
        onselect,
      },
    });
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.hasAttribute('disabled')).toBe(false);
    button?.focus();
    expect(document.activeElement).toBe(button);
    await fireEvent.click(button as HTMLButtonElement);
    expect(onselect).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Already drafted');
  });

  it('reports picks and considerations through callbacks when enabled', async () => {
    const onselect = vi.fn();
    const onconsider = vi.fn();
    const card = cardFixture();
    const { container } = render(DraftCard, {
      props: { card, presentation: 'ratings', onselect, onconsider },
    });
    const button = container.querySelector('button');
    await fireEvent.click(button as HTMLButtonElement);
    expect(onselect).toHaveBeenCalledWith(card);
    await fireEvent.pointerEnter(button as HTMLButtonElement);
    expect(onconsider).toHaveBeenCalledWith(card);
    await fireEvent.pointerLeave(button as HTMLButtonElement);
    expect(onconsider).toHaveBeenLastCalledWith(null);
  });

  it('does not reveal strength in the disabled ball-knowledge state', () => {
    const { container } = render(DraftCard, {
      props: {
        card: cardFixture(),
        presentation: 'ball-knowledge',
        disabled: true,
        reason: 'position',
      },
    });
    expect(container.textContent).not.toContain('97');
    expect(container.textContent).not.toContain('97-99');
    expect(container.textContent).toContain("Can't fill your lineup");
  });
});
