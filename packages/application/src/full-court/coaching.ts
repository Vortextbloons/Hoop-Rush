import {
  FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
  fullCourtCoachingPlanSchema,
  normalizeFullCourtBlueprint,
  type FullCourtBlueprint,
  type FullCourtBlueprintHierarchy,
  type FullCourtCoachingPlan,
  type FullCourtTactics,
  type Id,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import {
  assertFullCourtCoachingRoster,
  resolveFullCourtBlueprintHierarchy,
  type FullCourtBlueprintBindingPreview,
  type FullCourtBlueprintRotationRef,
  type FullCourtSeasonLock,
} from '@hoop-rush/engine';

export interface SaveFullCourtBlueprintOptions {
  readonly hierarchy?: FullCourtBlueprintHierarchy;
}

export async function saveFullCourtBlueprint(
  name: string,
  tactics: FullCourtTactics,
  repository: { create(blueprint: FullCourtBlueprint): Promise<void> },
  options?: SaveFullCourtBlueprintOptions,
): Promise<FullCourtBlueprint> {
  const blueprint = normalizeFullCourtBlueprint({
    schemaVersion: FULL_COURT_BLUEPRINT_SCHEMA_VERSION,
    name,
    tactics,
    ...(options?.hierarchy === undefined ? {} : { hierarchy: options.hierarchy }),
  });
  await repository.create(blueprint);
  return blueprint;
}

export interface ApplyFullCourtBlueprintResult {
  readonly plan: FullCourtCoachingPlan;
  readonly preview: FullCourtBlueprintBindingPreview;
}

/**
 * Applies a saved blueprint to a coaching plan, binding any portable scoring
 * roles to the target roster while preserving existing rotations and rules.
 */
export function applyFullCourtBlueprintToPlan(options: {
  readonly blueprint: FullCourtBlueprint;
  readonly plan: FullCourtCoachingPlan;
  readonly roster: readonly SimulationPlayer[];
  readonly defaultRotation?: FullCourtBlueprintRotationRef;
}): ApplyFullCourtBlueprintResult {
  const { blueprint, plan, roster, defaultRotation } = options;
  const normalized = normalizeFullCourtBlueprint(blueprint);
  const preview = resolveFullCourtBlueprintHierarchy({
    blueprint: normalized,
    roster,
    rotation: plan.rotation ?? defaultRotation,
  });
  const nextHierarchy = normalized.hierarchy === undefined ? plan.hierarchy : preview.hierarchy;
  const { hierarchy: _previousHierarchy, ...planWithoutHierarchy } = plan;
  const nextPlan = fullCourtCoachingPlanSchema.parse({
    ...planWithoutHierarchy,
    tactics: { ...normalized.tactics },
    ...(nextHierarchy === undefined ? {} : { hierarchy: nextHierarchy }),
  });
  assertFullCourtCoachingRoster(nextPlan, roster);
  return { plan: nextPlan, preview };
}

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
