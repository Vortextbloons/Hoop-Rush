import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_TACTICS,
  FULL_COURT_MAX_COACHING_RULES,
  FULL_COURT_MAX_NAMED_UNITS,
  FULL_COURT_UNIT_MINUTE_BUDGET,
  FULL_COURT_MAX_UNIT_NAME_LENGTH,
  type FullCourtBlueprint,
  type FullCourtBlueprintHierarchy,
  type FullCourtClosingLineupRule,
  type FullCourtCoachingPlan,
  type FullCourtCoachingRule,
  type FullCourtFoulTroubleRule,
  type FullCourtInterfaceLevel,
  type FullCourtNamedUnit,
  type FullCourtPlayerHealth,
  type FullCourtTactics,
  type FullCourtTeamHealth,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtBlueprintHierarchy,
  resolveFullCourtBlueprintHierarchy,
  type FullCourtBlueprintBindingPreview,
  type FullCourtBlueprintRotationRef,
} from '@hoop-rush/engine';

export const FULL_COURT_MINUTE_TOTAL = 240;
export const FULL_COURT_MAX_PLAYER_MINUTES = 48;
export const FULL_COURT_STARTER_SLOTS = 5;
export const FULL_COURT_MAX_RULES = FULL_COURT_MAX_COACHING_RULES;
export const FULL_COURT_MAX_UNITS = FULL_COURT_MAX_NAMED_UNITS;
export const FULL_COURT_UNIT_NAME_MAX_LENGTH = FULL_COURT_MAX_UNIT_NAME_LENGTH;
export { FULL_COURT_UNIT_MINUTE_BUDGET };
export const FULL_COURT_DEFAULT_RULE_SECONDS_REMAINING = 6 * 60;
export const FULL_COURT_DEFAULT_RULE_SCORE_MARGIN = 8;
export const FULL_COURT_DEFAULT_FOUL_LIMIT = 4;

type CoachingRotation = NonNullable<FullCourtCoachingPlan['rotation']>;
export type FullCourtRotationMode = 'automatic' | 'custom';

/** Editor form of the optional offensive hierarchy; `null` is an unassigned role. */
export interface FullCourtOffensiveHierarchyDraft {
  primaryPlayerId: string | null;
  secondaryPlayerId: string | null;
  floorGeneralPlayerId: string | null;
}

export interface FullCourtNamedUnitDraft {
  name: string;
  playerIds: string[];
  plannedMinutes?: number;
}

export interface FullCourtCoachingDraft {
  tactics: FullCourtTactics;
  interfaceLevel: FullCourtInterfaceLevel;
  rotationMode: FullCourtRotationMode;
  startingFive: string[];
  minuteTargets: Record<string, number>;
  closingFive: string[] | null;
  units: FullCourtNamedUnitDraft[];
  rules: FullCourtCoachingRule[];
  hierarchy: FullCourtOffensiveHierarchyDraft;
  /** Keep one assigned primary or secondary scorer on the floor when viable. */
  staggerStars: boolean;
  passingReads?: NonNullable<FullCourtCoachingPlan['hierarchy']>['passingReads'];
  unitRoles?: NonNullable<FullCourtCoachingPlan['hierarchy']>['unitRoles'];
}

export interface FullCourtCoachingValidation {
  valid: boolean;
  errors: string[];
  totalMinutes: number;
  remainingMinutes: number;
}

function isRosterFive(playerIds: readonly string[], rosterIds: ReadonlySet<string>): boolean {
  return (
    playerIds.length === FULL_COURT_STARTER_SLOTS &&
    new Set(playerIds).size === FULL_COURT_STARTER_SLOTS &&
    playerIds.every((playerId) => rosterIds.has(playerId))
  );
}

function rosterMinuteTargets(
  rosterIds: readonly string[],
  rotation: CoachingRotation,
): Record<string, number> {
  return Object.fromEntries(
    rosterIds.map((playerId) => [playerId, rotation.minuteTargets[playerId] ?? 0]),
  );
}

function normalizeFive(
  candidate: readonly string[],
  fallback: readonly string[],
  rosterIds: ReadonlySet<string>,
): string[] {
  return isRosterFive(candidate, rosterIds) ? [...candidate] : [...fallback];
}

