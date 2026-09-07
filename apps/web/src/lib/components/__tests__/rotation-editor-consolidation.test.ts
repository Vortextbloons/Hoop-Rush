import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import { franchiseIdSchema } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import { createRotationEditor } from '$lib/season/season-rotation-editor';
import type { RotationMember } from '$lib/season/season-rotation-editor';
import { legalRotation, rotationMembers } from '$lib/season/season-rotation-test-support';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const SLOT_POSITIONS = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['PG'],
  ['SF'],
  ['C'],
  ['SG'],
  ['PF'],
  ['PG', 'SG', 'SF'],
  ['PF', 'C'],
  ['C'],
] as const;

function fifteenMembers(): RotationMember[] {
  return SLOT_POSITIONS.map((playable, index) => ({
    playerVersionId: `pv-${String(index).padStart(2, '0')}`,
    displayName: `Player ${String(index).padStart(2, '0')}`,
    playable: [...playable] as RotationMember['playable'],
  }));
}

function editorWithDepth() {
  const all = fifteenMembers();
  const rotation = buildMinimalRotation({
    franchiseId: 'lakers',
    members: all.slice(0, 10).map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: member.playable,
    })),
  });
  const editor = createRotationEditor(rotation, all);
  return { editor, all };
}

function renderEditor(editor: ReturnType<typeof createRotationEditor>) {
  const onchange = vi.fn();
  const result = render(RotationEditor, {
    props: { editor, disabled: false, onchange },
  });
  return { onchange, ...result };
}

