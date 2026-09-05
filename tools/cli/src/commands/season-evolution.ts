import { resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_COURT_INNOVATION_VERSION,
  SEASON_EVOLUTION_TARGETS_VERSION,
  SEASON_FRONT_OFFICE_VERSION,
  seasonGameSimulationInputSchema,
  seedSchema,
  type SeasonGameRule,
  type SeasonGameSimulationInput,
} from '@hoop-rush/data-contracts';
import {
  baseInquiryAllowanceOf,
  campaignBonusOf,
  checkSeasonGameResult,
  createEngineContext,
  purchasedInquiryCostOf,
  rehabPriceOf,
  resolveAiCourtInnovations,
  simulateSeasonGame,
  wrapSponsorshipsForBlock,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile } from './season-data.ts';
import { parseSeedRange } from '../args.ts';
import { seasonCalibrationSeed, seedIndexRange } from './season-calibration.ts';
import { commitTargetsArtifact, validateTargetsArtifact } from '../artifact.ts';
import { loadSeasonGameFixture, SEASON_GAME_PRESET_FIXTURES } from './season-game.ts';

export const SEASON_EVOLUTION_CALIBRATE_OPTIONS: Record<string, boolean> = {
  fixture: true,
  'seed-from': true,
  'seed-to': true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};
export const SEASON_EVOLUTION_VALIDATE_OPTIONS: Record<string, boolean> = {
  out: true,
  manifest: true,
  format: true,
};
export const SEASON_EVOLUTION_BENCHMARK_OPTIONS: Record<string, boolean> = {
  fixture: true,
  manifest: true,
  format: true,
};
export const DEFAULT_EVOLUTION_TARGETS = resolve(
  DEFAULT_SEASON_DIR,
  'franchise-evolution-targets.json',
);
export const SEASON_EVOLUTION_CALIBRATION_SEEDS = 64;
export const SEASON_EVOLUTION_VALIDATION_SEEDS = 16;
export const SEASON_EVOLUTION_RACE_SEED_SCAN = 400;

export const seasonEvolutionTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_EVOLUTION_TARGETS_VERSION),
  frontOfficeVersion: z.literal(SEASON_FRONT_OFFICE_VERSION),
  courtInnovationVersion: z.literal(SEASON_COURT_INNOVATION_VERSION),
  cohort: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  heldOut: z.object({
    seedFrom: z.number().int().nonnegative(),
    seedTo: z.number().int().nonnegative(),
  }),
  measured: z.object({
    gamesPerRule: z.record(z.string(), z.number().int().nonnegative()),
    accountingViolations: z.number().int().nonnegative(),
    auditFailures: z.number().int().nonnegative(),
    determinismFailures: z.number().int().nonnegative(),
    meanPointsPerRule: z.record(z.string(), z.number()),
    meanPossessionsPerRule: z.record(z.string(), z.number()),
    deepAttemptShare: z.number(),
    deepMakes: z.number().int().nonnegative(),
    racesCompleted: z.number().int().nonnegative(),
    raceOvershootGames: z.number().int().nonnegative(),
    sponsorWrapRate: z.number(),
    sponsorWraps: z.number().int().nonnegative(),
    aiSelections: z.number().int().nonnegative(),
    aiDeterminismFailures: z.number().int().nonnegative(),
  }),
  gates: z.object({
    zeroAccountingViolations: z.boolean(),
    zeroAuditFailures: z.boolean(),
    deterministicReplay: z.boolean(),
    racesComplete: z.boolean(),
    sponsorRateWithinEnvelope: z.boolean(),
  }),
});
export type SeasonEvolutionTargets = z.infer<typeof seasonEvolutionTargetsSchema>;

const RULES: readonly SeasonGameRule[] = ['standard', 'deep-four', 'twenty-second-clock'];
const FRONT_OFFICE_IDS = ['morgan-vale', 'alex-chen', 'jordan-ellis'] as const;

interface RuleFacts {
  games: number;
  points: number;
  possessions: number;
  deepAttempts: number;
  deepMakes: number;
}

function blankRuleFacts(): RuleFacts {
  return { games: 0, points: 0, possessions: 0, deepAttempts: 0, deepMakes: 0 };
}

