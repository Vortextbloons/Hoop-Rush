import type {
  FullCourtCoachingPlan,
  FullCourtCoachingRule,
  FullCourtOffensiveHierarchy,
  FullCourtTactics,
  SimulationPlayer,
} from '@hoop-rush/data-contracts';
import type { FullCourtTeamGameInput } from './game.ts';
import {
  FULL_COURT_REGULATION_TEAM_SECONDS,
  resolveRotationPlan,
  type FullCourtRotationPlanInput,
} from './rotation.ts';

type CoachingRotation = NonNullable<FullCourtCoachingPlan['rotation']>;

export function defaultFullCourtCoachingRotation(team: FullCourtTeamGameInput): CoachingRotation {
  const { startingSlots, targetSeconds } = resolveRotationPlan(team.roster, {}, team.availability);
  const minutes = targetSeconds.map((seconds) => Math.floor(seconds / 60));
  const extraMinutes =
    FULL_COURT_REGULATION_TEAM_SECONDS / 60 - minutes.reduce((total, value) => total + value, 0);
  const byRemainder = targetSeconds
    .map((seconds, index) => ({ index, remainder: seconds % 60 }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of byRemainder.slice(0, extraMinutes)) {
    minutes[index] = (minutes[index] ?? 0) + 1;
  }
  return {
    startingFive: startingSlots.map((index) => {
      const player = team.roster[index];
      if (player === undefined) throw new Error('The automatic lineup includes a missing player.');
      return player.playerId;
    }),
    minuteTargets: Object.fromEntries(
      team.roster.map((player, index) => [player.playerId, minutes[index] ?? 0]),
    ),
  };
}

export function assertFullCourtCoachingRoster(
  plan: FullCourtCoachingPlan,
  roster: readonly SimulationPlayer[],
): void {
  const ids = new Set<string>(roster.map((player) => player.playerId));
  const outside = (id: string): boolean => !ids.has(id);
  if (plan.rotation !== undefined) {
    for (const id of Object.keys(plan.rotation.minuteTargets)) {
      if (outside(id)) throw new Error('The saved rotation includes a player outside your roster.');
    }
  }
  for (const rule of plan.rules ?? []) {
    const ruleIds = rule.kind === 'closing-lineup' ? rule.lineup : [rule.playerId];
    if (rule.kind === 'foul-trouble' && rule.replacementPlayerId !== undefined) {
      ruleIds.push(rule.replacementPlayerId);
    }
    if (ruleIds.some(outside)) {
      throw new Error('The saved coaching rule includes a player outside your roster.');
    }
  }
  assertHierarchyRoster(plan.hierarchy, ids);
}

function hierarchyPlayerIds(hierarchy: FullCourtOffensiveHierarchy): string[] {
  return [
    hierarchy.primaryPlayerId,
    hierarchy.secondaryPlayerId,
    hierarchy.floorGeneralPlayerId,
  ].filter((playerId): playerId is string => playerId !== undefined);
}

function assertHierarchyRoster(
  hierarchy: FullCourtOffensiveHierarchy | undefined,
  rosterIds: ReadonlySet<string>,
): void {
  if (hierarchy === undefined) return;
  if (hierarchyPlayerIds(hierarchy).some((playerId) => !rosterIds.has(playerId))) {
    throw new Error('The saved scoring hierarchy includes a player outside your roster.');
  }
}

export function withFullCourtCoaching(
  team: FullCourtTeamGameInput,
  options: {
    readonly rotation?: FullCourtRotationPlanInput;
    readonly tactics?: FullCourtTactics;
    readonly rules?: readonly FullCourtCoachingRule[];
    readonly hierarchy?: FullCourtOffensiveHierarchy;
  },
): FullCourtTeamGameInput {
  const { rotation, tactics, rules, hierarchy } = options;
  const activeRules = rules !== undefined && rules.length > 0 ? rules : undefined;
  if (
    rotation === undefined &&
    tactics === undefined &&
    activeRules === undefined &&
    hierarchy === undefined
  ) {
    return team;
  }
  if (hierarchy !== undefined) {
    assertHierarchyRoster(hierarchy, new Set(team.roster.map((player) => player.playerId)));
  }
  let rotationInput: FullCourtRotationPlanInput | undefined = rotation;
  if (activeRules !== undefined) {
    // Rules live beside the saved rotation in the coaching plan, but the engine
    // plan takes them with the rotation input, so keep any team rotation intact.
    const base = rotation ?? team.rotation;
    rotationInput = {
      ...(base ?? {}),
      rules: [...(base?.rules ?? []), ...activeRules],
    };
  }
  return {
    ...team,
    ...(rotationInput === undefined ? {} : { rotation: rotationInput }),
    ...(tactics === undefined ? {} : { tactics }),
    ...(hierarchy === undefined ? {} : { hierarchy }),
  };
}
