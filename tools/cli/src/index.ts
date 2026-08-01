import { parseArgs, UsageError, getOptionString, hasOption } from './args.js';
import { dataValidate, DATA_VALIDATE_OPTIONS, DEFAULT_MANIFEST } from './commands/data-validate.js';
import { helpCommand } from './commands/help.js';
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
  run: (args: ReturnType<typeof parseArgs>) => Promise<CliReport>;
}

const COMMANDS: Record<string, CommandDef> = {
  help: {
    options: {},
    run: () => Promise.resolve(helpCommand()),
  },
  'data validate': {
    options: DATA_VALIDATE_OPTIONS,
    run: async (args) => {
      const input = getOptionString(args, 'input') ?? DEFAULT_MANIFEST;
      return dataValidate(input, hasOption(args, 'verbose'));
    },
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
    commandKey = argv.slice(0, 2).join(' ');
    const def = COMMANDS[commandKey];
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

  const def = COMMANDS[commandKey];
  if (def === undefined) {
    return { report: usageError(`unknown command "${commandKey}"`), format: 'text' };
  }
  const report = await def.run(parsed);
  return { report, format };
}

const { report, format } = await main(process.argv.slice(2));
const output = format === 'json' ? renderJson(report) : renderText(report);
if (report.exitCode === EXIT_OK) {
  process.stdout.write(`${output}\n`);
} else {
  process.stderr.write(`${output}\n`);
}
process.exitCode = report.exitCode;
