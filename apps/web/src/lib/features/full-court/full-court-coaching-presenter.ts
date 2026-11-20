import {
  FULL_COURT_COACHING_SCHEMA_VERSION,
  FULL_COURT_DEFAULT_TACTICS,
  type FullCourtCoachingPlan,
  type FullCourtTactics,
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
