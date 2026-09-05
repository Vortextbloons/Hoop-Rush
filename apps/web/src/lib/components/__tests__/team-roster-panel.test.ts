import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { buildManifest, buildSeasonLeague, buildSeasonRosters } from '@hoop-rush/test-fixtures';
import type { HoopRushManifest, SeasonRoster } from '@hoop-rush/data-contracts';
import TeamRosterPanel from '$lib/components/season/TeamRosterPanel.svelte';
import { humanSeasonPlayerStats } from '$lib/season/season-player-stats-view';
import { initialSeasonRunShellData } from '$lib/season/season-shell-context';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
const MANIFEST: HoopRushManifest = buildManifest();
const ROSTER: SeasonRoster = buildSeasonRosters(
  buildSeasonLeague(),
  'roster-panel',
)[0] as SeasonRoster;
function minimalShell(): SeasonRunShellData {
  return {
    ...initialSeasonRunShellData(),
    ready: true,
    manifest: MANIFEST,
    humanFranchiseId: 'lakers',
    nextBlockIndex: 0,
  };
}
describe('TeamRosterPanel', () => {
  it('switches between overview and season stats with top tabs', async () => {
    const statsView = humanSeasonPlayerStats({
      roster: ROSTER,
      summaries: [],
      overallRatingOf: () => 80,
      playablePositions: () => ['PG'],
    });
    const { getByRole, container } = render(TeamRosterPanel, {
      props: {
        roster: ROSTER,
        manifest: MANIFEST,
        shell: minimalShell(),
        roleOf: () => ({ role: 'Starter G', minutes: 32 }),
        effects: null,
        summaries: [],
        statsView,
      },
    });
    expect(container.querySelector('[data-season-roster-list]')).toBeTruthy();
    expect(container.querySelector('[data-season-player-stats]')).toBeNull();
    await fireEvent.click(getByRole('button', { name: 'Season stats' }));
    expect(container.querySelector('[data-season-player-stats]')).toBeTruthy();
    expect(getByRole('button', { name: 'Season stats' }).getAttribute('aria-pressed')).toBe('true');
  });
});
