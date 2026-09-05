import { resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_CHALLENGE_CATALOG,
  SEASON_CHALLENGE_TARGETS_VERSION,
  SEASON_CHALLENGE_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  type SeasonChallengeId,
} from '@hoop-rush/data-contracts';
import { createEngineContext, dealSeasonBlockChallenges } from '@hoop-rush/engine';
import { reconstructSeasonGames, reduceSeasonStandings } from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonChallengesCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR } from './season-data.ts';
import {
  gateValue,
  gateSummary,
  m25RangeGate,
  m25ToleranceGate,
  seasonCalibrationSeed,
  seedIndexRange,
  share,
  type M25Gate,
} from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';

export const SEASON_CHALLENGES_CALIBRATE_OPTIONS: Record<string, boolean> = {
  input: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};
export const DEFAULT_CHALLENGE_TARGETS = resolve(DEFAULT_SEASON_DIR, 'challenge-targets.json');
export const SEASON_CHALLENGES_CALIBRATION_SEED_COUNT = 12;
export const SEASON_CHALLENGES_VALIDATION_SEED_COUNT = 4;
export const SEASON_CHALLENGES_MIN_BLOCK_SAMPLE = 20;
export const SEASON_CHALLENGES_MIN_THREE_POINT_SAMPLE = 10;
export const SEASON_CHALLENGES_THREE_PA_SUFFICIENCY_MIN = 0.5;

export const seasonChallengeTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_CHALLENGE_TARGETS_VERSION),
  policy: z.object({
    catalogVersion: z.literal(SEASON_CHALLENGE_VERSION),
    standardReward: z.literal(1),
    hardReward: z.literal(2),
    threePointPct: z.literal(0.35),
    threePointMinAttempts: z.literal(20),
    takeCareMaxPerGame: z.literal(13.0),
    winSixWins: z.literal(6),
    winSixMinGames: z.literal(8),
    statementMinGames: z.literal(4),
    threePointSufficiencyMin: z.literal(SEASON_CHALLENGES_THREE_PA_SUFFICIENCY_MIN),
  }),
  cohort: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  heldOut: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  measured: z.object({
    calibration: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      blocksDealt: z.number().int().nonnegative(),
      dealCompleteness: z.number().min(0).max(1),
      canonicalOrderShare: z.number().min(0).max(1),
      replayStabilityShare: z.number().min(0).max(1),
      hardFeasibleShare: z.number().min(0).max(1),
      dealFrequency: z.record(z.string(), z.number().min(0).max(1)),
      completionRate: z.record(z.string(), z.number().min(0).max(1).nullable()),
      expectedEarnedPerBlock: z.number().min(0).max(6).nullable(),
      threePointSufficiency: z.number().min(0).max(1).nullable(),
      threePointEvaluations: z.number().int().nonnegative(),
    }),
    heldOut: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      blocksDealt: z.number().int().nonnegative(),
      dealCompleteness: z.number().min(0).max(1),
      completionRate: z.record(z.string(), z.number().min(0).max(1).nullable()),
      expectedEarnedPerBlock: z.number().min(0).max(6).nullable(),
      threePointSufficiency: z.number().min(0).max(1).nullable(),
    }),
  }),
  gates: z.object({
    dealCompleteness: z.boolean(),
    canonicalOrder: z.boolean(),
    replayStability: z.boolean(),
    threePointSufficiency: z.boolean(),
    heldOut: z.boolean(),
  }),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonChallengeTargets = z.infer<typeof seasonChallengeTargetsSchema>;

export interface SeasonChallengeFacts {
  blocksDealt: number;
  blocksExpected: number;
  canonicalDeals: number;
  replayStable: number;
  replayChecked: number;
  hardFeasibleBlocks: number;
  dealCounts: Record<string, number>;
  completionCounts: Record<string, number>;
  completionDenominators: Record<string, number>;
  earnedApplied: number;
  threePointSufficient: number;
  threePointEvaluations: number;
}

const CHALLENGE_IDS = SEASON_CHALLENGE_CATALOG.map((entry) => entry.challengeId);

