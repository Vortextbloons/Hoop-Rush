import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_DEFAULT_TACTICS,
  fullCourtBlueprintSchema,
  playerIdSchema,
  type FullCourtBlueprint,
  type Position,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import {
  buildFullCourtBlueprintHierarchy,
  resolveFullCourtBlueprintHierarchy,
} from './blueprint.ts';

function makePlayer(options: {
  id: string;
  name: string;
  positions: Position[];
  overall?: number;
  usageRate?: number;
  passing?: number;
  ballHandling?: number;
  threePoint?: number;
  insideScoring?: number;
}): SimulationPlayer {
  const base = buildSimulationPlayer({
    playerId: playerIdSchema.parse(options.id),
    displayName: options.name,
    positions: options.positions,
  });
  return {
    ...base,
    overall: options.overall ?? 75,
    ratings: {
      ...base.ratings,
      passing: options.passing ?? base.ratings.passing,
      ballHandling: options.ballHandling ?? base.ratings.ballHandling,
      threePoint: options.threePoint ?? base.ratings.threePoint,
      insideScoring: options.insideScoring ?? base.ratings.insideScoring,
    },
    tendencies: {
      ...base.tendencies,
      usageRate: options.usageRate ?? base.tendencies.usageRate,
    },
  };
}

function makeBlueprint(
  name: string,
  hierarchy?: FullCourtBlueprint['hierarchy'],
): FullCourtBlueprint {
  return fullCourtBlueprintSchema.parse({
    schemaVersion: 1,
    name,
    tactics: { ...FULL_COURT_DEFAULT_TACTICS, pace: 'fast' },
    ...(hierarchy === undefined ? {} : { hierarchy }),
  });
}

function rosterOfSize(size: number): SimulationPlayer[] {
  const positions: Position[][] = [
    ['PG'],
    ['SG'],
    ['SF'],
    ['PF'],
    ['C'],
    ['PG', 'SG'],
    ['SF', 'PF'],
    ['SG'],
    ['PF', 'C'],
    ['PG'],
    ['SF'],
    ['C'],
  ];
  return Array.from({ length: size }, (_v, index) =>
    makePlayer({
      id: `p${String(index + 1)}`,
      name: `Player ${String(index + 1).padStart(2, '0')}`,
      positions: positions[index] ?? ['SF'],
      overall: 85 - index,
      usageRate: 28 - index,
      passing: (positions[index]?.includes('PG') ?? false) ? 84 : 58,
      ballHandling: (positions[index]?.includes('PG') ?? false) ? 82 : 56,
    }),
  );
}