function simulateCohort(
  seedFrom: number,
  seedTo: number,
): {
  perRule: Record<string, RuleFacts>;
  accountingViolations: number;
  auditFailures: number;
  determinismFailures: number;
  racesCompleted: number;
  raceOvershootGames: number;
  raceAuditFailures: number;
} {
  const context = createEngineContext();
  const perRule: Record<string, RuleFacts> = {
    standard: blankRuleFacts(),
    'deep-four': blankRuleFacts(),
    'twenty-second-clock': blankRuleFacts(),
  };
  let accountingViolations = 0;
  let auditFailures = 0;
  let determinismFailures = 0;
  let racesCompleted = 0;
  let raceOvershootGames = 0;
  let raceAuditFailures = 0;
  const fixtures = SEASON_GAME_PRESET_FIXTURES.map((preset) => loadSeasonGameFixture(preset).input);
  for (const seedIndex of seedIndexRange(seedFrom, seedTo)) {
    const seed = seasonCalibrationSeed(seedIndex);
    for (const fixture of fixtures) {
      for (const rule of RULES) {
        const input: SeasonGameSimulationInput = seasonGameSimulationInputSchema.parse({
          ...fixture,
          seed: seedSchema.parse(seed),
          gameRule: rule === 'standard' ? undefined : rule,
        });
        const result = simulateSeasonGame(input, context);
        const facts = perRule[rule];
        if (facts === undefined) continue;
        if (result.outcome !== 'completed') {
          auditFailures += 1;
          continue;
        }
        facts.games += 1;
        facts.points += result.home.score + result.away.score;
        facts.possessions += result.home.box.possessions + result.away.box.possessions;
        facts.deepAttempts +=
          (result.home.box.deepFours?.attempted ?? 0) + (result.away.box.deepFours?.attempted ?? 0);
        facts.deepMakes +=
          (result.home.box.deepFours?.made ?? 0) + (result.away.box.deepFours?.made ?? 0);
        const failures = checkSeasonGameResult(result, input);
        if (failures.length > 0) {
          auditFailures += 1;
          accountingViolations += failures.length;
        }
        const replay = simulateSeasonGame(input, context);
        if (JSON.stringify(replay) !== JSON.stringify(result)) determinismFailures += 1;
      }
    }
  }
  const raceSeeds = huntRaceSeeds(seedFrom);
  for (const raceSeed of raceSeeds) {
    const input: SeasonGameSimulationInput = seasonGameSimulationInputSchema.parse({
      ...fixtures[0],
      seed: seedSchema.parse(raceSeed),
      gameRule: 'first-to-seven-overtime',
    });
    const result = simulateSeasonGame(input, context);
    if (result.outcome !== 'completed' || result.overtimeRace === undefined) {
      raceAuditFailures += 1;
      continue;
    }
    racesCompleted += 1;
    const winnerPoints =
      result.winner === 'home' ? result.overtimeRace.homePoints : result.overtimeRace.awayPoints;
    if (winnerPoints > 7) raceOvershootGames += 1;
    if (checkSeasonGameResult(result, input).length > 0) raceAuditFailures += 1;
    const replay = simulateSeasonGame(input, context);
    if (JSON.stringify(replay) !== JSON.stringify(result)) determinismFailures += 1;
  }
  return {
    perRule,
    accountingViolations,
    auditFailures: auditFailures + raceAuditFailures,
    determinismFailures,
    racesCompleted,
    raceOvershootGames,
    raceAuditFailures,
  };
}

function huntRaceSeeds(seedFrom: number): string[] {
  const context = createEngineContext();
  const fixture = loadSeasonGameFixture(SEASON_GAME_PRESET_FIXTURES[0]).input;
  const found: string[] = [];
  for (let offset = 0; offset < SEASON_EVOLUTION_RACE_SEED_SCAN && found.length < 4; offset += 1) {
    const seed = seasonCalibrationSeed(seedFrom + offset);
    const input: SeasonGameSimulationInput = seasonGameSimulationInputSchema.parse({
      ...fixture,
      seed: seedSchema.parse(seed),
    });
    const result = simulateSeasonGame(input, context);
    if (result.outcome === 'completed' && result.overtimePeriods > 0) found.push(seed);
  }
  return found;
}

function measureSponsorships(seedFrom: number, seedTo: number): { wraps: number; total: number } {
  let wraps = 0;
  let total = 0;
  const opportunities = [
    { opportunityId: 'copp-00000001', family: 'style', blockIndex: 0 },
    { opportunityId: 'copp-00000002', family: 'results', blockIndex: 0 },
  ];
  for (const seedIndex of seedIndexRange(seedFrom, seedTo)) {
    for (let blockIndex = 0; blockIndex < 8; blockIndex += 1) {
      total += 1;
      const wrapped = wrapSponsorshipsForBlock({
        rootSeed: seasonCalibrationSeed(seedIndex),
        blockIndex,
        opportunities,
      });
      if (wrapped.wrapper !== null) wraps += 1;
    }
  }
  return { wraps, total };
}

