import {
  fullCourtCoachingPlanSchema,
  type FullCourtCoachingPlan,
  type Id,
} from '@hoop-rush/data-contracts';
import { assertFullCourtCoachingRoster, type FullCourtSeasonLock } from '@hoop-rush/engine';

interface SetFullCourtCoachingCommand {
  readonly command: 'set-full-court-coaching';
  readonly runId: Id;
  readonly plan: FullCourtCoachingPlan;
}

export async function saveFullCourtCoaching(
  command: SetFullCourtCoachingCommand,
  lock: FullCourtSeasonLock,
  repository: { save(runId: Id, plan: FullCourtCoachingPlan): Promise<void> },
): Promise<FullCourtCoachingPlan> {
  if (command.runId !== lock.season.runId) {
    throw new Error('The coaching plan belongs to a different Full Court run.');
  }
  const userTeam = lock.season.teams.find((team) => team.teamId === lock.season.userTeamId);
  if (userTeam === undefined) throw new Error('The Full Court roster is unavailable.');
  const plan = fullCourtCoachingPlanSchema.parse(command.plan);
  assertFullCourtCoachingRoster(plan, userTeam.roster);
  await repository.save(command.runId, plan);
  return plan;
}
