import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  fullCourtBlueprintSchema,
  fullCourtCoachingPlanSchema,
  playerIdSchema,
  type FullCourtCoachingPlan,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import {
  FULL_COURT_MAX_UNITS,
  applyFullCourtBlueprintToDraft,
  blueprintHierarchyFromDraft,
  defaultFullCourtCoachingDraft,
  fullCourtCoachingDraft,
  fullCourtCoachingPlan,
  fullCourtCoachingSignature,
  fullCourtPlayerHealthView,
  fullCourtTeamMinutes,
  fullCourtUnitNameForLineup,
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
    expect(draft.interfaceLevel).toBe('remix');
    expect(draft.rules).toEqual([]);
    expect(draft.staggerStars).toBe(false);
  });

  test('keeps a legacy plan clean and marks no false unsaved change', () => {
    const legacy: FullCourtCoachingPlan = {
      schemaVersion: 1,
      tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
      rotation: { ...DEFAULT_ROTATION },
    };
    const draft = fullCourtCoachingDraft(legacy, DEFAULT_ROTATION, ROSTER_IDS);

    expect(draft.interfaceLevel).toBe('remix');
    expect(draft.rules).toEqual([]);
    const emitted = fullCourtCoachingPlan(draft);
    expect(emitted).not.toHaveProperty('interfaceLevel');
    expect(emitted).not.toHaveProperty('rules');
    expect(fullCourtCoachingSignature(emitted)).toBe(fullCourtCoachingSignature(legacy));
  });

  test('round-trips offensive roles, passing reads, and unit overrides', () => {
    const saved: FullCourtCoachingPlan = {
      ...CUSTOM_PLAN,
      tactics: { ...CUSTOM_PLAN.tactics, offense: 'perimeter', ballMovement: true },
      units: [{ name: 'Closing group', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }],
      hierarchy: {
        primaryPlayerId: 'p2',
        secondaryPlayerId: 'p3',
        floorGeneralPlayerId: 'p1',
        passingReads: { p1: ['p2', 'p3'] },
        unitRoles: [
          {
            playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'],
            primaryPlayerId: 'p6',
          },
        ],
      },
    };
    const draft = fullCourtCoachingDraft(saved, DEFAULT_ROTATION, ROSTER_IDS);

    expect(draft.hierarchy).toEqual({
      primaryPlayerId: 'p2',
      secondaryPlayerId: 'p3',
      floorGeneralPlayerId: 'p1',
    });
    const emitted = fullCourtCoachingPlan(draft);
    expect(emitted.tactics).toEqual(saved.tactics);
    expect(emitted.hierarchy).toEqual(saved.hierarchy);
    expect(fullCourtCoachingPlanSchema.parse(emitted)).toEqual(emitted);
    expect(fullCourtCoachingSignature(emitted)).not.toBe(fullCourtCoachingSignature(CUSTOM_PLAN));
  });

  test('omits an unassigned hierarchy so legacy plans stay clean', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);

    expect(draft.hierarchy).toEqual({
      primaryPlayerId: null,
      secondaryPlayerId: null,
      floorGeneralPlayerId: null,
    });
    const emitted = fullCourtCoachingPlan(draft);
    expect(emitted).not.toHaveProperty('hierarchy');
    expect(fullCourtCoachingSignature(emitted)).toBe(fullCourtCoachingSignature(CUSTOM_PLAN));
  });

  test('keeps and edits hierarchy roles across interface levels', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);
    draft.interfaceLevel = 'mastermind';
    draft.hierarchy.primaryPlayerId = 'p4';
    const mastermind = fullCourtCoachingPlan(draft);
    expect(mastermind.hierarchy).toEqual({ primaryPlayerId: 'p4' });

    draft.interfaceLevel = 'quick';
    const quick = fullCourtCoachingPlan(draft);
    expect(quick.hierarchy).toEqual({ primaryPlayerId: 'p4' });
    expect(quick.interfaceLevel).toBe('quick');
  });

  test('defaults star staggering off and preserves it while the control is hidden', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);
    expect(draft.staggerStars).toBe(false);
    expect(fullCourtCoachingPlan(draft)).not.toHaveProperty('staggerStars');

    const saved: FullCourtCoachingPlan = {
      ...CUSTOM_PLAN,
      interfaceLevel: 'mastermind',
      hierarchy: { primaryPlayerId: 'p2', secondaryPlayerId: 'p3' },
      staggerStars: true,
    };
    const seeded = fullCourtCoachingDraft(saved, DEFAULT_ROTATION, ROSTER_IDS);
    expect(seeded.staggerStars).toBe(true);
    expect(fullCourtCoachingSignature(fullCourtCoachingPlan(seeded))).toBe(
      fullCourtCoachingSignature(saved),
    );

    seeded.interfaceLevel = 'quick';
    const quick = fullCourtCoachingPlan(seeded);
    expect(quick.staggerStars).toBe(true);
    expect(quick.hierarchy).toEqual(saved.hierarchy);
    expect(quick.interfaceLevel).toBe('quick');
    expect(fullCourtCoachingPlanSchema.parse(quick)).toEqual(quick);
  });

  test('seeds, emits, and preserves named units across interface levels', () => {
    const saved: FullCourtCoachingPlan = {
      ...CUSTOM_PLAN,
      interfaceLevel: 'mastermind',
      units: [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p7'] }],
    };
    const draft = fullCourtCoachingDraft(saved, DEFAULT_ROTATION, ROSTER_IDS);
    expect(draft.units).toEqual([{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p7'] }]);
    expect(fullCourtUnitNameForLineup(draft.units, ['p7', 'p4', 'p3', 'p2', 'p1'])).toBe('Bench');

    const mastermind = fullCourtCoachingPlan(draft);
    expect(fullCourtCoachingSignature(mastermind)).toBe(fullCourtCoachingSignature(saved));

    draft.interfaceLevel = 'quick';
    const quick = fullCourtCoachingPlan(draft);
    expect(quick.units).toEqual([{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p7'] }]);
    expect(fullCourtCoachingPlanSchema.parse(quick)).toEqual(quick);
    expect(quick.interfaceLevel).toBe('quick');
  });

  test('keeps named units editable without a custom rotation', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);
    draft.rotationMode = 'automatic';
    draft.units = [{ name: 'Small Ball', playerIds: ['p1', 'p2', 'p3', 'p6', 'p7'] }];
    const emitted = fullCourtCoachingPlan(draft);
    expect(emitted.rotation).toBeUndefined();
    expect(emitted.units).toEqual([
      { name: 'Small Ball', playerIds: ['p1', 'p2', 'p3', 'p6', 'p7'] },
    ]);
    expect(fullCourtCoachingPlanSchema.parse(emitted)).toEqual(emitted);
  });

  test('does not leave a dangling reference when a unit is removed', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);
    const unit = { name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] };
    draft.units = [unit];
    draft.rules = [
      {
        ruleId: 'rule-1',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 6,
        lineup: [...unit.playerIds],
      },
    ];
    draft.units = [];
    const emitted = fullCourtCoachingPlan(draft);
    expect(emitted.units).toBeUndefined();
    expect(emitted.rules?.[0]).toEqual({
      ruleId: 'rule-1',
      kind: 'closing-lineup',
      secondsRemainingMax: 360,
      scoreMarginMax: 6,
      lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
    });
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).valid).toBe(true);
  });

  test('preserves rotation, tactics, and rules when switching interface level', () => {
    const draft = fullCourtCoachingDraft(CUSTOM_PLAN, DEFAULT_ROTATION, ROSTER_IDS);
    draft.interfaceLevel = 'mastermind';
    draft.rules = [
      {
        ruleId: 'rule-1',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 6,
        lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
      },
    ];
    const plan = fullCourtCoachingPlan(draft);

    expect(plan.interfaceLevel).toBe('mastermind');
    expect(plan.rotation).toEqual(CUSTOM_PLAN.rotation);
    expect(plan.rules).toHaveLength(1);
    expect(fullCourtCoachingPlanSchema.parse(plan)).toEqual(plan);
    expect(fullCourtCoachingSignature({ ...plan, interfaceLevel: 'quick' })).not.toBe(
      fullCourtCoachingSignature(plan),
    );
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

  test('validates ordered coaching rules', () => {
    const draft = customDraft();
    draft.rules = [
      {
        ruleId: 'rule-1',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 6,
        lineup: ['p1', 'p2', 'p3', 'p4', 'p8'],
      },
      {
        ruleId: 'rule-2',
        kind: 'foul-trouble',
        playerId: 'p2',
        foulLimit: 4,
        replacementPlayerId: 'p2',
      },
    ];

    const validation = validateFullCourtCoachingDraft(draft, ROSTER_IDS);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(
      'Rule rule-2 needs a different replacement from your roster.',
    );

    draft.rules[1] = {
      ruleId: 'rule-2',
      kind: 'foul-trouble',
      playerId: 'p2',
      foulLimit: 4,
      replacementPlayerId: 'p6',
    };
    const firstRule = draft.rules[0];
    if (firstRule === undefined) throw new Error('expected a closing rule');
    draft.rules.push({ ...firstRule });
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Every coaching rule needs a unique id.',
    );
  });

  test('validates the scoring hierarchy against the roster and its own roles', () => {
    const draft = customDraft();
    draft.hierarchy.primaryPlayerId = 'missing-player';
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'The scoring hierarchy includes a player outside your roster.',
    );

    draft.hierarchy.primaryPlayerId = 'p2';
    draft.hierarchy.secondaryPlayerId = 'p2';
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Each scoring role needs a different player.',
    );

    draft.hierarchy.secondaryPlayerId = 'p3';
    draft.hierarchy.floorGeneralPlayerId = 'p1';
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).valid).toBe(true);
  });

  test('validates named unit names and roster membership', () => {
    const draft = customDraft();
    draft.units = [
      { name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] },
      { name: ' bench ', playerIds: ['p1', 'p2', 'p3', 'p4', 'p7'] },
    ];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Named unit names must be unique.',
    );

    draft.units = [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p1'] }];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Named unit Bench needs five different players from your roster.',
    );

    draft.units = [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'outside'] }];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Named unit Bench needs five different players from your roster.',
    );

    draft.units = [{ name: ' ', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      'Name each named unit in 32 characters or fewer.',
    );

    draft.units = Array.from({ length: FULL_COURT_MAX_UNITS + 1 }, (_value, index) => ({
      name: `Unit ${String(index + 1)}`,
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'],
    }));
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).errors).toContain(
      `Use ${String(FULL_COURT_MAX_UNITS)} named units or fewer.`,
    );

    draft.units = [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }];
    expect(validateFullCourtCoachingDraft(draft, ROSTER_IDS).valid).toBe(true);
  });

  test('validates a named unit plan with a six-player roster', () => {
    const rosterIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const rotation = {
      startingFive: rosterIds.slice(0, 5),
      minuteTargets: Object.fromEntries(rosterIds.map((playerId) => [playerId, 40])),
    };
    const draft = fullCourtCoachingDraft(
      {
        schemaVersion: 1,
        tactics: { pace: 'balanced', offense: 'balanced', defense: 'balanced' },
        rotation,
      },
      rotation,
      rosterIds,
    );
    draft.units = [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p5', 'p6'] }];

    const validation = validateFullCourtCoachingDraft(draft, rosterIds);
    expect(validation.valid).toBe(true);
    expect(validation.totalMinutes).toBe(240);
    expect(fullCourtCoachingPlanSchema.parse(fullCourtCoachingPlan(draft)).units).toEqual(
      draft.units,
    );
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

    const withUnit = {
      ...base,
      units: [{ name: 'Bench', playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }],
    };
    expect(fullCourtCoachingSignature(withUnit)).not.toBe(fullCourtCoachingSignature(base));
  });
});