function checkAiSelection(): { selections: number; determinismFailures: number } {
  const rootSeed = seasonCalibrationSeed(7);
  const aiFranchiseIds = Array.from(
    { length: 30 },
    (_, index) => `f${String(index + 1).padStart(2, '0')}`,
  );
  const first = resolveAiCourtInnovations({
    rootSeed,
    evolution: {
      schemaVersion: 1,
      frontOfficeVersion: SEASON_FRONT_OFFICE_VERSION,
      courtInnovationVersion: SEASON_COURT_INNOVATION_VERSION,
      targetsVersion: SEASON_EVOLUTION_TARGETS_VERSION,
      frontOffice: null,
      discovery: null,
      selections: {},
    },
    humanFranchiseId: null,
    aiFranchiseIds,
    data: null,
  });
  const second = resolveAiCourtInnovations({
    rootSeed,
    evolution: {
      schemaVersion: 1,
      frontOfficeVersion: SEASON_FRONT_OFFICE_VERSION,
      courtInnovationVersion: SEASON_COURT_INNOVATION_VERSION,
      targetsVersion: SEASON_EVOLUTION_TARGETS_VERSION,
      frontOffice: null,
      discovery: null,
      selections: {},
    },
    humanFranchiseId: null,
    aiFranchiseIds,
    data: null,
  });
  return {
    selections: Object.keys(first.selections).length,
    determinismFailures: JSON.stringify(first) === JSON.stringify(second) ? 0 : 1,
  };
}

function checkFrontOfficePolicy(): string[] {
  const failures: string[] = [];
  if (rehabPriceOf(null) !== 2) failures.push('base rehab price must be 2');
  if (rehabPriceOf('morgan-vale') !== 3) failures.push('deal-maker rehab price must be 3');
  if (rehabPriceOf('alex-chen') !== 1) failures.push('recovery-director rehab price must be 1');
  if (rehabPriceOf('jordan-ellis') !== 3) failures.push('campaign-director rehab price must be 3');
  if (baseInquiryAllowanceOf('morgan-vale') !== 4) failures.push('deal-maker allowance must be 4');
  if (purchasedInquiryCostOf('alex-chen') !== 2)
    failures.push('recovery-director purchase cost must be 2');
  if (campaignBonusOf('jordan-ellis') !== 1) failures.push('campaign-director bonus must be 1');
  for (const id of FRONT_OFFICE_IDS) {
    if (baseInquiryAllowanceOf(id) > 5) failures.push(`${id} allowance exceeds the cap`);
  }
  return failures;
}

export function seasonEvolutionCalibrate(args: {
  fixture?: string | null;
  'seed-from'?: string | null;
  'seed-to'?: string | null;
  out?: string | null;
  manifest?: string | null;
  validate?: string | null;
}): CliReport {
  const { from: seedFrom, to: seedTo } = parseSeedRange(
    args,
    SEASON_EVOLUTION_CALIBRATION_SEEDS - 1,
  );
  void args.fixture;
  const measured = simulateCohort(seedFrom, seedTo);
  const sponsors = measureSponsorships(seedFrom, seedTo);
  const ai = checkAiSelection();
  const policyFailures = checkFrontOfficePolicy();
  const deepFacts = measured.perRule['deep-four'] ?? blankRuleFacts();
  const meanPoints: Record<string, number> = {};
  const meanPossessions: Record<string, number> = {};
  for (const [rule, facts] of Object.entries(measured.perRule)) {
    meanPoints[rule] = facts.games > 0 ? facts.points / facts.games : 0;
    meanPossessions[rule] = facts.games > 0 ? facts.possessions / facts.games : 0;
  }
  const gamesPerRule: Record<string, number> = {};
  for (const [rule, facts] of Object.entries(measured.perRule)) gamesPerRule[rule] = facts.games;
  const sponsorWrapRate = sponsors.total > 0 ? sponsors.wraps / sponsors.total : 0;
  const gates = {
    zeroAccountingViolations: measured.accountingViolations === 0,
    zeroAuditFailures: measured.auditFailures === 0,
    deterministicReplay: measured.determinismFailures === 0 && ai.determinismFailures === 0,
    racesComplete: measured.racesCompleted > 0 && measured.raceAuditFailures === 0,
    sponsorRateWithinEnvelope: sponsorWrapRate >= 0.3 && sponsorWrapRate <= 0.7,
  };
  const content = seasonEvolutionTargetsSchema.parse({
    schemaVersion: 1,
    targetsVersion: SEASON_EVOLUTION_TARGETS_VERSION,
    frontOfficeVersion: SEASON_FRONT_OFFICE_VERSION,
    courtInnovationVersion: SEASON_COURT_INNOVATION_VERSION,
    cohort: { seedFrom, seedTo },
    heldOut: { seedFrom: seedTo + 1, seedTo: seedTo + SEASON_EVOLUTION_VALIDATION_SEEDS },
    measured: {
      gamesPerRule,
      accountingViolations: measured.accountingViolations,
      auditFailures: measured.auditFailures,
      determinismFailures: measured.determinismFailures + ai.determinismFailures,
      meanPointsPerRule: meanPoints,
      meanPossessionsPerRule: meanPossessions,
      deepAttemptShare:
        deepFacts.possessions > 0 ? deepFacts.deepAttempts / deepFacts.possessions : 0,
      deepMakes: deepFacts.deepMakes,
      racesCompleted: measured.racesCompleted,
      raceOvershootGames: measured.raceOvershootGames,
      sponsorWrapRate,
      sponsorWraps: sponsors.wraps,
      aiSelections: ai.selections,
      aiDeterminismFailures: ai.determinismFailures,
    },
    gates,
  });
  const outPath = args.out ?? DEFAULT_EVOLUTION_TARGETS;
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const written = commitTargetsArtifact({
    outPath,
    defaultTargetsPath: DEFAULT_EVOLUTION_TARGETS,
    manifestPath,
    manifestKey: 'evolutionTargets',
    manifestUrl: 'season/franchise-evolution-targets.json',
    content,
  });
  const failures = [...policyFailures];
  if (written.error !== null) failures.push(written.error);
  if (Object.values(gates).some((gate) => !gate))
    failures.push('evolution calibration gates failed');
  return makeReport(
    'season evolution calibrate',
    { seedFrom, seedTo, out: outPath },
    {
      failures,
      details: [
        `games per rule: ${JSON.stringify(gamesPerRule)}`,
        `accounting violations: ${String(measured.accountingViolations)}`,
        `audit failures: ${String(measured.auditFailures)}`,
        `races completed: ${String(measured.racesCompleted)} (overshoot ${String(measured.raceOvershootGames)})`,
        `sponsor wrap rate: ${sponsorWrapRate.toFixed(3)}`,
        `ai selections: ${String(ai.selections)}`,
        `artifact: ${written.path ?? outPath}`,
      ],
    },
  );
}

