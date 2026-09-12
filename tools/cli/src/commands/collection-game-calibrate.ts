import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_DIFFICULTY_ORDER,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_TARGETS_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_REWARD_VERSION,
  canonicalJson,
  type CollectionCatalog,
  type CollectionDifficultyId,
  type CollectionGameRules,
} from '@hoop-rush/data-contracts';
import { ENGINE_VERSION } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { collectionGameCalibrateReportSchema } from '../report-schemas.ts';
import { runWorkerChunks, validateTargetsArtifact } from '../artifact.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';
import { loadCollectionGameRules } from './collection-game.ts';
import {
  projectCollectionGameJob,
  type CollectionGameProjection,
  type CollectionGameProjectionJob,
} from './collection-game-projection.ts';

export const COLLECTION_GAME_CALIBRATE_OPTIONS: Record<string, boolean> = {
  workers: true,
  'calibration-seeds': true,
  'validation-seeds': true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_COLLECTION_GAME_TARGETS = resolve(
  dirname(DEFAULT_MANIFEST),
  'collection/game-targets.json',
);

export const collectionGameTargetsSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(COLLECTION_GAME_TARGETS_VERSION),
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_REPLAY_VERSION),
    catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
    rulesHash: z.string().regex(/^[0-9a-f]{64}$/),
    engineVersion: z.string().min(1).max(64),
    cohorts: z
      .object({
        calibrationSeeds: z.number().int().nonnegative(),
        validationSeeds: z.number().int().nonnegative(),
        generatedAtIso: z.string().min(1).max(64),
      })
      .strict(),
    fixtures: z
      .array(
        z
          .object({
            fixtureId: z.string().min(1).max(64),
            collectionHash: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .min(4),
    gates: z.record(z.string(), z.boolean()),
    measured: z.record(z.string(), z.number()),
  })
  .strict();
export type CollectionGameTargets = z.infer<typeof collectionGameTargetsSchema>;

function calibrationSeed(index: number): string {
  return index.toString(16).padStart(32, '0');
}

function jobsFor(
  difficultyIds: readonly CollectionDifficultyId[],
  seedOffset: number,
  seedCount: number,
): CollectionGameProjectionJob[] {
  const jobs: CollectionGameProjectionJob[] = [];
  for (const difficultyId of difficultyIds) {
    for (let index = 0; index < seedCount; index += 1) {
      jobs.push({ difficultyId, rootSeed: calibrationSeed(seedOffset + index), gameSequence: 0 });
    }
  }
  return jobs;
}

function projectInProcess(
  catalog: CollectionCatalog,
  rules: CollectionGameRules,
  jobs: readonly CollectionGameProjectionJob[],
): CollectionGameProjection[] {
  return jobs.map((job) => projectCollectionGameJob(catalog, rules, job));
}

function projectViaWorkers(
  manifestPath: string,
  jobs: readonly CollectionGameProjectionJob[],
  workers: number,
): Promise<CollectionGameProjection[]> {
  if (jobs.length === 0) return Promise.resolve([]);
  return runWorkerChunks<CollectionGameProjectionJob, CollectionGameProjection>({
    workerUrl: new URL('./collection-game-calibration-worker.ts', import.meta.url),
    workerData: (chunk) => ({ manifestPath, jobs: chunk }),
    items: jobs,
    workers,
    payloadKey: 'projections',
  });
}

function aggregate(projections: readonly CollectionGameProjection[]): {
  byDifficulty: Array<{
    difficultyId: string;
    games: number;
    meanRosterScoreMillionths: number;
    meanSpecialCount: number;
    legalityFailures: number;
  }>;
  failures: string[];
} {
  const failures: string[] = [];
  const byDifficulty = COLLECTION_DIFFICULTY_ORDER.map((difficultyId) => {
    const entries = projections.filter((entry) => entry.difficultyId === difficultyId);
    const games = entries.length;
    const rosterScoreTotal = entries.reduce((sum, entry) => sum + entry.rosterScoreMillionths, 0);
    const specialTotal = entries.reduce((sum, entry) => sum + entry.specialCount, 0);
    const legalityFailures = entries.filter((entry) => entry.failures.length > 0).length;
    for (const entry of entries) {
      for (const failure of entry.failures) {
        failures.push(`${difficultyId} ${entry.rootSeed}: ${failure}`);
      }
    }
    return {
      difficultyId,
      games,
      meanRosterScoreMillionths: games === 0 ? 0 : Math.round(rosterScoreTotal / games),
      meanSpecialCount: games === 0 ? 0 : specialTotal / games,
      legalityFailures,
    };
  });
  return { byDifficulty, failures };
}

export async function collectionGameCalibrate(args: {
  workers?: string;
  calibrationSeeds?: string;
  validationSeeds?: string;
  out?: string;
  manifest?: string;
  validate?: string | null;
}): Promise<CliReport> {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  if (typeof args.validate === 'string') {
    const extraFailures: string[] = [];
    let rawManifest: unknown;
    try {
      rawManifest = readJsonFile(manifestPath);
    } catch (error) {
      return makeReport(
        'collection game-calibrate',
        { manifest: manifestPath },
        {
          failures: [`cannot read manifest: ${(error as Error).message}`],
          exitCode: 2,
        },
      );
    }
    const pinned = (rawManifest as { collection?: { gameTargets?: { contentHash?: string } } })
      .collection?.gameTargets;
    if (pinned?.contentHash === undefined) {
      extraFailures.push('manifest has no collection.gameTargets pin for the packaged targets');
    } else {
      try {
        const actual = sha256Hex(readFileSync(resolve(args.validate)));
        if (actual !== pinned.contentHash) {
          extraFailures.push(
            `collection game targets content hash mismatch: expected ${pinned.contentHash}, got ${actual}`,
          );
        }
      } catch {
        extraFailures.push(`collection game targets asset is missing (${args.validate})`);
      }
    }
    let catalogHash: string | null = null;
    let rulesHash: string | null = null;
    try {
      catalogHash = loadCollectionCatalog(manifestPath).catalogHash;
      rulesHash = loadCollectionGameRules(manifestPath).rulesHash;
    } catch (error) {
      extraFailures.push((error as Error).message);
    }
    const report = validateTargetsArtifact({
      outPath: args.validate,
      schema: collectionGameTargetsSchema,
      command: 'collection game-calibrate',
      extraChecks: (parsed) => {
        const details: string[] = [];
        const failures: string[] = [...extraFailures];
        if (parsed.catalogHash !== catalogHash) {
          failures.push('targets catalogHash does not match the packaged catalog');
        }
        if (parsed.rulesHash !== rulesHash) {
          failures.push('targets rulesHash does not match the packaged game rules');
        }
        if (parsed.engineVersion !== ENGINE_VERSION) {
          failures.push(`targets engineVersion ${parsed.engineVersion} != ${ENGINE_VERSION}`);
        }
        if (parsed.fixtures.length < 4) {
          failures.push('targets must cover at least four collection strengths');
        }
        details.push(
          `targetsVersion ${parsed.targetsVersion} verified · ${String(parsed.fixtures.length)} fixtures · ${String(parsed.cohorts.calibrationSeeds)} calibration seeds`,
        );
        return { details, failures };
      },
    });
    return report;
  }

  const workers = Math.max(1, Number.parseInt(args.workers ?? '4', 10) || 4);
  const calibrationSeeds = Math.max(1, Number.parseInt(args.calibrationSeeds ?? '16', 10) || 16);
  const validationSeeds = Math.max(1, Number.parseInt(args.validationSeeds ?? '8', 10) || 8);
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  let rules: CollectionGameRules;
  let rulesHash: string;
  try {
    loaded = loadCollectionCatalog(manifestPath);
    ({ rules, rulesHash } = loadCollectionGameRules(manifestPath));
  } catch (error) {
    return makeReport(
      'collection game-calibrate',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const difficultyIds = rules.difficulties.map((profile) => profile.difficultyId);
  const calibrationJobs = jobsFor(difficultyIds, 0, calibrationSeeds);
  const validationJobs = jobsFor(difficultyIds, 5_000_000, validationSeeds);
  const startedAt = Date.now();
  let calibration: CollectionGameProjection[];
  let validation: CollectionGameProjection[];
  let chunkInvariant = true;
  try {
    const viaWorkers = await projectViaWorkers(manifestPath, calibrationJobs, workers);
    const inProcess = projectInProcess(loaded.catalog, rules, calibrationJobs);
    chunkInvariant = canonicalJson(viaWorkers) === canonicalJson(inProcess);
    const alternate =
      workers === 1
        ? await projectViaWorkers(manifestPath, calibrationJobs, 3)
        : await projectViaWorkers(manifestPath, calibrationJobs, 1);
    chunkInvariant = chunkInvariant && canonicalJson(viaWorkers) === canonicalJson(alternate);
    calibration = viaWorkers;
    validation = await projectViaWorkers(manifestPath, validationJobs, workers);
  } catch (error) {
    return makeReport(
      'collection game-calibrate',
      { manifest: manifestPath },
      {
        failures: [`projection failed: ${(error as Error).message}`],
        exitCode: 2,
      },
    );
  }
  const calibrationAggregate = aggregate(calibration);
  const validationAggregate = aggregate(validation);
  const failures = [...calibrationAggregate.failures, ...validationAggregate.failures];
  const gates: Record<string, boolean> = {
    'projection:cpu-legality': calibrationAggregate.failures.length === 0,
    'projection:rarity-band': calibration.every((entry) => entry.bandOk),
    'projection:adjustment-facts': calibration.every((entry) =>
      entry.failures.every((failure) => !failure.includes('adjustment facts')),
    ),
    'projection:chunk-invariant': chunkInvariant,
  };
  const ordered = calibrationAggregate.byDifficulty;
  gates['projection:quality-ordering'] = ordered.every(
    (entry, index) =>
      index === 0 ||
      entry.meanRosterScoreMillionths >=
        (ordered[index - 1]?.meanRosterScoreMillionths ?? Number.POSITIVE_INFINITY),
  );
  gates['projection:special-ordering'] = ordered.every(
    (entry, index) =>
      index === 0 ||
      entry.meanSpecialCount >= (ordered[index - 1]?.meanSpecialCount ?? Number.POSITIVE_INFINITY),
  );
  for (const gate of Object.entries(gates)) {
    if (!gate[1]) failures.push(`gate ${gate[0]} failed on the projection cohort`);
  }
  const blockers = [
    'collection-game-targets-v1 is not frozen: no committed exact-card starter/developing/strong/elite collection fixtures exist (spec §12)',
    'the authoritative Collection rotation simulation cohorts were not run, so win-rate, objective pass-rate, margin-cap, and repeat-Coin gates have no evidence',
    'calibration cohort ranges and held-out target envelopes are not predeclared',
    'manifest.collection.gameTargets pinning is not representable in hoopRushManifestSchema; data-contracts must add the optional entry before freeze',
    'this command intentionally writes no targets artifact and must not be treated as a release gate result until the cohorts above exist',
  ];
  const details = [
    `projection: ${String(calibration.length)} calibration / ${String(validation.length)} validation cpu generations across ${String(difficultyIds.length)} difficulties with ${String(workers)} workers`,
    ...ordered.map(
      (entry) =>
        `${entry.difficultyId}: mean roster score ${String(entry.meanRosterScoreMillionths)} · mean specials ${entry.meanSpecialCount.toFixed(2)} · failures ${String(entry.legalityFailures)}`,
    ),
    ...blockers.map((blocker) => `blocker: ${blocker}`),
  ];
  const payload = collectionGameCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'collection game-calibrate',
    status: 'scaffold',
    rulesVersion: rules.rulesVersion,
    rulesHash,
    catalogHash: loaded.catalogHash,
    workers,
    calibrationSeeds,
    validationSeeds,
    projection: {
      calibrationGames: calibration.length,
      validationGames: validation.length,
      chunkInvariant,
      difficulties: ordered,
    },
    gates,
    blockers,
    targetsWritten: false,
    targetsPath: null,
    durationMs: Date.now() - startedAt,
  });
  return makeReport(
    'collection game-calibrate',
    { manifest: manifestPath },
    { details, failures, payload },
  );
}
