import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_TACTICS,
  type FullCourtCoachingPlan,
  type FullCourtPlayerHealth,
  type FullCourtTactics,
  type FullCourtTeamHealth,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';

export const FULL_COURT_MINUTE_TOTAL = 240;
export const FULL_COURT_MAX_PLAYER_MINUTES = 48;
export const FULL_COURT_STARTER_SLOTS = 5;

type CoachingRotation = NonNullable<FullCourtCoachingPlan['rotation']>;
export type FullCourtRotationMode = 'automatic' | 'custom';

export interface FullCourtCoachingDraft {
  tactics: FullCourtTactics;
  rotationMode: FullCourtRotationMode;
  startingFive: string[];
  minuteTargets: Record<string, number>;
  closingFive: string[] | null;
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
    rotationMode: plan.rotation === undefined ? 'automatic' : 'custom',
    startingFive: normalizeFive(rotation.startingFive, defaultRotation.startingFive, rosterIdSet),
    minuteTargets: rosterMinuteTargets(rosterIds, rotation),
    closingFive,
  };
}

/** The reset baseline: balanced tactics, automatic rotation, default rotation values. */
export function defaultFullCourtCoachingDraft(
  defaultRotation: CoachingRotation,
  rosterIds: readonly string[],
): FullCourtCoachingDraft {
  return {
    tactics: { ...FULL_COURT_DEFAULT_TACTICS },
    rotationMode: 'automatic',
    startingFive: [...defaultRotation.startingFive],
    minuteTargets: rosterMinuteTargets(rosterIds, defaultRotation),
    closingFive:
      defaultRotation.closingFive === undefined ? null : [...defaultRotation.closingFive],
  };
}

export function fullCourtCoachingPlan(draft: FullCourtCoachingDraft): FullCourtCoachingPlan {
  const tactics: FullCourtTactics = { ...draft.tactics };
  if (draft.rotationMode === 'automatic') {
    return { schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION, tactics };
  }
  return {
    schemaVersion: FULL_COURT_COACHING_SCHEMA_VERSION,
    tactics,
    rotation: {
      startingFive: [...draft.startingFive],
      minuteTargets: { ...draft.minuteTargets },
      ...(draft.closingFive === null ? {} : { closingFive: [...draft.closingFive] }),
    },
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
    tactics: [plan.tactics.pace, plan.tactics.offense, plan.tactics.defense],
    rotation:
      rotation === undefined
        ? null
        : [rotation.startingFive, minutes, rotation.closingFive ?? null],
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
