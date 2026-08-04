import { parseArgs, UsageError, getOptionString, hasOption } from './args.js';
import { dataValidate, DATA_VALIDATE_OPTIONS, DEFAULT_MANIFEST } from './commands/data-validate.js';
import { dataOveralls, DATA_OVERALLS_OPTIONS } from './commands/data-overalls.js';
import { dataCoverage, DATA_COVERAGE_OPTIONS } from './commands/data-coverage.js';
import { dataLineageAudit, DATA_LINEAGE_AUDIT_OPTIONS } from './commands/data-lineage-audit.js';
import { dataDerive, DATA_DERIVE_OPTIONS } from './commands/data-derive.js';
import { helpCommand } from './commands/help.js';
import { simGame, simBatch, SIM_OPTIONS, UsageError as SimUsageError } from './commands/sim.js';
import { simDiagnose, simSeason, DIAGNOSE_OPTIONS, SEASON_OPTIONS } from './commands/diagnose.js';
import { simChallenge, SIM_CHALLENGE_OPTIONS } from './commands/challenge.js';
import { bracketAudit, BRACKET_AUDIT_OPTIONS } from './commands/bracket-audit.js';
import { bracketGenerate, BRACKET_GENERATE_OPTIONS } from './commands/bracket-generate.js';
import { benchmark, BENCHMARK_OPTIONS } from './commands/benchmark.js';
import { replay, REPLAY_OPTIONS } from './commands/replay.js';
import { combineDocs, COMBINE_DOCS_OPTIONS } from './commands/docs-combine.js';
import {
  seasonScheduleAudit,
  seasonScheduleGenerate,
  SEASON_SCHEDULE_AUDIT_OPTIONS,
  SEASON_SCHEDULE_GENERATE_OPTIONS,
} from './commands/season-schedule.js';
import { calibrateRun, calibrateSensitivity, CALIBRATE_OPTIONS } from './commands/calibrate.js';
import { calibrateRatings, CALIBRATE_RATINGS_OPTIONS } from './commands/calibrate-ratings.js';
import {
  importEraProfile,
  importFreeze,
  importManifest,
  importOpponent,
  importPools,
  importRatings,
  importRunAll,
  IMPORT_ERA_PROFILE_OPTIONS,
  IMPORT_FREEZE_OPTIONS,
  IMPORT_MANIFEST_OPTIONS,
  IMPORT_OPPONENT_OPTIONS,
  IMPORT_POOLS_OPTIONS,
  IMPORT_RATINGS_OPTIONS,
  IMPORT_RUN_ALL_OPTIONS,
} from './commands/import.js';
import {
  makeReport,
  renderJson,
  renderText,
  EXIT_OK,
  EXIT_USAGE_OR_DATA_ERROR,
  type CliReport,
} from './report.js';

interface CommandDef {
  options: Record<string, boolean>;
  run: (args: ReturnType<typeof parseArgs>) => CliReport | Promise<CliReport>;
}

