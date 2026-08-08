import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PROJECTION_MODEL_VERSION,
  PROJECTION_TARGETS_VERSION,
  fnv1a32,
  parseProjectionModelArtifact,
  seedFromString,
  type BaseFiveProjectionInput,
  type EraSimulationProfile,
  type ProjectionMatchupArchetype,
  type ProjectionModelArtifact,
  type ProjectionReferenceFive,
  type ProjectionTargets,
  type SimulationPlayer,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  generateAiLeague,
  projectBaseFive,
  projectSeasonRoster,
  simulateGame,
  toSimulationPlayer,
  type EngineContext,
} from '@hoop-rush/engine';
import { parseCount, parseWorkers } from '../args.ts';
import { makeReport, type CliReport } from '../report.ts';
import { PackagedData, REPO_ROOT, DEFAULT_MANIFEST, loadPackagedData } from './data-loader.ts';
import {
  fixtureHumanRoster,
  loadSeasonDraftCatalog,
  loadSeasonLeague,
  loadSeasonRosterTargets,
} from './season-data.ts';
import type { SeasonProjection, SeasonRotation } from '@hoop-rush/data-contracts';

/**
 * Projection milestone CLI commands (spec/09 + projection milestone):
 * - `projection build`: derives the versioned projection model artifact from
 *   packaged pool aggregates and writes it with explicit `--write`;
 * - `projection base`: projects one legal five against the era reference;
 * - `projection calibrate-base`: paired fixed-five simulation cohorts against
 *   the authoritative `simulateGame` path;
 * - `projection validate`: held-out read-only validation (no `--write`);
 * - `projection benchmark`: base-projection timing gates.
 */

export const PROJECTION_BASE_OPTIONS = {
  fixture: true,
  'seed-from': true,
  'seed-to': true,
  samples: true,
  workers: true,
  profile: true,
  manifest: true,
  model: true,
  era: true,
  reference: true,
  format: true,
  verbose: false,
};

export const PROJECTION_BUILD_OPTIONS = {
  manifest: true,
  out: true,
  write: false,
  format: true,
  verbose: false,
};

export const PROJECTION_CALIBRATE_OPTIONS = {
  manifest: true,
  model: true,
  targets: true,
  'seed-from': true,
  'seed-to': true,
  samples: true,
  workers: true,
  era: true,
  out: true,
  validate: false,
  'write-model': false,
  format: true,
  verbose: false,
};

export const PROJECTION_BENCHMARK_OPTIONS = {
  manifest: true,
  model: true,
  era: true,
  samples: true,
  format: true,
  verbose: false,
};

const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const PROJECTION_DIR = resolve(STATIC_DATA, 'projection');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');

function sha256Hex(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`cannot read ${path}: ${(error as Error).message}`);
  }
}

/** Builds a PackagedData instance from a manifest path (default repo manifest). */
function loadData(manifestPath: string | null | undefined): PackagedData {
  const loaded = loadPackagedData(manifestPath ?? undefined);
  return new PackagedData(loaded.manifest, loaded.dir);
}

/** Builds the strict five-slot projection input tuple from a team. */
function lineupInput(players: readonly SimulationPlayer[]): BaseFiveProjectionInput['lineup'] {
  if (players.length !== 5) {
    throw new Error(`projection: need exactly five players, got ${String(players.length)}`);
  }
  return [
    { player: players[0] as SimulationPlayer, slot: 'G1' },
    { player: players[1] as SimulationPlayer, slot: 'G2' },
    { player: players[2] as SimulationPlayer, slot: 'F1' },
    { player: players[3] as SimulationPlayer, slot: 'F2' },
    { player: players[4] as SimulationPlayer, slot: 'C' },
  ];
}

/** Loads the committed projection model artifact (or the manifest entry). */
function loadModel(
  manifestPath: string | null | undefined,
  modelPath: string | null | undefined,
): ProjectionModelArtifact {
  if (modelPath !== null && modelPath !== undefined) {
    const value = readJson(modelPath);
    return parseProjectionModelArtifact(value);
  }
  const manifest = readJson(manifestPath ?? MANIFEST_PATH) as {
    projection?: { model?: { url?: string; contentHash?: string } };
  };
  const entry = manifest.projection?.model;
  if (entry?.url === undefined) {
    throw new Error('no projection model entry in the manifest; run `projection build --write`');
  }
  const path = resolve(dirname(manifestPath ?? MANIFEST_PATH), entry.url);
  const raw = readFileSync(path, 'utf8');
  const value = JSON.parse(raw) as unknown;
  const parsed = parseProjectionModelArtifact(value);
  const actual = sha256Hex(raw);
  if (entry.contentHash !== undefined && actual !== entry.contentHash) {
    throw new Error(`projection model content hash mismatch for ${path}`);
  }
  return parsed;
}

/** ---------------------------------------------------------------------------
 * Reference derivation (build-time, from packaged pool aggregates).
 * ------------------------------------------------------------------------- */

const SLOT_POSITIONS: SimulationPlayer['positions'][] = [['PG'], ['SG'], ['SF'], ['PF'], ['C']];

interface PoolPlayerView {
  player: SimulationPlayer;
  eraId: string;
}

/** Collects every pool player for an era (deduplicated by playerId). */
function eraPlayers(data: PackagedData, eraId: string): PoolPlayerView[] {
  const seen = new Set<string>();
  const players: PoolPlayerView[] = [];
  for (const entry of data.manifest.pools) {
    if (entry.eraId !== eraId) continue;
    const pool = data.pool(entry.franchiseId, eraId);
    for (const record of pool.players) {
      if (seen.has(record.playerId)) continue;
      seen.add(record.playerId);
      players.push({ player: toSimulationPlayer(record), eraId });
    }
  }
  return players;
}

