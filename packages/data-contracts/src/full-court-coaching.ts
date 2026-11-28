import { z } from 'zod';
import { positionUnionSchema } from './positions.ts';

export const FULL_COURT_COACHING_SCHEMA_VERSION = 1;
export const FULL_COURT_BLUEPRINT_SCHEMA_VERSION = 1;
export const FULL_COURT_BLUEPRINT_MAX_NAME_LENGTH = 48;
export const FULL_COURT_MAX_COACHING_RULES = 8;
export const FULL_COURT_MAX_NAMED_UNITS = 6;
export const FULL_COURT_UNIT_MINUTE_BUDGET = 12;
export const FULL_COURT_MAX_UNIT_NAME_LENGTH = 32;

const FULL_COURT_MINUTE_TOTAL = 240;
const FULL_COURT_MIN_ROTATION_PLAYERS = 5;
const FULL_COURT_MAX_ROTATION_PLAYERS = 12;
const FULL_COURT_MAX_PLAYER_MINUTES = 48;
const FULL_COURT_REGULATION_SECONDS = 48 * 60;
const FULL_COURT_MAX_RULE_SCORE_MARGIN = 40;
const FULL_COURT_MAX_RULE_ID_LENGTH = 32;

const playerRefSchema = z.string().min(1).max(64);

export const fullCourtTacticsSchema = z.object({
  pace: z.enum(['slow', 'balanced', 'fast']),
  offense: z.enum(['balanced', 'perimeter', 'interior', 'ball-movement']),
  defense: z.enum(['balanced', 'pressure', 'protect-paint']),
  ballMovement: z.literal(true).optional(),
});
export type FullCourtTactics = z.infer<typeof fullCourtTacticsSchema>;

export const fullCourtBlueprintNameSchema = z
  .string()
  .trim()
  .normalize()
  .min(1, 'Enter a strategy name.')
  .max(FULL_COURT_BLUEPRINT_MAX_NAME_LENGTH, 'Use 48 characters or fewer for the strategy name.');

export const FULL_COURT_BLUEPRINT_ROLE_KEYS = ['primary', 'secondary', 'floorGeneral'] as const;
export type FullCourtBlueprintRoleKey = (typeof FULL_COURT_BLUEPRINT_ROLE_KEYS)[number];

export const FULL_COURT_BLUEPRINT_ARCHETYPES = [
  'primaryCreator',
  'secondaryCreator',
  'floorSpacer',
  'rimRunner',
  'postAnchor',
  'glue',
] as const;
export type FullCourtBlueprintArchetype = (typeof FULL_COURT_BLUEPRINT_ARCHETYPES)[number];

const fullCourtBlueprintStarterSlotRefSchema = z
  .object({
    kind: z.literal('starter-slot'),
    slot: z
      .number()
      .int()
      .min(0)
      .max(FULL_COURT_MIN_ROTATION_PLAYERS - 1),
    preferredPositions: positionUnionSchema.optional(),
    archetype: z.enum(FULL_COURT_BLUEPRINT_ARCHETYPES).optional(),
  })
  .strict();

const fullCourtBlueprintBenchSlotRefSchema = z
  .object({
    kind: z.literal('bench-slot'),
    benchIndex: z
      .number()
      .int()
      .min(0)
      .max(FULL_COURT_MAX_ROTATION_PLAYERS - FULL_COURT_MIN_ROTATION_PLAYERS - 1),
    preferredPositions: positionUnionSchema.optional(),
    archetype: z.enum(FULL_COURT_BLUEPRINT_ARCHETYPES).optional(),
  })
  .strict();

const fullCourtBlueprintRoleFitRefSchema = z
  .object({
    kind: z.literal('role-fit'),
    preferredPositions: positionUnionSchema.optional(),
    archetype: z.enum(FULL_COURT_BLUEPRINT_ARCHETYPES).optional(),
  })
  .strict()
  .refine(
    (ref) => ref.preferredPositions !== undefined || ref.archetype !== undefined,
    'role-fit references require preferredPositions or an archetype',
  );

