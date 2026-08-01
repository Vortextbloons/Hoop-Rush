import { parseArgs, UsageError, getOptionString, hasOption } from './args.js';
import { dataValidate, DATA_VALIDATE_OPTIONS, DEFAULT_MANIFEST } from './commands/data-validate.js';
import { dataOveralls, DATA_OVERALLS_OPTIONS } from './commands/data-overalls.js';
import { helpCommand } from './commands/help.js';
import { simGame, simBatch, SIM_OPTIONS, UsageError as SimUsageError } from './commands/sim.js';
import { replay, REPLAY_OPTIONS } from './commands/replay.js';
import { calibrateRun, calibrateSensitivity, CALIBRATE_OPTIONS } from './commands/calibrate.js';
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
      }),
  },
  'calibrate sensitivity': {
    options: CALIBRATE_OPTIONS,
    run: (args) =>
      calibrateSensitivity({
        samples: getOptionString(args, 'samples') ?? undefined,
        profile: getOptionString(args, 'profile') ?? undefined,
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
    // Resolve the command: two-word commands (sim game, data validate, ...)
    // first, then single-word commands (replay, help) when the next token is
    // an option or the first word alone is registered.
    commandKey = argv.slice(0, 2).join(' ');
    let def = COMMANDS[commandKey];
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
