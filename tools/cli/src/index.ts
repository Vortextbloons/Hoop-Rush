import { parseArgs, UsageError, getOptionString, hasOption } from './args.ts';
import {
  makeReport,
  renderJson,
  renderText,
  EXIT_OK,
  EXIT_USAGE_OR_DATA_ERROR,
  type CliReport,
} from './report.ts';

type ParsedArgs = ReturnType<typeof parseArgs>;

interface CommandDef {
  options: Record<string, boolean>;
  run: (args: ParsedArgs) => CliReport | Promise<CliReport>;
}

interface CommandEntry {
  load: () => Promise<CommandDef>;
}

/** Registers a command whose module (and its import graph) loads on demand. */
function command(load: CommandEntry['load']): CommandEntry {
  return { load };
}

const COMMANDS: Record<string, CommandEntry> = {
  help: command(async () => {
    const { helpCommand } = await import('./commands/help.ts');
    return { options: {}, run: () => helpCommand() };
  }),
  'data validate': command(async () => {
    const { dataValidate, DATA_VALIDATE_OPTIONS } = await import('./commands/data-validate.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_VALIDATE_OPTIONS,
      run: (args) => {
        const input = getOptionString(args, 'input') ?? DEFAULT_MANIFEST;
        return dataValidate(input, hasOption(args, 'verbose'));
      },
    };
  }),
  'data overalls': command(async () => {
    const { dataOveralls, DATA_OVERALLS_OPTIONS } = await import('./commands/data-overalls.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_OVERALLS_OPTIONS,
      run: (args) =>
        dataOveralls({
          input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
          franchise: getOptionString(args, 'franchise') ?? undefined,
          era: getOptionString(args, 'era') ?? undefined,
          player: getOptionString(args, 'player') ?? undefined,
          limit: getOptionString(args, 'limit') ?? undefined,
        }),
    };
  }),
  'data overalls-distribution': command(async () => {
    const { dataOverallsDistribution, DATA_OVERALLS_DISTRIBUTION_OPTIONS } =
      await import('./commands/data-overalls-distribution.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_OVERALLS_DISTRIBUTION_OPTIONS,
      run: (args) =>
        dataOverallsDistribution({ input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST }),
    };
  }),
  'data defense-bpm-correlation': command(async () => {
    const { defenseBpmCorrelation, DATA_DEFENSE_BPM_CORRELATION_OPTIONS } =
      await import('./commands/data-defense-bpm-correlation.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_DEFENSE_BPM_CORRELATION_OPTIONS,
      run: (args) =>
        defenseBpmCorrelation({ input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST }),
    };
  }),
  'data coverage': command(async () => {
    const { dataCoverage, DATA_COVERAGE_OPTIONS } = await import('./commands/data-coverage.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_COVERAGE_OPTIONS,
      run: (args) =>
        dataCoverage({
          input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
          franchise: getOptionString(args, 'franchise') ?? undefined,
          era: getOptionString(args, 'era') ?? undefined,
          status: getOptionString(args, 'status') ?? undefined,
        }),
    };
  }),
  'data lineage-audit': command(async () => {
    const { dataLineageAudit, DATA_LINEAGE_AUDIT_OPTIONS } =
      await import('./commands/data-lineage-audit.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: DATA_LINEAGE_AUDIT_OPTIONS,
      run: (args) =>
        dataLineageAudit({
          input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
          verifyLogos: hasOption(args, 'verify-logos'),
        }),
    };
  }),
  'data derive': command(async () => {
    const { dataDerive, DATA_DERIVE_OPTIONS } = await import('./commands/data-derive.ts');
    return {
      options: DATA_DERIVE_OPTIONS,
      run: (args) =>
        dataDerive({
          player: getOptionString(args, 'player') ?? undefined,
          season: getOptionString(args, 'season') ?? undefined,
          franchise: getOptionString(args, 'franchise') ?? undefined,
        }),
    };
  }),
  'sim game': command(async () => {
    const { simGame, SIM_OPTIONS } = await import('./commands/sim.ts');
    return {
      options: SIM_OPTIONS,
      run: (args) =>
        simGame({
          input: getOptionString(args, 'input') ?? undefined,
          seed: getOptionString(args, 'seed') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
        }),
    };
  }),
  'sim batch': command(async () => {
    const { simBatch, SIM_OPTIONS } = await import('./commands/sim.ts');
    return {
      options: SIM_OPTIONS,
      run: (args) =>
        simBatch({
          fixture: getOptionString(args, 'fixture') ?? undefined,
          'seed-from': getOptionString(args, 'seed-from') ?? undefined,
          'seed-to': getOptionString(args, 'seed-to') ?? undefined,
          samples: getOptionString(args, 'samples') ?? undefined,
          workers: getOptionString(args, 'workers') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
        }),
    };
  }),
  'sim diagnose': command(async () => {
    const { simDiagnose, DIAGNOSE_OPTIONS } = await import('./commands/diagnose.ts');
    return {
      options: DIAGNOSE_OPTIONS,
      run: (args) =>
        simDiagnose({
          fixture: getOptionString(args, 'fixture') ?? undefined,
          samples: getOptionString(args, 'samples') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
        }),
    };
  }),
  'sim season': command(async () => {
    const { simSeason, SEASON_OPTIONS } = await import('./commands/diagnose.ts');
    return {
      options: SEASON_OPTIONS,
      run: (args) =>
        simSeason({
          fixture: getOptionString(args, 'fixture') ?? undefined,
          samples: getOptionString(args, 'samples') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
        }),
    };
  }),
  'sim challenge': command(async () => {
    const { simChallenge, SIM_CHALLENGE_OPTIONS } = await import('./commands/challenge.ts');
    return {
      options: SIM_CHALLENGE_OPTIONS,
      run: (args) =>
        simChallenge({
          lineup: getOptionString(args, 'lineup') ?? undefined,
          seed: getOptionString(args, 'seed') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
          bracket: getOptionString(args, 'bracket') ?? undefined,
        }),
    };
  }),
  'bracket audit': command(async () => {
    const { bracketAudit, BRACKET_AUDIT_OPTIONS } = await import('./commands/bracket-audit.ts');
    const { DEFAULT_MANIFEST } = await import('./commands/data-loader.ts');
    return {
      options: BRACKET_AUDIT_OPTIONS,
      run: (args) =>
        bracketAudit(
          getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
          hasOption(args, 'verbose'),
        ),
    };
  }),
  'bracket generate': command(async () => {
    const { bracketGenerate, BRACKET_GENERATE_OPTIONS } =
      await import('./commands/bracket-generate.ts');
    return {
      options: BRACKET_GENERATE_OPTIONS,
      run: (args) =>
        bracketGenerate({
          seed: getOptionString(args, 'seed') ?? undefined,
          proposals: getOptionString(args, 'proposals') ?? undefined,
          samples: getOptionString(args, 'samples') ?? undefined,
          'min-score': getOptionString(args, 'min-score') ?? undefined,
          'data-version': getOptionString(args, 'data-version') ?? undefined,
          verbose: hasOption(args, 'verbose'),
        }),
    };
  }),
  benchmark: command(async () => {
    const { benchmark, BENCHMARK_OPTIONS } = await import('./commands/benchmark.ts');
    return {
      options: BENCHMARK_OPTIONS,
      run: (args) =>
        benchmark({
          fixture: getOptionString(args, 'fixture') ?? undefined,
          samples: getOptionString(args, 'samples') ?? undefined,
          'seed-from': getOptionString(args, 'seed-from') ?? undefined,
          'seed-to': getOptionString(args, 'seed-to') ?? undefined,
          workers: getOptionString(args, 'workers') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
          baseline: getOptionString(args, 'baseline') ?? undefined,
          'write-baseline': getOptionString(args, 'write-baseline') ?? undefined,
        }),
    };
  }),
  replay: command(async () => {
    const { replay, REPLAY_OPTIONS } = await import('./commands/replay.ts');
    return {
      options: REPLAY_OPTIONS,
      run: (args) =>
        replay({
          input: getOptionString(args, 'input') ?? undefined,
          expected: getOptionString(args, 'expected') ?? undefined,
        }),
    };
  }),
  'calibrate run': command(async () => {
    const { calibrateRun, CALIBRATE_OPTIONS } = await import('./commands/calibrate.ts');
    return {
      options: CALIBRATE_OPTIONS,
      run: (args) =>
        calibrateRun({
          samples: getOptionString(args, 'samples') ?? undefined,
          'seed-from': getOptionString(args, 'seed-from') ?? undefined,
          workers: getOptionString(args, 'workers') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
          era: getOptionString(args, 'era') ?? undefined,
          'challenge-samples': getOptionString(args, 'challenge-samples') ?? undefined,
          'opponent-games': getOptionString(args, 'opponent-games') ?? undefined,
          'allow-skipped': hasOption(args, 'allow-skipped'),
        }),
    };
  }),
  'calibrate sensitivity': command(async () => {
    const { calibrateSensitivity, CALIBRATE_OPTIONS } = await import('./commands/calibrate.ts');
    return {
      options: CALIBRATE_OPTIONS,
      run: (args) =>
        calibrateSensitivity({
          samples: getOptionString(args, 'samples') ?? undefined,
          profile: getOptionString(args, 'profile') ?? undefined,
          era: getOptionString(args, 'era') ?? undefined,
        }),
    };
  }),
  'calibrate ratings': command(async () => {
    const { calibrateRatings, CALIBRATE_RATINGS_OPTIONS } =
      await import('./commands/calibrate-ratings.ts');
    return {
      options: CALIBRATE_RATINGS_OPTIONS,
      run: (args) =>
        calibrateRatings({
          samples: getOptionString(args, 'samples') ?? undefined,
          workers: getOptionString(args, 'workers') ?? undefined,
          output: getOptionString(args, 'output') ?? undefined,
          manifest: getOptionString(args, 'manifest') ?? undefined,
        }),
    };
  }),
  'combine docs': command(async () => {
    const { combineDocs, COMBINE_DOCS_OPTIONS } = await import('./commands/docs-combine.ts');
    return {
      options: COMBINE_DOCS_OPTIONS,
      run: (args) =>
        combineDocs({
          input: getOptionString(args, 'input') ?? undefined,
          output: getOptionString(args, 'output') ?? undefined,
          exceptions: getOptionString(args, 'exceptions') ?? undefined,
        }),
    };
  }),
  'season schedule generate': command(async () => {
    const { seasonScheduleGenerate, SEASON_SCHEDULE_GENERATE_OPTIONS } =
      await import('./commands/season-schedule.ts');
    return {
      options: SEASON_SCHEDULE_GENERATE_OPTIONS,
      run: (args) =>
        seasonScheduleGenerate({
          out: getOptionString(args, 'out'),
          league: getOptionString(args, 'league'),
          seed: getOptionString(args, 'seed'),
        }),
    };
  }),
  'season schedule audit': command(async () => {
    const { seasonScheduleAudit, SEASON_SCHEDULE_AUDIT_OPTIONS } =
      await import('./commands/season-schedule.ts');
    return {
      options: SEASON_SCHEDULE_AUDIT_OPTIONS,
      run: (args) =>
        seasonScheduleAudit({
          schedule: getOptionString(args, 'schedule'),
          league: getOptionString(args, 'league'),
          manifest: getOptionString(args, 'manifest'),
          verbose: hasOption(args, 'verbose'),
        }),
    };
  }),
  'season draft reproduce': command(async () => {
    const { seasonDraftReproduce, SEASON_DRAFT_REPRODUCE_OPTIONS } =
      await import('./commands/season-draft.ts');
    return {
      options: SEASON_DRAFT_REPRODUCE_OPTIONS,
      run: (args) =>
        seasonDraftReproduce({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest'),
        }),
    };
  }),
  'season rosters generate': command(async () => {
    const { seasonRostersGenerate, SEASON_ROSTERS_GENERATE_OPTIONS } =
      await import('./commands/season-rosters.ts');
    return {
      options: SEASON_ROSTERS_GENERATE_OPTIONS,
      run: (args) =>
        seasonRostersGenerate({
          seed: getOptionString(args, 'seed') ?? null,
          draft: getOptionString(args, 'draft') ?? null,
          out: getOptionString(args, 'out'),
          manifest: getOptionString(args, 'manifest'),
        }),
    };
  }),
  'season rosters audit': command(async () => {
    const { seasonRostersAudit, SEASON_ROSTERS_AUDIT_OPTIONS } =
      await import('./commands/season-rosters.ts');
    return {
      options: SEASON_ROSTERS_AUDIT_OPTIONS,
      run: (args) =>
        seasonRostersAudit({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          'human-franchises': getOptionString(args, 'human-franchises') ?? null,
        }),
    };
  }),
  'season rosters calibrate': command(async () => {
    const { seasonRostersCalibrate, SEASON_ROSTERS_CALIBRATE_OPTIONS } =
      await import('./commands/season-rosters.ts');
    return {
      options: SEASON_ROSTERS_CALIBRATE_OPTIONS,
      run: (args) =>
        seasonRostersCalibrate({
          workers: getOptionString(args, 'workers') ?? undefined,
          'calibration-seeds': getOptionString(args, 'calibration-seeds') ?? undefined,
          'validation-seeds': getOptionString(args, 'validation-seeds') ?? undefined,
          out: getOptionString(args, 'out') ?? undefined,
          manifest: getOptionString(args, 'manifest') ?? undefined,
        }),
    };
  }),
  'season game simulate': command(async () => {
    const { seasonGameSimulate, SEASON_GAME_SIMULATE_OPTIONS } =
      await import('./commands/season-game.ts');
    return {
      options: SEASON_GAME_SIMULATE_OPTIONS,
      run: (args) =>
        seasonGameSimulate({
          input: getOptionString(args, 'input') ?? null,
          seed: getOptionString(args, 'seed') ?? null,
        }),
    };
  }),
  'season game calibrate': command(async () => {
    const { seasonGameCalibrate, SEASON_GAME_CALIBRATE_OPTIONS } =
      await import('./commands/season-game.ts');
    return {
      options: SEASON_GAME_CALIBRATE_OPTIONS,
      run: (args) =>
        seasonGameCalibrate({
          fixture: getOptionString(args, 'fixture') ?? null,
          'seed-from': getOptionString(args, 'seed-from') ?? null,
          'seed-to': getOptionString(args, 'seed-to') ?? null,
          workers: getOptionString(args, 'workers') ?? null,
          out: getOptionString(args, 'out') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
        }),
    };
  }),
  'season block simulate': command(async () => {
    const { seasonBlockSimulate, SEASON_BLOCK_SIMULATE_OPTIONS } =
      await import('./commands/season-block.ts');
    return {
      options: SEASON_BLOCK_SIMULATE_OPTIONS,
      run: (args) =>
        seasonBlockSimulate({
          input: getOptionString(args, 'input') ?? null,
          block: getOptionString(args, 'block') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
        }),
    };
  }),
  'season block audit': command(async () => {
    const { seasonBlockAudit, SEASON_BLOCK_AUDIT_OPTIONS } =
      await import('./commands/season-block.ts');
    return {
      options: SEASON_BLOCK_AUDIT_OPTIONS,
      run: (args) =>
        seasonBlockAudit({
          input: getOptionString(args, 'input') ?? null,
          run: getOptionString(args, 'run') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
        }),
    };
  }),
  'season full simulate': command(async () => {
    const { seasonFullSimulate, SEASON_FULL_SIMULATE_OPTIONS } =
      await import('./commands/season-block.ts');
    return {
      options: SEASON_FULL_SIMULATE_OPTIONS,
      run: (args) =>
        seasonFullSimulate({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
        }),
    };
  }),
  'season home-court calibrate': command(async () => {
    const { seasonHomeCourtCalibrate, SEASON_HOME_COURT_CALIBRATE_OPTIONS } =
      await import('./commands/season-home-court.ts');
    return {
      options: SEASON_HOME_COURT_CALIBRATE_OPTIONS,
      run: (args) =>
        seasonHomeCourtCalibrate({
          fixture: getOptionString(args, 'fixture') ?? null,
          'seed-from': getOptionString(args, 'seed-from') ?? null,
          'seed-to': getOptionString(args, 'seed-to') ?? null,
          workers: getOptionString(args, 'workers') ?? null,
          constants: getOptionString(args, 'constants') ?? null,
          out: getOptionString(args, 'out') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          validate: getOptionString(args, 'validate') ?? null,
        }),
    };
  }),
  'season benchmark block': command(async () => {
    const { seasonBenchmarkBlock, SEASON_BENCHMARK_OPTIONS } =
      await import('./commands/season-benchmark.ts');
    return {
      options: SEASON_BENCHMARK_OPTIONS,
      run: (args) =>
        seasonBenchmarkBlock({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
          out: getOptionString(args, 'out') ?? null,
        }),
    };
  }),
  'season benchmark full': command(async () => {
    const { seasonBenchmarkFull, SEASON_BENCHMARK_OPTIONS } =
      await import('./commands/season-benchmark.ts');
    return {
      options: SEASON_BENCHMARK_OPTIONS,
      run: (args) =>
        seasonBenchmarkFull({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
          out: getOptionString(args, 'out') ?? null,
        }),
    };
  }),
  'season benchmark determinism': command(async () => {
    const { seasonBenchmarkDeterminism, SEASON_BENCHMARK_OPTIONS } =
      await import('./commands/season-benchmark.ts');
    return {
      options: SEASON_BENCHMARK_OPTIONS,
      run: (args) =>
        seasonBenchmarkDeterminism({
          input: getOptionString(args, 'input') ?? null,
          manifest: getOptionString(args, 'manifest') ?? null,
          profile: getOptionString(args, 'profile') ?? null,
          out: getOptionString(args, 'out') ?? null,
        }),
    };
  }),
  'season benchmark persistence': command(async () => {
    const { seasonBenchmarkPersistence, SEASON_BENCHMARK_OPTIONS } =
      await import('./commands/season-benchmark.ts');
    return {
      options: SEASON_BENCHMARK_OPTIONS,
      run: (args) =>
        seasonBenchmarkPersistence({
          samples: getOptionString(args, 'samples') ?? null,
          out: getOptionString(args, 'out') ?? null,
        }),
    };
  }),
  'import ratings': command(async () => {
    const { importRatings, IMPORT_RATINGS_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_RATINGS_OPTIONS,
      run: (args) =>
        importRatings({
          seasons: getOptionString(args, 'seasons'),
          forceRatings: hasOption(args, 'force-ratings'),
          workers: getOptionString(args, 'workers'),
        }),
    };
  }),
  'import pools': command(async () => {
    const { importPools, IMPORT_POOLS_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_POOLS_OPTIONS,
      run: (args) =>
        importPools({
          pools: getOptionString(args, 'pools'),
          all: hasOption(args, 'all'),
          noAssets: hasOption(args, 'no-assets'),
          workers: getOptionString(args, 'workers'),
        }),
    };
  }),
  'import era-profile': command(async () => {
    const { importEraProfile, IMPORT_ERA_PROFILE_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_ERA_PROFILE_OPTIONS,
      run: (args) => importEraProfile({ era: getOptionString(args, 'era') }),
    };
  }),
  'import manifest': command(async () => {
    const { importManifest, IMPORT_MANIFEST_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_MANIFEST_OPTIONS,
      run: () => importManifest(),
    };
  }),
  'import opponent': command(async () => {
    const { importOpponent, IMPORT_OPPONENT_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_OPPONENT_OPTIONS,
      run: () => importOpponent(),
    };
  }),
  'import freeze': command(async () => {
    const { importFreeze, IMPORT_FREEZE_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_FREEZE_OPTIONS,
      run: (args) =>
        importFreeze({
          report: getOptionString(args, 'report'),
          era: getOptionString(args, 'era'),
        }),
    };
  }),
  'import run-all': command(async () => {
    const { importRunAll, IMPORT_RUN_ALL_OPTIONS } = await import('./commands/import.ts');
    return {
      options: IMPORT_RUN_ALL_OPTIONS,
      run: (args) =>
        importRunAll({
          seasons: getOptionString(args, 'seasons'),
          includeSchedule: hasOption(args, 'include-schedule'),
          forceStints: hasOption(args, 'force-stints'),
          forceRatings: hasOption(args, 'force-ratings'),
          workers: getOptionString(args, 'workers'),
          skipBbref: hasOption(args, 'skip-bbref'),
          pools: getOptionString(args, 'pools'),
        }),
    };
  }),
};

function usageError(message: string): CliReport {
  return makeReport(
    'usage',
    { message },
    { failures: [message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
  );
}

async function main(argv: string[]): Promise<{ report: CliReport; format: 'text' | 'json' }> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    const help = COMMANDS['help'];
    if (help === undefined) {
      return { report: usageError('missing command'), format: 'text' };
    }
    const def = await help.load();
    return {
      report: await def.run({ command: [], positional: [], options: new Map() }),
      format: 'text',
    };
  }

  let parsed: ParsedArgs;
  let commandKey: string;
  let def: CommandDef;
  try {
    // Resolve the command: three-word and two-word commands first, then
    // single-word commands when the next token is an option or the first
    // word alone is registered.
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
      if (COMMANDS[candidate]) {
        return {
          report: usageError(`unknown command "${commandKey}" (did you mean "${candidate}"?)`),
          format: 'text',
        };
      }
      return { report: usageError(`unknown command "${candidate}"`), format: 'text' };
    }
    def = await entry.load();
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
