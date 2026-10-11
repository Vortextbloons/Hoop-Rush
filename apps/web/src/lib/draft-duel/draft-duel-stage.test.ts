// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { draftDuelCardSchema } from '@hoop-rush/data-contracts';
import DraftBoard from './DraftBoard.svelte';
import RosterRail from './RosterRail.svelte';
import ReactionBar from './ReactionBar.svelte';
import RivalConsideration from './RivalConsideration.svelte';

const card = draftDuelCardSchema.parse({
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
});

const offers = Array.from({ length: 8 }, (_, slot) => ({
  slot,
  card,
  available: slot < 6,
  reason: slot < 6 ? null : ('claimed' as const),
  legalSlots: slot < 6 ? [0, 1] : [],
}));

describe('draft-duel components smoke', () => {
  it('renders the board and reports the chosen card', async () => {
    const onchoose = vi.fn();
    const { container } = render(DraftBoard, {
      props: { offers, active: true, round: 2, presentation: 'ratings', onchoose },
    });
    const slots = container.querySelectorAll('.dd-board-slot');
    expect(slots).toHaveLength(8);
    expect(container.textContent).toContain('Round 2 of 5');
    const style = container.querySelector('section')?.getAttribute('style') ?? '';
    expect(style).toContain('--dd-pick-ms');
    const first = slots[0]?.querySelector('button');
    await fireEvent.click(first as HTMLButtonElement);
    expect(onchoose).toHaveBeenCalledTimes(1);
    expect(onchoose).toHaveBeenCalledWith(expect.objectContaining({ slot: 0 }));
    const disabled = slots[6]?.querySelector('button');
    await fireEvent.click(disabled as HTMLButtonElement);
    expect(onchoose).toHaveBeenCalledTimes(1);
  });

  it('renders the roster rail in both presentations', () => {
    const roster = { participantId: 'p1' as const, slots: [{ slotIndex: 0, card }] };
    const ratings = render(RosterRail, { props: { roster, presentation: 'ratings' } });
    expect(ratings.container.textContent).toContain('Test Player');
    expect(ratings.container.textContent).toContain('Point Guard');
    expect(ratings.container.querySelectorAll('li')).toHaveLength(5);
    expect(ratings.container.querySelector('[data-filled="false"]')).not.toBeNull();
  });

  it('toggles mute and emits reactions', async () => {
    const onreact = vi.fn();
    const onmute = vi.fn();
    const { container, getByLabelText } = render(ReactionBar, {
      props: { onreact, onmute },
    });
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(5);
    await fireEvent.click(getByLabelText('React Hype'));
    expect(onreact).toHaveBeenCalledWith('hype');
    const mute = container.querySelector('.dd-react-mute');
    await fireEvent.click(mute as HTMLButtonElement);
    expect(onmute).toHaveBeenCalledWith(true);
    expect(mute?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows rival consideration only when present', async () => {
    const { container, rerender } = render(RivalConsideration, { props: { consideration: null } });
    expect(container.textContent).toBe('');
    await rerender({ consideration: { displayName: 'Alpha Player', seasonKey: '1980-81' } });
    expect(container.textContent).toContain('Alpha Player');
    expect(container.textContent).toContain('1980-81');
  });
});
