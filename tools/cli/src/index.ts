import { hasOption, parseArgs, parseOption, UsageError, getOptionString } from './args.ts';
import {
  EXIT_OK,
  EXIT_USAGE_OR_DATA_ERROR,
  makeReport,
  renderJson,
  renderText,
  type CliReport,
} from './report.ts';
import { DEFAULT_MANIFEST } from './commands/data-loader.ts';
import { helpCommand } from './commands/help.ts';
import { bracketAudit, BRACKET_AUDIT_OPTIONS } from './commands/bracket-audit.ts';
import { bracketGenerate, BRACKET_GENERATE_OPTIONS } from './commands/bracket-generate.ts';
import { benchmark, BENCHMARK_OPTIONS } from './commands/benchmark.ts';
import { draftFitBenchmark, DRAFT_FIT_BENCHMARK_OPTIONS } from './commands/draft-fit-benchmark.ts';
import { calibrateRun, calibrateSensitivity, CALIBRATE_OPTIONS } from './commands/calibrate.ts';
import { calibrateOverall, CALIBRATE_OVERALL_OPTIONS } from './commands/calibrate-overall.ts';
import { calibrateRatings, CALIBRATE_RATINGS_OPTIONS } from './commands/calibrate-ratings.ts';
import {
  calibrateThreePoint,
  CALIBRATE_THREE_POINT_OPTIONS,
} from './commands/calibrate-three-point.ts';
import { simChallenge, SIM_CHALLENGE_OPTIONS } from './commands/challenge.ts';
import {
  simChallengeAverage,
  SIM_CHALLENGE_AVERAGE_OPTIONS,
} from './commands/challenge-average.ts';
import { dataCoverage, DATA_COVERAGE_OPTIONS } from './commands/data-coverage.ts';
import {
  defenseBpmCorrelation,
  DATA_DEFENSE_BPM_CORRELATION_OPTIONS,
} from './commands/data-defense-bpm-correlation.ts';
import { dataDerive, DATA_DERIVE_OPTIONS } from './commands/data-derive.ts';
import { dataLineageAudit, DATA_LINEAGE_AUDIT_OPTIONS } from './commands/data-lineage-audit.ts';
import {
  dataOverallsCompare,
  DATA_OVERALLS_COMPARE_OPTIONS,
} from './commands/data-overalls-compare.ts';
import { dataOveralls, DATA_OVERALLS_OPTIONS } from './commands/data-overalls.ts';
import { dataOverallsAudit, DATA_OVERALLS_AUDIT_OPTIONS } from './commands/data-overalls-audit.ts';
import {
  dataPositionsCoverage,
  DATA_POSITIONS_COVERAGE_OPTIONS,
} from './commands/data-positions-coverage.ts';
import {
  dataOverallsDistribution,
  DATA_OVERALLS_DISTRIBUTION_OPTIONS,
} from './commands/data-overalls-distribution.ts';
import { dataValidate, DATA_VALIDATE_OPTIONS } from './commands/data-validate.ts';
import { DIAGNOSE_OPTIONS, SEASON_OPTIONS, simDiagnose, simSeason } from './commands/diagnose.ts';
import { combineDocs, COMBINE_DOCS_OPTIONS } from './commands/docs-combine.ts';
import {
  IMPORT_ERA_PROFILE_OPTIONS,
  IMPORT_FREEZE_OPTIONS,
  IMPORT_MANIFEST_OPTIONS,
  IMPORT_OPPONENT_OPTIONS,
  IMPORT_POOLS_OPTIONS,
  IMPORT_RATINGS_OPTIONS,
  IMPORT_RUN_ALL_OPTIONS,
  importEraProfile,
  importFreeze,
  importManifest,
  importOpponent,
  importPools,
  importRatings,
  importRunAll,
} from './commands/import.ts';
import {
  PROJECTION_AI_SHADOW_OPTIONS,
  PROJECTION_BASE_OPTIONS,
  PROJECTION_BENCHMARK_OPTIONS,
  PROJECTION_BUILD_OPTIONS,
  PROJECTION_CALIBRATE_OPTIONS,
  PROJECTION_SEASON_OPTIONS,
  projectionAiShadow,
  projectionBase,
  projectionBenchmark,
  projectionBuild,
  projectionCalibrateBase,
  projectionSeason,
} from './commands/projection.ts';
import { replay, REPLAY_OPTIONS } from './commands/replay.ts';
import {
  seasonBenchmarkBlock,
  seasonBenchmarkDeterminism,
  seasonBenchmarkFull,
  seasonBenchmarkPersistence,
  SEASON_BENCHMARK_OPTIONS,
} from './commands/season-benchmark.ts';
import {
  seasonBlockAudit,
  SEASON_BLOCK_AUDIT_OPTIONS,
  seasonBlockSimulate,
  SEASON_BLOCK_SIMULATE_OPTIONS,
  seasonFullSimulate,
  SEASON_FULL_SIMULATE_OPTIONS,
} from './commands/season-block.ts';
import {
  seasonDraftCalibrate,
  SEASON_DRAFT_CALIBRATE_OPTIONS,
} from './commands/season-draft-calibrate.ts';
import { seasonDraftReproduce, SEASON_DRAFT_REPRODUCE_OPTIONS } from './commands/season-draft.ts';
import {
  collectionPackAudit,
  collectionPullReproduce,
  COLLECTION_PACK_AUDIT_OPTIONS,
  COLLECTION_PULL_REPRODUCE_OPTIONS,
} from './commands/collection.ts';
import {
  collectionPackCalibrate,
  COLLECTION_PACK_CALIBRATE_OPTIONS,
} from './commands/collection-calibrate.ts';
import {
  collectionGameAudit,
  collectionGameReproduce,
  COLLECTION_GAME_AUDIT_OPTIONS,
  COLLECTION_GAME_REPRODUCE_OPTIONS,
} from './commands/collection-game.ts';
import {
  collectionGameCalibrate,
  COLLECTION_GAME_CALIBRATE_OPTIONS,
} from './commands/collection-game-calibrate.ts';
import {
  collectionProgressionAudit,
  COLLECTION_PROGRESSION_AUDIT_OPTIONS,
} from './commands/collection-progression.ts';
import {
  collectionProgressionCalibrate,
  COLLECTION_PROGRESSION_CALIBRATE_OPTIONS,
} from './commands/collection-progression-calibrate.ts';
import {
  SEASON_EFFECTS_OPTIONS,
  seasonEffectsCalibrate,
  seasonEffectsDistribution,
  seasonEffectsRoles,
  seasonEffectsSensitivity,
} from './commands/season-effects.ts';
import {
  seasonFreeAgencyAudit,
  SEASON_FREE_AGENCY_AUDIT_OPTIONS,
} from './commands/season-free-agency-audit.ts';
import {
  seasonFreeAgencyCalibrate,
  SEASON_FREE_AGENCY_CALIBRATE_OPTIONS,
} from './commands/season-free-agency-calibrate.ts';
import {
  SEASON_GAME_CALIBRATE_OPTIONS,
  SEASON_GAME_SIMULATE_OPTIONS,
  seasonGameCalibrate,
  seasonGameSimulate,
} from './commands/season-game.ts';
import {
  seasonHealthCalibrate,
  SEASON_HEALTH_CALIBRATE_OPTIONS,
} from './commands/season-health.ts';
import {
  seasonHomeCourtCalibrate,
  SEASON_HOME_COURT_CALIBRATE_OPTIONS,
} from './commands/season-home-court.ts';
import {
  seasonInfluenceCalibrate,
  SEASON_INFLUENCE_CALIBRATE_OPTIONS,
} from './commands/season-influence.ts';
import {
  seasonChallengesCalibrate,
  SEASON_CHALLENGES_CALIBRATE_OPTIONS,
} from './commands/season-challenges.ts';
import {
  seasonPostseasonAudit,
  SEASON_POSTSEASON_AUDIT_OPTIONS,
} from './commands/season-postseason-audit.ts';
import {
  seasonPostseasonCalibrate,
  SEASON_POSTSEASON_CALIBRATE_OPTIONS,
} from './commands/season-postseason-calibrate.ts';
import { seasonRunReproduce, SEASON_RUN_REPRODUCE_OPTIONS } from './commands/season-reproduce.ts';
import {
  seasonEvolutionBenchmark,
  seasonEvolutionCalibrate,
  seasonEvolutionValidate,
  SEASON_EVOLUTION_BENCHMARK_OPTIONS,
  SEASON_EVOLUTION_CALIBRATE_OPTIONS,
  SEASON_EVOLUTION_VALIDATE_OPTIONS,
} from './commands/season-evolution.ts';
import {
  SEASON_ROSTERS_AUDIT_OPTIONS,
  SEASON_ROSTERS_CALIBRATE_OPTIONS,
  SEASON_ROSTERS_GENERATE_OPTIONS,
  seasonRostersAudit,
  seasonRostersCalibrate,
  seasonRostersGenerate,
} from './commands/season-rosters.ts';
import {
  SEASON_SCHEDULE_AUDIT_OPTIONS,
  SEASON_SCHEDULE_GENERATE_OPTIONS,
  seasonScheduleAudit,
  seasonScheduleGenerate,
} from './commands/season-schedule.ts';
import {
  SEASON_TRADE_AUDIT_OPTIONS,
  SEASON_TRADE_CALIBRATE_OPTIONS,
  seasonTradeAudit,
  seasonTradeCalibrate,
} from './commands/season-trade.ts';
import { SIM_OPTIONS, simBatch, simGame } from './commands/sim.ts';
type ParsedArgs = ReturnType<typeof parseArgs>;
const s = (args: ParsedArgs, name: string): string | undefined =>
  getOptionString(args, name) ?? undefined;
