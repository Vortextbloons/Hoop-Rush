import { z } from 'zod';
import {
  POSITIONS,
  havocMutationIdSchema,
  seedFromString,
  seedSchema,
  type HavocCatalog,
  type HavocCatalogSource,
  type HavocLockedInputs,
  type HavocMutationId,
  type HavocTeamInput,
  type HavocVersionSet,
  type EraSimulationProfile,
  type OpponentBracket,
  type Position,
  type SeasonDraftCatalog,
  type Seed,
} from '@hoop-rush/data-contracts';
import {
  createHavocCommandEnvironment,
  type HavocCommandEnvironment,
  type HavocLockSources,
} from '@hoop-rush/engine';
import { parseCount, UsageError } from '../args.ts';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';
import { mean, median, percentile } from '../stats.ts';
import {
  HAVOC_CLI_CALIBRATION_BASE,
  HAVOC_CLI_DEFAULT_FULL_SHOT_CLOCK_SECONDS,
  HavocCliError,
  adaptHavocCliCatalog,
  buildConstructedHavocLockedInputs,
  havocCliFailureSchema,
  havocCliGameNumbers,
  havocCliRunIdOf,
  loadHavocCliAssets,
  replayHavocCliDraft,
  simulateHavocCliVariant,
  type HavocCliAssets,
  type HavocCliConstructedSlot,
  type HavocCliFailure,
  type HavocCliGameFacts,
  type HavocCliVariantRun,
} from '../havoc-cli-support.ts';

export type HavocCliLineupKind =
  'ordinary' | 'risky' | 'extreme' | 'mechanism-on' | 'mechanism-off';

export const HAVOC_CLI_COHORT_LINEUPS = ['ordinary', 'risky', 'extreme'] as const;
export type HavocCliCohortLineup = (typeof HAVOC_CLI_COHORT_LINEUPS)[number];