describe('Full Court blueprint presenter glue', () => {
  test('extracts portable roles using the active rotation (automatic vs custom) without pinning player IDs', () => {
    const draft = fullCourtCoachingDraft(
      {
        ...CUSTOM_PLAN,
        interfaceLevel: 'mastermind',
        hierarchy: {
          primaryPlayerId: 'p1',
          secondaryPlayerId: 'p6',
          floorGeneralPlayerId: 'p2',
        },
      },
      DEFAULT_ROTATION,
      ROSTER_IDS,
    );

    const customHierarchy = blueprintHierarchyFromDraft(draft, ROSTER, DEFAULT_ROTATION);
    expect(customHierarchy).toMatchObject({
      primary: {
        kind: 'starter-slot',
        slot: 0,
        preferredPositions: ['PG'],
      },
      secondary: {
        kind: 'bench-slot',
        benchIndex: 0,
        preferredPositions: ['C'],
      },
      floorGeneral: {
        kind: 'starter-slot',
        slot: 1,
        preferredPositions: ['PG'],
      },
    });
    expect(typeof customHierarchy?.primary?.archetype).toBe('string');
    expect(typeof customHierarchy?.secondary?.archetype).toBe('string');
    expect(typeof customHierarchy?.floorGeneral?.archetype).toBe('string');

    // When switching to automatic rotation, stale custom starter slots are ignored in favor of defaultRotation.
    draft.rotationMode = 'automatic';
    draft.startingFive = ['p8', 'p7', 'p6', 'p5', 'p4'];
    const autoHierarchy = blueprintHierarchyFromDraft(draft, ROSTER, DEFAULT_ROTATION);
    expect(autoHierarchy?.primary).toMatchObject({ kind: 'starter-slot', slot: 0 });
  });

  test('applies blueprint tactics and portable roles while preserving rotations, rules, and interface level', () => {
    const draft = fullCourtCoachingDraft(
      {
        ...CUSTOM_PLAN,
        interfaceLevel: 'quick',
        rules: [
          {
            ruleId: 'rule-1',
            kind: 'closing-lineup',
            secondsRemainingMax: 300,
            scoreMarginMax: 5,
            lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
          },
        ],
        hierarchy: {
          primaryPlayerId: 'p1',
        },
      },
      DEFAULT_ROTATION,
      ROSTER_IDS,
    );

    // Tactics-only blueprint preserves existing hierarchy and rotation.
    const legacyBlueprint = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: 'Legacy Pace',
      tactics: { pace: 'slow', offense: 'interior', defense: 'protect-paint' },
    });
    const afterLegacy = applyFullCourtBlueprintToDraft(
      draft,
      legacyBlueprint,
      ROSTER,
      DEFAULT_ROTATION,
    );
    expect(afterLegacy.changed).toBe(true);
    expect(afterLegacy.draft.tactics).toEqual(legacyBlueprint.tactics);
    expect(afterLegacy.draft.hierarchy).toEqual({
      primaryPlayerId: 'p1',
      secondaryPlayerId: null,
      floorGeneralPlayerId: null,
    });
    expect(afterLegacy.draft.rotationMode).toBe('custom');
    expect(afterLegacy.draft.startingFive).toEqual(DEFAULT_ROTATION.startingFive);
    expect(afterLegacy.draft.rules).toEqual(draft.rules);
    expect(afterLegacy.draft.interfaceLevel).toBe('quick');

    // Blueprint with portable roles updates tactics and binds distinct roles, flagging ties deterministically.
    const roleBlueprint = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: 'Two Guard Plus Wing',
      tactics: { pace: 'fast', offense: 'ball-movement', defense: 'pressure' },
      hierarchy: {
        primary: { kind: 'starter-slot', slot: 3, preferredPositions: ['SF'] },
        secondary: { kind: 'bench-slot', benchIndex: 4, preferredPositions: ['PG'] },
        floorGeneral: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
      },
    });
    const afterRoles = applyFullCourtBlueprintToDraft(
      afterLegacy.draft,
      roleBlueprint,
      ROSTER,
      DEFAULT_ROTATION,
    );
    expect(afterRoles.draft.tactics).toEqual(roleBlueprint.tactics);
    expect(afterRoles.draft.rotationMode).toBe('custom');
    expect(afterRoles.draft.startingFive).toEqual(DEFAULT_ROTATION.startingFive);
    expect(afterRoles.draft.rules).toEqual(draft.rules);
    expect(afterRoles.draft.interfaceLevel).toBe('quick');
    expect(afterRoles.draft.hierarchy).toEqual({
      primaryPlayerId: 'p4',
      secondaryPlayerId: 'p2',
      floorGeneralPlayerId: 'p1',
    });
    expect(afterRoles.preview.hasAmbiguous).toBe(true);
    expect(afterRoles.preview.hasFallback).toBe(false);
    expect(afterRoles.preview.hasMissingOrVacant).toBe(false);
    expect(afterRoles.preview.bindings.map((b) => [b.role, b.status, b.playerId])).toEqual([
      ['primary', 'matched', 'p4'],
      ['secondary', 'ambiguous', 'p2'],
      ['floorGeneral', 'matched', 'p1'],
    ]);
    expect(afterRoles.preview.bindings[1]?.tiedCandidates.map((p) => p.playerId)).toEqual([
      playerIdSchema.parse('p2'),
      playerIdSchema.parse('p3'),
    ]);
    expect(afterRoles.preview.bindings[1]?.reason).toContain('Bench 5 is not available');
    expect(afterRoles.preview.bindings[1]?.reason).toContain('Ambiguous fallback');

    // Clear fallback + vacant case on a distinct-rated 6-player roster.
    const distinctSix: SimulationPlayer[] = [
      buildSimulationPlayer({
        playerId: playerIdSchema.parse('p1'),
        displayName: 'Lead Guard',
        positions: ['PG'],
      }),
      buildSimulationPlayer({
        playerId: playerIdSchema.parse('p2'),
        displayName: 'Shooting Guard',
        positions: ['SG'],
      }),
      ...ROSTER.slice(2, 6).map((player, index) => {
        const base = buildSimulationPlayer({
          playerId: player.playerId,
          displayName: player.displayName,
          positions: [index === 0 ? 'SF' : index === 1 ? 'PF' : 'C'],
        });
        return {
          ...base,
          ratings: { ...base.ratings, passing: 35, ballHandling: 35 },
        };
      }),
    ];
    const sixRotation = {
      startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
      minuteTargets: { p1: 42, p2: 42, p3: 42, p4: 42, p5: 42, p6: 30 },
    };
    const fallbackAndVacantBlueprint = fullCourtBlueprintSchema.parse({
      schemaVersion: 1,
      name: 'Fallback And Vacant',
      tactics: { pace: 'balanced', offense: 'perimeter', defense: 'balanced' },
      hierarchy: {
        primary: { kind: 'starter-slot', slot: 0, preferredPositions: ['PG'] },
        secondary: { kind: 'bench-slot', benchIndex: 4, preferredPositions: ['SG'] },
        floorGeneral: { kind: 'bench-slot', benchIndex: 2, preferredPositions: ['PG'] },
      },
    });
    const afterFallbackAndVacant = applyFullCourtBlueprintToDraft(
      afterRoles.draft,
      fallbackAndVacantBlueprint,
      distinctSix,
      sixRotation,
    );
    expect(afterFallbackAndVacant.preview.hasFallback).toBe(true);
    expect(afterFallbackAndVacant.preview.hasMissingOrVacant).toBe(true);
    expect(afterFallbackAndVacant.preview.hasAmbiguous).toBe(false);
    expect(
      afterFallbackAndVacant.preview.bindings.map((b) => [b.role, b.status, b.playerId]),
    ).toEqual([
      ['primary', 'matched', 'p1'],
      ['secondary', 'fallback', 'p2'],
      ['floorGeneral', 'vacant', null],
    ]);
    expect(afterFallbackAndVacant.draft.hierarchy).toEqual({
      primaryPlayerId: 'p1',
      secondaryPlayerId: 'p2',
      floorGeneralPlayerId: null,
    });
    expect(afterFallbackAndVacant.draft.rules).toEqual(draft.rules);
    expect(afterFallbackAndVacant.draft.interfaceLevel).toBe('quick');
  });
});
