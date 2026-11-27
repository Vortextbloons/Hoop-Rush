import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_DEFAULT_TACTICS,
  fullCourtBlueprintSchema,
  fullCourtCoachingPlanSchema,
  fullCourtTacticsSchema,
  normalizeFullCourtBlueprint,
} from './full-court-coaching.ts';

const STARTERS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;
const FULL_MINUTES = Object.fromEntries(STARTERS.map((playerId) => [playerId, 48]));

function plan(
  overrides: { rotation?: Record<string, unknown>; tactics?: unknown; hierarchy?: unknown } = {},
) {
  return {
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics: overrides.tactics ?? FULL_COURT_DEFAULT_TACTICS,
    ...(overrides.rotation === undefined ? {} : { rotation: overrides.rotation }),
    ...(overrides.hierarchy === undefined ? {} : { hierarchy: overrides.hierarchy }),
  } satisfies Record<string, unknown>;
}

function rotation(overrides: Record<string, unknown> = {}) {
  return {
    startingFive: [...STARTERS],
    minuteTargets: { ...FULL_MINUTES },
    ...overrides,
  };
}

function accepts(candidate: unknown): boolean {
  return fullCourtCoachingPlanSchema.safeParse(candidate).success;
}

describe('Full Court coaching plan', () => {
  it('defaults to balanced tactics with an automatic rotation', () => {
    expect(fullCourtTacticsSchema.parse(FULL_COURT_DEFAULT_TACTICS)).toEqual({
      pace: 'balanced',
      offense: 'balanced',
      defense: 'balanced',
    });
    expect(FULL_COURT_DEFAULT_COACHING_PLAN).toEqual({
      schemaVersion: 1,
      tactics: { pace: 'balanced', offense: 'balanced', defense: 'balanced' },
    });
    expect(accepts(FULL_COURT_DEFAULT_COACHING_PLAN)).toBe(true);
  });

  it('accepts explicit tactics and a complete rotation', () => {
    const candidate = plan({
      tactics: { pace: 'fast', offense: 'ball-movement', defense: 'protect-paint' },
      rotation: rotation({ closingFive: [...STARTERS].reverse() }),
    });
    const parsed = fullCourtCoachingPlanSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data.tactics).toEqual({
      pace: 'fast',
      offense: 'ball-movement',
      defense: 'protect-paint',
    });
    expect(parsed.data.rotation?.closingFive).toEqual([...STARTERS].reverse());
  });

  it('accepts five to twelve minute targets including zero minutes', () => {
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: { ...FULL_MINUTES, p6: 0 },
          }),
        }),
      ),
    ).toBe(true);
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: Object.fromEntries(
              Array.from({ length: 12 }, (_, index) => [`p${String(index + 1)}`, 20]),
            ),
          }),
        }),
      ),
    ).toBe(true);
  });

  it('requires unique starters and closers and their minute targets', () => {
    expect(
      accepts(
        plan({
          rotation: rotation({ startingFive: ['p1', 'p1', 'p2', 'p3', 'p4'] }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({ startingFive: ['p1', 'p2', 'p3', 'p4'] }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({ closingFive: ['p1', 'p2', 'p3', 'p4', 'p4'] }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({ closingFive: ['p1', 'p2', 'p3', 'p4'] }),
        }),
      ),
    ).toBe(false);
    const missingStarters = rotation();
    delete (missingStarters.minuteTargets as Record<string, number>).p5;
    expect(accepts(plan({ rotation: missingStarters }))).toBe(false);
    const missingClosers = rotation({ closingFive: ['p1', 'p2', 'p3', 'p4', 'p6'] });
    expect(accepts(plan({ rotation: missingClosers }))).toBe(false);
    const inheritedTarget = rotation({ startingFive: ['p1', 'p2', 'p3', 'p4', 'constructor'] });
    expect(accepts(plan({ rotation: inheritedTarget }))).toBe(false);
    const zeroMinuteStarter = rotation({
      minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 0, p6: 48 },
    });
    expect(accepts(plan({ rotation: zeroMinuteStarter }))).toBe(false);
    const zeroMinuteCloser = rotation({
      startingFive: ['p1', 'p2', 'p3', 'p4', 'p6'],
      minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 0, p6: 48 },
      closingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
    });
    expect(accepts(plan({ rotation: zeroMinuteCloser }))).toBe(false);
  });

  it('requires 5 to 12 integer minute targets that total 240', () => {
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48 },
            startingFive: ['p1', 'p2', 'p3', 'p4'],
          }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: Object.fromEntries(
              Array.from({ length: 13 }, (_, index) => [`p${String(index + 1)}`, 18]),
            ),
          }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 47 },
          }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 48.5 },
          }),
        }),
      ),
    ).toBe(false);
    expect(
      accepts(
        plan({
          rotation: rotation({
            minuteTargets: { p1: 48, p2: 48, p3: 48, p4: 48, p5: 49 },
          }),
        }),
      ),
    ).toBe(false);
  });

  it('accepts an optional distinct scoring hierarchy and rejects empty or repeated roles', () => {
    expect(accepts(plan({ hierarchy: { primaryPlayerId: 'p1' } }))).toBe(true);
    expect(
      accepts(
        plan({
          hierarchy: {
            primaryPlayerId: 'p1',
            secondaryPlayerId: 'p2',
            floorGeneralPlayerId: 'p3',
          },
        }),
      ),
    ).toBe(true);
    expect(accepts(plan({ hierarchy: {} }))).toBe(false);
    expect(accepts(plan({ hierarchy: { primaryPlayerId: 'p1', secondaryPlayerId: 'p1' } }))).toBe(
      false,
    );
    expect(
      accepts(
        plan({
          hierarchy: { primaryPlayerId: 'p1', floorGeneralPlayerId: 'p1' },
        }),
      ),
    ).toBe(false);
    expect(accepts(plan({ hierarchy: { primaryPlayerId: '' } }))).toBe(false);
  });

  it('rejects unknown tactics and schema versions', () => {
    expect(
      accepts(plan({ tactics: { pace: 'warp', offense: 'balanced', defense: 'balanced' } })),
    ).toBe(false);
    expect(accepts({ ...plan(), schemaVersion: 2 })).toBe(false);
  });
});