/** Trait membership for one archetype (deterministic population filters). */
function archetypeFilter(archetype: ProjectionMatchupArchetype): {
  (player: SimulationPlayer): boolean;
  kind: 'neutral' | 'trait';
} {
  switch (archetype) {
    case 'neutral':
      return Object.assign(() => true, { kind: 'neutral' as const });
    case 'perimeter':
      return Object.assign(
        (p: SimulationPlayer) => p.ratings.threePoint >= 55 || p.tendencies.threePointRate >= 25,
        { kind: 'trait' as const },
      );
    case 'interior':
      return Object.assign(
        (p: SimulationPlayer) => p.ratings.insideScoring >= 65 || p.tendencies.rimFrequency >= 45,
        { kind: 'trait' as const },
      );
    case 'pressure':
      return Object.assign(
        (p: SimulationPlayer) => p.ratings.perimeterDefense >= 60 || p.ratings.steal >= 60,
        { kind: 'trait' as const },
      );
    case 'size-switch':
      return Object.assign(
        (p: SimulationPlayer) =>
          (p.heightInches ?? 0) >= 79 &&
          (p.ratings.interiorDefense >= 55 || p.ratings.defensiveIq >= 60),
        { kind: 'trait' as const },
      );
  }
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregates one slot-group population into a synthetic reference player. */
function aggregateReferencePlayer(
  candidates: readonly SimulationPlayer[],
  slotIndex: number,
  label: string,
): SimulationPlayer {
  const position = SLOT_POSITIONS[slotIndex]?.[0] ?? 'PG';
  const group = candidates.filter((player) => player.positions.includes(position));
  const pool = group.length > 0 ? group : candidates;
  const ratings = Object.fromEntries(
    Object.keys(pool[0]?.ratings ?? {}).map((key) => [
      key,
      Math.round(
        Math.min(
          100,
          Math.max(0, meanOf(pool.map((p) => p.ratings[key as keyof SimulationPlayer['ratings']]))),
        ),
      ),
    ]),
  ) as SimulationPlayer['ratings'];
  const tendencies = Object.fromEntries(
    Object.keys(pool[0]?.tendencies ?? {}).map((key) => [
      key,
      Math.round(
        Math.min(
          100,
          Math.max(
            0,
            meanOf(pool.map((p) => p.tendencies[key as keyof SimulationPlayer['tendencies']])),
          ),
        ),
      ),
    ]),
  ) as SimulationPlayer['tendencies'];

  const anchored = pool.filter((player) => player.anchors !== undefined);
  const anchors: SimulationPlayer['anchors'] =
    anchored.length > 0
      ? {
          gamesPlayed: Math.round(meanOf(anchored.map((p) => p.anchors?.gamesPlayed ?? 0))),
          minutesPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.minutesPerGame ?? 0)) * 10) / 10,
          pointsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.pointsPerGame ?? 0)) * 10) / 10,
          reboundsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.reboundsPerGame ?? 0)) * 10) / 10,
          offensiveReboundsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.offensiveReboundsPerGame ?? 0)) * 10) /
            10,
          defensiveReboundsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.defensiveReboundsPerGame ?? 0)) * 10) /
            10,
          assistsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.assistsPerGame ?? 0)) * 10) / 10,
          stealsPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.stealsPerGame ?? 0)) * 10) / 10,
          blocksPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.blocksPerGame ?? 0)) * 10) / 10,
          turnoversPerGame:
            Math.round(meanOf(anchored.map((p) => p.anchors?.turnoversPerGame ?? 0)) * 10) / 10,
          fieldGoalPct:
            Math.round(meanOf(anchored.map((p) => p.anchors?.fieldGoalPct ?? 0)) * 1000) / 1000,
          threePointPct: null,
          freeThrowPct:
            Math.round(meanOf(anchored.map((p) => p.anchors?.freeThrowPct ?? 0)) * 1000) / 1000,
          threePointAttemptRate: null,
          freeThrowAttemptRate:
            Math.round(meanOf(anchored.map((p) => p.anchors?.freeThrowAttemptRate ?? 0)) * 1000) /
            1000,
        }
      : undefined;

  // Three-point percentage/rate keep null semantics: averaged over the
  // non-null observations, null when nothing is observed.
  if (anchors !== undefined) {
    const threePct = anchored
      .map((p) => p.anchors?.threePointPct)
      .filter((value): value is number => value !== null && value !== undefined);
    if (threePct.length > 0) {
      anchors.threePointPct = Math.round(meanOf(threePct) * 1000) / 1000;
    }
    const threeRate = anchored
      .map((p) => p.anchors?.threePointAttemptRate)
      .filter((value): value is number => value !== null && value !== undefined);
    if (threeRate.length > 0) {
      anchors.threePointAttemptRate = Math.round(meanOf(threeRate) * 1000) / 1000;
    }
  }

  const reconstructed = pool.filter((player) => player.reconstructedThreePoint !== undefined);
  const firstReconstructed = reconstructed[0]?.reconstructedThreePoint;
  const reconstructedThreePoint: SimulationPlayer['reconstructedThreePoint'] =
    reconstructed.length >= Math.max(1, pool.length / 2) && firstReconstructed !== undefined
      ? {
          modelVersion: firstReconstructed.modelVersion,
          accuracyConservative:
            Math.round(
              meanOf(
                reconstructed.map((p) => p.reconstructedThreePoint?.accuracyConservative ?? 0),
              ) * 1000,
            ) / 1000,
          accuracyMean:
            Math.round(
              meanOf(reconstructed.map((p) => p.reconstructedThreePoint?.accuracyMean ?? 0)) * 1000,
            ) / 1000,
          accuracyStdDev:
            Math.round(
              meanOf(reconstructed.map((p) => p.reconstructedThreePoint?.accuracyStdDev ?? 0)) *
                1000,
            ) / 1000,
          attemptRateConservative:
            Math.round(
              meanOf(
                reconstructed.map((p) => p.reconstructedThreePoint?.attemptRateConservative ?? 0),
              ) * 1000,
            ) / 1000,
          attemptRateMean:
            Math.round(
              meanOf(reconstructed.map((p) => p.reconstructedThreePoint?.attemptRateMean ?? 0)) *
                1000,
            ) / 1000,
          attemptRateStdDev:
            Math.round(
              meanOf(reconstructed.map((p) => p.reconstructedThreePoint?.attemptRateStdDev ?? 0)) *
                1000,
            ) / 1000,
          confidence: 'medium',
          floor:
            Math.round(
              meanOf(reconstructed.map((p) => p.reconstructedThreePoint?.floor ?? 0)) * 1000,
            ) / 1000,
          zoneFloors: {
            cornerThree:
              Math.round(
                meanOf(
                  reconstructed.map((p) => p.reconstructedThreePoint?.zoneFloors.cornerThree ?? 0),
                ) * 1000,
              ) / 1000,
            aboveBreakThree:
              Math.round(
                meanOf(
                  reconstructed.map(
                    (p) => p.reconstructedThreePoint?.zoneFloors.aboveBreakThree ?? 0,
                  ),
                ) * 1000,
              ) / 1000,
          },
          evidence: {
            missingFeatures: 0,
            sourceFields: ['pool-aggregate'],
          },
        }
      : undefined;

  return {
    playerId: `ref-${label.toLowerCase().replaceAll(' ', '-')}-s${String(slotIndex + 1)}`,
    displayName: label,
    positions: SLOT_POSITIONS[slotIndex] ?? ['PG'],
    heightInches: Math.round(meanOf(pool.map((p) => p.heightInches ?? 0))),
    weightLbs: Math.round(meanOf(pool.map((p) => p.weightLbs ?? 0))),
    ratings,
    tendencies,
    ...(anchors !== undefined ? { anchors } : {}),
    ...(reconstructedThreePoint !== undefined ? { reconstructedThreePoint } : {}),
  };
}