export const havocCliDistributionSchema = z.object({
  count: z.number().int().nonnegative(),
  min: z.number(),
  p10: z.number(),
  median: z.number(),
  p90: z.number(),
  max: z.number(),
  mean: z.number(),
});
export type HavocCliDistribution = z.infer<typeof havocCliDistributionSchema>;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function distributionOf(values: readonly number[]): HavocCliDistribution {
  if (values.length === 0) {
    return { count: 0, min: 0, p10: 0, median: 0, p90: 0, max: 0, mean: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    min: round4(sorted[0] ?? 0),
    p10: round4(percentile(sorted, 0.1)),
    median: round4(median(sorted)),
    p90: round4(percentile(sorted, 0.9)),
    max: round4(sorted[sorted.length - 1] ?? 0),
    mean: round4(mean(values)),
  };
}

function ratioOf(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function ratioValues(
  facts: readonly HavocCliGameFacts[],
  numeratorOf: (fact: HavocCliGameFacts) => number,
  denominatorOf: (fact: HavocCliGameFacts) => number,
): number[] {
  const values: number[] = [];
  for (const fact of facts) {
    const ratio = ratioOf(numeratorOf(fact), denominatorOf(fact));
    if (ratio !== null) values.push(ratio);
  }
  return values;
}

export const havocCliCloneStatsSchema = z.object({
  gamesWithClone: z.number().int().nonnegative(),
  seconds: havocCliDistributionSchema,
  points: havocCliDistributionSchema,
  rebounds: havocCliDistributionSchema,
  assists: havocCliDistributionSchema,
});

export const havocCliMutationAggregateSchema = z.object({
  mutationId: havocMutationIdSchema,
  triggers: z.number().int().nonnegative(),
  pointsDelta: z.number().int(),
  freeThrowsGranted: z.number().int().nonnegative(),
  turnoversCancelled: z.number().int().nonnegative(),
  extraPossessionsEarned: z.number().int().nonnegative(),
  extraPossessionsUsed: z.number().int().nonnegative(),
  extraPossessionsExpired: z.number().int().nonnegative(),
});
export type HavocCliMutationAggregate = z.infer<typeof havocCliMutationAggregateSchema>;

export const havocCliLineupStatsSchema = z.object({
  lineup: z.enum(HAVOC_CLI_COHORT_LINEUPS),
  seeds: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  winRate: z.number(),
  score: havocCliDistributionSchema,
  opponentScore: havocCliDistributionSchema,
  margin: havocCliDistributionSchema,
  humanTurnovers: havocCliDistributionSchema,
  opponentTurnovers: havocCliDistributionSchema,
  humanRebounds: havocCliDistributionSchema,
  opponentRebounds: havocCliDistributionSchema,
  humanFouls: havocCliDistributionSchema,
  opponentFouls: havocCliDistributionSchema,
  humanAssists: havocCliDistributionSchema,
  humanFieldGoalPct: havocCliDistributionSchema,
  humanThreePointAttemptRate: havocCliDistributionSchema,
  humanShotClockViolations: havocCliDistributionSchema,
  opponentShotClockViolations: havocCliDistributionSchema,
  adjustments: havocCliDistributionSchema,
  overtimeGames: z.number().int().nonnegative(),
  clones: havocCliCloneStatsSchema,
  mutations: z.array(havocCliMutationAggregateSchema),
  auditFailures: z.number().int().nonnegative(),
  typedFailures: z.number().int().nonnegative(),
});
export type HavocCliLineupStats = z.infer<typeof havocCliLineupStatsSchema>;

function mutationAggregatesOf(facts: readonly HavocCliGameFacts[]): HavocCliMutationAggregate[] {
  const byMutation = new Map<string, HavocCliMutationAggregate>();
  for (const fact of facts) {
    for (const rollup of fact.rollups) {
      const existing = byMutation.get(rollup.mutationId) ?? {
        mutationId: rollup.mutationId,
        triggers: 0,
        pointsDelta: 0,
        freeThrowsGranted: 0,
        turnoversCancelled: 0,
        extraPossessionsEarned: 0,
        extraPossessionsUsed: 0,
        extraPossessionsExpired: 0,
      };
      existing.triggers += rollup.triggers;
      existing.pointsDelta += rollup.pointsDelta;
      existing.freeThrowsGranted += rollup.freeThrowsGranted;
      existing.turnoversCancelled += rollup.turnoversCancelled;
      existing.extraPossessionsEarned += rollup.extraPossessionsEarned;
      existing.extraPossessionsUsed += rollup.extraPossessionsUsed;
      existing.extraPossessionsExpired += rollup.extraPossessionsExpired;
      byMutation.set(rollup.mutationId, existing);
    }
  }
  return [...byMutation.values()].sort((left, right) =>
    left.mutationId < right.mutationId ? -1 : left.mutationId > right.mutationId ? 1 : 0,
  );
}

export function havocLineupStatsOf(
  runs: readonly HavocCohortRun[],
  lineup: HavocCliCohortLineup,
): HavocCliLineupStats {
  const selected = runs.filter((run) => run.lineup === lineup);
  const facts = selected.flatMap((run) => run.facts);
  const wins = facts.filter((fact) => fact.outcome === 'win').length;
  const losses = facts.length - wins;
  const cloneFacts = facts.filter((fact) => fact.cloneSeconds > 0);
  let auditFailures = 0;
  let typedFailures = 0;
  for (const run of selected) {
    auditFailures += run.auditFindings;
    typedFailures += run.failures.length;
  }
  return havocCliLineupStatsSchema.parse({
    lineup,
    seeds: selected.length,
    games: facts.length,
    wins,
    losses,
    winRate: facts.length === 0 ? 0 : round4(wins / facts.length),
    score: distributionOf(facts.map((fact) => fact.humanScore)),
    opponentScore: distributionOf(facts.map((fact) => fact.opponentScore)),
    margin: distributionOf(facts.map((fact) => fact.margin)),
    humanTurnovers: distributionOf(facts.map((fact) => fact.humanTurnovers)),
    opponentTurnovers: distributionOf(facts.map((fact) => fact.opponentTurnovers)),
    humanRebounds: distributionOf(facts.map((fact) => fact.humanRebounds)),
    opponentRebounds: distributionOf(facts.map((fact) => fact.opponentRebounds)),
    humanFouls: distributionOf(facts.map((fact) => fact.humanFouls)),
    opponentFouls: distributionOf(facts.map((fact) => fact.opponentFouls)),
    humanAssists: distributionOf(facts.map((fact) => fact.humanAssists)),
    humanFieldGoalPct: distributionOf(
      ratioValues(
        facts,
        (fact) => fact.humanFieldGoalsMade,
        (fact) => fact.humanFieldGoalsAttempted,
      ),
    ),
    humanThreePointAttemptRate: distributionOf(
      ratioValues(
        facts,
        (fact) => fact.humanThreesAttempted,
        (fact) => fact.humanFieldGoalsAttempted,
      ),
    ),
    humanShotClockViolations: distributionOf(facts.map((fact) => fact.humanShotClockViolations)),
    opponentShotClockViolations: distributionOf(
      facts.map((fact) => fact.opponentShotClockViolations),
    ),
    adjustments: distributionOf(facts.map((fact) => fact.humanAdjustments)),
    overtimeGames: facts.filter((fact) => fact.overtimePeriods > 0).length,
    clones: {
      gamesWithClone: cloneFacts.length,
      seconds: distributionOf(facts.map((fact) => fact.cloneSeconds)),
      points: distributionOf(facts.map((fact) => fact.clonePoints)),
      rebounds: distributionOf(facts.map((fact) => fact.cloneRebounds)),
      assists: distributionOf(facts.map((fact) => fact.cloneAssists)),
    },
    mutations: mutationAggregatesOf(facts),
    auditFailures,
    typedFailures,
  });
}

export interface HavocCohortSource {
  readonly catalog: SeasonDraftCatalog;
  readonly source: HavocCatalogSource;
  readonly bracket: OpponentBracket;
  readonly profile: EraSimulationProfile;
  readonly versionSet: HavocVersionSet;
}

export interface HavocCohortRun {
  readonly seed: Seed;
  readonly lineup: HavocCliLineupKind;
  readonly variant: 'havoc' | 'normal';
  readonly human: HavocTeamInput;
  readonly games: HavocCliVariantRun['games'];
  readonly aggregate: HavocCliVariantRun['aggregate'];
  readonly facts: readonly HavocCliGameFacts[];
  readonly failures: readonly HavocCliFailure[];
  readonly auditFindings: number;
}

export interface HavocCohortContext {
  readonly source: HavocCohortSource;
  readonly catalog: HavocCatalog;
  readonly environment: HavocCommandEnvironment;
  readonly lockSources: HavocLockSources;
}

export function createHavocCohortContext(source: HavocCohortSource): HavocCohortContext {
  const catalog = adaptHavocCliCatalog(source);
  return {
    source,
    catalog,
    environment: createHavocCommandEnvironment(catalog),
    lockSources: { bracket: source.bracket, profile: source.profile },
  };
}

const HAVOC_CLI_EXTREME_LINEUPS: Record<'risky' | 'extreme', readonly HavocCliConstructedSlot[]> = {
  risky: [
    { slot: 'PG', tier: 2, mutationIds: ['basketball-roulette', 'trigger-happy'] },
    { slot: 'SG', tier: 2, mutationIds: ['four-point-dunk', 'butterfingers'] },
    { slot: 'SF', tier: 3, mutationIds: ['double-or-nothing'] },
    { slot: 'PF', tier: 1, mutationIds: ['the-statue', 'walking-bucket', 'brick-wall'] },
    { slot: 'C', tier: 3, mutationIds: ['body-snatcher'] },
  ],
  extreme: [
    { slot: 'PG', tier: 3, mutationIds: ['clone-army'] },
    { slot: 'SG', tier: 3, mutationIds: ['time-lord'] },
    { slot: 'SF', tier: 3, mutationIds: ['reverse-basketball'] },
    { slot: 'PF', tier: 3, mutationIds: ['double-or-nothing'] },
    { slot: 'C', tier: 1, mutationIds: ['alien-arms', 'growth-spurt', 'super-soldier'] },
  ],
};

export function runHavocCohortLineup(
  context: HavocCohortContext,
  options: {
    readonly seed: Seed;
    readonly lineup: HavocCliLineupKind;
    readonly variant: 'havoc' | 'normal';
    readonly games: number;
    readonly slots?: readonly HavocCliConstructedSlot[];
  },
): HavocCohortRun {
  const { seed, lineup, variant, games } = options;
  const runId = havocCliRunIdOf(seed);
  let locked: HavocLockedInputs;
  if (lineup === 'ordinary') {
    const replay = replayHavocCliDraft({
      runId,
      runSeed: seed,
      versionSet: context.source.versionSet,
      catalog: context.catalog,
      environment: context.environment,
      lockSources: context.lockSources,
      plan: { pins: null, rerollRound: null },
    });
    locked = replay.locked;
  } else {
    const slots =
      lineup === 'risky' || lineup === 'extreme'
        ? HAVOC_CLI_EXTREME_LINEUPS[lineup]
        : options.slots;
    if (slots === undefined) {
      throw new HavocCliError('lineup', `no constructed lineup is defined for ${lineup}`);
    }
    locked = buildConstructedHavocLockedInputs({
      catalog: context.catalog,
      runId,
      runSeed: seed,
      versionSet: context.source.versionSet,
      bracket: context.source.bracket,
      profile: context.source.profile,
      slots,
      label: lineup,
    });
  }
  const run = simulateHavocCliVariant({
    locked,
    variant,
    gameNumbers: havocCliGameNumbers(games),
  });
  return {
    seed,
    lineup,
    variant,
    human: locked.human,
    games: run.games,
    aggregate: run.aggregate,
    facts: run.facts,
    failures: run.failures,
    auditFindings: run.auditFindings,
  };
}

export function havocCalibrationSeed(cohort: string, index: number): Seed {
  return seedSchema.parse(
    seedFromString(`${HAVOC_CLI_CALIBRATION_BASE}/${cohort}/${String(index)}`),
  );
}

export interface HavocCohortResult {
  readonly train: readonly HavocCohortRun[];
  readonly holdout: readonly HavocCohortRun[];
  readonly normal: readonly HavocCohortRun[];
  readonly trainSeeds: readonly Seed[];
  readonly holdoutSeeds: readonly Seed[];
}

export function runHavocCalibrationCohorts(options: {
  readonly source: HavocCohortSource;
  readonly seedCount: number;
  readonly holdoutCount: number;
  readonly games: number;
}): HavocCohortResult {
  const context = createHavocCohortContext(options.source);
  const trainSeeds = Array.from({ length: options.seedCount }, (_value, index) =>
    havocCalibrationSeed('train', index),
  );
  const holdoutSeeds = Array.from({ length: options.holdoutCount }, (_value, index) =>
    havocCalibrationSeed('holdout', index),
  );
  const train: HavocCohortRun[] = [];
  const holdout: HavocCohortRun[] = [];
  const normal: HavocCohortRun[] = [];
  for (const seed of trainSeeds) {
    for (const lineup of HAVOC_CLI_COHORT_LINEUPS) {
      train.push(
        runHavocCohortLineup(context, { seed, lineup, variant: 'havoc', games: options.games }),
      );
    }
    normal.push(
      runHavocCohortLineup(context, {
        seed,
        lineup: 'ordinary',
        variant: 'normal',
        games: options.games,
      }),
    );
  }
  for (const seed of holdoutSeeds) {
    for (const lineup of HAVOC_CLI_COHORT_LINEUPS) {
      holdout.push(
        runHavocCohortLineup(context, { seed, lineup, variant: 'havoc', games: options.games }),
      );
    }
    normal.push(
      runHavocCohortLineup(context, {
        seed,
        lineup: 'ordinary',
        variant: 'normal',
        games: options.games,
      }),
    );
  }
  return { train, holdout, normal, trainSeeds, holdoutSeeds };
}

export const havocCliCohortTotalsSchema = z.object({
  seeds: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  winRate: z.number(),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
  differential: z.number().int(),
  averagePointsFor: z.number(),
  averagePointsAgainst: z.number(),
  adjustments: z.number().int(),
});
export type HavocCliCohortTotals = z.infer<typeof havocCliCohortTotalsSchema>;

function cohortTotalsOf(runs: readonly HavocCohortRun[]): HavocCliCohortTotals {
  let wins = 0;
  let losses = 0;
  let pointsFor = 0;
  let pointsAgainst = 0;
  let adjustments = 0;
  let games = 0;
  for (const run of runs) {
    for (const game of run.games) {
      games += 1;
      if (game.summary.outcome === 'win') wins += 1;
      else losses += 1;
      pointsFor += game.summary.humanScore;
      pointsAgainst += game.summary.opponentScore;
      adjustments += game.summary.adjustments;
    }
  }
  return havocCliCohortTotalsSchema.parse({
    seeds: runs.length,
    games,
    wins,
    losses,
    winRate: games === 0 ? 0 : round4(wins / games),
    pointsFor,
    pointsAgainst,
    differential: pointsFor - pointsAgainst,
    averagePointsFor: games === 0 ? 0 : pointsFor / games,
    averagePointsAgainst: games === 0 ? 0 : pointsAgainst / games,
    adjustments,
  });
}

export function pairedTotalsOf(
  havocRuns: readonly HavocCohortRun[],
  normalRuns: readonly HavocCohortRun[],
): {
  havoc: HavocCliCohortTotals;
  normal: HavocCliCohortTotals;
  winsGained: number;
  differentialDelta: number;
} {
  const havoc = cohortTotalsOf(havocRuns);
  const normal = cohortTotalsOf(normalRuns);
  return {
    havoc,
    normal,
    winsGained: havoc.wins - normal.wins,
    differentialDelta: havoc.differential - normal.differential,
  };
}

export type HavocCliMechanismMetricId =
  | 'reboundShare'
  | 'threePointAttemptRate'
  | 'assistRate'
  | 'opponentFieldGoalPct'
  | 'humanTurnoverRate'
  | 'cloneSeconds'
  | 'humanFullShotClock'
  | 'opponentFullShotClock'
  | 'humanShotClockViolations'
  | 'opponentShotClockViolations';

export interface HavocCliMechanismSlotSpec {
  readonly slot: Position;
  readonly tier: 1 | 2 | 3;
  readonly mutationIds: readonly HavocMutationId[];
}

export interface HavocCliMechanismDefinition {
  readonly id: string;
  readonly label: string;
  readonly channel: string;
  readonly description: string;
  readonly on: readonly HavocCliMechanismSlotSpec[];
  readonly metricId: HavocCliMechanismMetricId;
  readonly direction: 'increase' | 'decrease';
  readonly minDelta: number;
  readonly structural: (
    onRuns: readonly HavocCohortRun[],
    offRuns: readonly HavocCohortRun[],
  ) => string[];
}

function starterAt(run: HavocCohortRun, slot: Position) {
  return run.human.starters.find((starter) => starter.slot === slot);
}

function structuralStarterFinding(
  onRuns: readonly HavocCohortRun[],
  slot: Position,
  check: (starter: NonNullable<ReturnType<typeof starterAt>>) => boolean,
  description: string,
): string[] {
  const findings: string[] = [];
  for (const run of onRuns) {
    const starter = starterAt(run, slot);
    if (starter === undefined) {
      findings.push(`structural: ${run.lineup} seed ${run.seed} has no ${slot} starter`);
      continue;
    }
    if (!check(starter)) {
      findings.push(
        `structural: ${run.lineup} seed ${run.seed} ${slot} effective profile does not show ${description}`,
      );
    }
  }
  return findings;
}

function everyFact(
  runs: readonly HavocCohortRun[],
  check: (fact: HavocCliGameFacts) => boolean,
  description: string,
): string[] {
  const findings: string[] = [];
  for (const run of runs) {
    for (const fact of run.facts) {
      if (!check(fact)) {
        findings.push(
          `structural: ${run.lineup} seed ${run.seed} game ${String(fact.gameNumber)} does not show ${description}`,
        );
      }
    }
  }
  return findings;
}

export const HAVOC_CLI_MECHANISMS: readonly HavocCliMechanismDefinition[] = [
  {
    id: 'physical-size',
    label: 'Physical size and reach',
    channel: 'rim contests and opponent shooting',
    description: 'Alien Arms + Growth Spurt + Super Soldier on the center.',
    on: [{ slot: 'C', tier: 1, mutationIds: ['alien-arms', 'growth-spurt', 'super-soldier'] }],
    metricId: 'opponentFieldGoalPct',
    direction: 'decrease',
    minDelta: 0.005,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'C',
        (starter) =>
          starter.effective.physical.reachUnits > 0 ||
          starter.effective.physical.heightInches > starter.effective.physical.baselineHeightInches,
        'a height or reach increase',
      ),
  },
  {
    id: 'shooting-floor',
    label: 'Shooting floor',
    channel: 'three-point volume',
    description: 'Sniper Gene + Walking Bucket + Super Soldier on the shooting guard.',
    on: [{ slot: 'SG', tier: 1, mutationIds: ['sniper-gene', 'walking-bucket', 'super-soldier'] }],
    metricId: 'threePointAttemptRate',
    direction: 'increase',
    minDelta: 0.02,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'SG',
        (starter) =>
          starter.effective.ratings.threePoint >= 97 &&
          starter.effective.tendencies.threePointRate >= 80,
        'the sniper three-point floor',
      ),
  },
  {
    id: 'passing-floor',
    label: 'Passing floor',
    channel: 'assist creation',
    description: 'Point God + Sniper Gene + Super Soldier on the point guard.',
    on: [{ slot: 'PG', tier: 1, mutationIds: ['point-god', 'sniper-gene', 'super-soldier'] }],
    metricId: 'assistRate',
    direction: 'increase',
    minDelta: 0.02,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'PG',
        (starter) =>
          starter.effective.ratings.passing >= 99 && starter.effective.tendencies.passRate >= 85,
        'the point-god passing floor',
      ),
  },
  {
    id: 'defense-floor',
    label: 'Defense floor',
    channel: 'opponent shooting and blocks',
    description: 'Brick Wall + Super Soldier + Glass Eater on the center.',
    on: [{ slot: 'C', tier: 1, mutationIds: ['brick-wall', 'super-soldier', 'glass-eater'] }],
    metricId: 'opponentFieldGoalPct',
    direction: 'decrease',
    minDelta: 0.005,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'C',
        (starter) =>
          starter.effective.ratings.interiorDefense >= 99 &&
          starter.effective.tendencies.blockAttemptRate >= 20,
        'the brick-wall defense floor',
      ),
  },
  {
    id: 'rebounding-floor',
    label: 'Rebounding floor',
    channel: 'rebound share',
    description: 'Glass Eater + Brick Wall + Super Soldier on the power forward.',
    on: [{ slot: 'PF', tier: 1, mutationIds: ['glass-eater', 'brick-wall', 'super-soldier'] }],
    metricId: 'reboundShare',
    direction: 'increase',
    minDelta: 0.01,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'PF',
        (starter) =>
          starter.effective.ratings.offensiveRebound >= 99 &&
          starter.effective.tendencies.crashOffensiveGlassRate >= 80,
        'the glass-eater rebounding floor',
      ),
  },
  {
    id: 'risky-caps',
    label: 'Risky caps',
    channel: 'assist creation under caps',
    description: 'Trigger Happy + The Statue + Reverse Evolution on the point guard.',
    on: [
      { slot: 'PG', tier: 1, mutationIds: ['trigger-happy', 'the-statue', 'reverse-evolution'] },
    ],
    metricId: 'assistRate',
    direction: 'decrease',
    minDelta: 0.01,
    structural: (onRuns) =>
      structuralStarterFinding(
        onRuns,
        'PG',
        (starter) =>
          starter.effective.tendencies.passRate <= 2 && starter.effective.ratings.speed <= 15,
        'the pass-rate and speed caps',
      ),
  },
  {
    id: 'clone-on',
    label: 'Clone Army on/off',
    channel: 'extra active participant and court time',
    description: 'Clone Army on the point guard versus no mutations.',
    on: [{ slot: 'PG', tier: 3, mutationIds: ['clone-army'] }],
    metricId: 'cloneSeconds',
    direction: 'increase',
    minDelta: 0.5,
    structural: (onRuns, offRuns) => {
      const findings: string[] = [];
      for (const run of onRuns) {
        if (run.human.clones.length < 1) {
          findings.push(`structural: ${run.lineup} seed ${run.seed} fields no clone participant`);
        }
      }
      for (const run of offRuns) {
        if (run.human.clones.length !== 0) {
          findings.push(`structural: control seed ${run.seed} unexpectedly fields a clone`);
        }
      }
      findings.push(
        ...everyFact(onRuns, (fact) => fact.cloneSeconds > 0, 'recorded clone court time'),
      );
      return findings;
    },
  },
  {
    id: 'rule-change',
    label: 'Time Lord rule change',
    channel: 'shot clock limits',
    description: 'Time Lord on the center versus no mutations.',
    on: [{ slot: 'C', tier: 3, mutationIds: ['time-lord'] }],
    metricId: 'humanFullShotClock',
    direction: 'increase',
    minDelta: 1,
    structural: (onRuns, offRuns) => [
      ...everyFact(
        onRuns,
        (fact) => fact.humanFullShotClock === 30 && fact.opponentFullShotClock === 12,
        'the 30/12 time-lord shot clocks',
      ),
      ...everyFact(
        offRuns,
        (fact) => fact.humanFullShotClock === null,
        'the default 24-second shot clock',
      ),
    ],
  },
];