export function seasonChallengeFactsOf(season: SeasonM25SeasonFacts): SeasonChallengeFacts {
  const run = season.run;
  const challenges = (
    run as unknown as {
      challenges?: {
        deals?: Record<string, unknown>;
        evaluations?: Array<{
          blockIndex: number;
          results?: Array<{
            challengeId: string;
            success?: boolean;
            facts?: { threePointersAttempted?: number };
          }>;
        }>;
      } | null;
    }
  ).challenges;
  const deals = challenges?.deals ?? {};
  const evaluations = challenges?.evaluations ?? [];
  const dealCounts: Record<string, number> = {};
  const completionCounts: Record<string, number> = {};
  const completionDenominators: Record<string, number> = {};
  for (const id of CHALLENGE_IDS) {
    dealCounts[id] = 0;
    completionCounts[id] = 0;
    completionDenominators[id] = 0;
  }
  let canonicalDeals = 0;
  let hardFeasibleBlocks = 0;
  for (let block = 0; block <= 7; block += 1) {
    const deal = (deals as Record<string, { challengeIds?: string[] } | undefined>)[String(block)];
    if (deal?.challengeIds === undefined) continue;
    const ids = deal.challengeIds;
    for (const id of ids) dealCounts[id] = (dealCounts[id] ?? 0) + 1;
    if (JSON.stringify([...ids].sort()) === JSON.stringify(ids)) canonicalDeals += 1;
    if (
      ids.some((id) => id === 'beat-leader' || id === 'beat-higher' || id === 'statement-block')
    ) {
      hardFeasibleBlocks += 1;
    }
  }
  let threePointSufficient = 0;
  let threePointEvaluations = 0;
  for (const evaluation of evaluations) {
    for (const result of evaluation.results ?? []) {
      const id = result.challengeId;
      completionDenominators[id] = (completionDenominators[id] ?? 0) + 1;
      if (result.success === true) completionCounts[id] = (completionCounts[id] ?? 0) + 1;
      if (id === 'three-point-mark') {
        threePointEvaluations += 1;
        if ((result.facts?.threePointersAttempted ?? 0) >= 20) threePointSufficient += 1;
      }
    }
  }
  let earnedApplied = 0;
  for (const entry of run.influence.ledger) {
    if (entry.source === 'challenge-reward') earnedApplied += entry.appliedDelta;
  }
  const replay = replayStabilityOf(season);
  return {
    blocksDealt: Object.keys(deals).length,
    blocksExpected: 8,
    canonicalDeals,
    replayStable: replay.stable,
    replayChecked: replay.checked,
    hardFeasibleBlocks,
    dealCounts,
    completionCounts,
    completionDenominators,
    earnedApplied,
    threePointSufficient,
    threePointEvaluations,
  };
}

function replayStabilityOf(season: SeasonM25SeasonFacts): { stable: number; checked: number } {
  const run = season.run;
  const challenges = (
    run as unknown as {
      challenges?: { deals?: Record<string, { challengeIds: string[] }> } | null;
    }
  ).challenges;
  if (challenges == null) return { stable: 0, checked: 0 };
  const human = run.league.teams.find((team) => team.control === 'human')?.franchiseId ?? null;
  if (human === null) return { stable: 0, checked: 0 };
  const scheduleLike = {
    games: run.games.map((game) => ({
      gameId: game.gameId,
      round: game.round,
      homeFranchiseId: game.homeFranchiseId,
      awayFranchiseId: game.awayFranchiseId,
    })),
  } as never;
  let stable = 0;
  let checked = 0;
  const prior: typeof season.summaries = [];
  const byBlock = new Map<number, typeof season.summaries>();
  for (const checkpoint of season.checkpoints) {
    byBlock.set(checkpoint.blockIndex, [...checkpoint.gameSummaries]);
  }
  for (let block = 0; block <= 7; block += 1) {
    const deals = challenges.deals ?? {};
    const stored = deals[String(block)];
    if (stored === undefined) continue;
    const standings = reduceSeasonStandings(
      run.league,
      reconstructSeasonGames(scheduleLike, prior),
    );
    const redealt = dealSeasonBlockChallenges(run.rootSeed, block, {
      league: run.league,
      schedule: scheduleLike,
      standings,
      humanFranchiseId: human,
    });
    checked += 1;
    if (
      redealt !== null &&
      JSON.stringify([...redealt.challengeIds].sort()) ===
        JSON.stringify([...stored.challengeIds].sort()) &&
      JSON.stringify(redealt.targets) ===
        JSON.stringify((stored as unknown as { targets: unknown }).targets)
    ) {
      stable += 1;
    }
    prior.push(...(byBlock.get(block) ?? []));
  }
  return { stable, checked };
}