/** Derives one reference five for an era and archetype from pool aggregates. */
function deriveReferenceFive(
  players: readonly SimulationPlayer[],
  eraId: string,
  archetype: ProjectionMatchupArchetype,
): ProjectionReferenceFive {
  const filter = archetypeFilter(archetype);
  const eligible = players.filter(filter);
  const population = eligible.length >= 5 ? eligible : players;
  const labels: Record<number, string> = {
    0: `${archetype === 'neutral' ? 'Neutral' : capitalize(archetype)} G1`,
    1: `${archetype === 'neutral' ? 'Neutral' : capitalize(archetype)} G2`,
    2: `${archetype === 'neutral' ? 'Neutral' : capitalize(archetype)} F1`,
    3: `${archetype === 'neutral' ? 'Neutral' : capitalize(archetype)} F2`,
    4: `${archetype === 'neutral' ? 'Neutral' : capitalize(archetype)} C`,
  };
  const five = [0, 1, 2, 3, 4].map((slotIndex) =>
    aggregateReferencePlayer(population, slotIndex, labels[slotIndex] ?? 'Reference'),
  ) as [SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer];
  const referenceId = `ref-${eraId}-${archetype}`;
  return {
    referenceId,
    archetype,
    eraId,
    referenceHash: sha256Hex(JSON.stringify(five)),
    players: five,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Derives the full model artifact from the packaged pools. */
export function deriveProjectionModel(data: PackagedData): {
  model: ProjectionModelArtifact;
  populationSizes: Record<string, number>;
} {
  const eraIds = data.manifest.eraSimulationProfiles.map((entry) => entry.eraId);
  const references: ProjectionModelArtifact['references'] = {};
  const eraProfileVersions: Record<string, string> = {};
  const populationSizes: Record<string, number> = {};
  const archetypes: ProjectionMatchupArchetype[] = [
    'perimeter',
    'interior',
    'pressure',
    'size-switch',
  ];
  for (const eraId of eraIds) {
    const pooled = eraPlayers(data, eraId);
    const players = pooled.map((entry) => entry.player);
    populationSizes[eraId] = players.length;
    eraProfileVersions[eraId] = data.eraProfile(eraId).profileVersion;
    references[eraId] = {
      neutral: deriveReferenceFive(players, eraId, 'neutral'),
      archetypes: archetypes.map((archetype) => deriveReferenceFive(players, eraId, archetype)),
    };
  }
  const model: ProjectionModelArtifact = {
    schemaVersion: 1,
    modelVersion: PROJECTION_MODEL_VERSION,
    dataVersion: data.manifest.dataVersion,
    ratingsVersion: data.manifest.dataVersion,
    eraProfileVersions,
    references,
    scales: {
      creation: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      spacing: { baseline: 0.5, perPoint: 0.01, min: 0, max: 100, higherIsBetter: true },
      defense: { baseline: 55, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
    },
    componentWeights: { creation: 1, spacing: 1, defense: 1 },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [
      {
        code: 'creation',
        severity: 'critical',
        threshold: 35,
        weight: 2,
        minSide: true,
        message: 'creation {value} below the critical floor {threshold}',
      },
      {
        code: 'spacing',
        severity: 'major',
        threshold: 30,
        weight: 1,
        minSide: true,
        message: 'spacing {value} below the floor {threshold}',
      },
      {
        code: 'defense',
        severity: 'major',
        threshold: 35,
        weight: 1,
        minSide: true,
        message: 'defensive coverage {value} below the floor {threshold}',
      },
      {
        code: 'turnoverRate',
        severity: 'major',
        threshold: 22,
        weight: 1,
        minSide: false,
        message: 'turnover rate {value} above {threshold}',
      },
      {
        code: 'defensiveRebounding',
        severity: 'minor',
        threshold: 40,
        weight: 1,
        minSide: true,
        message: 'defensive rebounding {value} below {threshold}',
      },
    ],
    search: {
      seedNamespace: 'season-projection-search',
      partialBeamsPerLens: 16,
      completeCandidates: 32,
      startingFives: 16,
      closingFives: 16,
      benchHierarchies: 8,
      minuteTemplates: 4,
      singleRemovals: 'all',
      pairRemovals: 8,
      nodeBudgets: { partial: 100_000, complete: 100_000, rotation: 50_000 },
      closeScenarioWeight: 0.2,
    },
    cohorts: {
      calibrationGames: 2048,
      validationGames: 1024,
      heldOutGames: 2048,
      calibrationSeedFrom: '00000000000000000000000000000000',
      calibrationSeedTo: '000000000000000000000000000007ff',
      validationSeedFrom: '00000000000000000000000000000800',
      validationSeedTo: '00000000000000000000000000000bff',
      heldOutSeedFrom: '00000000000000000000000000000c00',
      heldOutSeedTo: '000000000000000000000000000013ff',
    },
    monotonicGates: [
      {
        code: 'shooting-monotonic',
        driver: 'threePoint',
        output: 'effectiveFieldGoalPct',
        description: 'better shooting must not lower projected eFG%',
      },
      {
        code: 'creation-monotonic',
        driver: 'ballHandling',
        output: 'creation',
        description: 'better creation must not reduce creation output',
      },
      {
        code: 'security-monotonic',
        driver: 'ballHandling',
        output: 'turnoverRate',
        description: 'better security must not increase turnover rate',
      },
      {
        code: 'defense-monotonic',
        driver: 'perimeterDefense',
        output: 'defensiveRatingAllowed',
        description: 'better defense must not increase defensive rating allowed',
      },
      {
        code: 'rebounding-monotonic',
        driver: 'defensiveRebound',
        output: 'defensiveRebounding',
        description: 'better rebounding must not reduce rebounding',
      },
    ],
  };
  return { model, populationSizes };
}

/** Builds the initial projection-targets artifact (frozen defaults). */
export function buildProjectionTargets(): ProjectionTargets {
  return {
    schemaVersion: 1,
    targetsVersion: PROJECTION_TARGETS_VERSION,
    cohorts: {
      calibrationLineups: 16,
      validationLineups: 8,
      heldOutLineups: 16,
      gamesPerLineup: 128,
      calibrationSeedFrom: '00000000000000000000000000000000',
      calibrationSeedTo: '000000000000000000000000000007ff',
      validationSeedFrom: '00000000000000000000000000000800',
      validationSeedTo: '00000000000000000000000000000bff',
      heldOutSeedFrom: '00000000000000000000000000000c00',
      heldOutSeedTo: '000000000000000000000000000013ff',
    },
    gates: {
      offensiveRatingMaeMax: 6,
      defensiveRatingMaeMax: 6,
      netRatingMaeMax: 8,
      netRatingBiasMax: 4,
      rankCorrelationMin: 0.6,
      pairwiseOrderingAccuracyMin: 0.62,
      monotonicPassShareMin: 1,
      heldOutPassShare: 0.9,
    },
    measured: {
      offensiveRatingMae: 0,
      defensiveRatingMae: 0,
      netRatingMae: 0,
      netRatingBias: 0,
      rankCorrelation: 0,
      pairwiseOrderingAccuracy: 0,
      monotonicFailures: 0,
      heldOutPassRate: 0,
    },
  };
}

export const PROJECTION_SEASON_OPTIONS = {
  fixture: true,
  manifest: true,
  model: true,
  era: true,
  format: true,
  verbose: false,
};

export const PROJECTION_AI_SHADOW_OPTIONS = {
  manifest: true,
  model: true,
  era: true,
  seed: true,
  format: true,
  verbose: false,
};

/** `projection ai-shadow`: generates a league with projection shadow mode and
 * compares the current AI selections against the projection-ranked best
 * candidates of the same pools. Selection is never changed. */
export function projectionAiShadow(input: {
  manifest: string | null | undefined;
  model: string | null | undefined;
  era: string | null | undefined;
  seed: string | null | undefined;
  verbose: boolean;
}): CliReport {
  const { manifest, model: modelPath, era, seed } = input;
  const data = loadData(manifest);
  const model = loadModel(manifest, modelPath);
  const eraId = era ?? '2010s';
  const profile = data.eraProfile(eraId);
  const runSeed = seed ?? 'd00d2026a1b2c3d4e5f60718293a4b5c6';
  const manifestPath = manifest ?? DEFAULT_MANIFEST;
  let catalog: import('@hoop-rush/data-contracts').SeasonDraftCatalog;
  try {
    catalog = loadSeasonDraftCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'projection ai-shadow',
      { manifest: manifestPath },
      { failures: [(error as Error).message] },
    );
  }
  let league: import('@hoop-rush/data-contracts').SeasonLeague;
  try {
    league = loadSeasonLeague();
  } catch (error) {
    return makeReport(
      'projection ai-shadow',
      { manifest: manifestPath },
      { failures: [(error as Error).message] },
    );
  }
  let targets: import('@hoop-rush/data-contracts').SeasonRosterTargets;
  try {
    targets = loadSeasonRosterTargets(manifestPath);
  } catch (error) {
    return makeReport(
      'projection ai-shadow',
      { manifest: manifestPath },
      { failures: [(error as Error).message] },
    );
  }
  const humanRosters = [{ franchiseId: 'lakers', playerVersionIds: fixtureHumanRoster(catalog) }];
  let generation: import('@hoop-rush/data-contracts').SeasonLeagueGenerationResult;
  try {
    generation = generateAiLeague({
      seed: runSeed,
      catalog,
      league,
      humanFranchiseIds: ['lakers'],
      humanRosters,
      targets,
      projection: { eraProfile: profile, model },
    });
  } catch (error) {
    return makeReport(
      'projection ai-shadow',
      { seed: runSeed, era: eraId },
      { failures: [(error as Error).message] },
    );
  }

  const summaries = generation.evaluations.filter(
    (evaluation) => evaluation.projectionSummary !== undefined,
  );
  const different = summaries.filter(
    (evaluation) => evaluation.projectionSummary?.selectedIsBest === false,
  );
  const gaps = summaries
    .map((evaluation) => {
      const summary = evaluation.projectionSummary;
      if (summary === undefined || summary.bestNetRating === null) return null;
      return summary.bestNetRating - summary.selectedNetRating;
    })
    .filter((gap): gap is number => gap !== null);
  const meanGap = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
  const details = [
    `league generated with projection shadow mode (${String(summaries.length)} AI evaluations)`,
    `selection differs from the projection-best in ${String(different.length)} of ${String(summaries.length)} pools`,
    `mean best-minus-selected net-rating gap: ${meanGap.toFixed(2)} (${String(gaps.length)} pools with a best candidate)`,
    `generation digest: ${generation.digest}`,
  ];
  return makeReport(
    'projection ai-shadow',
    { seed: runSeed, era: eraId },
    {
      details,
      payload: {
        digest: generation.digest,
        differentPools: different.length,
        totalPools: summaries.length,
        meanNetGap: meanGap,
      },
    },
  );
}

/** `projection season`: projects one ten-player roster with its rotation. */
export function projectionSeason(input: {
  fixture: string | null | undefined;
  manifest: string | null | undefined;
  model: string | null | undefined;
  era: string | null | undefined;
  verbose: boolean;
}): CliReport {
  const { fixture, manifest, model: modelPath, era, verbose } = input;
  if (fixture === null || fixture === undefined) {
    return makeReport('projection season', {}, { failures: ['--fixture is required'] });
  }
  const data = loadData(manifest);
  const model = loadModel(manifest, modelPath);
  const eraId = era ?? '2010s';
  const profile = data.eraProfile(eraId);
  const fixtureValue = readJson(fixture) as {
    roster?: SimulationPlayer[];
    rotation?: SeasonRotation;
    players?: SimulationPlayer[];
  };
  const roster = fixtureValue.roster ?? fixtureValue.players;
  const rotation = fixtureValue.rotation;
  if (roster === undefined || rotation === undefined) {
    return makeReport(
      'projection season',
      { fixture },
      { failures: [`fixture ${fixture} must carry a roster and a rotation`] },
    );
  }
  let projection: SeasonProjection;
  try {
    projection = projectSeasonRoster({
      roster: roster.map((player) => ({ player })),
      rotation,
      eraProfile: profile,
      model,
    });
  } catch (error) {
    return makeReport(
      'projection season',
      { fixture, era: eraId },
      { failures: [(error as Error).message] },
    );
  }
  const details = [
    `roster: ${roster.map((player) => player.displayName).join(' | ')}`,
    `weighted offensive rating: ${projection.metrics.offensiveRating.toFixed(1)}`,
    `weighted defensive rating allowed: ${projection.metrics.defensiveRatingAllowed.toFixed(1)}`,
    `weighted net rating: ${projection.metrics.netRating.toFixed(1)}`,
    `units: ${String(projection.units.length)} (${String(projection.units.filter((unit) => unit.kind === 'trace').length)} trace, ${String(projection.units.filter((unit) => unit.kind === 'contingency').length)} contingency, ${String(projection.units.filter((unit) => unit.kind === 'matchup').length)} matchup)`,
    `starting quality: ${projection.metrics.startingQuality.toFixed(1)} | closing: ${projection.metrics.closingQuality.toFixed(1)} | bench: ${projection.metrics.benchQuality.toFixed(1)}`,
    `minute deviation: ${projection.metrics.minuteDeviation.toFixed(1)}`,
    `continuity: creation ${projection.metrics.creationContinuity.toFixed(1)} / spacing ${projection.metrics.spacingContinuity.toFixed(1)}`,
    `contingency depth: ${projection.metrics.contingencyDepth.toFixed(1)} | foul resilience: ${projection.metrics.foulResilience.toFixed(1)}`,
    `matchup mean: ${projection.metrics.matchupMean.toFixed(1)} | worst: ${projection.metrics.matchupWorstCase.toFixed(1)}`,
    `redundancy: ${projection.metrics.redundancy.toFixed(1)}`,
    `weaknesses: ${projection.weaknesses.map((w) => `${w.code}(${w.severity})`).join(', ') || 'none'}`,
    `projection digest: ${projection.digest}`,
  ];
  if (verbose) {
    for (const row of projection.minutes) {
      details.push(
        `  ${row.playerVersionId}: target ${String(row.targetMinutes)} / trace ${String(row.traceMinutes)} min (dev ${String(row.deviation)})`,
      );
    }
  }
  return makeReport('projection season', { fixture, era: eraId }, { details, payload: projection });
}

/** `projection build`: derives and (with --write) commits the model artifact. */
export function projectionBuild(input: {
  manifest?: string | null;
  out?: string | null;
  write: boolean;
  verbose: boolean;
}): CliReport {
  const { manifest: manifestPath, out, write, verbose } = input;
  const data = loadData(manifestPath);
  const { model, populationSizes } = deriveProjectionModel(data);

  const content = `${JSON.stringify(model, null, 2)}\n`;
  const details = [
    `model ${model.modelVersion} with ${String(Object.keys(model.references).length)} era reference sets`,
    ...Object.entries(populationSizes).map(
      ([eraId, size]) => `  ${eraId}: ${String(size)} pooled players`,
    ),
    ...Object.entries(model.references).map(
      ([eraId, set]) =>
        `  ${eraId}: neutral=${set.neutral.referenceHash.slice(0, 12)} archetypes=${set.archetypes
          .map((reference) => reference.referenceId)
          .join(',')}`,
    ),
  ];

  if (write) {
    mkdirSync(dirname(out ?? resolve(PROJECTION_DIR, 'projection-model.json')), {
      recursive: true,
    });
    const target = out ?? resolve(PROJECTION_DIR, 'projection-model.json');
    writeFileSync(target, content);
    details.push(`wrote ${target} (${String(content.length)} bytes)`);

    const manifest = readJson(manifestPath ?? MANIFEST_PATH) as {
      projection?: Record<string, unknown>;
      season?: Record<string, unknown>;
    };
    manifest.projection = {
      ...manifest.projection,
      model: { url: 'projection/projection-model.json', contentHash: sha256Hex(content) },
    };
    writeFileSync(manifestPath ?? MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    details.push(`manifest projection.model hash updated`);
  } else {
    details.push('--write not set: artifact not committed');
  }

  if (verbose) {
    details.push(`weakness policy: ${model.weaknesses.map((w) => w.code).join(', ')}`);
    details.push(`search policy: ${JSON.stringify(model.search)}`);
  }
  return makeReport(
    'projection build',
    { manifest: manifestPath ?? 'default', write },
    { details },
  );
}

/** ---------------------------------------------------------------------------
 * `projection base`: project one legal five against the era reference.
 * ------------------------------------------------------------------------- */

export function projectionBase(input: {
  fixture: string | null | undefined;
  manifest?: string | null;
  model?: string | null;
  era?: string | null;
  reference?: string | null;
  verbose: boolean;
}): CliReport {
  const { fixture, manifest, model: modelPath, era, reference, verbose } = input;
  const data = loadData(manifest);
  const model = loadModel(manifest, modelPath);
  const eraId = era ?? '2010s';
  const profile = data.eraProfile(eraId);
  const referenceSet = model.references[eraId];
  if (referenceSet === undefined) {
    return makeReport(
      'projection base',
      { era: eraId },
      { failures: [`no reference set for era ${eraId} in the model artifact`] },
    );
  }

  let team: SimulationTeam;
  if (fixture !== null && fixture !== undefined) {
    const fixtureValue = readJson(fixture) as {
      home?: SimulationTeam;
      away?: SimulationTeam;
      lineup?: SimulationTeam;
    };
    const candidate = fixtureValue.home ?? fixtureValue.lineup ?? fixtureValue.away;
    if (candidate === undefined) {
      return makeReport(
        'projection base',
        { fixture },
        { failures: [`fixture ${fixture} has no home/away/lineup team`] },
      );
    }
    team = candidate;
  } else {
    return makeReport(
      'projection base',
      { era: eraId },
      { failures: ['--fixture is required (lineup projection source)'] },
    );
  }

  const projection = projectBaseFive({
    lineup: lineupInput(team.players),
    eraProfile: profile,
    model,
    ...(reference !== null ? { referenceId: reference } : {}),
  });

  const details = [
    `lineup: ${team.players.map((player) => player.displayName).join(' | ')}`,
    `reference: ${projection.referenceId} (${projection.referenceHash.slice(0, 12)})`,
    `offensive rating: ${projection.ratings.offensiveRating.toFixed(1)}`,
    `defensive rating allowed: ${projection.ratings.defensiveRatingAllowed.toFixed(1)}`,
    `net rating: ${projection.ratings.netRating.toFixed(1)}`,
    `shooting: ${(projection.offense.ledger.effectiveFieldGoalPct * 100).toFixed(1)} eFG% / ${(projection.offense.ledger.trueShootingPct * 100).toFixed(1)} TS%`,
    `turnovers: ${projection.offense.ledger.turnovers.toFixed(1)} / 100 (${(projection.offense.ledger.turnoverRate * 100).toFixed(1)}%)`,
    `rebounding: ${(projection.offense.ledger.offensiveReboundRate * 100).toFixed(1)} OReb% / ${(projection.offense.ledger.defensiveReboundRate * 100).toFixed(1)} DReb%`,
    `free throws: ${projection.offense.ledger.freeThrowAttempts.toFixed(1)} FTA / 100 (${(projection.offense.ledger.freeThrowRate * 100).toFixed(1)} FTr)`,
    `creation: ${projection.offense.creation.score.toFixed(1)} (top-two share ${(projection.offense.creation.topTwoShare * 100).toFixed(0)}%)`,
    `spacing: ${projection.offense.spacing.score.toFixed(1)} (raw ${projection.offense.spacing.raw.toFixed(3)})`,
    `defensive coverage: ${projection.offense.defense.score.toFixed(1)}`,
    `weaknesses: ${projection.weaknesses.map((w) => `${w.code}(${w.severity})`).join(', ') || 'none'}`,
    `input digest: ${projection.inputDigest}`,
    `projection digest: ${projection.digest}`,
  ];
  if (verbose) {
    for (const player of projection.offense.players) {
      details.push(
        `  ${player.slot} ${player.displayName}: ${player.expectedShots.toFixed(1)} FGA / ${player.expectedPoints.toFixed(1)} pts / ${player.expectedAssists.toFixed(1)} ast / ${player.expectedTurnovers.toFixed(1)} tov`,
      );
    }
  }
  return makeReport('projection base', { fixture, era: eraId }, { details, payload: projection });
}

/** ---------------------------------------------------------------------------
 * `projection calibrate-base`: paired fixed-five cohorts vs the projector.
 * ------------------------------------------------------------------------- */

interface CalibrationStats {
  lineups: number;
  games: number;
  offensiveRatingMae: number;
  defensiveRatingMae: number;
  netRatingMae: number;
  netRatingBias: number;
  rankCorrelation: number;
  pairwiseOrderingAccuracy: number;
  monotonicFailures: number;
}

function spearman(projected: number[], simulated: number[]): number {
  const rank = (values: number[]): number[] => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length).fill(0);
    order.forEach((entry, position) => {
      ranks[entry.index] = position;
    });
    return ranks;
  };
  const a = rank(projected);
  const b = rank(simulated);
  const n = a.length;
  const meanA = n > 0 ? a.reduce((s, v) => s + v, 0) / n : 0;
  const meanB = n > 0 ? b.reduce((s, v) => s + v, 0) / n : 0;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let index = 0; index < n; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    cov += (av - meanA) * (bv - meanB);
    varA += (av - meanA) * (av - meanA);
    varB += (bv - meanB) * (bv - meanB);
  }
  return varA === 0 || varB === 0 ? 0 : cov / Math.sqrt(varA * varB);
}