export function havocMechanismById(id: string): HavocCliMechanismDefinition {
  const definition = HAVOC_CLI_MECHANISMS.find((candidate) => candidate.id === id);
  if (definition === undefined) {
    throw new UsageError(
      `unknown --mechanism "${id}"; known mechanisms: ${HAVOC_CLI_MECHANISMS.map((candidate) => candidate.id).join(', ')}`,
    );
  }
  return definition;
}

function mechanismSlots(specs: readonly HavocCliMechanismSlotSpec[]): HavocCliConstructedSlot[] {
  return POSITIONS.map((slot) => {
    const spec = specs.find((candidate) => candidate.slot === slot);
    return {
      slot,
      tier: spec?.tier ?? 1,
      mutationIds: spec?.mutationIds ?? [],
    };
  });
}

function mechanismMetricValue(
  metricId: HavocCliMechanismMetricId,
  fact: HavocCliGameFacts,
): number {
  switch (metricId) {
    case 'reboundShare':
      return fact.humanRebounds / Math.max(1, fact.humanRebounds + fact.opponentRebounds);
    case 'threePointAttemptRate':
      return fact.humanThreesAttempted / Math.max(1, fact.humanFieldGoalsAttempted);
    case 'assistRate':
      return fact.humanAssists / Math.max(1, fact.humanFieldGoalsMade);
    case 'opponentFieldGoalPct':
      return fact.opponentFieldGoalsMade / Math.max(1, fact.opponentFieldGoalsAttempted);
    case 'humanTurnoverRate':
      return fact.humanTurnovers / Math.max(1, fact.humanFieldGoalsAttempted);
    case 'cloneSeconds':
      return fact.cloneSeconds;
    case 'humanFullShotClock':
      return fact.humanFullShotClock ?? HAVOC_CLI_DEFAULT_FULL_SHOT_CLOCK_SECONDS;
    case 'opponentFullShotClock':
      return fact.opponentFullShotClock ?? HAVOC_CLI_DEFAULT_FULL_SHOT_CLOCK_SECONDS;
    case 'humanShotClockViolations':
      return fact.humanShotClockViolations;
    case 'opponentShotClockViolations':
      return fact.opponentShotClockViolations;
  }
}

