import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import type { DraftFitScore } from '@hoop-rush/engine';
import { buildPlayerSeason } from '@hoop-rush/test-fixtures';
import DraftValuePanel from '$lib/components/DraftValuePanel.svelte';

function fitScore(playerId: string, displayName: string, overrides: Partial<DraftFitScore> = {}) {
  return {
    playerId,
    displayName,
    baseOverall: 90,
    heuristicFitDelta: 0,
    netDelta: 2,
    worstNetDelta: 1,
    netRating: 1,
    tier: 'strong',
    primaryNeed: 'balance',
    reasonLabel: 'Balanced fit',
    warningLabel: null,
    recommendedSlot: null,
    rearrangementCount: 0,
    reasons: [],
    refined: true,
    ...overrides,
  } satisfies DraftFitScore;
}

describe('DraftValuePanel', () => {
  it('shows one suggestion per player when a pool repeats a player across seasons', () => {
    const { container } = render(DraftValuePanel, {
      props: {
        players: [],
        poolScores: [
          fitScore('p-1629029', 'Star Wing'),
          fitScore('p-1629029', 'Star Wing'),
          fitScore('p-764', 'Big Man'),
          fitScore('p-764', 'Big Man', { netDelta: -2, tier: 'situational' }),
          fitScore('p-23', 'Point Guard'),
          fitScore('p-33', 'Shooting Guard'),
          fitScore('p-44', 'Center'),
        ],
      },
    });
    const suggestions = container.querySelectorAll('[data-fit-top] li');
    expect(suggestions).toHaveLength(5);
    const names = [...suggestions].map((item) => item.textContent);
    expect(names.filter((name) => name.includes('Star Wing'))).toHaveLength(1);
    expect(names.filter((name) => name.includes('Big Man'))).toHaveLength(1);
  });

  it('renders a lineup that repeats a player identity without duplicate keys', () => {
    const repeated = buildPlayerSeason({
      playerId: playerIdSchema.parse('p-764'),
      displayName: 'Repeated Star',
    });
    const other = buildPlayerSeason({
      playerId: playerIdSchema.parse('p-1'),
      displayName: 'Role Player',
    });
    const { container } = render(DraftValuePanel, {
      props: { players: [repeated, other, repeated] },
    });
    const rows = container.querySelectorAll('ul li');
    expect(rows).toHaveLength(3);
    expect([...rows].filter((row) => row.textContent.includes('Repeated Star'))).toHaveLength(2);
  });

  it('renders the hidden-ratings lineup with repeated identities too', () => {
    const repeated = buildPlayerSeason({
      playerId: playerIdSchema.parse('p-764'),
      displayName: 'Repeated Star',
    });
    const { container } = render(DraftValuePanel, {
      props: { players: [repeated, repeated], presentation: 'ball-knowledge' },
    });
    expect(container.textContent).toContain('Repeated Star');
    expect(container.textContent).toContain('Ratings hidden');
  });
});