export function seasonEvolutionValidate(args: {
  out?: string | null;
  manifest?: string | null;
}): CliReport {
  const outPath = args.out ?? DEFAULT_EVOLUTION_TARGETS;
  return validateTargetsArtifact<SeasonEvolutionTargets>({
    outPath,
    schema: seasonEvolutionTargetsSchema,
    command: 'season evolution validate',
    extraChecks: (parsed) => {
      const heldOut = simulateCohort(parsed.heldOut.seedFrom, parsed.heldOut.seedTo);
      const details = [
        `held-out games: ${String(Object.values(heldOut.perRule).reduce((sum, facts) => sum + facts.games, 0))}`,
        `held-out audit failures: ${String(heldOut.auditFailures)}`,
      ];
      const failures: string[] = [];
      if (heldOut.auditFailures > 0) failures.push('held-out cohort has audit failures');
      if (heldOut.determinismFailures > 0) failures.push('held-out cohort is not deterministic');
      if (heldOut.racesCompleted === 0) failures.push('held-out cohort exercised no overtime race');
      return { details, failures };
    },
  });
}

export function seasonEvolutionBenchmark(args: {
  fixture?: string | null;
  manifest?: string | null;
}): CliReport {
  void args.fixture;
  void args.manifest;
  const context = createEngineContext();
  const fixture = loadSeasonGameFixture(SEASON_GAME_PRESET_FIXTURES[0]).input;
  const samples: Record<string, number[]> = {
    standard: [],
    'deep-four': [],
    'twenty-second-clock': [],
    'first-to-seven-overtime': [],
  };
  const rules: readonly SeasonGameRule[] = [
    'standard',
    'deep-four',
    'twenty-second-clock',
    'first-to-seven-overtime',
  ];
  for (const rule of rules) {
    for (let index = 0; index < 12; index += 1) {
      const input: SeasonGameSimulationInput = seasonGameSimulationInputSchema.parse({
        ...fixture,
        seed: seedSchema.parse(seasonCalibrationSeed(index)),
        gameRule: rule === 'standard' ? undefined : rule,
      });
      const started = performance.now();
      simulateSeasonGame(input, context);
      const samplesForRule = samples[rule];
      if (samplesForRule !== undefined) samplesForRule.push(performance.now() - started);
    }
  }
  const details: string[] = [];
  for (const [rule, values] of Object.entries(samples)) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    details.push(`${rule}: median ${median.toFixed(2)}ms over ${String(values.length)} games`);
  }
  const aiStarted = performance.now();
  checkAiSelection();
  details.push(`ai selection (30 franchises): ${(performance.now() - aiStarted).toFixed(2)}ms`);
  return makeReport('season evolution benchmark', {}, { details });
}

export function readEvolutionTargetsFile(path: string): SeasonEvolutionTargets {
  return seasonEvolutionTargetsSchema.parse(readJsonFile(path));
}
