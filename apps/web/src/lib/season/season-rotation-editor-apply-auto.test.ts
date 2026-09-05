import { describe, expect, it } from 'vitest';
import { buildMinimalRotation } from '@hoop-rush/engine';
import type { SeasonRotation } from '@hoop-rush/data-contracts';
import { createRotationEditor } from './season-rotation-editor';

function members() {
  const versionId = (n: number) => `pv-${String(n).padStart(32, '0')}`;
  const playable = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG', 'SG'],
    ['SF', 'PF'],
  ] as const;
  return playable.map((positions, index) => ({
    playerVersionId: versionId(index + 1),
    displayName: `Player ${String(index + 1)}`,
    playable: [...positions] as ('PG' | 'SG' | 'SF' | 'PF' | 'C')[],
  }));
}

function baseRotation() {
  const all = members();
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: all.slice(0, 10).map((m) => ({
      playerVersionId: m.playerVersionId,
      playable: m.playable,
    })),
  });
}

describe('RotationEditor.applyAutoRotation', () => {
  it('applies minutes-only candidates through the existing validation path', () => {
    const editor = createRotationEditor(baseRotation(), members().slice(0, 10));
    const candidate = {
      ...editor.rotation,
      targetMinutes: editor.rotation.targetMinutes.map((row, index) => ({
        ...row,
        minutes: index < 5 ? 34 : 14,
      })),
    };
    const total = candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0);
    expect(total).toBe(240);
    editor.applyAutoRotation(candidate);
    expect(editor.rotation.targetMinutes).toEqual(candidate.targetMinutes);
    expect(editor.validate()).toEqual([]);
  });

  it('applies active-10 swaps by refreshing the pending editor membership', () => {
    const all = members();
    const editor = createRotationEditor(baseRotation(), all);
    const inactive = all[10];
    const outgoing = editor.rotation.benchOrder[4];
    if (inactive === undefined || outgoing === undefined) throw new Error('fixture missing');
    const candidate = {
      ...editor.rotation,
      starters: [...editor.rotation.starters],
      benchOrder: editor.rotation.benchOrder.map((id) =>
        id === outgoing ? inactive.playerVersionId : id,
      ),
      targetMinutes: editor.rotation.targetMinutes.map((row) =>
        row.playerVersionId === outgoing
          ? { playerVersionId: inactive.playerVersionId, minutes: row.minutes }
          : row,
      ),
      closingFive: editor.rotation.closingFive.map((id) =>
        id === outgoing ? inactive.playerVersionId : id,
      ),
    };
    editor.applyAutoRotation(candidate);
    expect(editor.validate()).toEqual([]);
    expect(editor.isActive(inactive.playerVersionId)).toBe(true);
    expect(editor.isActive(outgoing)).toBe(false);
  });

  it('restores pre-Auto on undo, preserving pending-only semantics', () => {
    const all = members();
    const editor = createRotationEditor(baseRotation(), all);
    const before: SeasonRotation = JSON.parse(JSON.stringify(editor.rotation)) as SeasonRotation;
    const candidate = {
      ...editor.rotation,
      targetMinutes: editor.rotation.targetMinutes.map((row, index) => ({
        ...row,
        minutes: index < 5 ? 30 : 18,
      })),
    };
    expect(candidate.targetMinutes.reduce((sum, row) => sum + row.minutes, 0)).toBe(240);
    editor.applyAutoRotation(candidate);
    expect(editor.rotation).not.toEqual(before);
    editor.applyAutoRotation(before);
    expect(editor.rotation).toEqual(before);
    expect(editor.validate()).toEqual([]);
  });
});
