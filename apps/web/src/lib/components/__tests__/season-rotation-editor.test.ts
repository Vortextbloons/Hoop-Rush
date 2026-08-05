// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import { createRotationEditor, type RotationMember } from '$lib/season/season-rotation-editor';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

/**
 * RotationEditor component tests (M2.3 hub): preset buttons, minute steppers,
 * and the invalid-rotation alert. The editor's engine-validated commits are
 * unit-tested in season-rotation-editor.test.ts; here we verify the wiring.
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

describe('RotationEditor component', () => {
  it('shows the minute total and every roster member', () => {
    const { getByText, container } = renderEditor();
    // The strong wraps the reactive total, so assert on its textContent.
    const total = container.querySelector('p strong');
    expect(total?.textContent).toBe('240');
    expect(getByText('Starters')).not.toBeNull();
    expect(getByText('Bench order')).not.toBeNull();
    expect(getByText(/Closing five/)).not.toBeNull();
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
    const { editor, onchange, getByRole, container } = renderEditor();
    const first = editor.rotation.starters[0];
    const label = first === undefined ? undefined : editor.names.get(first);
    if (first === undefined || label === undefined) {
      throw new Error('fixture rotation has no first starter');
    }
    await fireEvent.click(getByRole('button', { name: `Increase minutes for ${label}` }));
    let [rotation] = onchange.mock.calls.at(-1) as [SeasonRotation, string[]];
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(33);
    await fireEvent.click(getByRole('button', { name: `Decrease minutes for ${label}` }));
    [rotation] = onchange.mock.calls.at(-1) as [SeasonRotation, string[]];
    expect(rotation.targetMinutes.find((t) => t.playerVersionId === first)?.minutes).toBe(32);
    // The compensating player absorbed the minute, so the total stays 240.
    const total = rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
    expect(total).toBe(240);
    expect(container.querySelector('p strong')?.textContent).toBe('240');
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
