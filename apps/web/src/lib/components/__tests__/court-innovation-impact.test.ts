import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import CourtInnovationImpact from '$lib/components/season/CourtInnovationImpact.svelte';
import type { SeasonInnovationImpact } from '$lib/season/season-innovation-impact-view';

const impact: SeasonInnovationImpact = {
  rule: 'deep-four',
  displayName: 'Deep Four',
  games: [
    {
      gameId: 's000001',
      round: 10,
      opponentFranchiseId: 'celtics',
      homeScore: 112,
      awayScore: 100,
      result: 'W',
      margin: 12,
      possessions: 100,
      pointsPer100: 112,
      detailAvailable: true,
    },
  ],
  wins: 1,
  losses: 0,
  averageMargin: 12,
  pointsPer100: 112,
  evidence: {
    kind: 'deep-four',
    attempts: 5,
    makes: 2,
    points: 8,
  },
};

describe('CourtInnovationImpact', () => {
  it('leads with observed results and rule-specific evidence', () => {
    const { container } = render(CourtInnovationImpact, {
      props: {
        impact,
        franchiseName: (franchiseId: string) => franchiseId,
      },
    });

    const section = container.querySelector('[data-season-court-impact]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('Deep Four');
    expect(section?.textContent).toContain('1–0');
    expect(section?.textContent).toContain('2/5');
    expect(section?.textContent).toContain('8 pts');
    expect(section?.textContent).toContain('simulated alternate outcome');
    expect(section?.querySelector('a[href="#box-score-s000001"]')).not.toBeNull();
  });
});