/**
 * Portable scoring role reference stored on reusable strategy blueprints.
 * Never stores run-scoped player IDs; binds via tactical slot or role-fit on apply.
 */
export const fullCourtBlueprintRoleRefSchema = z.discriminatedUnion('kind', [
  fullCourtBlueprintStarterSlotRefSchema,
  fullCourtBlueprintBenchSlotRefSchema,
  fullCourtBlueprintRoleFitRefSchema,
]);
export type FullCourtBlueprintRoleRef = z.infer<typeof fullCourtBlueprintRoleRefSchema>;

export const fullCourtBlueprintHierarchySchema = z
  .object({
    primary: fullCourtBlueprintRoleRefSchema.optional(),
    secondary: fullCourtBlueprintRoleRefSchema.optional(),
    floorGeneral: fullCourtBlueprintRoleRefSchema.optional(),
  })
  .strict()
  .superRefine((hierarchy, context) => {
    const slotKeys = new Set<string>();
    let assignedCount = 0;
    for (const key of FULL_COURT_BLUEPRINT_ROLE_KEYS) {
      const ref = hierarchy[key];
      if (ref === undefined) continue;
      assignedCount += 1;
      if (ref.kind === 'role-fit') continue;
      const slotKey =
        ref.kind === 'starter-slot'
          ? `starter:${String(ref.slot)}`
          : `bench:${String(ref.benchIndex)}`;
      if (slotKeys.has(slotKey)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'each portable scoring role must target a different slot',
        });
      }
      slotKeys.add(slotKey);
    }
    if (assignedCount === 0) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'assign at least one portable scoring role or omit hierarchy',
      });
    }
  });
export type FullCourtBlueprintHierarchy = z.infer<typeof fullCourtBlueprintHierarchySchema>;

export const fullCourtBlueprintSchema = z.object({
  schemaVersion: z.literal(FULL_COURT_BLUEPRINT_SCHEMA_VERSION),
  name: fullCourtBlueprintNameSchema,
  tactics: fullCourtTacticsSchema,
  hierarchy: fullCourtBlueprintHierarchySchema.optional(),
});
export type FullCourtBlueprint = z.infer<typeof fullCourtBlueprintSchema>;

function normalizeBlueprintRoleRef(ref: FullCourtBlueprintRoleRef): FullCourtBlueprintRoleRef {
  const hints = {
    ...(ref.preferredPositions === undefined ? {} : { preferredPositions: ref.preferredPositions }),
    ...(ref.archetype === undefined ? {} : { archetype: ref.archetype }),
  };
  switch (ref.kind) {
    case 'starter-slot':
      return { kind: 'starter-slot', slot: ref.slot, ...hints };
    case 'bench-slot':
      return { kind: 'bench-slot', benchIndex: ref.benchIndex, ...hints };
    case 'role-fit':
      return { kind: 'role-fit', ...hints };
  }
}

export function normalizeFullCourtBlueprint(input: FullCourtBlueprint): FullCourtBlueprint {
  const parsed = fullCourtBlueprintSchema.parse(input);
  if (parsed.hierarchy === undefined) {
    return {
      schemaVersion: parsed.schemaVersion,
      name: parsed.name,
      tactics: { ...parsed.tactics },
    };
  }
  const hierarchy: FullCourtBlueprintHierarchy = {
    ...(parsed.hierarchy.primary === undefined
      ? {}
      : { primary: normalizeBlueprintRoleRef(parsed.hierarchy.primary) }),
    ...(parsed.hierarchy.secondary === undefined
      ? {}
      : { secondary: normalizeBlueprintRoleRef(parsed.hierarchy.secondary) }),
    ...(parsed.hierarchy.floorGeneral === undefined
      ? {}
      : { floorGeneral: normalizeBlueprintRoleRef(parsed.hierarchy.floorGeneral) }),
  };
  return {
    schemaVersion: parsed.schemaVersion,
    name: parsed.name,
    tactics: { ...parsed.tactics },
    hierarchy,
  };
}