export const havocCliMechanismSideSchema = z.object({
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  metrics: z.record(z.string(), z.number()),
  score: havocCliDistributionSchema,
  opponentScore: havocCliDistributionSchema,
  auditFailures: z.number().int().nonnegative(),
  typedFailures: z.number().int().nonnegative(),
});

export const havocCliMechanismReportSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  channel: z.string().min(1).max(128),
  description: z.string().min(1).max(256),
  metricId: z.string().min(1).max(64),
  direction: z.enum(['increase', 'decrease']),
  minDelta: z.number(),
  seeds: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  on: havocCliMechanismSideSchema,
  off: havocCliMechanismSideSchema,
  onMean: z.number(),
  offMean: z.number(),
  delta: z.number(),
  responded: z.boolean(),
  structuralFindings: z.array(z.string().min(1).max(512)).max(200),
  pass: z.boolean(),
});
export type HavocCliMechanismReport = z.infer<typeof havocCliMechanismReportSchema>;

export interface HavocCliMechanismResult {
  readonly definition: HavocCliMechanismDefinition;
  readonly on: readonly HavocCohortRun[];
  readonly off: readonly HavocCohortRun[];
  readonly report: HavocCliMechanismReport;
}

type HavocCliMechanismSide = z.infer<typeof havocCliMechanismSideSchema>;

