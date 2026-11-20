import type {
  FullCourtCoachingPlan,
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
  if (plan.rotation === undefined) return;
  const ids = new Set<string>(roster.map((player) => player.playerId));
  for (const id of Object.keys(plan.rotation.minuteTargets)) {
    if (!ids.has(id)) throw new Error('The saved rotation includes a player outside your roster.');
  }
}

export function withFullCourtCoaching(
  team: FullCourtTeamGameInput,
  options: { readonly rotation?: FullCourtRotationPlanInput; readonly tactics?: FullCourtTactics },
): FullCourtTeamGameInput {
  const { rotation, tactics } = options;
  return rotation === undefined && tactics === undefined
    ? team
    : {
        ...team,
        ...(rotation === undefined ? {} : { rotation }),
        ...(tactics === undefined ? {} : { tactics }),
      };
}