describe('Full Court portable blueprint scoring roles', () => {
  it('extracts portable slot and role-fit references without pinning player IDs', () => {
    const roster = rosterOfSize(10);
    const rotation = {
      startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
      minuteTargets: {
        p1: 34,
        p2: 32,
        p3: 32,
        p4: 30,
        p5: 30,
        p6: 26,
        p7: 22,
        p8: 18,
        p9: 10,
        p10: 6,
      },
    };
    const hierarchy = buildFullCourtBlueprintHierarchy({
      hierarchy: {
        primaryPlayerId: 'p3',
        secondaryPlayerId: 'p7',
        floorGeneralPlayerId: 'p1',
      },
      roster,
      rotation,
    });

    expect(hierarchy).toMatchObject({
      primary: {
        kind: 'starter-slot',
        slot: 2,
        preferredPositions: ['SF'],
      },
      secondary: {
        kind: 'bench-slot',
        benchIndex: 1,
        preferredPositions: ['PF', 'SF'],
      },
      floorGeneral: {
        kind: 'starter-slot',
        slot: 0,
        preferredPositions: ['PG'],
      },
    });
    expect(typeof hierarchy?.primary?.archetype).toBe('string');
    expect(typeof hierarchy?.secondary?.archetype).toBe('string');
    expect(typeof hierarchy?.floorGeneral?.archetype).toBe('string');
    expect(JSON.stringify(hierarchy)).not.toContain('p3');
    expect(JSON.stringify(hierarchy)).not.toContain('p7');
    expect(JSON.stringify(hierarchy)).not.toContain('p1');
  });

  it('round-trips a scoring option who also runs the offense', () => {
    const roster = rosterOfSize(10);
    const assignedRoles = { primaryPlayerId: 'p1', floorGeneralPlayerId: 'p1' };
    const hierarchy = buildFullCourtBlueprintHierarchy({ hierarchy: assignedRoles, roster });
    const blueprint = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: 'Scoring playmaker',
      tactics: FULL_COURT_DEFAULT_TACTICS,
      hierarchy,
    });

    expect(resolveFullCourtBlueprintHierarchy({ blueprint, roster }).hierarchy).toEqual(
      assignedRoles,
    );
  });

  it('works cleanly when custom minutes are absent (automatic rotation)', () => {
    const roster = rosterOfSize(8);
    const primaryStarter = roster[2];
    const floorStarter = roster[0];
    if (primaryStarter === undefined || floorStarter === undefined) {
      throw new Error('Expected 8-player test roster');
    }
    const portable = buildFullCourtBlueprintHierarchy({
      hierarchy: {
        primaryPlayerId: primaryStarter.playerId,
        floorGeneralPlayerId: floorStarter.playerId,
      },
      roster,
    });
    expect(portable).toBeDefined();

    const targetRoster = rosterOfSize(8).map((player) => ({
      ...player,
      playerId: playerIdSchema.parse(`run2-${player.playerId}`),
    }));
    const preview = resolveFullCourtBlueprintHierarchy({
      blueprint: makeBlueprint('Auto Motion', portable),
      roster: targetRoster,
    });

    expect(preview.rotationSource).toBe('automatic');
    expect(preview.hasHierarchy).toBe(true);
    expect(preview.hasMissingOrVacant).toBe(false);
    expect(preview.hierarchy?.primaryPlayerId).toBeDefined();
    expect(preview.hierarchy?.floorGeneralPlayerId).toBeDefined();
    expect(preview.hierarchy?.primaryPlayerId).not.toBe(preview.hierarchy?.floorGeneralPlayerId);
  });

  it('handles 6 to 12 player rosters and missing bench slots with fallback or vacancy', () => {
    const blueprint = makeBlueprint('Deep Bench Wing', {
      primary: { kind: 'starter-slot', slot: 2, preferredPositions: ['SF'] },
      secondary: { kind: 'bench-slot', benchIndex: 4, preferredPositions: ['SG'] },
      floorGeneral: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
    });

    // 12-player roster has Bench 5 (benchIndex 4).
    const twelve = rosterOfSize(12);
    const preview12 = resolveFullCourtBlueprintHierarchy({ blueprint, roster: twelve });
    expect(preview12.hasMissingOrVacant).toBe(false);
    expect(preview12.bindings.every((binding) => binding.status === 'matched')).toBe(true);

    // 6-player roster lacks Bench 5; Bench 1 (p6) is PG/SG so it acts as explicit fallback.
    const six = rosterOfSize(6);
    const preview6 = resolveFullCourtBlueprintHierarchy({ blueprint, roster: six });
    expect(preview6.bindings[0]?.status).toBe('matched');
    expect(preview6.bindings[2]?.status).toBe('matched');
    expect(preview6.bindings[1]?.status).toBe('fallback');
    expect(preview6.bindings[1]?.playerId).toBe('p6');
    expect(preview6.bindings[1]?.reason).toContain('not available on this 6-player roster');

    // 6-player roster where the single bench player is an incompatible pure Center leaves secondary vacant.
    const sixWithCenterBench = [
      ...six.slice(0, 5),
      makePlayer({
        id: 'p6',
        name: 'Pure Center',
        positions: ['C'],
        usageRate: 14,
        passing: 30,
        ballHandling: 25,
      }),
    ];
    const rotation6 = {
      startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
      minuteTargets: { p1: 42, p2: 42, p3: 42, p4: 42, p5: 42, p6: 30 },
    };
    const previewIncompatibleBench = resolveFullCourtBlueprintHierarchy({
      blueprint: makeBlueprint('Guard Bench', {
        primary: { kind: 'starter-slot', slot: 1, preferredPositions: ['SG'] },
        secondary: { kind: 'bench-slot', benchIndex: 2, preferredPositions: ['PG'] },
        floorGeneral: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
      }),
      roster: sixWithCenterBench,
      rotation: rotation6,
    });
    expect(previewIncompatibleBench.bindings[0]?.status).toBe('matched');
    expect(previewIncompatibleBench.bindings[2]?.status).toBe('matched');
    expect(previewIncompatibleBench.bindings[1]?.status).toBe('vacant');
    expect(previewIncompatibleBench.bindings[1]?.playerId).toBeNull();
    expect(previewIncompatibleBench.hasMissingOrVacant).toBe(true);
    expect(previewIncompatibleBench.hierarchy).toEqual({
      primaryPlayerId: 'p2',
      floorGeneralPlayerId: 'p1',
    });
  });

  it('prevents a missing bench slot fallback from stealing another role exact starter match', () => {
    const six = rosterOfSize(6);
    const blueprint = makeBlueprint('Protect Exact Slots', {
      primary: { kind: 'bench-slot', benchIndex: 3, preferredPositions: ['PG'] },
      floorGeneral: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
    });

    const preview = resolveFullCourtBlueprintHierarchy({ blueprint, roster: six });
    expect(preview.bindings[1]?.status).toBe('matched');
    expect(preview.bindings[1]?.playerId).toBe('p1');
    expect(preview.bindings[0]?.status).toBe('fallback');
    expect(preview.bindings[0]?.playerId).toBe('p6');
  });

  it('flags ambiguous role-fit ties deterministically and enforces distinct players', () => {
    const twinA = makePlayer({
      id: 'twin-a',
      name: 'Alpha Twin',
      positions: ['PG'],
      overall: 84,
      usageRate: 28,
      passing: 86,
      ballHandling: 86,
    });
    const twinB = makePlayer({
      id: 'twin-b',
      name: 'Beta Twin',
      positions: ['PG'],
      overall: 84,
      usageRate: 28,
      passing: 86,
      ballHandling: 86,
    });
    const roster = [
      twinB,
      twinA,
      makePlayer({ id: 'sf', name: 'Wing', positions: ['SF'] }),
      makePlayer({ id: 'pf', name: 'Forward', positions: ['PF'] }),
      makePlayer({ id: 'c', name: 'Center', positions: ['C'] }),
      makePlayer({
        id: 'b1',
        name: 'Reserve Big',
        positions: ['C'],
        passing: 32,
        ballHandling: 30,
      }),
    ];
    const blueprint = makeBlueprint('Role Fit Tie', {
      primary: { kind: 'role-fit', preferredPositions: ['PG'] },
      floorGeneral: { kind: 'role-fit', preferredPositions: ['PG'] },
    });

    const first = resolveFullCourtBlueprintHierarchy({ blueprint, roster });
    const second = resolveFullCourtBlueprintHierarchy({
      blueprint,
      roster: [...roster].reverse(),
    });

    expect(first.hasAmbiguous).toBe(true);
    expect(first.bindings[0]?.status).toBe('ambiguous');
    expect(first.bindings[0]?.tiedCandidates.map((p) => p.playerId)).toEqual([
      twinA.playerId,
      twinB.playerId,
    ]);
    expect(first.hierarchy?.primaryPlayerId).toBe('twin-a');
    expect(first.hierarchy?.floorGeneralPlayerId).toBe('twin-b');
    expect(second.hierarchy).toEqual(first.hierarchy);
    expect(second.bindings).toEqual(first.bindings);
  });

  it('returns empty preview for tactics-only blueprints', () => {
    const roster = rosterOfSize(6);
    const preview = resolveFullCourtBlueprintHierarchy({
      blueprint: makeBlueprint('Legacy Tactics'),
      roster,
    });

    expect(preview.hasHierarchy).toBe(false);
    expect(preview.bindings).toEqual([]);
    expect(preview.hierarchy).toBeUndefined();
    expect(preview.hasMissingOrVacant).toBe(false);
    expect(preview.hasAmbiguous).toBe(false);
  });
});
