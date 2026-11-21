import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  fullCourtCoachingPlanSchema,
  playerIdSchema,
  type FullCourtCoachingPlan,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import {
  defaultFullCourtCoachingDraft,
  fullCourtCoachingDraft,
  fullCourtCoachingPlan,
  fullCourtCoachingSignature,
  fullCourtPlayerHealthView,
  fullCourtTeamMinutes,
  validateFullCourtCoachingDraft,
  type FullCourtCoachingDraft,
} from './full-court-coaching-presenter.ts';

const ROSTER: readonly SimulationPlayer[] = Array.from({ length: 8 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p${String(index + 1)}`),
    displayName: `Player ${String(index + 1)}`,
    positions: [index < 3 ? 'PG' : index < 5 ? 'SF' : 'C'],
  }),
);
const ROSTER_IDS = ROSTER.map((player) => player.playerId);
const DEFAULT_ROTATION: NonNullable<FullCourtCoachingPlan['rotation']> = {
  startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
  minuteTargets: { p1: 40, p2: 38, p3: 36, p4: 34, p5: 32, p6: 28, p7: 20, p8: 12 },
};
const CUSTOM_PLAN: FullCourtCoachingPlan = {
  schemaVersion: 1,
  tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
  rotation: { ...DEFAULT_ROTATION },
};

function customDraft(): FullCourtCoachingDraft {
  const draft = fullCourtCoachingDraft(
    FULL_COURT_DEFAULT_COACHING_PLAN,
    DEFAULT_ROTATION,
    ROSTER_IDS,
  );
  draft.rotationMode = 'custom';
  return draft;
}

describe('Full Court coaching draft', () => {
  test('seeds an automatic plan with the default rotation values for later editing', () => {
    const draft = fullCourtCoachingDraft(
      FULL_COURT_DEFAULT_COACHING_PLAN,
      DEFAULT_ROTATION,
      ROSTER_IDS,
    );

    expect(draft.rotationMode).toBe('automatic');
    expect(draft.startingFive).toEqual(DEFAULT_ROTATION.startingFive);
    expect(draft.minuteTargets).toEqual(DEFAULT_ROTATION.minuteTargets);
    expect(draft.closingFive).toBeNull();
  });

  test('uses a saved custom rotation instead of the default rotation', () => {
    const saved: FullCourtCoachingPlan = {
      schemaVersion: 1,
      tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
      rotation: {
        startingFive: ['p6', 'p7', 'p8', 'p1', 'p2'],
        minuteTargets: { p1: 42, p2: 42, p6: 42, p7: 42, p8: 42, p3: 30 },
        closingFive: ['p6', 'p7', 'p8', 'p1', 'p2'],
      },
    };

    const draft = fullCourtCoachingDraft(saved, DEFAULT_ROTATION, ROSTER_IDS);
    const savedRotation = saved.rotation;
    if (savedRotation === undefined) throw new Error('expected a saved rotation');

    expect(draft.rotationMode).toBe('custom');
    expect(draft.tactics).toEqual(saved.tactics);
    expect(draft.startingFive).toEqual(savedRotation.startingFive);
    expect(draft.closingFive).toEqual(savedRotation.closingFive ?? null);
    expect(draft.minuteTargets).toEqual({
      p1: 42,
      p2: 42,
      p3: 30,
      p4: 0,
      p5: 0,
      p6: 42,
      p7: 42,
      p8: 42,
    });
  });

  test('emits tactics only for automatic rotation', () => {
    const plan = fullCourtCoachingPlan(customDraft());

    expect(
      fullCourtCoachingPlan({
        ...customDraft(),
        rotationMode: 'automatic',
        tactics: { pace: 'slow', offense: 'interior', defense: 'protect-paint' },
      }),
    ).toEqual({
      schemaVersion: 1,
      tactics: { pace: 'slow', offense: 'interior', defense: 'protect-paint' },
    });
    expect(plan.rotation).toBeDefined();
    expect(fullCourtCoachingPlanSchema.parse(plan)).toEqual(plan);
  });

  test('resets to balanced tactics with automatic rotation and default values', () => {
    const draft = defaultFullCourtCoachingDraft(DEFAULT_ROTATION, ROSTER_IDS);

    expect(draft.tactics).toEqual({ pace: 'balanced', offense: 'balanced', defense: 'balanced' });
    expect(draft.rotationMode).toBe('automatic');
    expect(draft.minuteTargets).toEqual(DEFAULT_ROTATION.minuteTargets);
  });
});

describe('Full Court coaching validation', () => {
  test('accepts a complete custom rotation', () => {
    const validation = validateFullCourtCoachingDraft(customDraft(), ROSTER_IDS);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(validation.totalMinutes).toBe(240);
    expect(validation.remainingMinutes).toBe(0);
  });

  test('requires exactly 240 minutes', () => {
    const draft = customDraft();
    draft.minuteTargets.p8 = 11;

    const validation = validateFullCourtCoachingDraft(draft, ROSTER_IDS);

    expect(validation.valid).toBe(false);
    expect(validation.totalMinutes).toBe(239);
    expect(validation.remainingMinutes).toBe(1);
    expect(validation.errors).toContain('Add 1 more minute to reach 240.');
  });

  test('rejects repeated starters and out-of-range targets', () => {
    const draft = customDraft();
    draft.startingFive[4] = draft.startingFive[0] ?? '';
    draft.minuteTargets.p8 = 49;

    const validation = validateFullCourtCoachingDraft(draft, ROSTER_IDS);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Choose five different starters from your roster.');
    expect(validation.errors).toContain('Use whole minutes between 0 and 48 for every player.');
  });

  test('rejects a repeated closer only when a closing five is set', () => {
    const draft = customDraft();
    draft.closingFive = ['p1', 'p2', 'p3', 'p4', 'p4'];

    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Choose five different closers from your roster.',
    );

    draft.closingFive = null;
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).valid).toBe(true);
  });

  test('does not require a rotation for automatic mode', () => {
    const draft = customDraft();
    draft.rotationMode = 'automatic';
    draft.startingFive = [];
    draft.minuteTargets = {};

    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).valid).toBe(true);
  });

  test('flags a selected starter or closer with a zero-minute target', () => {
    const draft = customDraft();
    draft.minuteTargets.p7 = (draft.minuteTargets.p7 ?? 0) + (draft.minuteTargets.p8 ?? 0);
    draft.minuteTargets.p8 = 0;
    draft.startingFive[4] = 'p8';
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Assign at least one minute to each starter and closer.',
    );

    draft.startingFive[4] = 'p5';
    draft.closingFive = ['p1', 'p2', 'p3', 'p4', 'p8'];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Assign at least one minute to each starter and closer.',
    );
  });
});

describe('Full Court team minutes', () => {
  test('orders starters by slot and the bench by workload', () => {
    const draft = customDraft();
    const view = fullCourtTeamMinutes(draft, ROSTER, CUSTOM_PLAN);

    expect(view.starters.map((row) => String(row.player.playerId))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
    ]);
    expect(view.starters[0]?.starterSlot).toBe(0);
    expect(view.bench.map((row) => String(row.player.playerId))).toEqual(['p6', 'p7', 'p8']);
    expect(view.bench.every((row) => row.starterSlot === null)).toBe(true);
    expect(view.starterMinutes).toBe(180);
    expect(view.benchMinutes).toBe(60);
  });

  test('marks closers and reads saved minutes beside the draft', () => {
    const draft = customDraft();
    draft.closingFive = ['p1', 'p2', 'p3', 'p4', 'p6'];
    draft.minuteTargets.p6 = 24;
    const view = fullCourtTeamMinutes(draft, ROSTER, CUSTOM_PLAN);
    const closer = view.bench.find((row) => row.player.playerId === 'p6');

    expect(closer?.closer).toBe(true);
    expect(closer?.minutes).toBe(24);
    expect(closer?.savedMinutes).toBe(28);
    expect(view.starters[0]?.savedMinutes).toBe(40);
  });

  test('reads health into an availability label for the fixture day', () => {
    const draft = customDraft();
    const health = {
      version: 'full-court-health-v1' as const,
      teamId: 'team',
      throughDay: 10,
      players: {
        p1: { loadBasisPoints: 9_000, availableFromDay: null },
        p2: { loadBasisPoints: 0, availableFromDay: 14 },
      },
    };
    const view = fullCourtTeamMinutes(draft, ROSTER, CUSTOM_PLAN, health, 11);

    expect(view.starters[0]?.health).toEqual({ tone: 'fatigued', label: 'Heavy load 90%' });
    expect(view.starters[1]?.health).toEqual({ tone: 'unavailable', label: 'Out to day 14' });
    expect(view.starters[2]?.health).toBeNull();
  });

  test('treats a return day on the fixture day as available', () => {
    expect(fullCourtPlayerHealthView({ loadBasisPoints: 0, availableFromDay: 11 }, 11)).toEqual({
      tone: 'available',
      label: 'Load 0%',
    });
    expect(fullCourtPlayerHealthView({ loadBasisPoints: 0, availableFromDay: 12 }, 11)).toEqual({
      tone: 'unavailable',
      label: 'Out to day 12',
    });
  });
});

describe('Full Court coaching signature', () => {
  test('matches equal plans and ignores key order in minute targets', () => {
    const left = fullCourtCoachingPlan(customDraft());
    const draft = customDraft();
    draft.minuteTargets = { p8: 12, p7: 20, p6: 28, p5: 32, p4: 34, p3: 36, p2: 38, p1: 40 };
    const right = fullCourtCoachingPlan(draft);

    expect(fullCourtCoachingSignature(left)).toBe(fullCourtCoachingSignature(right));
  });

  test('changes when tactics, rotation mode, or minute targets change', () => {
    const base = fullCourtCoachingPlan(customDraft());

    expect(
      fullCourtCoachingSignature({
        ...base,
        tactics: { ...base.tactics, pace: 'slow' },
      }),
    ).not.toBe(fullCourtCoachingSignature(base));

    const draft = customDraft();
    draft.minuteTargets.p1 = 39;
    draft.minuteTargets.p2 = 39;
    expect(fullCourtCoachingSignature(fullCourtCoachingPlan(draft))).not.toBe(
      fullCourtCoachingSignature(base),
    );

    const automatic = { ...base, rotation: undefined };
    expect(fullCourtCoachingSignature(automatic)).not.toBe(fullCourtCoachingSignature(base));
  });
});