export function fullCourtBlueprintNameKey(name: string): string {
  return name.trim().normalize().toLowerCase().normalize();
}

export const FULL_COURT_DEFAULT_TACTICS: FullCourtTactics = fullCourtTacticsSchema.parse({
  pace: 'balanced',
  offense: 'balanced',
  defense: 'balanced',
});

function hasDuplicates(ids: readonly string[]): boolean {
  return new Set(ids).size !== ids.length;
}

/** A reusable, roster-bound five used by closing rules or the closing five. */
export const fullCourtNamedUnitSchema = z.object({
  name: z
    .string()
    .trim()
    .normalize()
    .min(1, 'Enter a unit name.')
    .max(
      FULL_COURT_MAX_UNIT_NAME_LENGTH,
      `Use ${String(FULL_COURT_MAX_UNIT_NAME_LENGTH)} characters or fewer for the unit name.`,
    ),
  playerIds: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS),
  plannedMinutes: z.number().int().min(1).max(FULL_COURT_UNIT_MINUTE_BUDGET).optional(),
});
export type FullCourtNamedUnit = z.infer<typeof fullCourtNamedUnitSchema>;

export const fullCourtNamedUnitsSchema = z
  .array(fullCourtNamedUnitSchema)
  .max(
    FULL_COURT_MAX_NAMED_UNITS,
    `Use ${String(FULL_COURT_MAX_NAMED_UNITS)} named units or fewer.`,
  )
  .superRefine((units, context) => {
    const total = units.reduce((minutes, unit) => minutes + (unit.plannedMinutes ?? 0), 0);
    if (total > FULL_COURT_UNIT_MINUTE_BUDGET) {
      context.addIssue({
        code: 'custom',
        message: 'Named units share 12 planned minutes in the second quarter.',
      });
    }
    const names = new Set<string>();
    units.forEach((unit, index) => {
      const key = unit.name.toLowerCase();
      if (names.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'named unit names must be unique',
        });
      }
      names.add(key);
      if (hasDuplicates(unit.playerIds)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'playerIds'],
          message: 'named unit players must be unique',
        });
      }
    });
  });

const fullCourtRotationSchema = z
  .object({
    startingFive: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS),
    minuteTargets: z.record(
      playerRefSchema,
      z.number().int().min(0).max(FULL_COURT_MAX_PLAYER_MINUTES),
    ),
    closingFive: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS).optional(),
  })
  .superRefine((rotation, context) => {
    const targetIds = Object.keys(rotation.minuteTargets);
    if (
      targetIds.length < FULL_COURT_MIN_ROTATION_PLAYERS ||
      targetIds.length > FULL_COURT_MAX_ROTATION_PLAYERS
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minuteTargets'],
        message: `a rotation requires ${String(FULL_COURT_MIN_ROTATION_PLAYERS)} to ${String(FULL_COURT_MAX_ROTATION_PLAYERS)} minute targets`,
      });
    }
    const total = Object.values(rotation.minuteTargets).reduce((sum, minutes) => sum + minutes, 0);
    if (total !== FULL_COURT_MINUTE_TOTAL) {
      context.addIssue({
        code: 'custom',
        path: ['minuteTargets'],
        message: `minute targets must total ${String(FULL_COURT_MINUTE_TOTAL)}`,
      });
    }
    if (hasDuplicates(rotation.startingFive)) {
      context.addIssue({
        code: 'custom',
        path: ['startingFive'],
        message: 'starters must be unique',
      });
    }
    if (rotation.closingFive !== undefined && hasDuplicates(rotation.closingFive)) {
      context.addIssue({
        code: 'custom',
        path: ['closingFive'],
        message: 'closers must be unique',
      });
    }
    const requireTargets = (
      players: readonly string[],
      path: 'startingFive' | 'closingFive',
      label: 'starter' | 'closer',
    ): void => {
      for (const playerId of players) {
        const minutes = Object.hasOwn(rotation.minuteTargets, playerId)
          ? rotation.minuteTargets[playerId]
          : undefined;
        if (minutes === undefined) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: `${label} ${playerId} is missing a minute target`,
          });
        } else if (minutes <= 0) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: `${label} ${playerId} requires positive minutes`,
          });
        }
      }
    };
    requireTargets(rotation.startingFive, 'startingFive', 'starter');
    if (rotation.closingFive !== undefined) {
      requireTargets(rotation.closingFive, 'closingFive', 'closer');
    }
  });