export function foldChallengeCohort(seasons: readonly SeasonM25SeasonFacts[]): {
  seasonsSimulated: number;
  blocksDealt: number;
  blocksExpected: number;
  dealCompleteness: number;
  canonicalOrderShare: number;
  replayStabilityShare: number;
  hardFeasibleShare: number;
  dealFrequency: Record<string, number>;
  completionRate: Record<string, number | null>;
  expectedEarnedPerBlock: number | null;
  threePointSufficiency: number | null;
  threePointEvaluations: number;
} {
  const facts = seasons.map(seasonChallengeFactsOf);
  const dealCounts: Record<string, number> = {};
  const completionCounts: Record<string, number> = {};
  const completionDenominators: Record<string, number> = {};
  for (const id of CHALLENGE_IDS) {
    dealCounts[id] = 0;
    completionCounts[id] = 0;
    completionDenominators[id] = 0;
  }
  let blocksDealt = 0;
  let blocksExpected = 0;
  let canonicalDeals = 0;
  let replayStable = 0;
  let replayChecked = 0;
  let hardFeasibleBlocks = 0;
  let earnedApplied = 0;
  let threePointSufficient = 0;
  let threePointEvaluations = 0;
  for (const fact of facts) {
    blocksDealt += fact.blocksDealt;
    blocksExpected += fact.blocksExpected;
    canonicalDeals += fact.canonicalDeals;
    replayStable += fact.replayStable;
    replayChecked += fact.replayChecked;
    hardFeasibleBlocks += fact.hardFeasibleBlocks;
    earnedApplied += fact.earnedApplied;
    threePointSufficient += fact.threePointSufficient;
    threePointEvaluations += fact.threePointEvaluations;
    for (const id of CHALLENGE_IDS) {
      dealCounts[id] = (dealCounts[id] ?? 0) + (fact.dealCounts[id] ?? 0);
      completionCounts[id] = (completionCounts[id] ?? 0) + (fact.completionCounts[id] ?? 0);
      completionDenominators[id] =
        (completionDenominators[id] ?? 0) + (fact.completionDenominators[id] ?? 0);
    }
  }
  const dealFrequency: Record<string, number> = {};
  for (const id of CHALLENGE_IDS) {
    dealFrequency[id] = share(dealCounts[id] ?? 0, blocksDealt);
  }
  const completionRate: Record<string, number | null> = {};
  for (const id of CHALLENGE_IDS) {
    const denominator = completionDenominators[id] ?? 0;
    completionRate[id] = denominator === 0 ? null : share(completionCounts[id] ?? 0, denominator);
  }
  return {
    seasonsSimulated: seasons.length,
    blocksDealt,
    blocksExpected,
    dealCompleteness: blocksExpected === 0 ? 0 : share(blocksDealt, blocksExpected),
    canonicalOrderShare: blocksDealt === 0 ? 0 : share(canonicalDeals, blocksDealt),
    replayStabilityShare: replayChecked === 0 ? 0 : share(replayStable, replayChecked),
    hardFeasibleShare: blocksDealt === 0 ? 0 : share(hardFeasibleBlocks, blocksDealt),
    dealFrequency,
    completionRate,
    expectedEarnedPerBlock: blocksDealt === 0 ? null : earnedApplied / Math.max(1, blocksDealt),
    threePointSufficiency:
      threePointEvaluations === 0 ? null : share(threePointSufficient, threePointEvaluations),
    threePointEvaluations,
  };
}

export function evaluateChallengeGates(args: {
  calibration: ReturnType<typeof foldChallengeCohort>;
  heldOut: ReturnType<typeof foldChallengeCohort>;
}): M25Gate[] {
  const c = args.calibration;
  const h = args.heldOut;
  return [
    m25ToleranceGate(
      'dealCompleteness',
      Math.round(c.dealCompleteness * c.blocksExpected),
      c.blocksExpected,
      c.blocksExpected,
      c.blocksDealt,
      SEASON_CHALLENGES_MIN_BLOCK_SAMPLE,
    ),
    m25ToleranceGate(
      'canonicalOrder',
      Math.round(c.canonicalOrderShare * c.blocksDealt),
      c.blocksDealt,
      c.blocksDealt,
      c.blocksDealt,
      SEASON_CHALLENGES_MIN_BLOCK_SAMPLE,
    ),
    m25ToleranceGate(
      'replayStability',
      Math.round(c.replayStabilityShare * c.blocksDealt),
      c.blocksDealt,
      c.blocksDealt,
      c.blocksDealt,
      SEASON_CHALLENGES_MIN_BLOCK_SAMPLE,
    ),
    m25RangeGate(
      'threePointSufficiency',
      c.threePointSufficiency ?? 0,
      SEASON_CHALLENGES_THREE_PA_SUFFICIENCY_MIN,
      1,
      c.threePointEvaluations,
      SEASON_CHALLENGES_MIN_THREE_POINT_SAMPLE,
    ),
    m25ToleranceGate(
      'heldOut.dealCompleteness',
      Math.round(h.dealCompleteness * h.blocksExpected),
      h.blocksExpected,
      h.blocksExpected,
      h.blocksDealt,
      SEASON_CHALLENGES_MIN_BLOCK_SAMPLE,
    ),
  ];
}