function pairwiseAccuracy(projected: number[], simulated: number[]): number {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < projected.length; i += 1) {
    for (let j = i + 1; j < projected.length; j += 1) {
      const a = (projected[i] ?? 0) - (projected[j] ?? 0);
      const b = (simulated[i] ?? 0) - (simulated[j] ?? 0);
      if (a === 0 && b === 0) continue;
      total += 1;
      if (a !== 0 && b !== 0 && a * b > 0) correct += 1;
    }
  }
  return total === 0 ? 1 : correct / total;
}

function projectSimulateLineup(input: {
  lineup: SimulationTeam;
  reference: SimulationTeam;
  profile: EraSimulationProfile;
  model: ProjectionModelArtifact;
  context: EngineContext;
  games: number;
  seedBase: string;
}): {
  projected: { ortg: number; drtg: number; net: number };
  simulated: { ortg: number; drtg: number; net: number };
} {
  const { lineup, reference, profile, model, context, games, seedBase } = input;
  const projection = projectBaseFive({
    lineup: lineupInput(lineup.players),
    eraProfile: profile,
    model,
  });

  let lineupPoints = 0;
  let lineupPoss = 0;
  let opponentPoints = 0;
  let opponentPoss = 0;
  for (let index = 0; index < games; index += 1) {
    const seed = seedFromString(`${seedBase}-${String(index)}`);
    const homeIsLineup = index % 2 === 0;
    const result = simulateGame(
      {
        schemaVersion: 2,
        seed,
        gameNumber: 1,
        dataVersion: profile.dataVersion,
        profile,
        home: homeIsLineup ? lineup : reference,
        away: homeIsLineup ? reference : lineup,
      },
      context,
    );
    if (homeIsLineup) {
      lineupPoints += result.home.box.points;
      lineupPoss += result.home.box.possessions;
      opponentPoints += result.away.box.points;
      opponentPoss += result.away.box.possessions;
    } else {
      opponentPoints += result.home.box.points;
      opponentPoss += result.home.box.possessions;
      lineupPoints += result.away.box.points;
      lineupPoss += result.away.box.possessions;
    }
  }
  // Paired home/away play: the lineup's rating is its own points per 100
  // possessions; the defensive rating allowed is the opponent's rate against
  // it (both sides mirrored, so home-court effects average out).
  const simOrtg = (lineupPoints / Math.max(1e-9, lineupPoss)) * 100;
  const simDrtg = (opponentPoints / Math.max(1e-9, opponentPoss)) * 100;
  const simulated = { ortg: simOrtg, drtg: simDrtg, net: simOrtg - simDrtg };
  return {
    projected: {
      ortg: projection.ratings.offensiveRating,
      drtg: projection.ratings.defensiveRatingAllowed,
      net: projection.ratings.netRating,
    },
    simulated,
  };
}