const fullCourtClosingLineupRuleSchema = z.object({
  ruleId: z.string().trim().min(1).max(FULL_COURT_MAX_RULE_ID_LENGTH),
  kind: z.literal('closing-lineup'),
  /**
   * Regulation seconds remaining at or below which the rule may run. Overtime
   * counts as zero, so a rule that reaches the end of regulation stays live.
   */
  secondsRemainingMax: z.number().int().min(0).max(FULL_COURT_REGULATION_SECONDS),
  /** Absolute score difference at or below which the rule may run. */
  scoreMarginMax: z.number().int().min(0).max(FULL_COURT_MAX_RULE_SCORE_MARGIN),
  lineup: z.array(playerRefSchema).length(FULL_COURT_MIN_ROTATION_PLAYERS),
});

const fullCourtFoulTroubleRuleSchema = z.object({
  ruleId: z.string().trim().min(1).max(FULL_COURT_MAX_RULE_ID_LENGTH),
  kind: z.literal('foul-trouble'),
  playerId: playerRefSchema,
  /** Personal fouls at which the player is replaced; disqualification is six. */
  foulLimit: z.number().int().min(1).max(5),
  /** Bench player to use; omit to use the staff's best available reserve. */
  replacementPlayerId: playerRefSchema.optional(),
});

/** Ordered coaching rules: the first applicable rule wins per decision window. */
export const fullCourtCoachingRuleSchema = z.discriminatedUnion('kind', [
  fullCourtClosingLineupRuleSchema,
  fullCourtFoulTroubleRuleSchema,
]);
export type FullCourtCoachingRule = z.infer<typeof fullCourtCoachingRuleSchema>;
export type FullCourtClosingLineupRule = z.infer<typeof fullCourtClosingLineupRuleSchema>;
export type FullCourtFoulTroubleRule = z.infer<typeof fullCourtFoulTroubleRuleSchema>;

export const fullCourtCoachingRulesSchema = z
  .array(fullCourtCoachingRuleSchema)
  .max(FULL_COURT_MAX_COACHING_RULES)
  .superRefine((rules, context) => {
    const ids = new Set<string>();
    rules.forEach((rule, index) => {
      if (ids.has(rule.ruleId)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'ruleId'],
          message: 'rule ids must be unique',
        });
      }
      ids.add(rule.ruleId);
      if (rule.kind === 'closing-lineup' && hasDuplicates(rule.lineup)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'lineup'],
          message: 'rule lineups must be unique',
        });
      }
      if (
        rule.kind === 'foul-trouble' &&
        rule.replacementPlayerId !== undefined &&
        rule.replacementPlayerId === rule.playerId
      ) {
        context.addIssue({
          code: 'custom',
          path: [index, 'replacementPlayerId'],
          message: 'a foul-trouble replacement must differ from the player',
        });
      }
    });
  });

export const FULL_COURT_INTERFACE_LEVELS = ['quick', 'remix', 'mastermind'] as const;
export const fullCourtInterfaceLevelSchema = z.enum(FULL_COURT_INTERFACE_LEVELS);
export type FullCourtInterfaceLevel = z.infer<typeof fullCourtInterfaceLevelSchema>;

/**
 * Offensive hierarchy for the user plan. Roles are optional and distinct; when
 * absent the prepared lineup is untouched. `floorGeneralPlayerId` is the
 * supporting creator, not a third scorer.
 */
