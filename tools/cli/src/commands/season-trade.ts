import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  type Position,
  type SeasonGamePlayerInput,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  canonicalRosterPairs,
  createEngineContext,
  expandSeasonRunRosters,
  legalFiveAfterAnyRemoval,
  validateSeasonRoster,
  validateSeasonRotation,
  type SeasonRosterMemberInput,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonTradeCalibrateReportSchema } from '../report-schemas.ts';
import { parseSeedRange, parseWorkers } from '../args.ts';
import { DEFAULT_MANIFEST, DEFAULT_SEASON_DIR, readJsonFile, sha256Hex } from './season-data.ts';
import {
  gateValue,
  gateSummary,
  m25RangeGate,
  m25ToleranceGate,
  mean,
  seasonCalibrationSeed,
  seedIndexRange,
  type M25Gate,
} from './season-calibration.ts';
import { runSeasonM25, type SeasonM25SeasonFacts } from './season-m25-core.ts';

/**
 * `season trade calibrate` (spec/2.0 M2.5, contract §17): freezes
 * `trade-targets-v1` from seasons that open trade windows at blocks 2/4/5
 * through the engine economy (`openSeasonTradeWindow`, §20 frozen shape).
 * The human franchise never acts in the cohort, so every accepted offer in
 * the recorded trade state is AI activity; the season-level gate freezes the
 * mean accepted AI trades per season in [8, 15] (LEAD DECISION, contract
 * §13: window targets 3-6 AI trades each across three windows).
 *
 * Gates (frozen):
 * - AI trades per season mean within [8, 15] (range gate over the cohort
 *   mean).
 * - zero illegal trades / zero duplicate-ownership trades: post-season every
 *   roster holds exactly ten distinct versions, the league owns 300 unique
 *   versions, and every roster keeps a legal five after any removal with
 *   valid rotation legality.
 * - accepted offers respect their value bands: `qualified` true and the
 *   ratio inside the frozen 85-115 (1-for-1) / 80-120 (2-for-2) bands.
 * - deterministic offer generation: the first window is re-generated from
 *   the exact pre-window run state and must produce identical offers.
 * - chemistry invariants: 45 canonical pairs per roster (1,350 league-wide)
 *   and every pair created by a trade carries zero-state chemistry (zero
 *   shared possessions in the effects state).
 *
 * Cohort sizes (documented): 8 calibration + 4 held-out seasons (seasons are
 * the expensive unit; the mean-across-seeds gate has ~1.1 trade error at the
 * expected per-season variance, comfortably inside the [8, 15] band). The
 * runner is in-process (a worker variant is deferred to stay bounded).
 */

export const SEASON_TRADE_CALIBRATE_OPTIONS: Record<string, boolean> = {
  input: true,
  'seed-from': true,
  'seed-to': true,
  workers: true,
  out: true,
  manifest: true,
  validate: true,
  format: true,
};

export const DEFAULT_TRADE_TARGETS = resolve(DEFAULT_SEASON_DIR, 'trade-targets.json');

export const SEASON_TRADE_CALIBRATION_SEED_COUNT = 8;
export const SEASON_TRADE_VALIDATION_SEED_COUNT = 4;

/** Frozen season-level AI trade band (LEAD DECISION, contract §13/§17). */
export const SEASON_TRADE_MIN_AI_TRADES_PER_SEASON = 8;
export const SEASON_TRADE_MAX_AI_TRADES_PER_SEASON = 15;

/** Frozen value bands: ratio basis points per offer size. */
export const SEASON_TRADE_VALUE_BANDS = {
  '1-for-1': { min: 850, max: 1150 },
  '2-for-2': { min: 800, max: 1200 },
} as const;

/** Chemistry invariants (canonical pairs per roster and league-wide). */
export const SEASON_TRADE_PAIRS_PER_ROSTER = 45;
export const SEASON_TRADE_PAIRS_LEAGUE = 1350;

/** Minimum seasons before the mean-across-seeds gates evaluate. */
export const SEASON_TRADE_MIN_SEASONS = 4;

