import { describe, expect, it } from 'vitest';
import {
  canPlay,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_VERSION,
  type Position,
  type SeasonRotation,
} from '@hoop-rush/data-contracts';
import {
  ROTATION_PRESETS,
  createRotationEditor,
  failurePlayerVersionId,
  indexRotationFailures,
  presetLabel,
  rotationEditorNeedsPositionRefresh,
  rotationRoleOf,
  strategyLabel,
  SLOT_GROUPS,
  type RotationMember,
} from './season-rotation-editor';
import {
  CANDIDATES,
  legalRotation,
  rotationMembers,
  rotationPlayableOf,
} from './season-rotation-test-support';

/**
 * M2.3 rotation editor unit tests: every mutation stays inside the engine
 * audit (spec/2.0/04 M2.2 contract), so the pending rotation can never drift
 * into a submission the engine would reject.
 */

function members(): RotationMember[] {
  return rotationMembers();
}

function playableOf(playerVersionId: string): readonly Position[] {
  return rotationPlayableOf(playerVersionId);
}

function rotation() {
  return legalRotation();
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

  it('throws when the member list is outside ten to fifteen players', () => {
    expect(() => createRotationEditor(rotation(), members().slice(0, 9))).toThrow(
      /10 to 15 roster members/,
    );
    const sixteen = [...members(), ...members().slice(0, 6)];
    expect(() => createRotationEditor(rotation(), sixteen)).toThrow(/10 to 15 roster members/);
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
    const expectedStrategies: Record<(typeof ROTATION_PRESETS)[number], string> = {
      balanced: 'balanced',
      tight: 'starter-heavy',
      'bench-heavy': 'bench-heavy',
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
      expect(e.rotation.minutePolicy.policyVersion).toBe('minute-policy-v1');
      expect(e.rotation.minutePolicy.strategy).toBe(expectedStrategies[preset]);
    }
  });

  it('labels presets for the UI', () => {
    expect(presetLabel('balanced')).toBe('Balanced');
    expect(presetLabel('tight')).toBe('Starter-Heavy');
    expect(presetLabel('bench-heavy')).toBe('Bench-Heavy');
  });

  it('labels minute-policy strategies for the plan cards', () => {
    expect(strategyLabel('starter-heavy')).toBe('Starter-Heavy');
    expect(strategyLabel('balanced')).toBe('Balanced');
    expect(strategyLabel('bench-heavy')).toBe('Bench-Heavy');
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

describe('RotationEditor.rebalanceMinutes', () => {
  it('raises one player by taking from the highest-minute teammate, keeping 240', () => {
    const e = editor();
    const first = e.rotation.starters[0];
    if (first === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const other = e.rotation.starters[1];
    if (other === undefined) {
      throw new Error('fixture rotation has no second starter');
    }
    const result = e.rebalanceMinutes(first, 40);
    expect(result.failures).toEqual([]);
    expect(e.minutesFor(first)).toBe(40);
    expect(e.minutesFor(other)).toBe(24);
    expect(e.validate()).toEqual([]);
    expect(e.rotation.targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
    expect(result.adjustments[0]).toEqual({ playerVersionId: first, minutes: 40, delta: 8 });
    expect(result.adjustments.slice(1).reduce((sum, a) => sum + a.delta, 0)).toBe(-8);
  });

  it('lowers one player by giving minutes to the lowest-minute teammate, keeping 240', () => {
    const e = editor();
    const first = e.rotation.starters[0];
    if (first === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const benchPlayer = e.rotation.benchOrder[0];
    if (benchPlayer === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    const result = e.rebalanceMinutes(first, 20);
    expect(result.failures).toEqual([]);
    expect(e.minutesFor(first)).toBe(20);
    expect(e.minutesFor(benchPlayer)).toBe(28);
    expect(e.validate()).toEqual([]);
    const target = result.adjustments[0];
    if (target === undefined) {
      throw new Error('rebalance has no target adjustment');
    }
    expect(target.delta).toBe(-12);
    expect(result.adjustments.slice(1).reduce((sum, a) => sum + a.delta, 0)).toBe(12);
  });

  it('rejects a raise with no minutes available and leaves the rotation unchanged', () => {
    const e = editor();
    const first = e.rotation.starters[0];
    if (first === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    for (const entry of e.rotation.targetMinutes) {
      e.setMinutes(entry.playerVersionId, 0);
    }
    const before = e.rotation;
    const result = e.rebalanceMinutes(first, 20);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]).toMatch(/not enough minutes available/);
    expect(result.adjustments).toEqual([]);
    expect(e.rotation).toEqual(before);
  });

  it('treats a same-value rebalance as a no-op', () => {
    const e = editor();
    const first = e.rotation.starters[0];
    if (first === undefined) {
      throw new Error('fixture rotation has no starters');
    }
    const noop = e.rebalanceMinutes(first, e.minutesFor(first));
    expect(noop.failures).toEqual([]);
    expect(noop.adjustments).toEqual([]);
  });
});

describe('RotationEditor.toggleClosing', () => {
  it('adds a non-closing player to the first legal closing slot, displacing the incumbent', () => {
    const e = editor();
    const benchPlayer = e.rotation.benchOrder[0];
    if (benchPlayer === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    const playable = playableOf(benchPlayer);
    const slot = SLOT_GROUPS.findIndex((group) => canPlay(playable, group));
    expect(slot).toBeGreaterThanOrEqual(0);
    const failures = e.toggleClosing(benchPlayer);
    expect(failures).toEqual([]);
    expect(e.rotation.closingFive).toHaveLength(5);
    expect(e.rotation.closingFive[slot]).toBe(benchPlayer);
    expect(e.validate()).toEqual([]);
  });

  it('removing a closing player replaces them with the best eligible non-closer', () => {
    const e = editor();
    const benchPlayer = e.rotation.benchOrder[0];
    if (benchPlayer === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    expect(e.toggleClosing(benchPlayer)).toEqual([]);
    const slot = e.rotation.closingFive.indexOf(benchPlayer);
    expect(slot).toBeGreaterThanOrEqual(0);
    const failures = e.toggleClosing(benchPlayer);
    expect(failures).toEqual([]);
    expect(e.rotation.closingFive).toHaveLength(5);
    expect(e.rotation.closingFive.includes(benchPlayer)).toBe(false);
    expect(e.validate()).toEqual([]);
  });

  it('rejects a removal when no non-closing player can fill the vacated slot', () => {
    const players: RotationMember[] = [
      { playerVersionId: 'g1', displayName: 'G1', playable: ['PG'] },
      { playerVersionId: 'g2', displayName: 'G2', playable: ['SG'] },
      { playerVersionId: 'g3', displayName: 'G3', playable: ['PG'] },
      { playerVersionId: 'g4', displayName: 'G4', playable: ['SG'] },
      { playerVersionId: 'f1', displayName: 'F1', playable: ['SF'] },
      { playerVersionId: 'f2', displayName: 'F2', playable: ['PF'] },
      { playerVersionId: 'f3', displayName: 'F3', playable: ['SF'] },
      { playerVersionId: 'f4', displayName: 'F4', playable: ['PF'] },
      { playerVersionId: 'c1', displayName: 'C1', playable: ['C'] },
      { playerVersionId: 'c2', displayName: 'C2', playable: ['C'] },
    ];
    const e = createRotationEditor(
      {
        franchiseId: 'lakers',
        starters: ['g1', 'g2', 'f1', 'f2', 'c1'],
        benchOrder: ['g3', 'g4', 'f3', 'f4', 'c2'],
        targetMinutes: players.map((p) => ({ playerVersionId: p.playerVersionId, minutes: 24 })),
        closingFive: ['g1', 'g2', 'g3', 'g4', 'c1'],
        minutePolicy: {
          policyVersion: SEASON_MINUTE_POLICY_VERSION,
          strategy: 'balanced',
        },
        rotationVersion: SEASON_ROTATION_VERSION,
      },
      players,
    );
    // Every guard is closing, so the bench cannot fill a vacated guard slot.
    const failures = e.toggleClosing('g1');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toMatch(/cannot be removed/);
    expect(e.rotation.closingFive[0]).toBe('g1');
  });
});

describe('RotationEditor.moveBench', () => {
  it('moves a bench player up and down the substitution hierarchy', () => {
    const e = editor();
    const first = e.rotation.benchOrder[0];
    const second = e.rotation.benchOrder[1];
    if (first === undefined || second === undefined) {
      throw new Error('fixture rotation has no bench order');
    }
    expect(e.moveBench(1, -1)).toEqual([]);
    expect(e.rotation.benchOrder[0]).toBe(second);
    expect(e.rotation.benchOrder[1]).toBe(first);
    expect(rotationRoleOf(e.rotation, second)).toBe('Bench 1');
    expect(rotationRoleOf(e.rotation, first)).toBe('Bench 2');
    expect(e.validate()).toEqual([]);
  });

  it('is a no-op at the edges of the bench', () => {
    const e = editor();
    const before = e.rotation.benchOrder;
    expect(e.moveBench(0, -1)).toEqual([]);
    expect(e.moveBench(4, 1)).toEqual([]);
    expect(e.rotation.benchOrder).toEqual(before);
  });
});

describe('RotationEditor.eligibleForSlot', () => {
  it('offers only players who can legally play the slot group', () => {
    const e = editor();
    const eligibleFor = (slotIndex: number) =>
      new Set(e.eligibleForSlot(slotIndex).map((member) => member.playerVersionId));
    for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
      const group = SLOT_GROUPS[slotIndex];
      if (group === undefined) continue;
      for (const id of e.eligibleForSlot(slotIndex).map((member) => member.playerVersionId)) {
        expect(canPlay(playableOf(id), group)).toBe(true);
      }
      // The roster always has someone ineligible for the slot (the fixture
      // covers the full position archetype cycle).
      const ineligible = members()
        .map((member) => member.playerVersionId)
        .find((id) => !canPlay(playableOf(id), group));
      expect(ineligible).toBeDefined();
      expect(eligibleFor(slotIndex).has(ineligible ?? '')).toBe(false);
    }
  });

  it('includes every current starter in their own slot, and a center-only player only in C slots', () => {
    const e = editor();
    for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
      const current = e.rotation.starters[slotIndex];
      if (current === undefined) continue;
      expect(e.eligibleForSlot(slotIndex).map((m) => m.playerVersionId)).toContain(current);
    }
    const centerOnly = members().find((member) => member.playable.join() === 'C');
    if (centerOnly === undefined) {
      throw new Error('fixture roster has no center-only player');
    }
    expect(e.eligibleForSlot(4).map((m) => m.playerVersionId)).toContain(
      centerOnly.playerVersionId,
    );
    expect(e.eligibleForSlot(0).map((m) => m.playerVersionId)).not.toContain(
      centerOnly.playerVersionId,
    );
  });
});

describe('RotationEditor.applyRotation', () => {
  it('commits a valid external candidate and returns the committed rotation', () => {
    const e = editor();
    const candidate: SeasonRotation = {
      ...e.rotation,
      targetMinutes: e.rotation.targetMinutes.map((entry, index) =>
        index === 0
          ? { ...entry, minutes: entry.minutes + 4 }
          : index === 1
            ? { ...entry, minutes: entry.minutes - 4 }
            : entry,
      ),
    };
    const committed = e.applyRotation(candidate);
    expect(committed).toBe(candidate);
    expect(e.rotation).toBe(candidate);
    expect(e.validate()).toEqual([]);
    expect(e.minutesFor(e.rotation.starters[0] ?? '')).toBe(36);
  });

  it('rejects an invalid external candidate and leaves the rotation unchanged', () => {
    const e = editor();
    const before = e.rotation;
    const invalid: SeasonRotation = {
      ...e.rotation,
      targetMinutes: e.rotation.targetMinutes.map((entry, index) =>
        index === 0 ? { ...entry, minutes: entry.minutes + 1 } : entry,
      ),
    };
    expect(() => e.applyRotation(invalid)).toThrow(/rotation plan rejected/);
    expect(e.rotation).toBe(before);
    expect(e.validate()).toEqual([]);
  });
});

describe('failurePlayerVersionId', () => {
  it('extracts ids from per-player audit messages', () => {
    expect(failurePlayerVersionId('starter pv-a.b:c-1 cannot play slot 4')).toBe('pv-a.b:c-1');
    expect(failurePlayerVersionId('closing-five player pv-9 cannot play slot 0')).toBe('pv-9');
    expect(
      failurePlayerVersionId('target minutes for pv-2 must be an integer from 0-48 (got 7)'),
    ).toBe('pv-2');
    expect(failurePlayerVersionId('no target minutes for rostered player pv-3')).toBe('pv-3');
  });

  it('returns null for global audit messages', () => {
    expect(failurePlayerVersionId('target minutes must total 240 (got 256)')).toBeNull();
    expect(failurePlayerVersionId('rotation references duplicate players')).toBeNull();
    expect(
      failurePlayerVersionId('rotation must reference exactly ten players (got 5)'),
    ).toBeNull();
  });
});

describe('indexRotationFailures', () => {
  it('splits failures into per-player and global buckets', () => {
    const index = indexRotationFailures([
      'starter pv-1 cannot play slot 4',
      'closing-five player pv-2 cannot play slot 0',
      'target minutes must total 240 (got 256)',
    ]);
    expect(index.byPlayer.get('pv-1')).toEqual(['starter pv-1 cannot play slot 4']);
    expect(index.byPlayer.get('pv-2')).toEqual(['closing-five player pv-2 cannot play slot 0']);
    expect(index.global).toEqual(['target minutes must total 240 (got 256)']);
  });

  it('groups multiple failures for the same player', () => {
    const index = indexRotationFailures([
      'starter pv-1 cannot play slot 0',
      'no target minutes for rostered player pv-1',
    ]);
    expect(index.byPlayer.get('pv-1')).toHaveLength(2);
    expect(index.global).toEqual([]);
  });

  it('returns empty buckets for a clean rotation', () => {
    const e = editor();
    const index = indexRotationFailures(e.validate());
    expect(index.byPlayer.size).toBe(0);
    expect(index.global).toEqual([]);
  });
});

describe('rotationEditorNeedsPositionRefresh', () => {
  it('returns true when the slice gains positions the cached editor lacks', () => {
    const emptyPlayables = members().map((member) => ({ ...member, playable: [] as const }));
    const cached = createRotationEditor(rotation(), emptyPlayables);
    const rosterIds = members().map((member) => member.playerVersionId);
    expect(rotationEditorNeedsPositionRefresh(cached, rosterIds, (id) => playableOf(id))).toBe(
      true,
    );
  });

  it('returns false when the editor already has loaded playables', () => {
    const cached = editor();
    const rosterIds = members().map((member) => member.playerVersionId);
    expect(rotationEditorNeedsPositionRefresh(cached, rosterIds, (id) => playableOf(id))).toBe(
      false,
    );
  });
});