const HAVOC_CLI_MECHANISM_METRIC_IDS: readonly HavocCliMechanismMetricId[] = [
  'reboundShare',
  'threePointAttemptRate',
  'assistRate',
  'opponentFieldGoalPct',
  'humanTurnoverRate',
  'cloneSeconds',
  'humanFullShotClock',
  'opponentFullShotClock',
  'humanShotClockViolations',
  'opponentShotClockViolations',
];

function mechanismSideOf(runs: readonly HavocCohortRun[]): HavocCliMechanismSide {
  const facts = runs.flatMap((run) => run.facts);
  const wins = facts.filter((fact) => fact.outcome === 'win').length;
  const metrics: Record<string, number> = {};
  for (const id of HAVOC_CLI_MECHANISM_METRIC_IDS) {
    metrics[id] = round4(mean(facts.map((fact) => mechanismMetricValue(id, fact))));
  }
  return {
    games: facts.length,
    wins,
    losses: facts.length - wins,
    metrics,
    score: distributionOf(facts.map((fact) => fact.humanScore)),
    opponentScore: distributionOf(facts.map((fact) => fact.opponentScore)),
    auditFailures: runs.reduce((sum, run) => sum + run.auditFindings, 0),
    typedFailures: runs.reduce((sum, run) => sum + run.failures.length, 0),
  };
}

