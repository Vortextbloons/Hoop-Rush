import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PUBLIC_DATA } from '../config.ts';
import { fileExists, readJson, writeJson } from '../json.ts';
export const ERA_SIM_DIR = join(PUBLIC_DATA, 'era-sim');
export const MINIMUM_SAMPLES: Readonly<Record<string, number>> = {
  closeGameRate: 2000,
  blowoutRate: 2000,
  overtimeRate: 2000,
  strongVsWeakWinRate: 2000,
  equalLineupHomeWinRate: 2000,
};
export const calibrationMetricSchema = z.object({
  key: z.string(),
  observed: z.number(),
});
export type CalibrationMetric = z.infer<typeof calibrationMetricSchema>;
export const calibrationPayloadSchema = z.object({
  command: z.string(),
  eraId: z.string(),
  samples: z.number(),
  engineVersion: z.string(),
  metrics: z.array(calibrationMetricSchema),
});
export type CalibrationPayload = z.infer<typeof calibrationPayloadSchema>;
const reportEnvelopeSchema = z.object({
  payload: calibrationPayloadSchema.optional(),
});
const frozenTargetLeafSchema = z.object({
  value: z.number(),
  tolerance: z.number().optional(),
  minimumSample: z.number().optional(),
});
const frozenTargetsSchema = z.looseObject({
  possessionsPerGame: frozenTargetLeafSchema.optional(),
  pointsPerGame: frozenTargetLeafSchema.optional(),
  offensiveRating: frozenTargetLeafSchema.optional(),
  fieldGoalPct: frozenTargetLeafSchema.optional(),
  efgPct: frozenTargetLeafSchema.optional(),
  tsPct: frozenTargetLeafSchema.optional(),
  threePointRate: frozenTargetLeafSchema.optional(),
  threePointPct: frozenTargetLeafSchema.optional(),
  freeThrowsAttemptedPerGame: frozenTargetLeafSchema.optional(),
  freeThrowPct: frozenTargetLeafSchema.optional(),
  turnoversPerGame: frozenTargetLeafSchema.optional(),
  turnoversPerPossession: frozenTargetLeafSchema.optional(),
  offensiveReboundsPerGame: frozenTargetLeafSchema.optional(),
  offensiveReboundRate: frozenTargetLeafSchema.optional(),
  assistsPerGame: frozenTargetLeafSchema.optional(),
  assistRate: frozenTargetLeafSchema.optional(),
  personalFoulsPerGame: frozenTargetLeafSchema.optional(),
  zoneMix: z.record(z.string(), frozenTargetLeafSchema).optional(),
  closeGameRate: frozenTargetLeafSchema.optional(),
  blowoutRate: frozenTargetLeafSchema.optional(),
  overtimeRate: frozenTargetLeafSchema.optional(),
  strongVsWeakWinRate: frozenTargetLeafSchema.optional(),
  equalLineupHomeWinRate: frozenTargetLeafSchema.optional(),
  playerRoles: z.unknown().optional(),
});
type FrozenTargets = z.infer<typeof frozenTargetsSchema>;
const frozenProfileSchema = z.looseObject({
  profileVersion: z.string(),
  baselineReport: z.string(),
  targets: frozenTargetsSchema,
});
export type FrozenProfile = z.infer<typeof frozenProfileSchema>;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
export function extractCalibrationPayload(raw: string): CalibrationPayload {
  const start = raw.indexOf('{');
  if (start < 0) {
    throw new Error('report contains no JSON payload');
  }
  let depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i += 1) {
    if (raw[i] === '{') {
      depth += 1;
    } else if (raw[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error('report JSON payload is not closed');
  }
  const parsed = reportEnvelopeSchema.safeParse(JSON.parse(raw.slice(start, end)));
  if (!parsed.success) {
    throw new Error(
      `expected a calibrate run report, got (missing payload): ${parsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const payload = parsed.data.payload;
  if (payload === undefined || payload.command !== 'calibrate run') {
    throw new Error(
      `expected a calibrate run report, got ${payload?.command ?? '(missing payload)'}`,
    );
  }
  return payload;
}
export function freezeTargets(reportPath: string, eraId = '1990s', profilePath?: string): void {
  const raw = readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, '');
  const payload = extractCalibrationPayload(raw);
  const resolved = profilePath ?? join(ERA_SIM_DIR, `${eraId}.json`);
  if (!fileExists(resolved)) {
    throw new Error(`no era profile at ${resolved}`);
  }
  if (payload.eraId !== eraId) {
    throw new Error(`report is for era ${payload.eraId}, not ${eraId}`);
  }
  const observed = new Map<string, number>();
  for (const metric of payload.metrics) observed.set(metric.key, metric.observed);
  const profileRaw = readJson(resolved) as unknown;
  const profileParsed = frozenProfileSchema.safeParse(profileRaw);
  if (!profileParsed.success) {
    throw new Error(
      `era profile ${resolved} fails validation: ${profileParsed.error.issues[0]?.message ?? 'invalid'}`,
    );
  }
  const profile = profileParsed.data;
  const newVersion = `m3-${eraId}-v2`;
  profile.profileVersion = newVersion;
  profile.baselineReport = `calibrate run --samples ${String(payload.samples)} (engine ${payload.engineVersion})`;
  const targets: FrozenTargets = profile.targets;
  const setTarget = (path: string, value: number): void => {
    let node: unknown = targets;
    for (const part of path.split('.')) {
      if (typeof node !== 'object' || node === null || !(part in node)) {
        throw new Error(`profile has no target ${path}`);
      }
      node = Reflect.get(node, part);
    }
    if (typeof node !== 'object' || node === null) {
      throw new Error(`profile has no target ${path}`);
    }
    const leaf = frozenTargetLeafSchema.safeParse(node);
    if (!leaf.success) {
      throw new Error(`profile has no target ${path}`);
    }
    Reflect.set(node, 'value', round4(value));
    const existingSample: unknown = Reflect.get(node, 'minimumSample');
    Reflect.set(
      node,
      'minimumSample',
      MINIMUM_SAMPLES[path] ?? (typeof existingSample === 'number' ? existingSample : 200),
    );
  };
  for (const [key, value] of observed) setTarget(key, value);
  writeJson(resolved, profile, true);
  console.log(`froze ${String(observed.size)} targets into ${resolved} (${newVersion})`);
}
export function run(reportPath: string, eraId = '1990s'): void {
  freezeTargets(reportPath, eraId);
}
