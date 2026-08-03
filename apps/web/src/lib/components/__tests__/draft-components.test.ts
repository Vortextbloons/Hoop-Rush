// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { PlayersIndexEntry } from '@hoop-rush/data-contracts';
import { buildManifest } from '@hoop-rush/test-fixtures';
import DraftPoolBrowser from '$lib/components/draft/DraftPoolBrowser.svelte';
import SlotPickerDialog from '$lib/components/draft/SlotPickerDialog.svelte';
import LineupCourt from '$lib/components/LineupCourt.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

function row(partial: Partial<PlayersIndexEntry> & { playerId: string }): PlayersIndexEntry {
  return {
    franchiseId: 'lakers',
    eraId: '1990s',
    seasonKey: '1996-97',
    firstName: 'Test',
    lastName: 'Player',
    displayName: 'Test Player',
    playerExternalId: '1',
    altIds: null,
    positionsCanonical: ['G'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
    heightInches: 78,
    weightLbs: 200,
    stats: {
      gamesPlayed: 80,
      minutes: 2400,
      points: 1600,
      rebounds: 800,
      offensiveRebounds: null,
      defensiveRebounds: null,
      assists: 400,
      steals: 80,
      blocks: 40,
      turnovers: 200,
      fieldGoalsMade: 600,
      fieldGoalsAttempted: 1200,
      threesMade: 100,
      threesAttempted: 250,
      freeThrowsMade: 300,
      freeThrowsAttempted: 360,
      per: 20,
      boxPlusMinus: 2,
      usageRate: 25,
      tsPct: 0.6,
      efgPct: 0.54,
    },
    ...partial,
  };
}

const EMPTY_SLOTS = [null, null, null, null, null];

function renderPoolBrowser(
  props: Partial<{
    presentation: 'sandbox' | 'ratings' | 'ball-knowledge';
    filtersEditable: boolean;
    allowDisplacement: boolean;
    rows: PlayersIndexEntry[];
  }> = {},
) {
  const manifest = buildManifest();
  return render(DraftPoolBrowser, {
    props: {
      heading: 'LAL · 1990s',
      rows: props.rows ?? [row({ playerId: 'a', displayName: 'Aaron A', overall: 90 })],
      slots: EMPTY_SLOTS,
      countLabel: '1 players · sorted by OVER',
      filtersEditable: props.filtersEditable ?? false,
      manifest,
      presentation: props.presentation ?? 'ratings',
      error: null,
      emptyMessage: 'No players in this pool.',
      allowDisplacement: props.allowDisplacement ?? false,
      onpick: vi.fn(),
    },
  });
}

describe('DraftPoolBrowser parity', () => {
  it('ratings presentation shows Overall, Offense, and Defense badges', () => {
    const { getByTitle } = renderPoolBrowser({ presentation: 'ratings' });

    expect(getByTitle('Overall').textContent).toBe('O 90');
    expect(getByTitle('Offense').textContent).toBe('OFF 70');
    expect(getByTitle('Defense').textContent).toBe('DEF 70');
  });

  it('ball-knowledge hides Overall but keeps Offense and Defense', () => {
    const { queryByTitle, getByTitle } = renderPoolBrowser({ presentation: 'ball-knowledge' });

    expect(queryByTitle('Overall')).toBeNull();
    expect(getByTitle('Offense').textContent).toBe('OFF 70');
    expect(getByTitle('Defense').textContent).toBe('DEF 70');
  });

  it('filtersEditable=false renders no search box', () => {
    const { queryByRole } = renderPoolBrowser({ filtersEditable: false });

    expect(queryByRole('searchbox', { name: 'Search players by name' })).toBeNull();
  });

  it('renders rows in the passed order without re-sorting', () => {
    const zed = row({ playerId: 'z', displayName: 'Zed Zoster', overall: 99 });
    const aaron = row({ playerId: 'a', displayName: 'Aaron Aardvark', overall: 1 });
    const { container } = renderPoolBrowser({ rows: [zed, aaron] });

    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain('Zed Zoster');
    expect(items[1]?.textContent).toContain('Aaron Aardvark');
  });

  it('with allowDisplacement=false a displace-only pool card shows the blocked state instead', () => {
    const subject = row({ playerId: 'sub', displayName: 'Subject One', positionsCanonical: ['G'] });
    // The only slot Subject One can fill (PG) is occupied, and the swing player
    // there is the only one who could move (to the open SF slot). That makes
    // this displace-only: blocked without displacement, "Moves …" with it.
    const filledSlots = [
      row({ playerId: 'g1', displayName: 'Guard One', positionsCanonical: ['G'] }),
      row({ playerId: 'g2', displayName: 'Swing Two', positionsCanonical: ['G', 'F'] }),
      null,
      row({ playerId: 'c4', displayName: 'Center Four', positionsCanonical: ['C'] }),
      row({ playerId: 'c5', displayName: 'Center Five', positionsCanonical: ['C'] }),
    ];
    const manifest = buildManifest();
    const { container } = render(DraftPoolBrowser, {
      props: {
        heading: 'LAL · 1990s',
        rows: [subject],
        slots: filledSlots,
        countLabel: '1 players · sorted by OVER',
        filtersEditable: false,
        manifest,
        presentation: 'ratings',
        error: null,
        emptyMessage: 'No players in this pool.',
        allowDisplacement: false,
        onpick: vi.fn(),
      },
    });

    const card = container.querySelector('li button') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.textContent).toContain('No slot');
    expect(card.textContent).not.toContain('Moves');
  });

  it('with allowDisplacement=true the same displace-only card shows the Moves hint', () => {
    const subject = row({ playerId: 'sub', displayName: 'Subject One', positionsCanonical: ['G'] });
    const filledSlots = [
      row({ playerId: 'g1', displayName: 'Guard One', positionsCanonical: ['G'] }),
      row({ playerId: 'g2', displayName: 'Swing Two', positionsCanonical: ['G', 'F'] }),
      null,
      row({ playerId: 'c4', displayName: 'Center Four', positionsCanonical: ['C'] }),
      row({ playerId: 'c5', displayName: 'Center Five', positionsCanonical: ['C'] }),
    ];
    const manifest = buildManifest();
    const { container } = render(DraftPoolBrowser, {
      props: {
        heading: 'LAL · 1990s',
        rows: [subject],
        slots: filledSlots,
        countLabel: '1 players · sorted by OVER',
        filtersEditable: false,
        manifest,
        presentation: 'ratings',
        error: null,
        emptyMessage: 'No players in this pool.',
        allowDisplacement: true,
        onpick: vi.fn(),
      },
    });

    const card = container.querySelector('li button') as HTMLButtonElement;
    expect(card.disabled).toBe(false);
    expect(card.textContent).toContain('Moves');
  });
});

