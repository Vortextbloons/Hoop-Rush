// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
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
    positionsPlayable: ['PG'],
    overall: 70,
    offense: 70,
    defense: 70,
    selectionScore: 50,
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
  it.each(['ratings', 'sandbox'] as const)(
    '%s presentation shows only the Overall badge',
    (presentation) => {
      const { getByTitle, queryByTitle } = renderPoolBrowser({ presentation });

      expect(getByTitle('Overall').textContent).toBe('O 90');
      expect(queryByTitle('Offense')).toBeNull();
      expect(queryByTitle('Defense')).toBeNull();
    },
  );

  it('ball-knowledge shows no rating badges', () => {
    const { queryByTitle, getByText } = renderPoolBrowser({ presentation: 'ball-knowledge' });

    expect(queryByTitle('Overall')).toBeNull();
    expect(queryByTitle('Offense')).toBeNull();
    expect(queryByTitle('Defense')).toBeNull();
    expect(getByText('Aaron A')).not.toBeNull();
    expect(getByText(/1996-97 ·/)).not.toBeNull();
  });

  it('shows the historical team label for a relocated franchise-era row', () => {
    const { getByText } = renderPoolBrowser({
      rows: [
        row({
          playerId: 'sea-2000s',
          displayName: 'Sonics Star',
          franchiseId: 'thunder',
          eraId: '2000s',
          seasonKey: '2005-06',
        }),
      ],
    });

    expect(getByText(/2005-06 · SEA → OKC · 2000s/)).not.toBeNull();
  });

  it('falls back to the modern abbreviation when the era has no lineage', () => {
    const { getByText } = renderPoolBrowser({
      rows: [
        row({
          playerId: 'rak-1960s',
          displayName: 'Raptor Pioneer',
          franchiseId: 'raptors',
          eraId: '1960s',
          seasonKey: '1960-61',
        }),
      ],
    });

    expect(getByText(/1960-61 · TOR · 1960s/)).not.toBeNull();
  });

  it('resets local filters when a new pool scope is revealed', async () => {
    const rowsA = [
      row({ playerId: 'a', displayName: 'Aaron A', overall: 90 }),
      row({ playerId: 'b', displayName: 'Bob B', overall: 80 }),
    ];
    const rowsB = [
      row({ playerId: 'c', displayName: 'Cara C', overall: 95 }),
      row({ playerId: 'd', displayName: 'Dan D', overall: 75 }),
    ];
    const { container, rerender } = renderPoolBrowser({
      presentation: 'ratings',
      filtersEditable: true,
      rows: rowsA,
    });

    const searchbox = container.querySelector('input[type="search"]') as HTMLInputElement;
    await fireEvent.input(searchbox, { target: { value: 'bob' } });

    await vi.waitFor(() => {
      expect(container.querySelectorAll('li')).toHaveLength(1);
    });
    expect(container.textContent).toContain('Bob B');

    await rerender({ rows: rowsB, filtersEditable: true, presentation: 'ratings' });

    expect(searchbox.value).toBe('');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('Cara C');
    expect(container.textContent).toContain('Dan D');
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
    const subject = row({ playerId: 'sub', displayName: 'Subject One', positionsPlayable: ['PG'] });
    // The only slot Subject One can fill (PG) is occupied, and the swing player
    // there is the only one who could move (to the open SF slot). That makes
    // this displace-only: blocked without displacement, "Moves …" with it.
    const filledSlots = [
      row({ playerId: 'g1', displayName: 'Guard One', positionsPlayable: ['PG'] }),
      row({ playerId: 'g2', displayName: 'Swing Two', positionsPlayable: ['PG', 'SF'] }),
      null,
      row({ playerId: 'c4', displayName: 'Center Four', positionsPlayable: ['C'] }),
      row({ playerId: 'c5', displayName: 'Center Five', positionsPlayable: ['C'] }),
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
    const subject = row({ playerId: 'sub', displayName: 'Subject One', positionsPlayable: ['PG'] });
    const filledSlots = [
      row({ playerId: 'g1', displayName: 'Guard One', positionsPlayable: ['PG'] }),
      row({ playerId: 'g2', displayName: 'Swing Two', positionsPlayable: ['PG', 'SF'] }),
      null,
      row({ playerId: 'c4', displayName: 'Center Four', positionsPlayable: ['C'] }),
      row({ playerId: 'c5', displayName: 'Center Five', positionsPlayable: ['C'] }),
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
      positionsPlayable: ['PG'],
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
      positionsPlayable: ['PG'],
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
      positionsPlayable: ['C'],
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
      positionsPlayable: ['PG'],
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

  it('announces a placement once and does not re-announce for a fresh array with identical ids', async () => {
    // Regression: previousSlots is a non-reactive snapshot. A reactive
    // snapshot re-triggers the effect after every slot reallocation, which
    // produced effect_update_depth_exceeded under parallel test runs.
    const manifest = buildManifest();
    const a = row({ playerId: 'a', displayName: 'Aaron A' });
    const b = row({ playerId: 'b', displayName: 'Barry B' });
    const props = {
      slots: [a, null, null, null, null],
      manifest,
      ready: false,
      allowRemove: false,
      onmove: vi.fn(),
      onremove: vi.fn(),
    };
    const { container, rerender } = render(LineupCourt, { props });

    await rerender({ ...props, slots: [null, b, null, null, null] });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Placed Barry B at SG.');

    // Same ids, freshly allocated array: the snapshot must prevent a repeat
    // announcement (and any effect loop).
    await rerender({ ...props, slots: [null, b, null, null, null] });
    expect(status?.textContent).toBe('Placed Barry B at SG.');
  });
});