export function runHavocMechanismSensitivity(options: {
  readonly source: HavocCohortSource;
  readonly mechanismId: string;
  readonly seedCount: number;
  readonly games: number;
}): HavocCliMechanismResult {
  const definition = havocMechanismById(options.mechanismId);
  const context = createHavocCohortContext(options.source);
  const onSlots = mechanismSlots(definition.on);
  const offSlots = mechanismSlots([]);
  const on: HavocCohortRun[] = [];
  const off: HavocCohortRun[] = [];
  for (let index = 0; index < options.seedCount; index += 1) {
    const seed = havocCalibrationSeed('mechanism', index);
    on.push(
      runHavocCohortLineup(context, {
        seed,
        lineup: 'mechanism-on',
        variant: 'havoc',
        games: options.games,
        slots: onSlots,
      }),
    );
    off.push(
      runHavocCohortLineup(context, {
        seed,
        lineup: 'mechanism-off',
        variant: 'havoc',
        games: options.games,
        slots: offSlots,
      }),
    );
  }
  const onSide = mechanismSideOf(on);
  const offSide = mechanismSideOf(off);
  const onMean = onSide.metrics[definition.metricId] ?? 0;
  const offMean = offSide.metrics[definition.metricId] ?? 0;
  const delta = round4(onMean - offMean);
  const responded =
    definition.direction === 'increase'
      ? delta >= definition.minDelta
      : -delta >= definition.minDelta;
  const structuralFindings = definition.structural(on, off);
  const report = havocCliMechanismReportSchema.parse({
    id: definition.id,
    label: definition.label,
    channel: definition.channel,
    description: definition.description,
    metricId: definition.metricId,
    direction: definition.direction,
    minDelta: definition.minDelta,
    seeds: options.seedCount,
    games: onSide.games,
    on: onSide,
    off: offSide,
    onMean,
    offMean,
    delta,
    responded,
    structuralFindings,
    pass:
      responded &&
      structuralFindings.length === 0 &&
      onSide.auditFailures + offSide.auditFailures === 0 &&
      onSide.typedFailures + offSide.typedFailures === 0,
  });
  return { definition, on, off, report };
}

