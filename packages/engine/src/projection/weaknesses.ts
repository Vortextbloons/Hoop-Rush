import type { ProjectionModelArtifact, ProjectionWeakness } from '@hoop-rush/data-contracts';
export interface WeaknessComponentValues {
  [code: string]: number;
}
export function identifyWeaknesses(
  model: ProjectionModelArtifact,
  values: WeaknessComponentValues,
): ProjectionWeakness[] {
  const weaknesses: ProjectionWeakness[] = [];
  for (const policy of model.weaknesses) {
    const value = values[policy.code];
    if (value === undefined) continue;
    const violated = policy.minSide ? value < policy.threshold : value > policy.threshold;
    if (!violated) continue;
    weaknesses.push({
      code: policy.code,
      severity: policy.severity,
      threshold: policy.threshold,
      value,
      evidence: [
        policy.message
          .replaceAll('{value}', value.toFixed(1))
          .replaceAll('{threshold}', String(policy.threshold)),
      ],
    });
  }
  return weaknesses;
}
export function weaknessPenalty(
  model: ProjectionModelArtifact,
  weaknesses: readonly ProjectionWeakness[],
): number {
  const severityWeight = { critical: 3, major: 2, minor: 1 };
  let penalty = 0;
  for (const weakness of weaknesses) {
    const policy = model.weaknesses.find((entry) => entry.code === weakness.code);
    const weight = policy?.weight ?? 1;
    const level = severityWeight[weakness.severity];
    penalty += weight * level * level;
  }
  return penalty;
}
