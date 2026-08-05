// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import { createRotationEditor, type RotationMember } from '$lib/season/season-rotation-editor';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * RotationEditor component tests (M2.3 hub, M2.3.5 team workspace): preset
 * buttons, minute steppers, the invalid-rotation alert, the compact mobile
 * rows (closing-five toggles, 44px steppers), and per-player failure
 * placement. The editor's engine-validated commits are unit-tested in
 * season-rotation-editor.test.ts; here we verify the wiring. The component
 * renders both the compact (mobile) and the desktop workspace layouts; the
 * CSS breakpoints decide which is visible.
 */

const CATALOG = buildSeasonDraftCatalog({
  franchiseIds: ['lakers'],
  eras: ['1990s'],
  playersPerPool: 10,
});
const POOL = CATALOG.pools[0];
if (POOL === undefined) {
  throw new Error('fixture catalog has no pool');
}
const CANDIDATES = POOL.playerVersionIds.map((id) => {
  const candidate = CATALOG.candidates.find((c) => c.playerVersionId === id);
  if (candidate === undefined) {
    throw new Error(`fixture catalog misses candidate ${id}`);
  }
  return candidate;
});

function members(): RotationMember[] {
  return CANDIDATES.map((candidate) => ({
    playerVersionId: candidate.playerVersionId,
    displayName: candidate.displayName,
    playable: candidate.positions.playable,
  }));
}

function legalRotation(): SeasonRotation {
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: members().map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: member.playable,
    })),
  });
}

function renderEditor(overrides: { minutes?: Array<[string, number]> } = {}) {
  const rotation = legalRotation();
  if (overrides.minutes) {
    for (const [playerVersionId, minutes] of overrides.minutes) {
      rotation.targetMinutes = rotation.targetMinutes.map((entry) =>
        entry.playerVersionId === playerVersionId ? { ...entry, minutes } : entry,
      );
    }
  }
  const editor = createRotationEditor(rotation, members());
  const onchange = vi.fn();
  const result = render(RotationEditor, {
    props: { editor, disabled: false, onchange },
  });
  return { editor, onchange, ...result };
}

/** The desktop "Target minutes" list (the compact rows are the mobile list). */
function desktopMinutesList(container: HTMLElement) {
  const section = container.querySelector('section[aria-labelledby="minutes-heading"]');
  if (section === null) throw new Error('desktop minutes section missing');
  return within(section as HTMLElement);
}

/** The compact (mobile) player-rows list. */
function compactRowsList(container: HTMLElement) {
  const section = container.querySelector('section[aria-labelledby="compact-rows-heading"]');
  if (section === null) throw new Error('compact rows section missing');
  return within(section as HTMLElement);
}

