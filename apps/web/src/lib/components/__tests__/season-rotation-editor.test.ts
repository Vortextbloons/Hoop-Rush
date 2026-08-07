// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import { createRotationEditor, type RotationMember } from '$lib/season/season-rotation-editor';
import {
  CANDIDATES,
  legalRotation,
  rotationMembers,
} from '$lib/season/season-rotation-test-support';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * RotationEditor component tests (M2.3 hub, M2.3.5 team workspace): preset
 * buttons, minute steppers, the invalid-rotation alert, the compact mobile
 * rows (bench controls, closing-five toggles, 44px steppers), and per-player failure
 * placement. The editor's engine-validated commits are unit-tested in
 * season-rotation-editor.test.ts; here we verify the wiring. The component
 * renders both the compact (mobile) and the desktop workspace layouts; the
 * CSS breakpoints decide which is visible.
 */

function members(): RotationMember[] {
  return rotationMembers();
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

/** The compact (mobile) player-rows list (Minutes tab). */
function compactRowsList(container: HTMLElement) {
  const section = container.querySelector('section[aria-labelledby="mobile-rotation-heading"]');
  if (section === null) throw new Error('mobile rotation section missing');
  return within(section as HTMLElement);
}

describe('RotationEditor component', () => {
  it('shows the minute total and the bench members in the compact layout', async () => {
    const { getByText, getByRole, container } = renderEditor();
    const total = container.querySelector('p strong');
    expect(total?.textContent).toBe('240');
    expect(container.querySelector('#mobile-rotation-heading')?.textContent).toContain(
      'Bench order',
    );
    expect(getByRole('heading', { name: 'Starters' })).not.toBeNull();
    expect(getByText(/Closing five/)).not.toBeNull();
    // The compact Bench tab keeps the narrow layout focused on reserve controls.
    await fireEvent.click(getByRole('button', { name: 'Bench' }));
    expect(compactRowsList(container).getAllByRole('group', { name: /Minutes for/ })).toHaveLength(
      5,
    );
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
    const first = editor.rotation.benchOrder[0];
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
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(17);
  });

  it('closing-five selects swap players while keeping five selected', async () => {
    const { editor, onchange, container, getByRole } = renderEditor();
    const bench = editor.rotation.benchOrder[0];
    if (bench === undefined) {
      throw new Error('fixture rotation has no bench player');
    }
    const originalSlot1 = editor.rotation.closingFive[1];
    if (originalSlot1 === undefined) {
      throw new Error('closing five missing slot 1');
    }
    await fireEvent.click(getByRole('button', { name: 'Closing' }));
    const select = container.querySelector(
      'select[aria-label="Closing slot 2"]',
    ) as HTMLSelectElement;
    await fireEvent.change(select, { target: { value: bench } });
    expect(onchange).toHaveBeenCalledTimes(1);
    expect(editor.rotation.closingFive).toHaveLength(5);
    expect(editor.rotation.closingFive.includes(bench)).toBe(true);
    await fireEvent.change(select, { target: { value: originalSlot1 } });
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

  it('surfaces per-player audit failures beside the affected row', async () => {
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
    // The compact Starters section carries the failure for the invalid starter.
    await fireEvent.click(within(container).getByRole('button', { name: 'Starters' }));
    const compact = compactRowsList(container);
    const row = compact.getByText(/cannot play slot/).closest('li');
    expect(row).not.toBeNull();
    expect(row?.textContent ?? '').toMatch(/cannot play slot/);
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
    for (const select of getAllByRole('combobox')) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
    }
  });
});
