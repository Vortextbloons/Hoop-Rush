import { describe, expect, it } from 'vitest';
import type { Position, SeasonRotation } from '@hoop-rush/data-contracts';
import { buildMinimalRotation } from '@hoop-rush/engine';
import { buildSeasonDraftCatalog } from '@hoop-rush/test-fixtures';
import {
  ROTATION_PRESETS,
  createRotationEditor,
  presetLabel,
  rotationRoleOf,
  type RotationMember,
} from './season-rotation-editor';

/**
 * M2.3 rotation editor unit tests: every mutation stays inside the engine
 * audit (spec/2.0/04 M2.2 contract), so the pending rotation can never drift
 * into a submission the engine would reject.
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

function playableOf(playerVersionId: string): readonly Position[] {
  const candidate = CANDIDATES.find((c) => c.playerVersionId === playerVersionId);
  if (candidate === undefined) {
    throw new Error(`fixture catalog misses candidate ${playerVersionId}`);
  }
  return candidate.positions.playable;
}

/** Legal rotation over the ten fixture candidates (engine-built). */
function rotation(): SeasonRotation {
  return buildMinimalRotation({
    franchiseId: 'lakers',
    members: members().map((member) => ({
      playerVersionId: member.playerVersionId,
      playable: member.playable,
    })),
  });
}

function editor() {
  return createRotationEditor(rotation(), members());
}

/** A bench player that can play a guard slot, if one exists. */
function guardBenchPlayer(e: ReturnType<typeof editor>): string | null {
  return (
    e.rotation.benchOrder.find(
      (id) => playableOf(id).includes('PG') || playableOf(id).includes('SG'),
    ) ?? null
  );
}

/** A bench player that can play a forward slot, if one exists. */
function forwardBenchPlayer(e: ReturnType<typeof editor>): string | null {
  return (
    e.rotation.benchOrder.find(
      (id) => playableOf(id).includes('SF') || playableOf(id).includes('PF'),
    ) ?? null
  );
}

/** A player who can ONLY play center. */
function centerOnlyPlayer(): string | null {
  const candidate = CANDIDATES.find(
    (c) => c.positions.playable.length === 1 && c.positions.playable[0] === 'C',
  );
  return candidate?.playerVersionId ?? null;
}

describe('RotationEditor', () => {
  it('builds a clean editor from an engine-built legal rotation', () => {
    const e = editor();
    expect(e.validate()).toEqual([]);
    expect(e.rows()).toHaveLength(10);
    expect(e.rotation.starters).toHaveLength(5);
    expect(e.rotation.closingFive).toHaveLength(5);
  });

  it('throws when the member list is not ten players', () => {
    expect(() => createRotationEditor(rotation(), members().slice(0, 9))).toThrow(/ten members/);
  });

  it('sets and clamps target minutes per player', () => {
    const e = editor();
    const first = e.rows()[0];
    if (first === undefined) {
      throw new Error('fixture editor has no rows');
    }
    e.setMinutes(first.member.playerVersionId, 40);
    expect(e.minutesFor(first.member.playerVersionId)).toBe(40);
    e.setMinutes(first.member.playerVersionId, 99);
    expect(e.minutesFor(first.member.playerVersionId)).toBe(48);
    e.setMinutes(first.member.playerVersionId, -5);
    expect(e.minutesFor(first.member.playerVersionId)).toBe(0);
  });

  it('surfaces a validation failure when minutes stop totaling 240', () => {
    const e = editor();
    const first = e.rows()[0];
    if (first === undefined) {
      throw new Error('fixture editor has no rows');
    }
    e.setMinutes(first.member.playerVersionId, 48);
    const failures = e.validate();
    expect(failures.some((failure) => failure.includes('240'))).toBe(true);
  });

  it('applies presets through the engine tables and stays valid', () => {
    const e = editor();
    const expectedStarters: Record<(typeof ROTATION_PRESETS)[number], number> = {
      balanced: 33,
      tight: 37,
      'bench-heavy': 29,
    };
    for (const preset of ROTATION_PRESETS) {
      const failures = e.applyPreset(preset);
      expect(failures).toEqual([]);
      expect(e.validate()).toEqual([]);
      const starter = e.rotation.starters[0];
      if (starter === undefined) {
        throw new Error('fixture rotation has no starters');
      }
      expect(e.minutesFor(starter)).toBe(expectedStarters[preset]);
    }
  });

  it('labels presets for the UI', () => {
    expect(presetLabel('balanced')).toBe('Balanced');
    expect(presetLabel('tight')).toBe('Tight');
    expect(presetLabel('bench-heavy')).toBe('Bench-Heavy');
  });

  it('promotes a guard-capable bench player into a starter slot, demoting the incumbent', () => {
    const e = editor();
    const benchPlayer = guardBenchPlayer(e);
    if (benchPlayer === null) {
      throw new Error('fixture rotation has no guard-capable bench player');
    }
    const incumbent = e.rotation.starters[0];
    if (incumbent === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const benchIndex = e.rotation.benchOrder.indexOf(benchPlayer);
    const failures = e.assignStarter(0, benchPlayer);
    expect(failures).toEqual([]);
    expect(e.rotation.starters[0]).toBe(benchPlayer);
    expect(e.rotation.benchOrder[benchIndex]).toBe(incumbent);
    expect(e.validate()).toEqual([]);
  });

  it('swaps two same-slot starters when assigning an existing starter elsewhere', () => {
    const e = editor();
    const a = e.rotation.starters[0];
    if (a === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const b = e.rotation.starters[1];
    if (b === undefined) {
      throw new Error('fixture rotation has no second starter');
    }
    e.assignStarter(0, b);
    expect(e.rotation.starters[0]).toBe(b);
    expect(e.rotation.starters[1]).toBe(a);
    expect(e.validate()).toEqual([]);
  });

  it('rejects an illegal starter assignment and keeps the rotation unchanged', () => {
    const e = editor();
    const centerOnly = centerOnlyPlayer();
    if (centerOnly === null) {
      throw new Error('fixture catalog has no center-only player');
    }
    const before = e.rotation;
    const failures = e.assignStarter(0, centerOnly);
    expect(failures.length).toBeGreaterThan(0);
    expect(e.rotation.starters).toEqual(before.starters);
    expect(e.rotation.benchOrder).toEqual(before.benchOrder);
  });

  it('assigns a bench player into the closing five when legal', () => {
    const e = editor();
    const wing = forwardBenchPlayer(e);
    if (wing === null) {
      throw new Error('fixture rotation has no forward-capable bench player');
    }
    const failures = e.assignClosing(3, wing);
    expect(failures).toEqual([]);
    expect(e.rotation.closingFive[3]).toBe(wing);
    expect(e.validate()).toEqual([]);
  });

  it('rejects an illegal closing assignment', () => {
    const e = editor();
    const centerOnly = centerOnlyPlayer();
    if (centerOnly === null) {
      throw new Error('fixture catalog has no center-only player');
    }
    const before = e.rotation.closingFive;
    const failures = e.assignClosing(0, centerOnly);
    expect(failures.length).toBeGreaterThan(0);
    expect(e.rotation.closingFive).toEqual(before);
  });

  it('describes starter and bench roles', () => {
    const e = editor();
    const starter = e.rotation.starters[0];
    if (starter === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const benchPlayer = e.rotation.benchOrder[0];
    if (benchPlayer === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    expect(rotationRoleOf(e.rotation, starter)).toMatch(/^Starter /);
    expect(rotationRoleOf(e.rotation, benchPlayer)).toBe('Bench 1');
  });
});
