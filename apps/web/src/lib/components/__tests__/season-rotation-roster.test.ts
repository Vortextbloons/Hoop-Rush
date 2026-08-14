import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import RotationEditor from '$lib/components/season/RotationEditor.svelte';
import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
import { createRotationEditor } from '$lib/season/season-rotation-editor';
import type { SeasonRunShellData } from '$lib/season/season-shell-context';
import { initialSeasonRunShellData } from '$lib/season/season-shell-context';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

const SLOT_POSITIONS: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF', 'C'],
  ['C'],
];

interface NamedMember {
  id: string;
  playable: readonly Position[];
}

function members(count: number): NamedMember[] {
  const list: NamedMember[] = [];
  for (let i = 0; i < count; i += 1) {
    list.push({
      id: `pv-${String(i).padStart(2, '0')}`,
      playable: SLOT_POSITIONS[i % SLOT_POSITIONS.length] ?? ['PG'],
    });
  }
  return list;
}

function rotationFor(members: NamedMember[]): SeasonRotation {
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: members.slice(0, 10).map((member) => ({
      playerVersionId: member.id,
      playable: member.playable,
    })),
  });
}

function editorFor(count: number) {
  const roster = members(count);
  const rotation = rotationFor(roster);
  const editor = createRotationEditor(
    rotation,
    roster.map((member) => ({
      playerVersionId: member.id,
      displayName: `Player ${member.id}`,
      playable: member.playable,
    })),
  );
  return { editor, roster };
}

function shellFor(editor: SeasonRunShellData['editor']): SeasonRunShellData {
  const shell = initialSeasonRunShellData();
  shell.ready = true;
  shell.editor = editor;
  shell.humanFranchiseId = 'lakers';
  shell.manifest = buildManifest();
  return shell;
}