export const fullCourtOffensiveHierarchySchema = z
  .object({
    primaryPlayerId: playerRefSchema.optional(),
    secondaryPlayerId: playerRefSchema.optional(),
    floorGeneralPlayerId: playerRefSchema.optional(),
    passingReads: z.record(playerRefSchema, z.array(playerRefSchema).min(1).max(2)).optional(),
    unitRoles: z
      .array(
        z.object({
          playerIds: z.array(playerRefSchema).length(5),
          primaryPlayerId: playerRefSchema.optional(),
          floorGeneralPlayerId: playerRefSchema.optional(),
        }),
      )
      .max(FULL_COURT_MAX_NAMED_UNITS)
      .optional(),
  })
  .superRefine((hierarchy, context) => {
    const assignments: Array<[keyof typeof hierarchy, string | undefined]> = [
      ['primaryPlayerId', hierarchy.primaryPlayerId],
      ['secondaryPlayerId', hierarchy.secondaryPlayerId],
      ['floorGeneralPlayerId', hierarchy.floorGeneralPlayerId],
    ];
    const seen = new Set<string>();
    for (const [field, playerId] of assignments) {
      if (playerId === undefined) continue;
      if (seen.has(playerId)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'each offensive role needs a different player',
        });
      }
      seen.add(playerId);
    }
    for (const [handler, targets] of Object.entries(hierarchy.passingReads ?? {})) {
      if (targets.includes(handler) || new Set(targets).size !== targets.length) {
        context.addIssue({
          code: 'custom',
          path: ['passingReads', handler],
          message: 'Choose distinct teammates.',
        });
      }
    }
    const units = new Set<string>();
    for (const unit of hierarchy.unitRoles ?? []) {
      const key = JSON.stringify([...unit.playerIds].sort());
      if (
        units.has(key) ||
        new Set(unit.playerIds).size !== 5 ||
        [unit.primaryPlayerId, unit.floorGeneralPlayerId].some(
          (id) => id !== undefined && !unit.playerIds.includes(id),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['unitRoles'],
          message: 'Choose one set of roles per lineup, using players from that lineup.',
        });
      }
      units.add(key);
    }
    if (seen.size === 0 && !Object.keys(hierarchy.passingReads ?? {}).length && !units.size) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'assign at least one offensive role or omit the hierarchy',
      });
    }
  });
export type FullCourtOffensiveHierarchy = z.infer<typeof fullCourtOffensiveHierarchySchema>;

export const fullCourtCoachingPlanSchema = z.object({
  schemaVersion: z.literal(FULL_COURT_COACHING_SCHEMA_VERSION),
  tactics: fullCourtTacticsSchema,
  rotation: fullCourtRotationSchema.optional(),
  /** Reusable roster-bound fives. Absent preserves legacy plans. */
  units: fullCourtNamedUnitsSchema.optional(),
  /** Ordered conditional rules. Absent means no rules and legacy behavior. */
  rules: fullCourtCoachingRulesSchema.optional(),
  /** Optional per-player offensive hierarchy. Absent leaves opportunities untouched. */
  hierarchy: fullCourtOffensiveHierarchySchema.optional(),
  /**
   * Keep at least one assigned primary or secondary scorer on the floor when an
   * automatic rotation choice would otherwise leave neither available scorer out
   * there. Absent preserves legacy rotations.
   */
  staggerStars: z.boolean().optional(),
  /** Optional editor depth; absent behaves like `remix`. */
  interfaceLevel: fullCourtInterfaceLevelSchema.optional(),
});
export type FullCourtCoachingPlan = z.infer<typeof fullCourtCoachingPlanSchema>;

export const FULL_COURT_DEFAULT_COACHING_PLAN: FullCourtCoachingPlan =
  fullCourtCoachingPlanSchema.parse({
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics: FULL_COURT_DEFAULT_TACTICS,
  });