describe('RotationEditor component', () => {
  it('shows the minute total and every roster member in both layouts', () => {
    const { getByText, container } = renderEditor();
    const total = container.querySelector('p strong');
    expect(total?.textContent).toBe('240');
    expect(getByText('Starters')).not.toBeNull();
    expect(getByText('Bench order')).not.toBeNull();
    expect(getByText(/Closing five/)).not.toBeNull();
    // The compact mobile layout renders ten player rows too.
    expect(
      compactRowsList(container).getAllByRole('group', {
        name: /Minutes for/,
      }),
    ).toHaveLength(10);
  });

  it('applies a preset through the engine and reports the new rotation', async () => {
    const { onchange, getByRole } = renderEditor();
    await fireEvent.click(getByRole('button', { name: 'Balanced' }));
    expect(onchange).toHaveBeenCalledTimes(1);
    const [rotation, failures] = onchange.mock.calls[0] as [SeasonRotation, string[]];
    expect(failures).toEqual([]);
    expect(
      rotation.targetMinutes.find((t) => t.playerVersionId === rotation.starters[0])?.minutes,
    ).toBe(33);
    expect(
      rotation.targetMinutes.find((t) => t.playerVersionId === rotation.benchOrder[0])?.minutes,
    ).toBe(21);
  });

  it('increments and decrements one player target minute, keeping the 240 total', async () => {
    const { editor, onchange, container } = renderEditor();
    const first = editor.rotation.starters[0];
    const label = first === undefined ? undefined : editor.names.get(first);
    if (first === undefined || label === undefined) {
      throw new Error('fixture rotation has no first starter');
    }
    const minutes = desktopMinutesList(container);
    await fireEvent.click(minutes.getByRole('button', { name: `Increase minutes for ${label}` }));
    let [rotation] = onchange.mock.calls.at(-1) as [SeasonRotation, string[]];
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(33);
    await fireEvent.click(minutes.getByRole('button', { name: `Decrease minutes for ${label}` }));
    [rotation] = onchange.mock.calls.at(-1) as [SeasonRotation, string[]];
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(32);
    const total = rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
    expect(total).toBe(240);
    expect(container.querySelector('p strong')?.textContent).toBe('240');
  });

  it('compact rows adjust minutes with touch-sized steppers', async () => {
    const { editor, onchange, container } = renderEditor();
    const first = editor.rotation.starters[0];
    const label = first === undefined ? undefined : editor.names.get(first);
    if (first === undefined || label === undefined) {
      throw new Error('fixture rotation has no first starter');
    }
    const compact = compactRowsList(container);
    const increase = compact.getByRole('button', {
      name: `Increase minutes for ${label}`,
    });
    expect(increase.classList.contains('h-11')).toBe(true);
    expect(increase.classList.contains('w-11')).toBe(true);
    await fireEvent.click(increase);
    const [rotation] = onchange.mock.calls.at(-1) as [SeasonRotation, string[]];
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(33);
  });

  it('closing-five toggles swap players in and out while keeping five selected', async () => {
    const { editor, onchange, container } = renderEditor();
    const bench = editor.rotation.benchOrder[0];
    const label = bench === undefined ? undefined : editor.names.get(bench);
    if (bench === undefined || label === undefined) {
      throw new Error('fixture rotation has no bench player');
    }
    const compact = compactRowsList(container);
    const add = compact.getByRole('button', {
      name: `Add ${label} to the closing five`,
    });
    await fireEvent.click(add);
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(editor.rotation.closingFive).toHaveLength(5);
    expect(editor.rotation.closingFive.includes(bench)).toBe(true);
    const remove = compact.getByRole('button', {
      name: `Remove ${label} from the closing five`,
    });
    expect(remove.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(remove);
    expect(editor.rotation.closingFive).toHaveLength(5);
    expect(editor.rotation.closingFive.includes(bench)).toBe(false);
    expect(editor.validate()).toEqual([]);
  });

  it('an illegal starter swap is rejected by the engine and surfaced', async () => {
    const { editor, onchange, container } = renderEditor();
    const centerOnly = CANDIDATES.find(
      (candidate) =>
        candidate.positions.playable.length === 1 && candidate.positions.playable[0] === 'C',
    );
    if (centerOnly === undefined) {
      throw new Error('fixture catalog has no center-only candidate');
    }
    const starters = desktopMinutesList(container);
    void starters;
    const select = container.querySelector(
      'select[aria-label="Starter slot 1"]',
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: centerOnly.playerVersionId } });
    // The engine rejects the swap; the rotation is unchanged and the page
    // reports the rejection.
    expect(editor.rotation.starters[0]).not.toBe(centerOnly.playerVersionId);
    expect(onchange).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent ?? '').toMatch(/rejected/);
  });

  it('surfaces per-player audit failures beside the affected row', () => {
    const editor = createRotationEditor(legalRotation(), members());
    // Promote a bench player who cannot play a guard slot into starter slot 0,
    // demoting the incumbent guard to the bench. The audit fails per-player
    // ("starter {id} cannot play slot 0") while the partition stays unique.
    const bench = editor.rotation.benchOrder.find((id) => {
      const candidate = CANDIDATES.find((c) => c.playerVersionId === id);
      if (candidate === undefined) {
        throw new Error(`fixture catalog misses candidate ${id}`);
      }
      return (
        !candidate.positions.playable.includes('PG') && !candidate.positions.playable.includes('SG')
      );
    });
    if (bench === undefined) {
      throw new Error('fixture rotation has no non-guard bench player');
    }
    const guard = editor.rotation.starters[0];
    if (guard === undefined) {
      throw new Error('fixture rotation has no first starter');
    }
    const brokenRotation: SeasonRotation = {
      ...editor.rotation,
      starters: [bench, ...editor.rotation.starters.slice(1)],
      benchOrder: [...editor.rotation.benchOrder.filter((id) => id !== bench), guard],
    };
    const broken = createRotationEditor(brokenRotation, members());
    expect(broken.validate().length).toBeGreaterThan(0);
    const benchName = broken.names.get(bench);
    if (benchName === undefined) {
      throw new Error('fixture rotation has no name for the bench player');
    }

    const { container } = render(RotationEditor, {
      props: { editor: broken, disabled: false, onchange: vi.fn() },
    });
    // The compact row for the offending player carries the failure.
    const compact = compactRowsList(container);
    const row = compact.getByText(benchName).closest('li');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toMatch(/cannot play slot/);
    expect(row?.querySelector('ul')?.textContent ?? '').toMatch(/cannot play slot/);
    // The desktop starter select for the offending player is marked invalid.
    const select = container.querySelector('select[aria-label="Starter slot 1"]');
    expect(select?.getAttribute('aria-invalid')).toBe('true');
  });

  it('surfaces the invalid-rotation alert when the audit fails', () => {
    const editor = createRotationEditor(legalRotation(), members());
    // Break the 240 total: give the first starter 48 (33+32... total 256).
    const first = editor.rotation.starters[0];
    if (first === undefined) {
      throw new Error('fixture rotation has no first starter');
    }
    editor.setMinutes(first, 48);
    const { getByText } = render(RotationEditor, {
      props: { editor, disabled: false, onchange: vi.fn() },
    });
    expect(getByText('This rotation cannot be submitted:')).not.toBeNull();
  });

  it('disables every control while a block is running', () => {
    const { getByRole, getAllByRole } = render(RotationEditor, {
      props: {
        editor: createRotationEditor(legalRotation(), members()),
        disabled: true,
        onchange: vi.fn(),
      },
    });
    const preset = getByRole('button', { name: 'Balanced' }) as HTMLButtonElement;
    expect(preset.disabled).toBe(true);
    for (const button of getAllByRole('button', { name: /Increase minutes/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    for (const button of getAllByRole('button', { name: /closing five/ })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    for (const select of getAllByRole('combobox')) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }
  });
});