export const havocCliCohortSchema = z.object({
  seeds: z.number().int().nonnegative(),
  lineups: z.object({
    ordinary: havocCliLineupStatsSchema,
    risky: havocCliLineupStatsSchema,
    extreme: havocCliLineupStatsSchema,
  }),
});

export const havocCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('havoc calibrate'),
  baseSeed: seedSchema,
  mode: z.enum(['cohorts', 'mechanism']),
  gamesPerSeason: z.number().int().min(1).max(82),
  seedCount: z.number().int().nonnegative(),
  holdoutCount: z.number().int().nonnegative(),
  cohorts: z
    .object({
      train: havocCliCohortSchema,
      holdout: havocCliCohortSchema,
    })
    .nullable(),
  paired: z
    .object({
      seeds: z.number().int().nonnegative(),
      havoc: havocCliCohortTotalsSchema,
      normal: havocCliCohortTotalsSchema,
      winsGained: z.number().int(),
      differentialDelta: z.number().int(),
    })
    .nullable(),
  mechanism: havocCliMechanismReportSchema.nullable(),
  typedFailures: z.array(havocCliFailureSchema).max(200),
  auditFailures: z.number().int().nonnegative(),
  pass: z.boolean(),
});
export type HavocCalibrateReport = z.infer<typeof havocCalibrateReportSchema>;

function typedFailuresOf(runs: readonly HavocCohortRun[]): HavocCliFailure[] {
  const failures: HavocCliFailure[] = [];
  for (const run of runs) failures.push(...run.failures);
  return failures.slice(0, 200);
}

function auditFailuresOf(runs: readonly HavocCohortRun[]): number {
  return runs.reduce((sum, run) => sum + run.auditFindings, 0);
}

export interface HavocCalibrateArgs {
  'seed-count': string | null;
  'holdout-count': string | null;
  mechanism: string | null;
  games: string | null;
  manifest: string | null;
}

export interface HavocCalibrateDeps {
  readonly assets?: HavocCliAssets;
}

function cohortSourceOf(assets: HavocCliAssets): HavocCohortSource {
  return {
    catalog: assets.catalog,
    source: assets.source,
    bracket: assets.bracket,
    profile: assets.profile,
    versionSet: assets.versionSet,
  };
}

function renderLineupStats(label: string, stats: HavocCliLineupStats): string {
  return `${label}: ${String(stats.wins)}-${String(stats.losses)} (${(stats.winRate * 100).toFixed(1)}%) · score mean ${stats.score.mean.toFixed(1)} · turnovers ${stats.humanTurnovers.mean.toFixed(1)}/${stats.opponentTurnovers.mean.toFixed(1)} · rebounds ${stats.humanRebounds.mean.toFixed(1)}/${stats.opponentRebounds.mean.toFixed(1)} · fouls ${stats.humanFouls.mean.toFixed(1)}/${stats.opponentFouls.mean.toFixed(1)} · adjustments ${stats.adjustments.mean.toFixed(1)} · clone seconds ${stats.clones.seconds.mean.toFixed(1)} · OT ${String(stats.overtimeGames)} · audit ${String(stats.auditFailures)} · typed ${String(stats.typedFailures)}`;
}