const n = (args: ParsedArgs, name: string): string | null => getOptionString(args, name);
function pick<const T extends string>(
  args: ParsedArgs,
  keys: readonly T[],
): Record<T, string | null> {
  const out = {} as Record<T, string | null>;
  for (const key of keys) out[key] = n(args, key);
  return out;
}
function pickU<const T extends string>(
  args: ParsedArgs,
  keys: readonly T[],
): Record<T, string | undefined> {
  const out = {} as Record<T, string | undefined>;
  for (const key of keys) out[key] = s(args, key);
  return out;
}
interface SeedRangeCliArgs {
  'seed-from': string | null;
  'seed-to': string | null;
  workers: string | null;
  out: string | null;
  manifest: string | null;
  validate: string | null;
}
const seedRange = (args: ParsedArgs): SeedRangeCliArgs => ({
  'seed-from': n(args, 'seed-from'),
  'seed-to': n(args, 'seed-to'),
  workers: n(args, 'workers'),
  out: n(args, 'out'),
  manifest: n(args, 'manifest'),
  validate: n(args, 'validate'),
});
interface CommandDef {
  options: Record<string, boolean>;
  run: (args: ParsedArgs) => CliReport | Promise<CliReport>;
}
const COMMANDS: Record<string, CommandDef> = {
  help: { options: {}, run: () => helpCommand() },
  'calibrate overall': {
    options: CALIBRATE_OVERALL_OPTIONS,
    run: (args) => calibrateOverall(s(args, 'output')),
  },
  'data validate': {
    options: DATA_VALIDATE_OPTIONS,
    run: (args) => {
      const input = parseOption(args, 'input', DEFAULT_MANIFEST);
      return dataValidate(input, hasOption(args, 'verbose'));
    },
  },
  'data overalls-compare': {
    options: DATA_OVERALLS_COMPARE_OPTIONS,
    run: (args) =>
      dataOverallsCompare({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        baseline: s(args, 'baseline'),
        output: s(args, 'output'),
        allowInputChanges: hasOption(args, 'allow-input-changes'),
      }),
  },
  'data overalls': {
    options: DATA_OVERALLS_OPTIONS,
    run: (args) =>
      dataOveralls({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        franchise: s(args, 'franchise'),
        era: s(args, 'era'),
        player: s(args, 'player'),
        limit: s(args, 'limit'),
      }),
  },
  'data overalls-distribution': {
    options: DATA_OVERALLS_DISTRIBUTION_OPTIONS,
    run: (args) =>
      dataOverallsDistribution({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  'data overalls-audit': {
    options: DATA_OVERALLS_AUDIT_OPTIONS,
    run: (args) => dataOverallsAudit({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  'data positions-coverage': {
    options: DATA_POSITIONS_COVERAGE_OPTIONS,
    run: (args) => dataPositionsCoverage({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  'data defense-bpm-correlation': {
    options: DATA_DEFENSE_BPM_CORRELATION_OPTIONS,
    run: (args) => defenseBpmCorrelation({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
  },
  'data coverage': {
    options: DATA_COVERAGE_OPTIONS,
    run: (args) =>
      dataCoverage({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        franchise: s(args, 'franchise'),
        era: s(args, 'era'),
        status: s(args, 'status'),
      }),
  },
  'data lineage-audit': {
    options: DATA_LINEAGE_AUDIT_OPTIONS,
    run: (args) =>
      dataLineageAudit({
        input: parseOption(args, 'input', DEFAULT_MANIFEST),
        verifyLogos: hasOption(args, 'verify-logos'),
      }),
  },
  'data derive': {
    options: DATA_DERIVE_OPTIONS,
    run: (args) => dataDerive(pickU(args, ['player', 'season', 'franchise'])),
  },
  'sim game': {
    options: SIM_OPTIONS,
    run: (args) => simGame(pickU(args, ['input', 'seed', 'profile'])),
  },
  'sim batch': {
    options: SIM_OPTIONS,
    run: (args) =>
      simBatch(pickU(args, ['fixture', 'seed-from', 'seed-to', 'samples', 'workers', 'profile'])),
  },
  'sim diagnose': {
    options: DIAGNOSE_OPTIONS,
    run: (args) => simDiagnose(pickU(args, ['fixture', 'samples', 'profile'])),
  },
  'sim season': {
    options: SEASON_OPTIONS,
    run: (args) => simSeason(pickU(args, ['fixture', 'samples', 'profile'])),
  },
  'sim challenge': {
    options: SIM_CHALLENGE_OPTIONS,
    run: (args) =>
      simChallenge(pickU(args, ['lineup', 'seed', 'reruns', 'era', 'profile', 'bracket'])),
  },
  'sim challenge-average': {
    options: SIM_CHALLENGE_AVERAGE_OPTIONS,
    run: (args) =>
      simChallengeAverage(pickU(args, ['lineup', 'seed', 'reruns', 'era', 'profile', 'bracket'])),
  },
  'bracket audit': {
    options: BRACKET_AUDIT_OPTIONS,
    run: (args) =>
      bracketAudit(parseOption(args, 'input', DEFAULT_MANIFEST), hasOption(args, 'verbose')),
  },
  'bracket generate': {
    options: BRACKET_GENERATE_OPTIONS,
    run: (args) =>
      bracketGenerate({
        seed: s(args, 'seed'),
        proposals: s(args, 'proposals'),
        samples: s(args, 'samples'),
        'min-score': s(args, 'min-score'),
        'data-version': s(args, 'data-version'),
        out: s(args, 'out'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  benchmark: {
    options: BENCHMARK_OPTIONS,
    run: (args) =>
      benchmark({
        fixture: s(args, 'fixture'),
        samples: s(args, 'samples'),
        'seed-from': s(args, 'seed-from'),
        'seed-to': s(args, 'seed-to'),
        workers: s(args, 'workers'),
        profile: s(args, 'profile'),
        baseline: s(args, 'baseline'),
        'write-baseline': s(args, 'write-baseline'),
      }),
  },
  'benchmark draft-fit': {
    options: DRAFT_FIT_BENCHMARK_OPTIONS,
    run: (args) =>
      draftFitBenchmark({
        manifest: s(args, 'manifest'),
        seed: s(args, 'seed'),
        samples: s(args, 'samples'),
        games: s(args, 'games'),
        'refine-top': s(args, 'refine-top'),
        era: s(args, 'era'),
        franchise: s(args, 'franchise'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  replay: {
    options: REPLAY_OPTIONS,
    run: (args) =>
      replay({
        input: s(args, 'input'),
        expected: s(args, 'expected'),
      }),
  },
  'calibrate run': {
    options: CALIBRATE_OPTIONS,
    run: (args) =>
      calibrateRun({
        samples: s(args, 'samples'),
        'seed-from': s(args, 'seed-from'),
        workers: s(args, 'workers'),
        profile: s(args, 'profile'),
        era: s(args, 'era'),
        'challenge-samples': s(args, 'challenge-samples'),
        'opponent-games': s(args, 'opponent-games'),
        'allow-skipped': hasOption(args, 'allow-skipped'),
      }),
  },
  'calibrate sensitivity': {
    options: CALIBRATE_OPTIONS,
    run: (args) => calibrateSensitivity(pickU(args, ['samples', 'profile', 'era'])),
  },
  'calibrate ratings': {
    options: CALIBRATE_RATINGS_OPTIONS,
    run: (args) => calibrateRatings(pickU(args, ['samples', 'workers', 'output', 'manifest'])),
  },
  'calibrate three-point': {
    options: CALIBRATE_THREE_POINT_OPTIONS,
    run: (args) =>
      calibrateThreePoint({
        write: hasOption(args, 'write'),
        format: s(args, 'format'),
        manifest: s(args, 'manifest'),
        output: s(args, 'output'),
      }),
  },
  'combine docs': {
    options: COMBINE_DOCS_OPTIONS,
    run: (args) => combineDocs(pickU(args, ['input', 'output', 'exceptions'])),
  },
  'season schedule generate': {
    options: SEASON_SCHEDULE_GENERATE_OPTIONS,
    run: (args) => seasonScheduleGenerate(pick(args, ['out', 'league', 'seed', 'manifest'])),
  },
  'season schedule audit': {
    options: SEASON_SCHEDULE_AUDIT_OPTIONS,
    run: (args) =>
      seasonScheduleAudit({
        schedule: n(args, 'schedule'),
        league: n(args, 'league'),
        manifest: n(args, 'manifest'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'season draft reproduce': {
    options: SEASON_DRAFT_REPRODUCE_OPTIONS,
    run: (args) => seasonDraftReproduce(pick(args, ['input', 'manifest'])),
  },
  'collection pack-audit': {
    options: COLLECTION_PACK_AUDIT_OPTIONS,
    run: (args) => collectionPackAudit(pick(args, ['manifest'])),
  },
  'collection pull-reproduce': {
    options: COLLECTION_PULL_REPRODUCE_OPTIONS,
    run: (args) => collectionPullReproduce(pick(args, ['input', 'manifest'])),
  },
  'collection pack-calibrate': {
    options: COLLECTION_PACK_CALIBRATE_OPTIONS,
    run: (args) =>
      collectionPackCalibrate({
        samples: s(args, 'samples'),
        starterSeeds: s(args, 'starter-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
  'collection game-audit': {
    options: COLLECTION_GAME_AUDIT_OPTIONS,
    run: (args) => collectionGameAudit(pick(args, ['manifest', 'games'])),
  },
  'collection game-reproduce': {
    options: COLLECTION_GAME_REPRODUCE_OPTIONS,
    run: (args) => collectionGameReproduce(pick(args, ['input', 'manifest'])),
  },
  'collection game-calibrate': {
    options: COLLECTION_GAME_CALIBRATE_OPTIONS,
    run: (args) =>
      collectionGameCalibrate({
        workers: s(args, 'workers'),
        calibrationSeeds: s(args, 'calibration-seeds'),
        validationSeeds: s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
  'collection progression-audit': {
    options: COLLECTION_PROGRESSION_AUDIT_OPTIONS,
    run: (args) => collectionProgressionAudit(pick(args, ['manifest', 'player', 'input'])),
  },
  'collection progression-calibrate': {
    options: COLLECTION_PROGRESSION_CALIBRATE_OPTIONS,
    run: (args) =>
      collectionProgressionCalibrate({
        workers: s(args, 'workers'),
        calibrationSeeds: s(args, 'calibration-seeds'),
        validationSeeds: s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
  'season rosters generate': {
    options: SEASON_ROSTERS_GENERATE_OPTIONS,
    run: (args) => seasonRostersGenerate(pick(args, ['seed', 'draft', 'out', 'manifest'])),
  },
  'season rosters audit': {
    options: SEASON_ROSTERS_AUDIT_OPTIONS,
    run: (args) => seasonRostersAudit(pick(args, ['input', 'manifest', 'human-franchises'])),
  },
  'season rosters calibrate': {
    options: SEASON_ROSTERS_CALIBRATE_OPTIONS,
    run: (args) =>
      seasonRostersCalibrate({
        workers: s(args, 'workers'),
        'calibration-seeds': s(args, 'calibration-seeds'),
        'validation-seeds': s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        targets: s(args, 'targets'),
        validate: hasOption(args, 'validate'),
      }),
  },
  'season draft calibrate': {
    options: SEASON_DRAFT_CALIBRATE_OPTIONS,
    run: (args) =>
      seasonDraftCalibrate(
        pickU(args, ['workers', 'calibration-seeds', 'validation-seeds', 'out', 'manifest']),
      ),
  },
  'season game simulate': {
    options: SEASON_GAME_SIMULATE_OPTIONS,
    run: (args) => seasonGameSimulate(pick(args, ['input', 'seed'])),
  },
  'season game calibrate': {
    options: { ...SEASON_GAME_CALIBRATE_OPTIONS, effects: true },
    run: (args) =>
      seasonGameCalibrate(
        pick(args, ['fixture', 'seed-from', 'seed-to', 'workers', 'out', 'manifest', 'effects']),
      ),
  },
  'season block simulate': {
    options: SEASON_BLOCK_SIMULATE_OPTIONS,
    run: (args) => seasonBlockSimulate(pick(args, ['input', 'block', 'manifest', 'profile'])),
  },
  'season block audit': {
    options: SEASON_BLOCK_AUDIT_OPTIONS,
    run: (args) => seasonBlockAudit(pick(args, ['input', 'run', 'manifest', 'profile'])),
  },
  'season full simulate': {
    options: SEASON_FULL_SIMULATE_OPTIONS,
    run: (args) => seasonFullSimulate(pick(args, ['input', 'manifest', 'profile'])),
  },
  'season home-court calibrate': {
    options: SEASON_HOME_COURT_CALIBRATE_OPTIONS,
    run: (args) =>
      seasonHomeCourtCalibrate({
        fixture: n(args, 'fixture'),
        constants: n(args, 'constants'),
        ...seedRange(args),
      }),
  },
  'season effects sensitivity': {
    options: SEASON_EFFECTS_OPTIONS,
    run: (args) => seasonEffectsSensitivity({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  'season effects distribution': {
    options: SEASON_EFFECTS_OPTIONS,
    run: (args) => seasonEffectsDistribution({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  'season effects roles': {
    options: SEASON_EFFECTS_OPTIONS,
    run: (args) => seasonEffectsRoles({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  'season effects calibrate': {
    options: SEASON_EFFECTS_OPTIONS,
    run: (args) => seasonEffectsCalibrate({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  'season health calibrate': {
    options: SEASON_HEALTH_CALIBRATE_OPTIONS,
    run: (args) => seasonHealthCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  'season trade audit': {
    options: SEASON_TRADE_AUDIT_OPTIONS,
    run: (args) => seasonTradeAudit(pick(args, ['input', 'manifest'])),
  },
  'season trade calibrate': {
    options: { ...SEASON_TRADE_CALIBRATE_OPTIONS, write: false },
    run: (args) => seasonTradeCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  'season influence calibrate': {
    options: { ...SEASON_INFLUENCE_CALIBRATE_OPTIONS, write: false },
    run: (args) => seasonInfluenceCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  'season challenges calibrate': {
    options: { ...SEASON_CHALLENGES_CALIBRATE_OPTIONS, write: false },
    run: (args) => seasonChallengesCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  'season evolution calibrate': {
    options: { ...SEASON_EVOLUTION_CALIBRATE_OPTIONS, write: false },
    run: (args) =>
      seasonEvolutionCalibrate(
        pick(args, ['fixture', 'seed-from', 'seed-to', 'out', 'manifest', 'validate']),
      ),
  },
  'season evolution validate': {
    options: SEASON_EVOLUTION_VALIDATE_OPTIONS,
    run: (args) => seasonEvolutionValidate(pick(args, ['out', 'manifest'])),
  },
  'season evolution benchmark': {
    options: SEASON_EVOLUTION_BENCHMARK_OPTIONS,
    run: (args) => seasonEvolutionBenchmark(pick(args, ['fixture', 'manifest'])),
  },
  'season free-agency audit': {
    options: SEASON_FREE_AGENCY_AUDIT_OPTIONS,
    run: (args) => seasonFreeAgencyAudit(pick(args, ['input', 'manifest'])),
  },
  'season free-agency calibrate': {
    options: SEASON_FREE_AGENCY_CALIBRATE_OPTIONS,
    run: (args) => seasonFreeAgencyCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  'season run reproduce': {
    options: SEASON_RUN_REPRODUCE_OPTIONS,
    run: (args) => seasonRunReproduce(pick(args, ['input', 'manifest', 'profile'])),
  },
  'season postseason audit': {
    options: SEASON_POSTSEASON_AUDIT_OPTIONS,
    run: (args) => seasonPostseasonAudit(pick(args, ['input'])),
  },
  'season postseason calibrate': {
    options: SEASON_POSTSEASON_CALIBRATE_OPTIONS,
    run: (args) =>
      seasonPostseasonCalibrate({
        input: n(args, 'input'),
        write: hasOption(args, 'write'),
        ...seedRange(args),
      }),
  },
  'season benchmark block': {
    options: SEASON_BENCHMARK_OPTIONS,
    run: (args) => seasonBenchmarkBlock(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  'season benchmark full': {
    options: SEASON_BENCHMARK_OPTIONS,
    run: (args) => seasonBenchmarkFull(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  'season benchmark determinism': {
    options: SEASON_BENCHMARK_OPTIONS,
    run: (args) => seasonBenchmarkDeterminism(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  'season benchmark persistence': {
    options: SEASON_BENCHMARK_OPTIONS,
    run: (args) => seasonBenchmarkPersistence(pick(args, ['samples', 'out'])),
  },
  'projection base': {
    options: PROJECTION_BASE_OPTIONS,
    run: (args) =>
      projectionBase({
        fixture: n(args, 'fixture'),
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        reference: n(args, 'reference'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection season': {
    options: PROJECTION_SEASON_OPTIONS,
    run: (args) =>
      projectionSeason({
        fixture: n(args, 'fixture'),
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection build': {
    options: PROJECTION_BUILD_OPTIONS,
    run: (args) =>
      projectionBuild({
        manifest: n(args, 'manifest'),
        out: n(args, 'out'),
        write: hasOption(args, 'write'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection calibrate-base': {
    options: PROJECTION_CALIBRATE_OPTIONS,
    run: (args) =>
      projectionCalibrateBase({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        targets: n(args, 'targets'),
        'seed-from': n(args, 'seed-from'),
        'seed-to': n(args, 'seed-to'),
        samples: n(args, 'samples'),
        workers: n(args, 'workers'),
        era: n(args, 'era'),
        out: n(args, 'out'),
        validate: hasOption(args, 'validate'),
        'write-model': hasOption(args, 'write-model'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection validate': {
    options: PROJECTION_CALIBRATE_OPTIONS,
    run: (args) =>
      projectionCalibrateBase({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        targets: n(args, 'targets'),
        'seed-from': n(args, 'seed-from'),
        'seed-to': n(args, 'seed-to'),
        samples: n(args, 'samples'),
        workers: n(args, 'workers'),
        era: n(args, 'era'),
        out: n(args, 'out'),
        validate: true,
        'write-model': false,
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection benchmark': {
    options: PROJECTION_BENCHMARK_OPTIONS,
    run: (args) =>
      projectionBenchmark({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        samples: n(args, 'samples'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'projection ai-shadow': {
    options: PROJECTION_AI_SHADOW_OPTIONS,
    run: (args) =>
      projectionAiShadow({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        seed: n(args, 'seed'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'import ratings': {
    options: IMPORT_RATINGS_OPTIONS,
    run: (args) =>
      importRatings({
        seasons: n(args, 'seasons'),
        forceRatings: hasOption(args, 'force-ratings'),
        overallOnly: hasOption(args, 'overall-only'),
        workers: n(args, 'workers'),
      }),
  },
  'import pools': {
    options: IMPORT_POOLS_OPTIONS,
    run: (args) =>
      importPools({
        pools: n(args, 'pools'),
        all: hasOption(args, 'all'),
        noAssets: hasOption(args, 'no-assets'),
        workers: n(args, 'workers'),
      }),
  },
  'import era-profile': {
    options: IMPORT_ERA_PROFILE_OPTIONS,
    run: (args) => importEraProfile(pick(args, ['era'])),
  },
  'import manifest': {
    options: IMPORT_MANIFEST_OPTIONS,
    run: () => importManifest(),
  },
  'import opponent': {
    options: IMPORT_OPPONENT_OPTIONS,
    run: () => importOpponent(),
  },
  'import freeze': {
    options: IMPORT_FREEZE_OPTIONS,
    run: (args) => importFreeze(pick(args, ['report', 'era'])),
  },
  'import run-all': {
    options: IMPORT_RUN_ALL_OPTIONS,
    run: (args) =>
      importRunAll({
        seasons: n(args, 'seasons'),
        includeSchedule: hasOption(args, 'include-schedule'),
        forceStints: hasOption(args, 'force-stints'),
        forceRatings: hasOption(args, 'force-ratings'),
        workers: n(args, 'workers'),
        skipBbref: hasOption(args, 'skip-bbref'),
        pools: n(args, 'pools'),
      }),
  },
};
function usageError(message: string): CliReport {
  return makeReport(
    'usage',
    { message },
    { failures: [message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
  );
}
async function main(argv: string[]): Promise<{
  report: CliReport;
  format: 'text' | 'json';
}> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    const def = COMMANDS['help'];
    if (def === undefined) {
      return { report: usageError('missing command'), format: 'text' };
    }
    return {
      report: await def.run({ command: [], positional: [], options: new Map() }),
      format: 'text',
    };
  }
  let parsed: ParsedArgs;
  let commandKey: string;
  let def: CommandDef;
  try {
    commandKey = argv.slice(0, 3).join(' ');
    let entry = COMMANDS[commandKey];
    if (!entry) {
      commandKey = argv.slice(0, 2).join(' ');
      entry = COMMANDS[commandKey];
    }
    if (!entry) {
      const candidate = argv[0];
      if (candidate !== undefined && COMMANDS[candidate]) {
        commandKey = candidate;
        entry = COMMANDS[candidate];
      }
    }
    if (!entry) {
      const candidate = argv[0];
      if (candidate === undefined) {
        return { report: usageError('missing command'), format: 'text' };
      }
      return { report: usageError(`unknown command "${candidate}"`), format: 'text' };
    }
    def = entry;
    parsed = parseArgs(argv, def.options);
  } catch (error) {
    if (error instanceof UsageError) {
      return { report: usageError(error.message), format: 'text' };
    }
    throw error;
  }
  const format = getOptionString(parsed, 'format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    return {
      report: usageError(`--format must be text or json (got "${format}")`),
      format: 'text',
    };
  }
  if (parsed.positional.length > 0) {
    return {
      report: usageError(`unexpected positional arguments: ${parsed.positional.join(' ')}`),
      format: 'text',
    };
  }
  try {
    const report = await def.run(parsed);
    return { report, format };
  } catch (error) {
    if (error instanceof UsageError) {
      return { report: usageError(error.message), format: 'text' };
    }
    throw error;
  }
}
const { report, format } = await main(process.argv.slice(2));
const output = format === 'json' ? renderJson(report) : renderText(report);
if (report.exitCode === EXIT_OK) {
  process.stdout.write(`${output}\n`);
} else {
  process.stderr.write(`${output}\n`);
}
process.exitCode = report.exitCode;