const COMMANDS: Record<string, CommandDef> = {
  help: {
    options: {},
    run: () => Promise.resolve(helpCommand()),
  },
  'data validate': {
    options: DATA_VALIDATE_OPTIONS,
    run: (args) => {
      const input = getOptionString(args, 'input') ?? DEFAULT_MANIFEST;
      return dataValidate(input, hasOption(args, 'verbose'));
    },
  },
  'data overalls': {
    options: DATA_OVERALLS_OPTIONS,
    run: (args) =>
      dataOveralls({
        input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
        franchise: getOptionString(args, 'franchise') ?? undefined,
        era: getOptionString(args, 'era') ?? undefined,
        player: getOptionString(args, 'player') ?? undefined,
        limit: getOptionString(args, 'limit') ?? undefined,
      }),
  },
  'data coverage': {
    options: DATA_COVERAGE_OPTIONS,
    run: (args) =>
      dataCoverage({
        input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
        franchise: getOptionString(args, 'franchise') ?? undefined,
        era: getOptionString(args, 'era') ?? undefined,
        status: getOptionString(args, 'status') ?? undefined,
      }),
  },
  'data lineage-audit': {
    options: DATA_LINEAGE_AUDIT_OPTIONS,
    run: (args) =>
      dataLineageAudit({
        input: getOptionString(args, 'input') ?? DEFAULT_MANIFEST,
        verifyLogos: hasOption(args, 'verify-logos'),
      }),
  },
  'data derive': {
    options: DATA_DERIVE_OPTIONS,
    run: (args) =>
      dataDerive({
        player: getOptionString(args, 'player') ?? undefined,
        season: getOptionString(args, 'season') ?? undefined,
        franchise: getOptionString(args, 'franchise') ?? undefined,
      }),
  },
  'sim game': {
    options: SIM_OPTIONS,
    run: (args) =>
      simGame({
        input: getOptionString(args, 'input') ?? undefined,
        seed: getOptionString(args, 'seed') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
      }),
  },
  'sim batch': {
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
  },
  'sim diagnose': {
    options: DIAGNOSE_OPTIONS,
    run: (args) =>
      simDiagnose({
        fixture: getOptionString(args, 'fixture') ?? undefined,
        samples: getOptionString(args, 'samples') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
      }),
  },
  'sim season': {
    options: SEASON_OPTIONS,
    run: (args) =>
      simSeason({
        fixture: getOptionString(args, 'fixture') ?? undefined,
        samples: getOptionString(args, 'samples') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
      }),
  },
  'sim challenge': {
    options: SIM_CHALLENGE_OPTIONS,
    run: (args) =>
      simChallenge({
        lineup: getOptionString(args, 'lineup') ?? undefined,
        seed: getOptionString(args, 'seed') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
        bracket: getOptionString(args, 'bracket') ?? undefined,
      }),
  },
  'bracket audit': {
    options: BRACKET_AUDIT_OPTIONS,
    run: (args) =>
      bracketAudit(getOptionString(args, 'input') ?? DEFAULT_MANIFEST, hasOption(args, 'verbose')),
  },
  'bracket generate': {
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
  },
  benchmark: {
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
  },
  replay: {
    options: REPLAY_OPTIONS,
    run: (args) =>
      replay({
        input: getOptionString(args, 'input') ?? undefined,
        expected: getOptionString(args, 'expected') ?? undefined,
      }),
  },
  'calibrate run': {
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
  },
  'calibrate sensitivity': {
    options: CALIBRATE_OPTIONS,
    run: (args) =>
      calibrateSensitivity({
        samples: getOptionString(args, 'samples') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
        era: getOptionString(args, 'era') ?? undefined,
      }),
  },
  'calibrate ratings': {
    options: CALIBRATE_RATINGS_OPTIONS,
    run: (args) =>
      calibrateRatings({
        samples: getOptionString(args, 'samples') ?? undefined,
        workers: getOptionString(args, 'workers') ?? undefined,
        output: getOptionString(args, 'output') ?? undefined,
        manifest: getOptionString(args, 'manifest') ?? undefined,
      }),
  },
  'combine docs': {
    options: COMBINE_DOCS_OPTIONS,
    run: (args) =>
      combineDocs({
        input: getOptionString(args, 'input') ?? undefined,
        output: getOptionString(args, 'output') ?? undefined,
        exceptions: getOptionString(args, 'exceptions') ?? undefined,
      }),
  },
  'season schedule generate': {
    options: SEASON_SCHEDULE_GENERATE_OPTIONS,
    run: (args) =>
      seasonScheduleGenerate({
        out: getOptionString(args, 'out'),
        league: getOptionString(args, 'league'),
        seed: getOptionString(args, 'seed'),
      }),
  },
  'season schedule audit': {
    options: SEASON_SCHEDULE_AUDIT_OPTIONS,
    run: (args) =>
      seasonScheduleAudit({
        schedule: getOptionString(args, 'schedule'),
        league: getOptionString(args, 'league'),
        manifest: getOptionString(args, 'manifest'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  'import ratings': {
    options: IMPORT_RATINGS_OPTIONS,
    run: (args) =>
      importRatings({
        seasons: getOptionString(args, 'seasons'),
        forceRatings: hasOption(args, 'force-ratings'),
        workers: getOptionString(args, 'workers'),
      }),
  },
  'import pools': {
    options: IMPORT_POOLS_OPTIONS,
    run: (args) =>
      importPools({
        pools: getOptionString(args, 'pools'),
        all: hasOption(args, 'all'),
        noAssets: hasOption(args, 'no-assets'),
        workers: getOptionString(args, 'workers'),
      }),
  },
  'import era-profile': {
    options: IMPORT_ERA_PROFILE_OPTIONS,
    run: (args) => importEraProfile({ era: getOptionString(args, 'era') }),
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
    run: (args) =>
      importFreeze({
        report: getOptionString(args, 'report'),
        era: getOptionString(args, 'era'),
      }),
  },
  'import run-all': {
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
  },
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
    return { report: helpCommand(), format: 'text' };
  }

  let parsed: ReturnType<typeof parseArgs>;
  let commandKey: string;
  try {
    // Resolve the command: three-word and two-word commands first, then
    // single-word commands when the next token is an option or the first
    // word alone is registered.
    commandKey = argv.slice(0, 3).join(' ');
    let def = COMMANDS[commandKey];
    if (!def) {
      commandKey = argv.slice(0, 2).join(' ');
      def = COMMANDS[commandKey];
    }
    if (!def) {
      const candidate = argv[0];
      if (candidate !== undefined && COMMANDS[candidate]) {
        commandKey = candidate;
        def = COMMANDS[candidate];
      }
    }
    if (!def) {
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
    parsed = parseArgs(argv, def.options);
  } catch (error) {
    if (error instanceof UsageError || error instanceof SimUsageError) {
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

  const def = COMMANDS[commandKey];
  if (def === undefined) {
    return { report: usageError(`unknown command "${commandKey}"`), format: 'text' };
  }
  try {
    const report = await def.run(parsed);
    return { report, format };
  } catch (error) {
    if (error instanceof UsageError || error instanceof SimUsageError) {
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