export function havocCalibrate(args: HavocCalibrateArgs, deps: HavocCalibrateDeps = {}): CliReport {
  const input = {
    seedCount: args['seed-count'],
    holdoutCount: args['holdout-count'],
    mechanism: args.mechanism,
    games: args.games,
    manifest: args.manifest,
  };
  try {
    const mechanismId = args.mechanism;
    const seedCount = parseCount(
      args['seed-count'] ?? undefined,
      '--seed-count',
      mechanismId === null ? 128 : 64,
    );
    const holdoutCount = parseCount(args['holdout-count'] ?? undefined, '--holdout-count', 32);
    const games = parseCount(args.games ?? undefined, '--games', 82);
    if (games < 1 || games > 82) {
      throw new UsageError(`--games must be an integer from 1..82 (got "${String(games)}")`);
    }
    if (mechanismId !== null) havocMechanismById(mechanismId);
    const assets = deps.assets ?? loadHavocCliAssets(args.manifest ?? undefined);
    const source = cohortSourceOf(assets);
    const baseSeed = seedSchema.parse(seedFromString(HAVOC_CLI_CALIBRATION_BASE));
    if (mechanismId !== null) {
      const result = runHavocMechanismSensitivity({
        source,
        mechanismId,
        seedCount,
        games,
      });
      const report = havocCalibrateReportSchema.parse({
        schemaVersion: 1,
        command: 'havoc calibrate',
        baseSeed,
        mode: 'mechanism',
        gamesPerSeason: games,
        seedCount,
        holdoutCount: 0,
        cohorts: null,
        paired: null,
        mechanism: result.report,
        typedFailures: typedFailuresOf([...result.on, ...result.off]),
        auditFailures: auditFailuresOf([...result.on, ...result.off]),
        pass: result.report.pass,
      });
      const failures: string[] = [];
      if (!result.report.responded) {
        failures.push(
          `mechanism ${result.definition.id}: channel ${result.definition.metricId} did not move ${result.definition.direction} by ${String(result.definition.minDelta)} (delta ${String(result.report.delta)})`,
        );
      }
      failures.push(...result.report.structuralFindings);
      if (report.auditFailures > 0) {
        failures.push(`accounting audit failures: ${String(report.auditFailures)}`);
      }
      if (report.typedFailures.length > 0) {
        failures.push(`typed simulation failures: ${String(report.typedFailures.length)}`);
      }
      const details = [
        `mechanism ${result.definition.id} (${result.definition.label}) · ${String(seedCount)} paired seeds × ${String(games)} game(s)`,
        `channel ${result.definition.metricId}: on ${String(result.report.onMean)} · off ${String(result.report.offMean)} · delta ${String(result.report.delta)} (${result.definition.direction} ≥ ${String(result.definition.minDelta)}) · responded ${String(result.report.responded)}`,
        `structural findings ${String(result.report.structuralFindings.length)} · audit failures ${String(report.auditFailures)} · typed failures ${String(report.typedFailures.length)}`,
      ];
      details.push(...failures.slice(0, 20));
      return makeReport('havoc calibrate', input, { details, failures, payload: report });
    }
    const cohorts = runHavocCalibrationCohorts({
      source,
      seedCount,
      holdoutCount,
      games,
    });
    const statsOf = (runs: readonly HavocCohortRun[], lineup: HavocCliCohortLineup) =>
      havocLineupStatsOf(runs, lineup);
    const paired = pairedTotalsOf(
      cohorts.train.filter((run) => run.lineup === 'ordinary'),
      cohorts.normal.filter((run) => cohorts.trainSeeds.includes(run.seed)),
    );
    const cohortsPayload = {
      train: {
        seeds: cohorts.trainSeeds.length,
        lineups: {
          ordinary: statsOf(cohorts.train, 'ordinary'),
          risky: statsOf(cohorts.train, 'risky'),
          extreme: statsOf(cohorts.train, 'extreme'),
        },
      },
      holdout: {
        seeds: cohorts.holdoutSeeds.length,
        lineups: {
          ordinary: statsOf(cohorts.holdout, 'ordinary'),
          risky: statsOf(cohorts.holdout, 'risky'),
          extreme: statsOf(cohorts.holdout, 'extreme'),
        },
      },
    };
    const report = havocCalibrateReportSchema.parse({
      schemaVersion: 1,
      command: 'havoc calibrate',
      baseSeed,
      mode: 'cohorts',
      gamesPerSeason: games,
      seedCount,
      holdoutCount,
      cohorts: cohortsPayload,
      paired: {
        seeds: cohorts.trainSeeds.length,
        havoc: paired.havoc,
        normal: paired.normal,
        winsGained: paired.winsGained,
        differentialDelta: paired.differentialDelta,
      },
      mechanism: null,
      typedFailures: typedFailuresOf([...cohorts.train, ...cohorts.holdout, ...cohorts.normal]),
      auditFailures: auditFailuresOf([...cohorts.train, ...cohorts.holdout, ...cohorts.normal]),
      pass:
        auditFailuresOf([...cohorts.train, ...cohorts.holdout, ...cohorts.normal]) === 0 &&
        typedFailuresOf([...cohorts.train, ...cohorts.holdout, ...cohorts.normal]).length === 0,
    });
    const failures: string[] = [];
    if (report.auditFailures > 0) {
      failures.push(`accounting audit failures: ${String(report.auditFailures)}`);
    }
    if (report.typedFailures.length > 0) {
      failures.push(`typed simulation failures: ${String(report.typedFailures.length)}`);
    }
    const details = [
      `cohorts: ${String(seedCount)} train + ${String(holdoutCount)} holdout seeds × ${String(games)} games × ${String(HAVOC_CLI_COHORT_LINEUPS.length)} lineups, plus paired normal seasons`,
      renderLineupStats('train ordinary', cohortsPayload.train.lineups.ordinary),
      renderLineupStats('train risky', cohortsPayload.train.lineups.risky),
      renderLineupStats('train extreme', cohortsPayload.train.lineups.extreme),
      renderLineupStats('holdout ordinary', cohortsPayload.holdout.lineups.ordinary),
      renderLineupStats('holdout risky', cohortsPayload.holdout.lineups.risky),
      renderLineupStats('holdout extreme', cohortsPayload.holdout.lineups.extreme),
      `paired ordinary train: havoc ${String(paired.havoc.wins)}-${String(paired.havoc.losses)} vs normal ${String(paired.normal.wins)}-${String(paired.normal.losses)} · wins gained ${String(paired.winsGained)} · differential delta ${String(paired.differentialDelta)}`,
      `audit failures ${String(report.auditFailures)} · typed failures ${String(report.typedFailures.length)}`,
    ];
    details.push(...failures.slice(0, 20));
    return makeReport('havoc calibrate', input, { details, failures, payload: report });
  } catch (error) {
    if (error instanceof UsageError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof HavocCliError ? `${error.code}: ` : '';
    return makeReport('havoc calibrate', input, {
      failures: [`${code}${message}`],
      exitCode: EXIT_USAGE_OR_DATA_ERROR,
    });
  }
}