describe('SlotPickerDialog swap state', () => {
  function renderPicker(props: { allowDisplacement: boolean; incumbent: PlayersIndexEntry }) {
    const manifest = buildManifest();
    const subject = row({
      playerId: 'sub',
      displayName: 'Subject One',
      positionsCanonical: ['G'],
    });
    return render(SlotPickerDialog, {
      props: {
        player: subject,
        slots: [subject, props.incumbent, null, null, null],
        manifest,
        presentation: 'ratings',
        allowDisplacement: props.allowDisplacement,
        onplace: vi.fn(),
        onclose: vi.fn(),
      },
    });
  }

  it('allowDisplacement=false swaps when the incumbent can fill the subject slot', () => {
    const incumbent = row({
      playerId: 'inc',
      displayName: 'Incumbent Two',
      positionsCanonical: ['G'],
    });
    const { getByRole } = renderPicker({ allowDisplacement: false, incumbent });

    const swap = getByRole('button', {
      name: 'Swap Subject One with Incumbent Two at Shooting Guard slot 2',
    });
    expect(swap.textContent).toContain('Swap');
    expect((swap as HTMLButtonElement).disabled).toBe(false);
  });

  it('allowDisplacement=false blocks a slot whose incumbent cannot fill the subject slot', () => {
    const incumbent = row({
      playerId: 'inc',
      displayName: 'Incumbent Two',
      positionsCanonical: ['C'],
    });
    const { getByRole } = renderPicker({ allowDisplacement: false, incumbent });

    const blocked = getByRole('button', {
      name: 'Shooting Guard slot 2 occupied by Incumbent Two',
    });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect(blocked.textContent).toContain('Occupied');
  });

  it('allowDisplacement=true shows the displace option instead of a swap', () => {
    const incumbent = row({
      playerId: 'inc',
      displayName: 'Incumbent Two',
      positionsCanonical: ['G'],
    });
    const { getByRole, queryByRole } = renderPicker({ allowDisplacement: true, incumbent });

    expect(
      queryByRole('button', {
        name: 'Swap Subject One with Incumbent Two at Shooting Guard slot 2',
      }),
    ).toBeNull();
    const displace = getByRole('button', {
      name: 'Place Subject One at Shooting Guard slot 2, moving Incumbent Two to Point Guard slot 1',
    });
    expect(displace.textContent).toContain('Moves');
    expect((displace as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('LineupCourt allowRemove', () => {
  function renderCourt(props: { allowRemove?: boolean }) {
    const manifest = buildManifest();
    const player = row({ playerId: 'a', displayName: 'Aaron A' });
    return render(LineupCourt, {
      props: {
        slots: [player, null, null, null, null],
        manifest,
        ready: false,
        allowRemove: props.allowRemove,
        onmove: vi.fn(),
        onremove: vi.fn(),
      },
    });
  }

  it('allowRemove=false renders no Remove buttons', () => {
    const { container } = renderCourt({ allowRemove: false });

    expect(container.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(0);
  });

  it('omitting allowRemove keeps the Remove button', () => {
    const { container } = renderCourt({});

    expect(container.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(1);
  });
});