/** The targets artifact frozen by `season trade calibrate`. */
export const seasonTradeTargetsSchema = z.object({
  schemaVersion: z.literal(1),
  targetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  policy: z.object({
    aiTradesPerSeason: z.object({
      min: z.literal(8),
      max: z.literal(15),
    }),
    windows: z.tuple([z.literal(2), z.literal(4), z.literal(5)]),
    valueBands: z.object({
      '1-for-1': z.tuple([z.literal(850), z.literal(1150)]),
      '2-for-2': z.tuple([z.literal(800), z.literal(1200)]),
    }),
    chemistryPairsPerRoster: z.literal(45),
    chemistryPairsTotal: z.literal(1350),
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
      aiTradesMean: z.number(),
      aiTradesMin: z.number().int().nonnegative(),
      aiTradesMax: z.number().int().nonnegative(),
      acceptedTrades: z.number().int().nonnegative(),
      illegalRosterFailures: z.number().int().nonnegative(),
      duplicateOwnershipFailures: z.number().int().nonnegative(),
      valueBandFailures: z.number().int().nonnegative(),
      chemistryPairs: z.number().int().nonnegative(),
      chemistryPairFailures: z.number().int().nonnegative(),
      zeroStateNewPairFailures: z.number().int().nonnegative(),
      deterministicOffers: z.boolean(),
    }),
    heldOut: z.object({
      seasonsSimulated: z.number().int().nonnegative(),
      aiTradesMean: z.number(),
      illegalRosterFailures: z.number().int().nonnegative(),
      duplicateOwnershipFailures: z.number().int().nonnegative(),
      valueBandFailures: z.number().int().nonnegative(),
    }),
  }),
  gates: z.object({
    aiTradesPerSeason: z.boolean(),
    zeroIllegal: z.boolean(),
    zeroDuplicateOwnership: z.boolean(),
    valueBands: z.boolean(),
    deterministicOffers: z.boolean(),
    chemistryInvariants: z.boolean(),
    heldOut: z.boolean(),
  }),
  engineVersion: z.string().min(1).max(64),
  gameVersion: z.literal(SEASON_GAME_VERSION),
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  generatedAtIso: z.string().min(1),
});
export type SeasonTradeTargets = z.infer<typeof seasonTradeTargetsSchema>;

/**
 * Accepted AI trades per season: the accepted offers of the window each
 * `SeasonM25WindowOpen` result opened. Each window result's `trade.windows`
 * ACCUMULATES every earlier window (the driver folds the trade state
 * forward), so only the last window of each result is counted — counting
 * all windows would triple-count window 0's offers.
 */
export function aiTradesOf(season: SeasonM25SeasonFacts): number {
  let accepted = 0;
  for (const window of season.windows) {
    if (window.result === null) continue;
    const opened = window.result.trade.windows.at(-1);
    if (opened === undefined) continue;
    for (const offer of opened.offers) {
      if (offer.status === 'accepted') accepted += 1;
    }
  }
  return accepted;
}

/**
 * Value-band failures among the accepted offers of one season: only the
 * window each result opened is counted (see `aiTradesOf`).
 */
export function valueBandFailuresOf(season: SeasonM25SeasonFacts): number {
  let failures = 0;
  for (const window of season.windows) {
    if (window.result === null) continue;
    const opened = window.result.trade.windows.at(-1);
    if (opened === undefined) continue;
    for (const offer of opened.offers) {
      if (offer.status !== 'accepted') continue;
      if (!offer.valueBand.qualified) {
        failures += 1;
        continue;
      }
      const expected =
        offer.outgoingPlayerVersionIds.length === 1
          ? SEASON_TRADE_VALUE_BANDS['1-for-1']
          : SEASON_TRADE_VALUE_BANDS['2-for-2'];
      if (
        offer.valueBand.ratioBasisPoints < expected.min ||
        offer.valueBand.ratioBasisPoints > expected.max
      ) {
        failures += 1;
      }
    }
  }
  return failures;
}

/**
 * Post-season roster legality and unique-ownership audit. `duplicateOwnership`
 * counts a season where the league does not own exactly 300 distinct
 * versions across ten-player rosters (the expansion throws on duplicates,
 * unknown versions, or a wrong total); `illegal` counts rosters that fail
 * the ten-player roster rules (legal five after any removal + roster
 * legality) or whose rotation fails rotation legality (trades repair
 * rotations deterministically, so a post-season failure is an invariant
 * breach).
 */