export interface SeasonChallengesArgs {
  input: string | null;
  'seed-from': string | null;
  'seed-to': string | null;
  workers: string | null;
  out: string | null;
  manifest: string | null;
  validate: string | null;
  format?: string | null;
}

export function validateSeasonChallengeTargets(
  args: SeasonChallengesArgs,
  outPath: string,
): CliReport {
  void args;
  return validateTargetsArtifact({
    outPath,
    schema: seasonChallengeTargetsSchema,
    command: 'season challenges calibrate --validate',
    extraChecks: () => ({
      details: ['catalog holds the frozen 8 challenges with +1/+2 pricing'],
      failures: [],
    }),
  });
}

export function seasonChallengesCalibrate(args: SeasonChallengesArgs): CliReport {
  const started = Date.now();
  const { from, to } = parseSeedRange(args, SEASON_CHALLENGES_CALIBRATION_SEED_COUNT - 1);
  const outPath = args.out ?? DEFAULT_CHALLENGE_TARGETS;
  const validateOnly = args['validate'] !== null;
  if (validateOnly) {
    return validateSeasonChallengeTargets(args, resolve(args.validate ?? outPath));
  }
  const workers = parseWorkers(args, 1);
  const calibrationIndices = seedIndexRange(from, to);
  const validationIndices = seedIndexRange(to + 1, to + SEASON_CHALLENGES_VALIDATION_SEED_COUNT);
  let calibration: SeasonM25SeasonFacts[];
  let heldOut: SeasonM25SeasonFacts[];
  try {
    calibration = calibrationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: true,
      }),
    );
    heldOut = validationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: true,
      }),
    );
  } catch (error) {
    return makeReport(
      'season challenges calibrate',
      { seedFrom: from, seedTo: to, workers },
      { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }
  const calibrationCohort = foldChallengeCohort(calibration);
  const heldOutCohort = foldChallengeCohort(heldOut);
  const metrics = evaluateChallengeGates({
    calibration: calibrationCohort,
    heldOut: heldOutCohort,
  });
  const { skippedGates, pass } = gateSummary(metrics);
  const gates = {
    dealCompleteness: gateValue(metrics, 'dealCompleteness'),
    canonicalOrder: gateValue(metrics, 'canonicalOrder'),
    replayStability: gateValue(metrics, 'replayStability'),
    threePointSufficiency: gateValue(metrics, 'threePointSufficiency'),
    heldOut: gateValue(metrics, 'heldOut.dealCompleteness'),
  };
  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  if (pass) {
    const targets: SeasonChallengeTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_CHALLENGE_TARGETS_VERSION,
      policy: {
        catalogVersion: SEASON_CHALLENGE_VERSION,
        standardReward: 1,
        hardReward: 2,
        threePointPct: 0.35,
        threePointMinAttempts: 20,
        takeCareMaxPerGame: 13.0,
        winSixWins: 6,
        winSixMinGames: 8,
        statementMinGames: 4,
        threePointSufficiencyMin: SEASON_CHALLENGES_THREE_PA_SUFFICIENCY_MIN,
      },
      cohort: { seedFrom: from, seedTo: to },
      heldOut: { seedFrom: to + 1, seedTo: to + SEASON_CHALLENGES_VALIDATION_SEED_COUNT },
      measured: {
        calibration: {
          seasonsSimulated: calibrationCohort.seasonsSimulated,
          blocksDealt: calibrationCohort.blocksDealt,
          dealCompleteness: calibrationCohort.dealCompleteness,
          canonicalOrderShare: calibrationCohort.canonicalOrderShare,
          replayStabilityShare: calibrationCohort.replayStabilityShare,
          hardFeasibleShare: calibrationCohort.hardFeasibleShare,
          dealFrequency: calibrationCohort.dealFrequency,
          completionRate: calibrationCohort.completionRate,
          expectedEarnedPerBlock: calibrationCohort.expectedEarnedPerBlock,
          threePointSufficiency: calibrationCohort.threePointSufficiency,
          threePointEvaluations: calibrationCohort.threePointEvaluations,
        },
        heldOut: {
          seasonsSimulated: heldOutCohort.seasonsSimulated,
          blocksDealt: heldOutCohort.blocksDealt,
          dealCompleteness: heldOutCohort.dealCompleteness,
          completionRate: heldOutCohort.completionRate,
          expectedEarnedPerBlock: heldOutCohort.expectedEarnedPerBlock,
          threePointSufficiency: heldOutCohort.threePointSufficiency,
        },
      },
      gates,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonChallengeTargetsSchema.parse(targets);
    const commit = commitTargetsArtifact({
      outPath,
      defaultTargetsPath: DEFAULT_CHALLENGE_TARGETS,
      manifestPath: args.manifest ?? DEFAULT_MANIFEST,
      manifestKey: 'challengeTargets',
      manifestUrl: 'season/challenge-targets.json',
      content: targets,
    });
    targetsWritten = commit.written;
    targetsPath = commit.path;
    if (commit.error !== null) gateFailures.push(commit.error);
  }
  const payload = seasonChallengesCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season challenges calibrate',
    targetsVersion: SEASON_CHALLENGE_TARGETS_VERSION,
    calibrationSeeds: calibrationIndices.length,
    validationSeeds: validationIndices.length,
    seasonsSimulated: calibrationCohort.seasonsSimulated + heldOutCohort.seasonsSimulated,
    blocksDealt: calibrationCohort.blocksDealt,
    dealCompleteness: calibrationCohort.dealCompleteness,
    canonicalOrderShare: calibrationCohort.canonicalOrderShare,
    replayStabilityShare: calibrationCohort.replayStabilityShare,
    hardFeasibleShare: calibrationCohort.hardFeasibleShare,
    dealFrequency: calibrationCohort.dealFrequency,
    completionRate: calibrationCohort.completionRate,
    expectedEarnedPerBlock: calibrationCohort.expectedEarnedPerBlock,
    threePointSufficiency: calibrationCohort.threePointSufficiency,
    threePointEvaluations: calibrationCohort.threePointEvaluations,
    gates: {
      dealCompleteness: gates.dealCompleteness,
      canonicalOrder: gates.canonicalOrder,
      replayStability: gates.replayStability,
      threePointSufficiency: gates.threePointSufficiency,
      heldOut: gates.heldOut,
    },
    metrics,
    skippedGates,
    targetsWritten,
    targetsPath,
    durationMs: Date.now() - started,
  });
  const details = [
    `${String(calibrationCohort.seasonsSimulated)} calibration + ${String(heldOutCohort.seasonsSimulated)} held-out seasons in ${String(Date.now() - started)}ms (${String(workers)} workers)`,
    `blocks dealt ${String(calibrationCohort.blocksDealt)}/${String(calibrationCohort.blocksDealt + heldOutCohort.blocksDealt)} · completeness ${(calibrationCohort.dealCompleteness * 100).toFixed(1)}% · canonical ${(calibrationCohort.canonicalOrderShare * 100).toFixed(1)}% · replay ${(calibrationCohort.replayStabilityShare * 100).toFixed(1)}%`,
    `hard-feasible ${(calibrationCohort.hardFeasibleShare * 100).toFixed(1)}% · earned/block ${calibrationCohort.expectedEarnedPerBlock === null ? 'n/a' : calibrationCohort.expectedEarnedPerBlock.toFixed(2)} · 3PA sufficient ${calibrationCohort.threePointSufficiency === null ? 'n/a' : `${(calibrationCohort.threePointSufficiency * 100).toFixed(1)}%`} over ${String(calibrationCohort.threePointEvaluations)} 3P evaluations`,
    `targets ${targetsWritten ? `written to ${targetsPath ?? '?'}` : 'NOT written'}`,
  ];
  if (skippedGates.length > 0) {
    gateFailures.push(`gates skipped (insufficient sample): ${skippedGates.join(', ')}`);
  }
  if (!pass) {
    for (const metric of metrics) {
      if (!metric.pass) {
        gateFailures.push(
          `gate ${metric.key}: observed ${String(metric.observed)} (${metric.status})`,
        );
      }
    }
  }
  if (pass && !targetsWritten) gateFailures.push('targets artifact was not written');
  return makeReport(
    'season challenges calibrate',
    { seedFrom: from, seedTo: to, workers },
    { details, failures: gateFailures, payload },
  );
}

export type { SeasonChallengeId };