function cloneRule(rule: FullCourtCoachingRule): FullCourtCoachingRule {
  return rule.kind === 'closing-lineup' ? { ...rule, lineup: [...rule.lineup] } : { ...rule };
}

function cloneUnit(unit: FullCourtNamedUnit): FullCourtNamedUnitDraft {
  return { ...unit, playerIds: [...unit.playerIds] };
}

function namedUnitNameKey(name: string): string {
  return name.trim().normalize().toLowerCase();
}

/** Returns the name of the named unit matching this exact five, if any. */
export function fullCourtUnitNameForLineup(
  units: readonly FullCourtNamedUnitDraft[],
  playerIds: readonly string[],
): string | null {
  const target = new Set(playerIds);
  for (const unit of units) {
    if (unit.playerIds.length !== target.size) continue;
    if (unit.playerIds.every((playerId) => target.has(playerId))) return unit.name;
  }
  return null;
}

/** A stable, collision-free id for a rule added in the editor. */
export function nextFullCourtRuleId(rules: readonly FullCourtCoachingRule[]): string {
  const taken = new Set(rules.map((rule) => rule.ruleId));
  for (let index = 1; ; index += 1) {
    const candidate = `rule-${String(index)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function newFullCourtClosingRule(
  ruleId: string,
  rosterIds: readonly string[],
): FullCourtClosingLineupRule {
  return {
    ruleId,
    kind: 'closing-lineup',
    secondsRemainingMax: FULL_COURT_DEFAULT_RULE_SECONDS_REMAINING,
    scoreMarginMax: FULL_COURT_DEFAULT_RULE_SCORE_MARGIN,
    lineup: [...rosterIds.slice(0, FULL_COURT_STARTER_SLOTS)],
  };
}

export function newFullCourtFoulTroubleRule(
  ruleId: string,
  rosterIds: readonly string[],
): FullCourtFoulTroubleRule {
  const playerId = rosterIds[0] ?? '';
  const replacementPlayerId = rosterIds[FULL_COURT_STARTER_SLOTS];
  return {
    ruleId,
    kind: 'foul-trouble',
    playerId,
    foulLimit: FULL_COURT_DEFAULT_FOUL_LIMIT,
    ...(replacementPlayerId === undefined ? {} : { replacementPlayerId }),
  };
}

/** Seeds the editable draft, using the saved rotation when one exists. */
export function fullCourtCoachingDraft(
  plan: FullCourtCoachingPlan,
  defaultRotation: CoachingRotation,
  rosterIds: readonly string[],
): FullCourtCoachingDraft {
  const rotation = plan.rotation ?? defaultRotation;
  const rosterIdSet = new Set(rosterIds);
  const closingFive =
    rotation.closingFive !== undefined && isRosterFive(rotation.closingFive, rosterIdSet)
      ? [...rotation.closingFive]
      : null;
  return {
    tactics: { ...plan.tactics },
    interfaceLevel: plan.interfaceLevel ?? 'remix',
    rotationMode: plan.rotation === undefined ? 'automatic' : 'custom',
    startingFive: normalizeFive(rotation.startingFive, defaultRotation.startingFive, rosterIdSet),
    minuteTargets: rosterMinuteTargets(rosterIds, rotation),
    closingFive,
    units: (plan.units ?? []).map(cloneUnit),
    rules: (plan.rules ?? []).map(cloneRule),
    hierarchy: {
      primaryPlayerId: plan.hierarchy?.primaryPlayerId ?? null,
      secondaryPlayerId: plan.hierarchy?.secondaryPlayerId ?? null,
      floorGeneralPlayerId: plan.hierarchy?.floorGeneralPlayerId ?? null,
    },
    staggerStars: plan.staggerStars === true,
    passingReads: Object.fromEntries(
      Object.entries(plan.hierarchy?.passingReads ?? {}).map(([id, reads]) => [id, [...reads]]),
    ),
    unitRoles: plan.hierarchy?.unitRoles?.map((unit) => ({
      ...unit,
      playerIds: [...unit.playerIds],
    })),
  };
}

/** The reset baseline: balanced tactics, automatic rotation, default rotation values. */
export function defaultFullCourtCoachingDraft(
  defaultRotation: CoachingRotation,
  rosterIds: readonly string[],
): FullCourtCoachingDraft {
  return {
    tactics: { ...FULL_COURT_DEFAULT_TACTICS },
    interfaceLevel: 'remix',
    rotationMode: 'automatic',
    startingFive: [...defaultRotation.startingFive],
    minuteTargets: rosterMinuteTargets(rosterIds, defaultRotation),
    closingFive:
      defaultRotation.closingFive === undefined ? null : [...defaultRotation.closingFive],
    units: [],
    rules: [],
    hierarchy: {
      primaryPlayerId: null,
      secondaryPlayerId: null,
      floorGeneralPlayerId: null,
    },
    staggerStars: false,
  };
}

/** Emits the contract hierarchy, or `undefined` when no role is assigned. */
export function fullCourtOffensiveHierarchy(
  draft: FullCourtOffensiveHierarchyDraft,
): FullCourtCoachingPlan['hierarchy'] {
  const hierarchy = {
    ...(draft.primaryPlayerId === null ? {} : { primaryPlayerId: draft.primaryPlayerId }),
    ...(draft.secondaryPlayerId === null ? {} : { secondaryPlayerId: draft.secondaryPlayerId }),
    ...(draft.floorGeneralPlayerId === null
      ? {}
      : { floorGeneralPlayerId: draft.floorGeneralPlayerId }),
  };
  return Object.keys(hierarchy).length === 0 ? undefined : hierarchy;
}

export function fullCourtCoachingPlan(draft: FullCourtCoachingDraft): FullCourtCoachingPlan {
  const tactics: FullCourtTactics = { ...draft.tactics };
  const rules = draft.rules.map(cloneRule);
  const hierarchy = fullCourtOffensiveHierarchy(draft.hierarchy);
  const passingReads = draft.passingReads ?? {};
  const unitRoles = (draft.unitRoles ?? []).filter((entry) =>
    draft.units.some((unit) => unit.playerIds.every((id) => entry.playerIds.includes(id))),
  );
  const offensePlan = {
    ...hierarchy,
    ...(Object.keys(passingReads).length === 0
      ? {}
      : {
          passingReads: Object.fromEntries(
            Object.entries(passingReads).map(([id, reads]) => [id, [...reads]]),
          ),
        }),
    ...(unitRoles.length === 0
      ? {}
      : { unitRoles: unitRoles.map((unit) => ({ ...unit, playerIds: [...unit.playerIds] })) }),
  };
  const units = draft.units.map((unit) => ({
    ...unit,
    name: unit.name.trim().normalize(),
    playerIds: [...unit.playerIds],
  }));
  const trailing = {
    ...(units.length === 0 ? {} : { units }),
    ...(rules.length === 0 ? {} : { rules }),
    ...(Object.keys(offensePlan).length === 0 ? {} : { hierarchy: offensePlan }),
    ...(draft.staggerStars ? { staggerStars: true } : {}),
    ...(draft.interfaceLevel === 'remix' ? {} : { interfaceLevel: draft.interfaceLevel }),
  };
  if (draft.rotationMode === 'automatic') {
    return { schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION, tactics, ...trailing };
  }
  return {
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics,
    rotation: {
      startingFive: [...draft.startingFive],
      minuteTargets: { ...draft.minuteTargets },
      ...(draft.closingFive === null ? {} : { closingFive: [...draft.closingFive] }),
    },
    ...trailing,
  };
}

export function validateFullCourtCoachingDraft(
  draft: FullCourtCoachingDraft,
  rosterIds: readonly string[],
): FullCourtCoachingValidation {
  const totalMinutes = Object.values(draft.minuteTargets).reduce(
    (total, minutes) => total + minutes,
    0,
  );
  const remainingMinutes = FULL_COURT_MINUTE_TOTAL - totalMinutes;
  const errors: string[] = [];
  const rosterIdSet = new Set(rosterIds);

  if (draft.rules.length > FULL_COURT_MAX_RULES) {
    errors.push(`Use ${String(FULL_COURT_MAX_RULES)} coaching rules or fewer.`);
  }
  if (new Set(draft.rules.map((rule) => rule.ruleId)).size !== draft.rules.length) {
    errors.push('Every coaching rule needs a unique id.');
  }
  if (
    draft.units.reduce((total, unit) => total + (unit.plannedMinutes ?? 0), 0) >
    FULL_COURT_UNIT_MINUTE_BUDGET
  ) {
    errors.push('Named units share 12 planned minutes in the second quarter.');
  }
  const hierarchyIds = [
    draft.hierarchy.primaryPlayerId,
    draft.hierarchy.secondaryPlayerId,
    draft.hierarchy.floorGeneralPlayerId,
  ].filter((playerId): playerId is string => playerId !== null);
  if (hierarchyIds.some((playerId) => !rosterIdSet.has(playerId))) {
    errors.push('The scoring hierarchy includes a player outside your roster.');
  }
  if (
    draft.hierarchy.primaryPlayerId !== null &&
    draft.hierarchy.primaryPlayerId === draft.hierarchy.secondaryPlayerId
  ) {
    errors.push('Choose different primary and second scoring options.');
  }
  if (draft.units.length > FULL_COURT_MAX_UNITS) {
    errors.push(`Use ${String(FULL_COURT_MAX_UNITS)} named units or fewer.`);
  }
  const unitNames = new Set<string>();
  for (const unit of draft.units) {
    const name = unit.name.trim();
    if (name.length === 0 || name.length > FULL_COURT_UNIT_NAME_MAX_LENGTH) {
      errors.push(
        `Name each named unit in ${String(FULL_COURT_UNIT_NAME_MAX_LENGTH)} characters or fewer.`,
      );
    }
    const key = namedUnitNameKey(name);
    if (unitNames.has(key)) {
      errors.push('Named unit names must be unique.');
    }
    unitNames.add(key);
    if (!isRosterFive(unit.playerIds, rosterIdSet)) {
      errors.push(
        `Named unit ${name.length === 0 ? '(unnamed)' : name} needs five different players from your roster.`,
      );
    }
  }
  for (const rule of draft.rules) {
    if (rule.kind === 'closing-lineup') {
      if (!isRosterFive(rule.lineup, rosterIdSet)) {
        errors.push(`Rule ${rule.ruleId} needs five different players from your roster.`);
      }
      if (
        !Number.isInteger(rule.secondsRemainingMax) ||
        rule.secondsRemainingMax < 0 ||
        rule.secondsRemainingMax > 48 * 60 ||
        !Number.isInteger(rule.scoreMarginMax) ||
        rule.scoreMarginMax < 0 ||
        rule.scoreMarginMax > 40
      ) {
        errors.push(`Rule ${rule.ruleId} has an out-of-range time or score margin.`);
      }
    } else {
      if (!rosterIdSet.has(rule.playerId)) {
        errors.push(`Rule ${rule.ruleId} names a player outside your roster.`);
      }
      if (
        rule.replacementPlayerId !== undefined &&
        (!rosterIdSet.has(rule.replacementPlayerId) || rule.replacementPlayerId === rule.playerId)
      ) {
        errors.push(`Rule ${rule.ruleId} needs a different replacement from your roster.`);
      }
      if (
        !Number.isInteger(rule.foulLimit) ||
        rule.foulLimit < 1 ||
        rule.foulLimit > FULL_COURT_STARTER_SLOTS
      ) {
        errors.push(`Rule ${rule.ruleId} needs a foul limit between 1 and 5.`);
      }
    }
  }

  if (draft.rotationMode === 'custom') {
    const rosterIdSet = new Set(rosterIds);
    if (!isRosterFive(draft.startingFive, rosterIdSet)) {
      errors.push('Choose five different starters from your roster.');
    }
    if (
      rosterIds.length < FULL_COURT_STARTER_SLOTS ||
      rosterIds.some((playerId) => {
        const minutes = draft.minuteTargets[playerId];
        return (
          minutes === undefined ||
          !Number.isInteger(minutes) ||
          minutes < 0 ||
          minutes > FULL_COURT_MAX_PLAYER_MINUTES
        );
      })
    ) {
      errors.push(
        `Use whole minutes between 0 and ${String(FULL_COURT_MAX_PLAYER_MINUTES)} for every player.`,
      );
    }
    if (remainingMinutes !== 0) {
      const amount = Math.abs(remainingMinutes);
      errors.push(
        remainingMinutes > 0
          ? `Add ${String(amount)} more ${amount === 1 ? 'minute' : 'minutes'} to reach ${String(FULL_COURT_MINUTE_TOTAL)}.`
          : `Remove ${String(amount)} ${amount === 1 ? 'minute' : 'minutes'} to reach ${String(FULL_COURT_MINUTE_TOTAL)}.`,
      );
    }
    if (draft.closingFive !== null && !isRosterFive(draft.closingFive, rosterIdSet)) {
      errors.push('Choose five different closers from your roster.');
    }
    const selected = [...draft.startingFive, ...(draft.closingFive ?? [])];
    if (selected.some((playerId) => (draft.minuteTargets[playerId] ?? 0) <= 0)) {
      errors.push('Assign at least one minute to each starter and closer.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    totalMinutes,
    remainingMinutes,
  };
}

/**
 * A stable fingerprint of everything a saved plan controls, so the editor can
 * tell saved from unsaved work without comparing object identity.
 */
export function fullCourtCoachingSignature(plan: FullCourtCoachingPlan): string {
  const rotation = plan.rotation;
  const minutes = Object.entries(rotation?.minuteTargets ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return JSON.stringify({
    interfaceLevel: plan.interfaceLevel ?? 'remix',
    tactics: [
      plan.tactics.pace,
      plan.tactics.offense,
      plan.tactics.defense,
      plan.tactics.ballMovement ?? false,
    ],
    staggerStars: plan.staggerStars === true,
    rotation:
      rotation === undefined
        ? null
        : [rotation.startingFive, minutes, rotation.closingFive ?? null],
    units: (plan.units ?? []).map((unit) => [
      unit.name,
      [...unit.playerIds],
      unit.plannedMinutes ?? null,
    ]),
    rules: (plan.rules ?? []).map((rule) =>
      rule.kind === 'closing-lineup'
        ? [rule.ruleId, rule.kind, rule.secondsRemainingMax, rule.scoreMarginMax, [...rule.lineup]]
        : [rule.ruleId, rule.kind, rule.playerId, rule.foulLimit, rule.replacementPlayerId ?? null],
    ),
    hierarchy: [
      plan.hierarchy?.primaryPlayerId ?? null,
      plan.hierarchy?.secondaryPlayerId ?? null,
      plan.hierarchy?.floorGeneralPlayerId ?? null,
      Object.entries(plan.hierarchy?.passingReads ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
      plan.hierarchy?.unitRoles ?? [],
    ],
  });
}

export type FullCourtHealthTone = 'available' | 'fatigued' | 'unavailable';

export interface FullCourtPlayerHealthView {
  readonly tone: FullCourtHealthTone;
  readonly label: string;
}

/** Heavy accumulated load starts where one full regulation game lands. */
const FULL_COURT_HEAVY_LOAD = 6_000;

/**
 * Turns a checkpoint health row into a short label. `dayOffset` is the fixture
 * day the reader is looking at; a return day after it means the player is out.
 */
export function fullCourtPlayerHealthView(
  health: FullCourtPlayerHealth | undefined,
  dayOffset: number | null = null,
): FullCourtPlayerHealthView | null {
  if (health === undefined) return null;
  const returnDay = health.availableFromDay;
  if (returnDay !== null && (dayOffset === null || returnDay > dayOffset)) {
    return {
      tone: 'unavailable',
      label: dayOffset === null ? 'Out' : `Out to day ${String(returnDay)}`,
    };
  }
  const load = Math.round((health.loadBasisPoints / 100) * 10) / 10;
  if (health.loadBasisPoints >= FULL_COURT_HEAVY_LOAD) {
    return { tone: 'fatigued', label: `Heavy load ${String(load)}%` };
  }
  return { tone: 'available', label: `Load ${String(load)}%` };
}

export interface FullCourtTeamMinutesRow {
  readonly player: SimulationPlayer;
  /** Court slot 0–4 for a starter, `null` for the bench. */
  readonly starterSlot: number | null;
  readonly minutes: number;
  /** Target already saved for this player, when a custom rotation is saved. */
  readonly savedMinutes: number | null;
  readonly closer: boolean;
  readonly health: FullCourtPlayerHealthView | null;
  readonly cumulativeLoad: number;
}

export interface FullCourtTeamMinutesView {
  readonly starters: readonly FullCourtTeamMinutesRow[];
  readonly bench: readonly FullCourtTeamMinutesRow[];
  readonly starterMinutes: number;
  readonly benchMinutes: number;
}

/**
 * Orders the roster for the team editor: starters in court-slot order, then the
 * bench by workload so the minute hierarchy reads top to bottom.
 */
export function fullCourtTeamMinutes(
  draft: FullCourtCoachingDraft,
  roster: readonly SimulationPlayer[],
  savedPlan: FullCourtCoachingPlan,
  health: FullCourtTeamHealth | null = null,
  dayOffset: number | null = null,
): FullCourtTeamMinutesView {
  const savedMinutes = savedPlan.rotation?.minuteTargets ?? null;
  const closers = new Set(draft.closingFive ?? []);
  const rows = roster.map((player): FullCourtTeamMinutesRow => {
    const starterSlot = draft.startingFive.indexOf(player.playerId);
    return {
      player,
      starterSlot: starterSlot === -1 ? null : starterSlot,
      minutes: draft.minuteTargets[player.playerId] ?? 0,
      savedMinutes: savedMinutes?.[player.playerId] ?? null,
      closer: closers.has(player.playerId),
      health: fullCourtPlayerHealthView(health?.players[player.playerId], dayOffset),
      cumulativeLoad: Math.round(
        (health?.players[player.playerId]?.cumulativeLoadBasisPoints ?? 0) / 100,
      ),
    };
  });
  const starters = rows
    .filter((row) => row.starterSlot !== null)
    .sort((left, right) => (left.starterSlot ?? 0) - (right.starterSlot ?? 0));
  const bench = rows
    .filter((row) => row.starterSlot === null)
    .sort(
      (left, right) =>
        right.minutes - left.minutes ||
        (left.player.displayName < right.player.displayName
          ? -1
          : left.player.displayName > right.player.displayName
            ? 1
            : 0) ||
        (left.player.playerId < right.player.playerId ? -1 : 1),
    );
  const total = (items: readonly FullCourtTeamMinutesRow[]): number =>
    items.reduce((sum, row) => sum + row.minutes, 0);
  return {
    starters,
    bench,
    starterMinutes: total(starters),
    benchMinutes: total(bench),
  };
}

export function activeRotationForBlueprint(
  draft: FullCourtCoachingDraft,
  defaultRotation: CoachingRotation,
): FullCourtBlueprintRotationRef {
  return draft.rotationMode === 'custom'
    ? { startingFive: draft.startingFive, minuteTargets: draft.minuteTargets }
    : defaultRotation;
}

export function blueprintHierarchyFromDraft(
  draft: FullCourtCoachingDraft,
  roster: readonly SimulationPlayer[],
  defaultRotation: CoachingRotation,
): FullCourtBlueprintHierarchy | undefined {
  const hierarchy = fullCourtOffensiveHierarchy(draft.hierarchy);
  if (hierarchy === undefined) return undefined;
  return buildFullCourtBlueprintHierarchy({
    hierarchy,
    roster,
    rotation: activeRotationForBlueprint(draft, defaultRotation),
  });
}

export interface ApplyFullCourtBlueprintDraftResult {
  readonly draft: FullCourtCoachingDraft;
  readonly preview: FullCourtBlueprintBindingPreview;
  readonly changed: boolean;
}

/**
 * Applies a saved blueprint to the current coaching draft, binding any portable
 * scoring roles to the active roster while keeping existing rotations, rules,
 * and editor view depth intact.
 */
export function applyFullCourtBlueprintToDraft(
  draft: FullCourtCoachingDraft,
  blueprint: FullCourtBlueprint,
  roster: readonly SimulationPlayer[],
  defaultRotation: CoachingRotation,
): ApplyFullCourtBlueprintDraftResult {
  const preview = resolveFullCourtBlueprintHierarchy({
    blueprint,
    roster,
    rotation: activeRotationForBlueprint(draft, defaultRotation),
  });
  const nextHierarchy: FullCourtOffensiveHierarchyDraft =
    blueprint.hierarchy === undefined
      ? { ...draft.hierarchy }
      : {
          primaryPlayerId: preview.hierarchy?.primaryPlayerId ?? null,
          secondaryPlayerId: preview.hierarchy?.secondaryPlayerId ?? null,
          floorGeneralPlayerId: preview.hierarchy?.floorGeneralPlayerId ?? null,
        };
  const tacticsChanged =
    blueprint.tactics.ballMovement !== draft.tactics.ballMovement ||
    blueprint.tactics.pace !== draft.tactics.pace ||
    blueprint.tactics.offense !== draft.tactics.offense ||
    blueprint.tactics.defense !== draft.tactics.defense;
  const hierarchyChanged =
    nextHierarchy.primaryPlayerId !== draft.hierarchy.primaryPlayerId ||
    nextHierarchy.secondaryPlayerId !== draft.hierarchy.secondaryPlayerId ||
    nextHierarchy.floorGeneralPlayerId !== draft.hierarchy.floorGeneralPlayerId;

  return {
    preview,
    changed: tacticsChanged || hierarchyChanged,
    draft: {
      ...draft,
      tactics: { ...blueprint.tactics },
      startingFive: [...draft.startingFive],
      minuteTargets: { ...draft.minuteTargets },
      closingFive: draft.closingFive === null ? null : [...draft.closingFive],
      units: draft.units.map((unit) => ({ ...unit, playerIds: [...unit.playerIds] })),
      rules: draft.rules.map(cloneRule),
      hierarchy: nextHierarchy,
    },
  };
}

export function historicalThreePointShare(roster: readonly SimulationPlayer[]): number | null {
  let minutes = 0;
  let weightedShare = 0;
  for (const player of roster) {
    const anchors = player.anchors;
    if (anchors?.threePointAttemptRate == null) continue;
    minutes += anchors.minutesPerGame;
    weightedShare += anchors.minutesPerGame * anchors.threePointAttemptRate;
  }
  return minutes > 0 ? (100 * weightedShare) / minutes : null;
}

export function rebalanceFullCourtMinuteTargets(
  draft: FullCourtCoachingDraft,
  rosterIds: readonly string[],
  staffTargets: Readonly<Record<string, number>>,
  lastMinutesEdit: string | null,
  lockedIds: ReadonlySet<string> = new Set(),
): Record<string, number> {
  const pinned = [...draft.startingFive, ...(draft.closingFive ?? [])];
  const targets = Object.fromEntries(
    rosterIds.map((id) => [
      id,
      Math.max(
        pinned.includes(id) ? 1 : 0,
        Math.min(FULL_COURT_MAX_PLAYER_MINUTES, Math.round(draft.minuteTargets[id] ?? 0)),
      ),
    ]),
  );
  let remaining =
    FULL_COURT_MINUTE_TOTAL - Object.values(targets).reduce((sum, value) => sum + value, 0);
  const order = [...rosterIds]
    .filter((id) => !lockedIds.has(id))
    .sort(
      (left, right) =>
        Number(left === lastMinutesEdit) - Number(right === lastMinutesEdit) ||
        (staffTargets[right] ?? 0) - (staffTargets[left] ?? 0),
    );
  const step = Math.sign(remaining);
  while (remaining !== 0) {
    let changed = false;
    for (const id of order) {
      if (remaining === 0) break;
      const next = (targets[id] ?? 0) + step;
      if (next < (pinned.includes(id) ? 1 : 0) || next > FULL_COURT_MAX_PLAYER_MINUTES) continue;
      if (id === lastMinutesEdit && changed) continue;
      targets[id] = next;
      remaining -= step;
      changed = true;
    }
    if (!changed) break;
  }
  return targets;
}
