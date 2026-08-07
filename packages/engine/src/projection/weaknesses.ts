import type { ProjectionModelArtifact, ProjectionWeakness } from '@hoop-rush/data-contracts';

/**
 * Weakness generation (projection milestone). Weaknesses come from explicit
 * component thresholds in the frozen model artifact; every weakness records
 * its code, severity, threshold, measured value, and evidence strings.
 * Critical weaknesses reject a candidate in ranking; noncritical ones reduce
 * its score nonlinearly (weight x severity²).
 */

/** The measured component values a weakness check reads. */
export interface WeaknessComponentValues {
  [code: string]: number;
}

/** Generates weaknesses from the artifact policy table and measured values. */
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

/** Nonlinear weakness penalty: sum of weight x severity². */
export function weaknessPenalty(
  model: ProjectionModelArtifact,
  weaknesses: readonly ProjectionWeakness[],
): number {
  const severityWeight = { critical: 3, major: 2, minor: 1 };
  let penalty = 0;
  for (const weakness of weaknesses) {
    const policy = model.weaknesses.find((entry) => entry.code === weakness.code);
    const weight = policy?.weight ?? 1;
    const level = severityWeight[weakness.severity] ?? 1;
    penalty += weight * level * level;
  }
  return penalty;
}