describe('Full Court blueprint schema', () => {
  it('accepts older tactics-only blueprints and optional portable scoring roles', () => {
    const legacy = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: '  Fast Break  ',
      tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
    });
    expect(legacy).toEqual({
      schemaVersion: 1,
      name: 'Fast Break',
      tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
    });
    expect(normalizeFullCourtBlueprint(legacy)).toEqual(legacy);

    const withHierarchy = normalizeFullCourtBlueprint(
      fullCourtBlueprintSchema.parse({
        schemaVersion: 1,
        name: 'Motion Wing',
        tactics: { pace: 'balanced', offense: 'ball-movement', defense: 'balanced' },
        hierarchy: {
          primary: {
            kind: 'starter-slot',
            slot: 2,
            preferredPositions: ['SF', 'SG', 'SF'],
            archetype: 'primaryCreator',
          },
          secondary: {
            kind: 'bench-slot',
            benchIndex: 0,
            preferredPositions: ['SG'],
            archetype: 'floorSpacer',
          },
          floorGeneral: {
            kind: 'role-fit',
            preferredPositions: ['PG'],
            archetype: 'primaryCreator',
          },
        },
      }),
    );
    expect(withHierarchy.hierarchy?.primary).toEqual({
      kind: 'starter-slot',
      slot: 2,
      preferredPositions: ['SF', 'SG'],
      archetype: 'primaryCreator',
    });
  });

  it('rejects pinned run player IDs, duplicate slots, empty hierarchy, and empty role-fit refs', () => {
    expect(
      fullCourtBlueprintSchema.safeParse({
        schemaVersion: 1,
        name: 'Invalid Run ID',
        tactics: FULL_COURT_DEFAULT_TACTICS,
        hierarchy: { primaryPlayerId: 'p1' },
      }).success,
    ).toBe(false);

    expect(
      fullCourtBlueprintSchema.safeParse({
        schemaVersion: 1,
        name: 'Empty Hierarchy',
        tactics: FULL_COURT_DEFAULT_TACTICS,
        hierarchy: {},
      }).success,
    ).toBe(false);

    expect(
      fullCourtBlueprintSchema.safeParse({
        schemaVersion: 1,
        name: 'Duplicate Starter Slot',
        tactics: FULL_COURT_DEFAULT_TACTICS,
        hierarchy: {
          primary: { kind: 'starter-slot', slot: 0 },
          floorGeneral: { kind: 'starter-slot', slot: 0 },
        },
      }).success,
    ).toBe(false);

    expect(
      fullCourtBlueprintSchema.safeParse({
        schemaVersion: 1,
        name: 'Empty Role Fit',
        tactics: FULL_COURT_DEFAULT_TACTICS,
        hierarchy: {
          primary: { kind: 'role-fit' },
        },
      }).success,
    ).toBe(false);
  });
});