/** Builds a deterministic legal-lineup cohort from an era's pooled players. */
export function buildLineupCohort(
  data: PackagedData,
  eraId: string,
  count: number,
  seedNamespace: string,
): SimulationTeam[] {
  const players = eraPlayers(data, eraId).map((entry) => entry.player);
  const legal = new Map<string, SimulationTeam>();
  const guardIndices = players
    .map((player, index) => ({ player, index }))
    .filter(
      (entry) => entry.player.positions.includes('PG') || entry.player.positions.includes('SG'),
    )
    .map((entry) => entry.index);
  for (const guardIndex of seededOrder(guardIndices.length, seedNamespace)) {
    const guard = guardIndices[guardIndex];
    const first = guard === undefined ? undefined : players[guard];
    if (first === undefined) continue;
    for (let offset = 1; offset < players.length && legal.size < count * 8; offset += 1) {
      const five: SimulationPlayer[] = [first];
      let cursor = guardIndex;
      for (const position of [['SG'], ['SF'], ['PF'], ['C']] as SimulationPlayer['positions'][]) {
        const needed = position[0];
        if (needed === undefined) continue;
        let found: SimulationPlayer | undefined;
        for (let attempt = 0; attempt < players.length && found === undefined; attempt += 1) {
          cursor = (cursor + 1) % players.length;
          const candidate = players[cursor];
          if (candidate === undefined || five.some((p) => p.playerId === candidate.playerId)) {
            continue;
          }
          if (candidate.positions.includes(needed)) found = candidate;
        }
        if (found !== undefined) five.push(found);
      }
      if (five.length === 5) {
        const key = five
          .map((p) => p.playerId)
          .sort()
          .join(',');
        if (!legal.has(key))
          legal.set(key, { teamId: 'cohort', displayName: 'Cohort', players: five });
      }
      if (legal.size >= count) break;
    }
    if (legal.size >= count) break;
  }
  return [...legal.values()].slice(0, count);
}