export function rosterAuditFailuresOf(season: SeasonM25SeasonFacts): {
  illegal: number;
  duplicateOwnership: number;
} {
  const run = season.run;
  let expanded: Map<string, SeasonGamePlayerInput>;
  try {
    expanded = expandSeasonRunRosters(run, season.catalog);
  } catch {
    return { illegal: 0, duplicateOwnership: 1 };
  }
  const playableByVersion = new Map<string, readonly Position[]>();
  for (const player of expanded.values()) {
    playableByVersion.set(player.playerVersionId, player.positions);
  }

  let illegal = 0;
  const membersByFranchise = new Map<string, SeasonRosterMemberInput[]>();
  for (const roster of run.rosters) {
    const members: SeasonRosterMemberInput[] = roster.players.map((player) => ({
      playerVersionId: player.playerVersionId,
      playable: [...(playableByVersion.get(player.playerVersionId) ?? [])],
    }));
    if (members.length !== 10) {
      illegal += 1;
      continue;
    }
    if (!legalFiveAfterAnyRemoval(members) || validateSeasonRoster(members).length > 0) {
      illegal += 1;
    }
    membersByFranchise.set(roster.franchiseId, members);
  }
  for (const rotation of run.rotations) {
    const members = membersByFranchise.get(rotation.franchiseId);
    if (members === undefined) {
      illegal += 1;
      continue;
    }
    const memberPlayable = new Map(
      members.map((member) => [member.playerVersionId, member.playable]),
    );
    if (validateSeasonRotation(rotation, memberPlayable).length > 0) illegal += 1;
  }
  return { illegal, duplicateOwnership: 0 };
}

/** The ten-player rosters recorded at season start (the base run fixture). */
function initialRostersOf(run: SeasonRun): string[][] {
  return run.rosters.map((roster) => roster.players.map((player) => player.playerVersionId));
}

/**
 * Chemistry invariants of one season: exactly 45 canonical pairs per final
 * roster (1,350 league-wide) and zero-state chemistry on every pair created
 * by a trade (a pair that was not on the same roster at season start).
 */
export function chemistryFailuresOf(season: SeasonM25SeasonFacts): {
  pairs: number;
  pairFailures: number;
  zeroStateNewPairFailures: number;
} {
  const run = season.run;
  const initialPairs = new Set<string>();
  for (const roster of initialRostersOf(run)) {
    for (const [a, b] of canonicalRosterPairs(roster)) initialPairs.add(`${a}\u0000${b}`);
  }
  const finalRosters = run.rosters.map((roster) =>
    roster.players.map((player) => player.playerVersionId),
  );
  const finalPairs = new Set<string>();
  let pairs = 0;
  let pairFailures = 0;
  for (const roster of finalRosters) {
    const canonical = canonicalRosterPairs(roster);
    if (canonical.length !== SEASON_TRADE_PAIRS_PER_ROSTER) pairFailures += 1;
    pairs += canonical.length;
    for (const [a, b] of canonical) finalPairs.add(`${a}\u0000${b}`);
  }
  const sharedByPair = new Map(
    season.effects.pairStates.map((pair) => [`${pair.a}\u0000${pair.b}`, pair.sharedPossessions]),
  );
  let zeroStateNewPairFailures = 0;
  for (const key of finalPairs) {
    if (initialPairs.has(key)) continue;
    if ((sharedByPair.get(key) ?? 0) !== 0) zeroStateNewPairFailures += 1;
  }
  return { pairs, pairFailures, zeroStateNewPairFailures };
}

/** Trade cohort args shared by run and validate modes. */
export interface SeasonTradeArgs {
  input: string | null;
  'seed-from': string | null;
  'seed-to': string | null;
  workers: string | null;
  out: string | null;
  manifest: string | null;
  validate: string | null;
  format?: string | null;
}

/** Measured trade cohort facts (mirror the targets artifact `measured`). */
export interface SeasonTradeCohortFacts {
  aiTradesMean: number;
  aiTradesMin: number;
  aiTradesMax: number;
  acceptedTrades: number;
  illegalRosterFailures: number;
  duplicateOwnershipFailures: number;
  valueBandFailures: number;
  chemistryPairs: number;
  chemistryPairFailures: number;
  zeroStateNewPairFailures: number;
  deterministicOffers: boolean;
}