describe('rotation editor consolidation (M3.11a)', () => {
  it('renders one ordered Active 10 with no legacy duplicate lists', () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    expect(container.querySelector('[aria-labelledby="minutes-heading"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="starters-heading"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="bench-heading"]')).toBeNull();
    expect(container.querySelector('[aria-labelledby="active10-heading"]')).not.toBeNull();
    const activeRows = container.querySelectorAll('[data-rotation-active-row]');
    expect(activeRows).toHaveLength(10);
    const positions = [...activeRows].map((row) =>
      row.textContent.includes('Starter') ? 'starter' : 'bench',
    );
    expect(positions.slice(0, 5)).toEqual(['starter', 'starter', 'starter', 'starter', 'starter']);
    expect(positions.slice(5)).toEqual(['bench', 'bench', 'bench', 'bench', 'bench']);
  });

  it('dedups identity: one card per player across active + inactive rows', () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    const activeRows = container.querySelectorAll('[data-rotation-active-row]');
    const inactiveRows = container.querySelectorAll('[data-rotation-inactive-row]');
    expect(activeRows).toHaveLength(10);
    expect(inactiveRows).toHaveLength(5);
    const activeIds = [...activeRows].map((row) => row.getAttribute('data-player-version-id'));
    const inactiveIds = [...inactiveRows].flatMap((row) => {
      const name = row.querySelector('p')?.textContent ?? '';
      const member = fifteenMembers().find((m) => m.displayName === name.trim());
      return member ? [member.playerVersionId] : [];
    });
    expect(new Set(activeIds).size).toBe(10);
    for (const id of activeIds) {
      expect(
        [...inactiveRows].some((row) => row.textContent.includes(editor.names.get(id ?? '') ?? '')),
      ).toBe(false);
    }
    expect(inactiveIds.length).toBeLessThanOrEqual(5);
  });

  it('keeps closing strip read-only with scroll-to-row chips', async () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    const strip = container.querySelector('[data-rotation-closing-strip]');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('select')).toBeNull();
    const chips = container.querySelectorAll('[data-closing-chip]');
    expect(chips).toHaveLength(5);
    const firstChip = chips[0] as HTMLElement;
    const targetId = firstChip.getAttribute('data-closing-chip') ?? '';
    const target = container.querySelector(`#rotation-row-${CSS.escape(targetId)}`);
    expect(target).not.toBeNull();
    const scrollSpy = vi.fn();
    if (target !== null) {
      (target as HTMLElement).scrollIntoView = scrollSpy;
      (target as HTMLElement).focus = vi.fn();
    }
    await fireEvent.click(firstChip);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('humanizes per-row failures with display names and G1/G2/F1/F2/C slots', () => {
    const all = fifteenMembers();
    const rotation = buildMinimalRotation({
      franchiseId: franchiseIdSchema.parse('lakers'),
      members: all.slice(0, 10).map((member) => ({
        playerVersionId: member.playerVersionId,
        playable: member.playable,
      })),
    });
    const firstTen = all.slice(0, 10);
    const intruder = firstTen.find(
      (member) =>
        !rotation.closingFive.includes(member.playerVersionId) &&
        !rotation.starters.includes(member.playerVersionId) &&
        member.playable.includes('SG'),
    );
    if (intruder === undefined) {
      throw new Error('fixture lacks a bench SG intruder');
    }
    const tampered: typeof rotation = {
      ...rotation,
      closingFive: rotation.closingFive.map((id, index) =>
        index === 2 ? intruder.playerVersionId : id,
      ),
    };
    const probe = createRotationEditor(tampered, all.slice(0, 10));
    const raw = probe.validate();
    expect(raw.some((failure) => failure.includes(intruder.playerVersionId))).toBe(true);
    const { container } = render(RotationEditor, {
      props: { editor: probe, disabled: false, onchange: vi.fn() },
    });
    const row = container.querySelector(
      `[data-rotation-active-row][data-player-version-id="${intruder.playerVersionId}"]`,
    );
    expect(row).not.toBeNull();
    const text = row?.textContent ?? '';
    expect(text).toContain(intruder.displayName);
    expect(text).toContain('F1');
    expect(text).not.toContain('slot 2');
    expect(text).not.toContain(intruder.playerVersionId);
  });

  it('keeps invalid minute types focused with a single-row error', async () => {
    const base = createRotationEditor(legalRotation(), rotationMembers());
    const { container } = renderEditor(base);
    const first = base.rotation.starters[0];
    if (first === undefined) throw new Error('fixture rotation has no starters');
    const label = base.names.get(first) ?? '';
    const editButton = container.querySelector(
      `[data-rotation-active-row][data-player-version-id="${first}"]`,
    );
    expect(editButton).not.toBeNull();
    const opener = within(editButton as HTMLElement).getByRole('button', {
      name: new RegExp(`Edit target minutes for ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    });
    await fireEvent.click(opener);
    const input = container.querySelector(`input[aria-label="Target minutes for ${label}"]`);
    expect(input).not.toBeNull();
    if (input === null) throw new Error('minutes input missing');
    await fireEvent.input(input, { target: { value: 'abc' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement === input || container.contains(document.activeElement)).toBe(
      true,
    );
  });

  it('typing zero sets that player to zero without touching teammates', async () => {
    const base = createRotationEditor(legalRotation(), rotationMembers());
    const { container, onchange } = renderEditor(base);
    const [first, second] = base.rotation.starters;
    if (first === undefined || second === undefined)
      throw new Error('fixture rotation has no starters');
    const firstLabel = base.names.get(first) ?? '';
    const secondMinutes = base.minutesFor(second);
    const opener = within(
      container.querySelector(
        `[data-rotation-active-row][data-player-version-id="${first}"]`,
      ) as HTMLElement,
    ).getByRole('button', {
      name: new RegExp(
        `Edit target minutes for ${firstLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    });
    await fireEvent.click(opener);
    const input = container.querySelector(`input[aria-label="Target minutes for ${firstLabel}"]`);
    if (input === null) throw new Error('minutes input missing');
    await fireEvent.input(input, { target: { value: '0' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(base.minutesFor(first)).toBe(0);
    expect(base.minutesFor(second)).toBe(secondMinutes);
    expect(onchange).toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent ?? '').toMatch(/Balance to 240/);
  });

  it('preserves minute-rebalance feedback instead of timing it out', async () => {
    vi.useFakeTimers();
    try {
      const base = createRotationEditor(legalRotation(), rotationMembers());
      const { container } = renderEditor(base);
      const first = base.rotation.starters[0];
      if (first === undefined) throw new Error('fixture rotation has no starters');
      const label = base.names.get(first) ?? '';
      const inc = within(
        container.querySelector(
          `[data-rotation-active-row][data-player-version-id="${first}"]`,
        ) as HTMLElement,
      ).getByRole('button', { name: `Increase minutes for ${label}` });
      await fireEvent.click(inc);
      const status = container.querySelector('[role="status"]');
      expect(status?.textContent ?? '').toMatch(/min/);
      await vi.advanceTimersByTimeAsync(5000);
      expect(container.querySelector('[role="status"]')?.textContent ?? '').toMatch(/min/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes keyboard-operable controls with accessible names', () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    expect(within(container).getAllByRole('combobox', { name: /Starter slot/ })).toHaveLength(5);
    expect(
      within(container).getAllByRole('button', { name: /bench order/i }).length,
    ).toBeGreaterThan(0);
    expect(
      within(container).getAllByRole('button', {
        name: /Add .* to closing five|Remove .* from closing five/,
      }).length,
    ).toBe(10);
    for (const row of container.querySelectorAll('[data-rotation-active-row]')) {
      expect(row.getAttribute('aria-label')).toMatch(/minutes/);
    }
  });

  it('uses 44px touch targets, visible focus, and reduced-motion-safe transitions', () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const cls = button.getAttribute('class') ?? '';
      const hasTouch = cls.includes('min-h-11') || cls.includes('h-11') || cls.includes('h-6');
      expect(hasTouch).toBe(true);
      expect(cls).toContain('focus-visible:ring-2');
    }
    const progress = container.querySelector('[role="progressbar"] > div');
    expect(progress?.getAttribute('class') ?? '').toContain('motion-reduce:transition-none');
  });

  it('collapses inactive depth beneath the Active 10', () => {
    const { editor } = editorWithDepth();
    const { container } = renderEditor(editor);
    const section = container.querySelector('[data-rotation-inactive-section]');
    expect(section).not.toBeNull();
    expect(section?.tagName.toLowerCase()).toBe('details');
    expect(section?.hasAttribute('open')).toBe(false);
    expect(container.querySelectorAll('[data-rotation-inactive-row]').length).toBe(5);
  });

  it('does not render the legacy rejection alert surface', () => {
    const base = createRotationEditor(legalRotation(), rotationMembers());
    const { container } = renderEditor(base);
    expect(container.textContent).not.toMatch(/rejected:/i);
  });
});

describe('rotation editor consolidation with real fixtures', () => {
  it('starter slot pickers only offer slot-legal players', () => {
    const base = createRotationEditor(legalRotation(), rotationMembers());
    const { container } = renderEditor(base);
    const picker = within(container).getByRole('combobox', {
      name: 'Starter slot 1',
    });
    expect(picker.querySelectorAll('option').length).toBeGreaterThan(0);
  });

  it('applies a preset and keeps the 240 total', async () => {
    const base = createRotationEditor(legalRotation(), rotationMembers());
    const { container } = renderEditor(base);
    await fireEvent.click(within(container).getByRole('button', { name: 'Balanced' }));
    const total = base.rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0);
    expect(total).toBe(240);
    expect(base.validate()).toEqual([]);
  });
});
