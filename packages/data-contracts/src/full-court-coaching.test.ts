import { describe, expect, it } from 'bun:test';
import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_COACHING_PLAN,
  FULL_COURT_DEFAULT_TACTICS,
  fullCourtCoachingPlanSchema,
  fullCourtTacticsSchema,
} from './full-court-coaching.ts';

const STARTERS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;
const FULL_MINUTES = Object.fromEntries(STARTERS.map((playerId) => [playerId, 48]));

function plan(overrides: { rotation?: Record<string, unknown>; tactics?: unknown } = {}) {
  return {
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics: overrides.tactics ?? FULL_COURT_DEFAULT_TACTICS,
    ...(overrides.rotation === undefined ? {} : { rotation: overrides.rotation }),
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

  it('rejects unknown tactics and schema versions', () => {
    expect(
      accepts(plan({ tactics: { pace: 'warp', offense: 'balanced', defense: 'balanced' } })),
    ).toBe(false);
    expect(accepts({ ...plan(), schemaVersion: 2 })).toBe(false);
  });
});