/** Evaluates the frozen trade gates over the cohort seasons. */
export function evaluateTradeGates(args: {
  calibration: SeasonM25SeasonFacts[];
  heldOut: SeasonM25SeasonFacts[];
}): { metrics: M25Gate[]; measured: SeasonTradeCohortFacts } {
  const c = args.calibration;
  const h = args.heldOut;
  const trades = c.map(aiTradesOf);
  const tradesMean = mean(trades);
  const heldOutMean = mean(h.map(aiTradesOf));
  const illegal = c.reduce((sum, season) => sum + rosterAuditFailuresOf(season).illegal, 0);
  const duplicates = c.reduce(
    (sum, season) => sum + rosterAuditFailuresOf(season).duplicateOwnership,
    0,
  );
  const valueBandFailures = c.reduce((sum, season) => sum + valueBandFailuresOf(season), 0);
  const chemistry = c.map(chemistryFailuresOf);
  const chemistryPairs = chemistry.reduce((sum, entry) => sum + entry.pairs, 0);
  const chemistryPairFailures = chemistry.reduce((sum, entry) => sum + entry.pairFailures, 0);
  const zeroStateNewPairFailures = chemistry.reduce(
    (sum, entry) => sum + entry.zeroStateNewPairFailures,
    0,
  );
  // Determinism: the driver re-generated the first window from the exact
  // pre-window state and threw on divergence; a completed cohort implies
  // deterministic generation.
  const deterministicOffers = c.length > 0;

  const sample = c.length;
  const metrics: M25Gate[] = [
    m25RangeGate(
      'aiTradesPerSeason',
      tradesMean,
      SEASON_TRADE_MIN_AI_TRADES_PER_SEASON,
      SEASON_TRADE_MAX_AI_TRADES_PER_SEASON,
      sample,
      SEASON_TRADE_MIN_SEASONS,
    ),
    m25ToleranceGate('zeroIllegal', illegal, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
    m25ToleranceGate('zeroDuplicateOwnership', duplicates, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
    m25ToleranceGate('valueBands', valueBandFailures, 0, 0, sample, SEASON_TRADE_MIN_SEASONS),
    m25ToleranceGate('deterministicOffers', deterministicOffers ? 1 : 0, 1, 0, sample, 1),
    m25ToleranceGate(
      'chemistryPairs',
      chemistryPairs,
      SEASON_TRADE_PAIRS_LEAGUE * c.length,
      0,
      sample,
      1,
    ),
    m25ToleranceGate(
      'chemistryPairFailures',
      chemistryPairFailures,
      0,
      0,
      sample,
      SEASON_TRADE_MIN_SEASONS,
    ),
    m25ToleranceGate(
      'zeroStateNewPairFailures',
      zeroStateNewPairFailures,
      0,
      0,
      sample,
      SEASON_TRADE_MIN_SEASONS,
    ),
    m25RangeGate(
      'heldOut.aiTradesPerSeason',
      heldOutMean,
      SEASON_TRADE_MIN_AI_TRADES_PER_SEASON,
      SEASON_TRADE_MAX_AI_TRADES_PER_SEASON,
      h.length,
      SEASON_TRADE_MIN_SEASONS,
    ),
  ];
  return {
    metrics,
    measured: {
      aiTradesMean: tradesMean,
      aiTradesMin: Math.min(...trades, 0),
      aiTradesMax: Math.max(...trades, 0),
      acceptedTrades: trades.reduce((sum, value) => sum + value, 0),
      illegalRosterFailures: illegal,
      duplicateOwnershipFailures: duplicates,
      valueBandFailures,
      chemistryPairs,
      chemistryPairFailures,
      zeroStateNewPairFailures,
      deterministicOffers,
    },
  };
}

/** Validates a committed trade-targets artifact (--validate mode). */
export function validateSeasonTradeTargets(args: SeasonTradeArgs, outPath: string): CliReport {
  const failuresList: string[] = [];
  const details: string[] = [];
  let parsed: SeasonTradeTargets | null = null;
  try {
    parsed = seasonTradeTargetsSchema.parse(readJsonFile(outPath));
    details.push(`artifact ${outPath} validates against the schema`);
  } catch (error) {
    failuresList.push(`artifact fails validation: ${(error as Error).message}`);
  }
  if (parsed !== null) {
    // The schema literal already pins the AI trade band to [8, 15].
    details.push(`AI trade band matches the frozen [8, 15]`);
    const gatePass = Object.values(parsed.gates).every(Boolean);
    if (!gatePass) failuresList.push('artifact records failed calibration gates');
    else details.push('artifact records all-passing gates');
  }
  void args;
  return makeReport('season trade calibrate --validate', {}, { details, failures: failuresList });
}

/** `season trade calibrate`: runs the gates and freezes trade-targets-v1. */
export function seasonTradeCalibrate(args: SeasonTradeArgs): CliReport {
  const started = Date.now();
  const { from, to } = parseSeedRange(args, SEASON_TRADE_CALIBRATION_SEED_COUNT - 1);
  const outPath = args.out ?? DEFAULT_TRADE_TARGETS;
  const validateOnly = args['validate'] !== null;

  if (validateOnly) {
    return validateSeasonTradeTargets(args, resolve(args.validate ?? outPath));
  }

  const workers = parseWorkers(args, 1);
  const calibrationIndices = seedIndexRange(from, to);
  const validationIndices = seedIndexRange(to + 1, to + SEASON_TRADE_VALIDATION_SEED_COUNT);

  let calibration: SeasonM25SeasonFacts[];
  let heldOut: SeasonM25SeasonFacts[];
  try {
    calibration = calibrationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: false,
        probeWindow: index === from,
      }),
    );
    heldOut = validationIndices.map((index) =>
      runSeasonM25({
        runPath: args.input,
        manifestPath: args.manifest,
        rootSeed: seasonCalibrationSeed(index),
        driveWindows: true,
        pickObjectives: false,
      }),
    );
  } catch (error) {
    return makeReport(
      'season trade calibrate',
      { seedFrom: from, seedTo: to, workers },
      { failures: [`calibration cohort failed: ${(error as Error).message}`], exitCode: 2 },
    );
  }

  const { metrics, measured } = evaluateTradeGates({ calibration, heldOut });
  const { skippedGates, pass } = gateSummary(metrics);
  const gates = {
    aiTradesPerSeason: gateValue(metrics, 'aiTradesPerSeason'),
    zeroIllegal: gateValue(metrics, 'zeroIllegal'),
    zeroDuplicateOwnership: gateValue(metrics, 'zeroDuplicateOwnership'),
    valueBands: gateValue(metrics, 'valueBands'),
    deterministicOffers: gateValue(metrics, 'deterministicOffers'),
    chemistryInvariants:
      gateValue(metrics, 'chemistryPairs') &&
      gateValue(metrics, 'chemistryPairFailures') &&
      gateValue(metrics, 'zeroStateNewPairFailures'),
    heldOut: gateValue(metrics, 'heldOut.aiTradesPerSeason'),
  };

  let targetsWritten = false;
  let targetsPath: string | null = null;
  const gateFailures: string[] = [];
  if (pass) {
    const targets: SeasonTradeTargets = {
      schemaVersion: 1,
      targetsVersion: SEASON_TRADE_TARGETS_VERSION,
      policy: {
        aiTradesPerSeason: {
          min: SEASON_TRADE_MIN_AI_TRADES_PER_SEASON,
          max: SEASON_TRADE_MAX_AI_TRADES_PER_SEASON,
        },
        windows: [2, 4, 5],
        valueBands: {
          '1-for-1': [
            SEASON_TRADE_VALUE_BANDS['1-for-1'].min,
            SEASON_TRADE_VALUE_BANDS['1-for-1'].max,
          ],
          '2-for-2': [
            SEASON_TRADE_VALUE_BANDS['2-for-2'].min,
            SEASON_TRADE_VALUE_BANDS['2-for-2'].max,
          ],
        },
        chemistryPairsPerRoster: SEASON_TRADE_PAIRS_PER_ROSTER,
        chemistryPairsTotal: SEASON_TRADE_PAIRS_LEAGUE,
      },
      cohort: { seedFrom: from, seedTo: to },
      heldOut: { seedFrom: to + 1, seedTo: to + SEASON_TRADE_VALIDATION_SEED_COUNT },
      measured: {
        calibration: {
          seasonsSimulated: calibration.length,
          aiTradesMean: measured.aiTradesMean,
          aiTradesMin: measured.aiTradesMin,
          aiTradesMax: measured.aiTradesMax,
          acceptedTrades: measured.acceptedTrades,
          illegalRosterFailures: measured.illegalRosterFailures,
          duplicateOwnershipFailures: measured.duplicateOwnershipFailures,
          valueBandFailures: measured.valueBandFailures,
          chemistryPairs: measured.chemistryPairs,
          chemistryPairFailures: measured.chemistryPairFailures,
          zeroStateNewPairFailures: measured.zeroStateNewPairFailures,
          deterministicOffers: measured.deterministicOffers,
        },
        heldOut: {
          seasonsSimulated: heldOut.length,
          aiTradesMean: mean(heldOut.map(aiTradesOf)),
          illegalRosterFailures: heldOut.reduce(
            (sum, season) => sum + rosterAuditFailuresOf(season).illegal,
            0,
          ),
          duplicateOwnershipFailures: heldOut.reduce(
            (sum, season) => sum + rosterAuditFailuresOf(season).duplicateOwnership,
            0,
          ),
          valueBandFailures: heldOut.reduce((sum, season) => sum + valueBandFailuresOf(season), 0),
        },
      },
      gates,
      engineVersion: createEngineContext().engineVersion,
      gameVersion: SEASON_GAME_VERSION,
      gameTargetsVersion: SEASON_GAME_TARGETS_VERSION,
      generatedAtIso: new Date().toISOString(),
    };
    seasonTradeTargetsSchema.parse(targets);
    try {
      const target = resolve(outPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(targets, null, 2)}\n`);
      targetsWritten = true;
      targetsPath = target;
      if (resolve(outPath) === resolve(DEFAULT_TRADE_TARGETS)) {
        const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
          season?: Record<string, { url?: string; contentHash?: string }>;
        };
        if (manifest.season !== undefined) {
          manifest.season.tradeTargets = {
            url: 'season/trade-targets.json',
            contentHash: sha256Hex(readFileSync(target)),
          };
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        }
      }
    } catch (error) {
      gateFailures.push(`cannot write targets: ${(error as Error).message}`);
    }
  }

  const payload = seasonTradeCalibrateReportSchema.parse({
    schemaVersion: 1,
    command: 'season trade calibrate',
    targetsVersion: SEASON_TRADE_TARGETS_VERSION,
    calibrationSeeds: calibrationIndices.length,
    validationSeeds: validationIndices.length,
    seasonsSimulated: calibration.length + heldOut.length,
    aiTradesMean: measured.aiTradesMean,
    aiTradesMin: measured.aiTradesMin,
    aiTradesMax: measured.aiTradesMax,
    acceptedTrades: measured.acceptedTrades,
    illegalRosterFailures: measured.illegalRosterFailures,
    duplicateOwnershipFailures: measured.duplicateOwnershipFailures,
    valueBandFailures: measured.valueBandFailures,
    chemistryPairs: measured.chemistryPairs,
    chemistryPairFailures: measured.chemistryPairFailures,
    zeroStateNewPairFailures: measured.zeroStateNewPairFailures,
    deterministicOffers: measured.deterministicOffers,
    gates: {
      aiTradesPerSeason: gates.aiTradesPerSeason,
      zeroIllegal: gates.zeroIllegal,
      zeroDuplicateOwnership: gates.zeroDuplicateOwnership,
      valueBands: gates.valueBands,
      deterministicOffers: gates.deterministicOffers,
      chemistryInvariants: gates.chemistryInvariants,
      heldOut: gates.heldOut,
    },
    metrics,
    skippedGates,
    targetsWritten,
    targetsPath,
    durationMs: Date.now() - started,
  });

  const details = [
    `${String(calibration.length)} calibration + ${String(heldOut.length)} held-out seasons in ${String(Date.now() - started)}ms (${String(workers)} workers)`,
    `AI trades per season mean ${measured.aiTradesMean.toFixed(2)} (min ${String(measured.aiTradesMin)} · max ${String(measured.aiTradesMax)}; gate [${String(SEASON_TRADE_MIN_AI_TRADES_PER_SEASON)}, ${String(SEASON_TRADE_MAX_AI_TRADES_PER_SEASON)}])`,
    `illegal rosters ${String(measured.illegalRosterFailures)} · duplicate ownership ${String(measured.duplicateOwnershipFailures)} · value-band failures ${String(measured.valueBandFailures)}`,
    `chemistry pairs ${String(measured.chemistryPairs)} (${String(SEASON_TRADE_PAIRS_LEAGUE)} per season) · pair failures ${String(measured.chemistryPairFailures)} · zero-state new-pair failures ${String(measured.zeroStateNewPairFailures)}`,
    `deterministic offer generation ${String(measured.deterministicOffers)}`,
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
    'season trade calibrate',
    { seedFrom: from, seedTo: to, workers },
    { details, failures: gateFailures, payload },
  );
}