describe('rotation editor: active/inactive roster (M2.6.5)', () => {
  it('renders the inactive roster section only when depth exists', () => {
    const ten = editorFor(10);
    const tenResult = render(RotationEditor, {
      props: { editor: ten.editor, disabled: false, onchange: vi.fn() },
    });
    expect(tenResult.container.querySelector('[data-rotation-inactive-section]')).toBeNull();

    const twelve = editorFor(12);
    const twelveResult = render(RotationEditor, {
      props: { editor: twelve.editor, disabled: false, onchange: vi.fn() },
    });
    const section = twelveResult.container.querySelector('[data-rotation-inactive-section]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('2 rostered players');
    const rows = twelveResult.container.querySelectorAll('[data-rotation-inactive-row]');
    expect(rows).toHaveLength(2);
  });

  it('promotes an inactive player through the replace picker (engine-audited swap)', async () => {
    const { editor, roster } = editorFor(12);

    const inactive = roster[10];
    const active = roster[5];
    if (inactive === undefined || active === undefined) throw new Error('fixture too small');
    const { container } = render(RotationEditor, {
      props: { editor, disabled: false, onchange: vi.fn() },
    });
    const inactiveRow = Array.from(
      container.querySelectorAll<HTMLElement>('[data-rotation-inactive-row]'),
    ).find((row) => row.textContent.includes(inactive.id));
    if (inactiveRow === undefined) throw new Error('inactive row missing');
    await fireEvent.click(within(inactiveRow).getByRole('button', { name: /Promote/ }));
    const options = container.querySelectorAll('[data-promote-option]');
    expect(options.length).toBe(10);
    const option = Array.from(options).find((el) => el.textContent.includes(active.id));
    if (option === undefined) throw new Error('replace option missing');
    await fireEvent.click(option);

    expect(editor.isActive(inactive.id)).toBe(true);
    expect(editor.isActive(active.id)).toBe(false);
    expect(editor.activeMemberIds()).toHaveLength(10);
    expect(editor.inactiveMembers()).toHaveLength(2);
    expect(editor.validate()).toEqual([]);

    const minutes = editor.rotation.targetMinutes.find((t) => t.playerVersionId === inactive.id);
    expect(minutes).toBeDefined();
  });

  it('demotes an active player through the demote picker', async () => {
    const { editor, roster } = editorFor(12);

    const inactive = roster[10];
    const active = roster[0];
    if (inactive === undefined || active === undefined) throw new Error('fixture too small');
    const { container } = render(RotationEditor, {
      props: { editor, disabled: false, onchange: vi.fn() },
    });
    await fireEvent.click(
      within(container).getByRole('button', {
        name: `Demote Player ${active.id} to inactive`,
      }),
    );
    const options = Array.from(container.querySelectorAll('[data-promote-option]'));
    const option = options.find((el) => el.textContent.includes(inactive.id));
    if (option === undefined) throw new Error('promote option missing');
    await fireEvent.click(option);
    expect(editor.isActive(inactive.id)).toBe(true);
    expect(editor.isActive(active.id)).toBe(false);
    expect(editor.validate()).toEqual([]);
  });

  it('rejects an illegal promotion with a visible rejection (no commit)', async () => {
    const { editor, roster } = editorFor(12);

    const depth = roster[10];
    const center = editor.rotation.starters[4];
    if (depth === undefined || center === undefined) throw new Error('fixture too small');
    const inactive: NamedMember = { id: depth.id, playable: ['PG'] };
    const failures = editor.promoteToRotation(inactive.id, center);
    expect(failures.length).toBeGreaterThan(0);
    expect(editor.isActive(inactive.id)).toBe(false);
    expect(editor.isActive(center)).toBe(true);

    const { container } = render(RotationEditor, {
      props: { editor, disabled: false, onchange: vi.fn() },
    });
    await fireEvent.click(
      within(container).getByRole('button', {
        name: `Demote Player ${center} to inactive`,
      }),
    );
    const options = Array.from(container.querySelectorAll('[data-promote-option]'));
    const option = options.find((el) => el.textContent.includes(inactive.id));
    if (option === undefined) throw new Error('promote option missing');
    await fireEvent.click(option);
    expect(container.textContent).toContain('rejected');
    expect(editor.isActive(inactive.id)).toBe(false);
  });

  it('keeps the starter pickers limited to active members', () => {
    const { editor } = editorFor(12);
    expect(editor.eligibleForSlot(0).length).toBeLessThanOrEqual(10);
    for (const member of editor.eligibleForSlot(0)) {
      expect(editor.isActive(member.playerVersionId)).toBe(true);
    }
  });

  it('keeps exactly ten active members across repeated swaps', () => {
    const { editor, roster } = editorFor(15);
    const swaps: Array<[string, string]> = [
      [roster[10]?.id ?? '', roster[0]?.id ?? ''],
      [roster[11]?.id ?? '', roster[1]?.id ?? ''],
      [roster[12]?.id ?? '', roster[2]?.id ?? ''],
    ];
    for (const [inactiveId, activeId] of swaps) {
      const failures = editor.promoteToRotation(inactiveId, activeId);
      expect(failures).toEqual([]);
      expect(editor.activeMemberIds()).toHaveLength(10);
      expect(editor.inactiveMembers().length + editor.activeMemberIds().length).toBe(15);
      expect(editor.validate()).toEqual([]);
    }
  });
});

describe('roster list: active/inactive presentation (M2.6.5)', () => {
  it('marks the ten active and the inactive depth rows', () => {
    const { editor, roster } = editorFor(12);
    const roleOf = (playerVersionId: string) => {
      if (!editor.isActive(playerVersionId)) return { role: 'Inactive', minutes: '—' as const };
      const row = editor.rows().find((entry) => entry.member.playerVersionId === playerVersionId);
      return { role: row?.role ?? '—', minutes: row?.minutes ?? '—' };
    };
    const shell = shellFor(editor);
    const { container } = render(SeasonRosterList, {
      props: {
        roster: {
          franchiseId: 'lakers',
          players: roster.map((member) => ({
            playerVersionId: member.id,
            playerId: member.id,
            franchiseId: 'lakers',
            eraId: '1990s',
            seasonKey: '1994-95',
            displayName: `Player ${member.id}`,
          })),
        },
        manifest: buildManifest(),
        shell,
        roleOf,
        effects: null,
        summaries: [],
      },
    });
    const rows = Array.from(container.querySelectorAll('[data-season-roster-status]'));
    expect(rows).toHaveLength(12);
    const active = rows.filter((row) => row.getAttribute('data-season-roster-status') === 'active');
    const inactive = rows.filter(
      (row) => row.getAttribute('data-season-roster-status') === 'inactive',
    );
    expect(active).toHaveLength(10);
    expect(inactive).toHaveLength(2);
    expect(inactive[0]?.textContent).toContain('Inactive');
    expect(container.querySelector('[data-season-roster-list]')).not.toBeNull();
  });
});