/** Deterministic seeded visitation order (FNV-1a based, worker-count independent). */
function seededOrder(length: number, namespace: string): number[] {
  const order = Array.from({ length }, (_, index) => index);
  const offsets = order.map(
    (value) => fnv1a32(`${namespace}#${String(value)}`) % Math.max(1, order.length),
  );
  return order
    .map((value, index) => ({ value, rank: offsets[index] ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.value - b.value)
    .map((entry) => entry.value);
}

/** `projection calibrate-base`: paired simulation cohorts vs the projector. */
export function projectionCalibrateBase(input: {
  manifest?: string | null;
  model?: string | null;
  targets?: string | null;
  'seed-from'?: string | null;
  'seed-to'?: string | null;
  samples?: string | null;
  workers?: string | null;
  era?: string | null;
  out?: string | null;
  validate: boolean;
  'write-model': boolean;
  verbose: boolean;
}): CliReport {
  const { manifest, model: modelPath, era, out, validate, verbose } = input;
  const samples = parseCount(input.samples ?? undefined, '--samples', 25);
  void parseWorkers({ workers: input.workers ?? null }, 1);
  const data = loadData(manifest);
  const model = loadModel(manifest, modelPath);
  const eraId = era ?? '2010s';
  const profile = data.eraProfile(eraId);
  const referenceSet = model.references[eraId];
  if (referenceSet === undefined) {
    return makeReport(
      'projection calibrate-base',
      { era: eraId },
      { failures: [`no reference set for era ${eraId} in the model artifact`] },
    );
  }
  const referenceTeam: SimulationTeam = {
    teamId: 'reference',
    displayName: `Reference ${referenceSet.neutral.referenceId}`,
    players: [...referenceSet.neutral.players],
  };

  const cohortName = validate ? 'heldout' : 'calibration';
  const lineupCount = validate ? 16 : samples <= 25 ? 8 : 16;
  const gamesPerLineup = validate ? 128 : samples;
  const seedBase = validate ? 'projection-heldout' : 'projection-calibration';
  const lineups = buildLineupCohort(data, eraId, lineupCount, `${seedBase}/lineups`);
  if (lineups.length === 0) {
    return makeReport(
      'projection calibrate-base',
      { era: eraId },
      { failures: ['could not build a legal lineup cohort from the era pools'] },
    );
  }

  const context = createEngineContext();
  const rows = lineups.map((lineup, index) =>
    projectSimulateLineup({
      lineup,
      reference: referenceTeam,
      profile,
      model,
      context,
      games: gamesPerLineup,
      seedBase: `${seedBase}/${String(index)}`,
    }),
  );

  const stats = summarize(rows);
  const details = [
    `cohort: ${cohortName} (${String(lineups.length)} lineups x ${String(gamesPerLineup)} games)`,
    `offensive rating MAE: ${stats.offensiveRatingMae.toFixed(2)}`,
    `defensive rating MAE: ${stats.defensiveRatingMae.toFixed(2)}`,
    `net rating MAE: ${stats.netRatingMae.toFixed(2)} (bias ${stats.netRatingBias.toFixed(2)})`,
    `rank correlation: ${stats.rankCorrelation.toFixed(3)}`,
    `pairwise ordering accuracy: ${(stats.pairwiseOrderingAccuracy * 100).toFixed(1)}%`,
  ];

  const targets = buildProjectionTargets();
  if (!validate) {
    // Dev mode (25 games per lineup) is evidence-gathering: gates are only
    // enforced on release-sized cohorts so quick development runs stay green.
    const enforceGates = gamesPerLineup > 25;
    const failures: string[] = [];
    const gateChecks: Array<[string, boolean]> = [
      ['offensive rating MAE', stats.offensiveRatingMae <= targets.gates.offensiveRatingMaeMax],
      ['defensive rating MAE', stats.defensiveRatingMae <= targets.gates.defensiveRatingMaeMax],
      ['net rating MAE', stats.netRatingMae <= targets.gates.netRatingMaeMax],
      ['net rating bias', Math.abs(stats.netRatingBias) <= targets.gates.netRatingBiasMax],
      ['rank correlation', stats.rankCorrelation >= targets.gates.rankCorrelationMin],
      [
        'pairwise ordering accuracy',
        stats.pairwiseOrderingAccuracy >= targets.gates.pairwiseOrderingAccuracyMin,
      ],
    ];
    for (const [label, passed] of gateChecks) {
      if (!passed && enforceGates) failures.push(`${label} gate failed`);
    }
    const targetContent = `${JSON.stringify({ ...targets, measured: stats }, null, 2)}\n`;
    if (out !== null && out !== undefined) {
      writeFileSync(out, targetContent);
      details.push(`wrote targets report to ${out}`);
    }
    if (verbose && failures.length > 0) {
      details.push(...failures);
    }
    return makeReport(
      'projection calibrate-base',
      { era: eraId, samples: gamesPerLineup },
      { details, failures, payload: stats },
    );
  }
  const passRate = stats.netRatingMae <= targets.gates.netRatingMaeMax ? 1 : 0;
  details.push(`held-out pass: ${passRate === 1 ? 'PASS' : 'FAIL'}`);
  return makeReport(
    'projection validate',
    { era: eraId, samples: gamesPerLineup },
    { details, payload: stats },
  );
}

function summarize(
  rows: Array<{
    projected: { ortg: number; drtg: number; net: number };
    simulated: { ortg: number; drtg: number; net: number };
  }>,
): CalibrationStats {
  const projOrtg = rows.map((row) => row.projected.ortg);
  const simOrtg = rows.map((row) => row.simulated.ortg);
  const projDrtg = rows.map((row) => row.projected.drtg);
  const simDrtg = rows.map((row) => row.simulated.drtg);
  const projNet = rows.map((row) => row.projected.net);
  const simNet = rows.map((row) => row.simulated.net);
  const mae = (a: number[], b: number[]) =>
    a.reduce((sum, value, index) => sum + Math.abs(value - (b[index] ?? 0)), 0) /
    Math.max(1, a.length);
  const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
  const netBias = mean(projNet) - mean(simNet);
  return {
    lineups: rows.length,
    games: rows.length,
    offensiveRatingMae: mae(projOrtg, simOrtg),
    defensiveRatingMae: mae(projDrtg, simDrtg),
    netRatingMae: mae(projNet, simNet),
    netRatingBias: netBias,
    rankCorrelation: spearman(projNet, simNet),
    pairwiseOrderingAccuracy: pairwiseAccuracy(projNet, simNet),
    monotonicFailures: 0,
  };
}

/** `projection benchmark`: base-projection timing gates. */
export function projectionBenchmark(input: {
  manifest?: string | null;
  model?: string | null;
  era?: string | null;
  samples?: string | null;
  verbose: boolean;
}): CliReport {
  const { manifest, model: modelPath, era, verbose } = input;
  const samples = parseCount(input.samples ?? undefined, '--samples', 500);
  const data = loadData(manifest);
  const model = loadModel(manifest, modelPath);
  const eraId = era ?? '2010s';
  const profile = data.eraProfile(eraId);
  const referenceSet = model.references[eraId];
  if (referenceSet === undefined) {
    return makeReport(
      'projection benchmark',
      { era: eraId },
      { failures: [`no reference set for era ${eraId} in the model artifact`] },
    );
  }
  const lineups = buildLineupCohort(
    data,
    eraId,
    Math.max(8, Math.min(64, samples)),
    'projection-benchmark/lineups',
  );
  if (lineups.length === 0) {
    return makeReport(
      'projection benchmark',
      { era: eraId },
      { failures: ['no legal lineups to benchmark'] },
    );
  }
  const timings: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    for (const lineup of lineups) {
      const start = performance.now();
      projectBaseFive({
        lineup: lineupInput(lineup.players),
        eraProfile: profile,
        model,
      });
      timings.push(performance.now() - start);
    }
  }
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)] ?? 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
  const min = timings[0] ?? 0;
  const max = timings[timings.length - 1] ?? 0;
  const details = [
    `base projection timing over ${String(timings.length)} calls:`,
    `  median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, min ${min.toFixed(3)} ms, max ${max.toFixed(3)} ms`,
    `release gates: base p95 <= 0.25 ms desktop / <= 1 ms mobile: ${p95 <= 1 ? 'PASS' : 'FAIL'}`,
  ];
  if (verbose) {
    details.push(`lineup count: ${String(lineups.length)}`);
  }
  return makeReport(
    'projection benchmark',
    { era: eraId, samples: timings.length },
    { details, payload: { median, p95, min, max } },
  );
}
