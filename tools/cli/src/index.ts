import { getOptionString, parseArgs, UsageError, type ParsedArgs } from './args.ts';
import { EXIT_OK, renderJson, renderText, type CliReport } from './report.ts';
import {
  COMMANDS,
  declaredOptions,
  makeCommandArgs,
  usageError,
  type CommandSpec,
} from './registry/index.ts';

function resolveCommand(argv: readonly string[]): CommandSpec | null {
  for (const length of [3, 2, 1]) {
    const key = argv.slice(0, length).join(' ');
    const match = COMMANDS.find((command) => command.name === key);
    if (match !== undefined) return match;
  }
  return null;
}

function helpDef(): CommandSpec {
  const def = COMMANDS.find((command) => command.name === 'help');
  if (def === undefined) throw new Error('the help command is missing from the registry');
  return def;
}

async function main(argv: string[]): Promise<{
  report: CliReport;
  format: 'text' | 'json';
}> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    const def = helpDef();
    const parsed: ParsedArgs = { command: [], positional: [], options: new Map() };
    return { report: await def.run(makeCommandArgs(parsed)), format: 'text' };
  }
  let parsed: ParsedArgs;
  let spec: CommandSpec;
  try {
    const resolved = resolveCommand(argv);
    if (resolved === null) {
      const candidate = argv[0];
      if (candidate === undefined) {
        return { report: usageError('missing command'), format: 'text' };
      }
      return { report: usageError(`unknown command "${candidate}"`), format: 'text' };
    }
    spec = resolved;
    parsed = parseArgs(argv, declaredOptions(spec));
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
  const positionalLimit = spec.maxPositionals ?? 0;
  if (parsed.positional.length > positionalLimit) {
    return {
      report: usageError(`unexpected positional arguments: ${parsed.positional.join(' ')}`),
      format: 'text',
    };
  }
  try {
    const report = await spec.run(makeCommandArgs(parsed));
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
