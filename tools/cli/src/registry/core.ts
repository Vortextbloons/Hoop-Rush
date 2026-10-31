import { getOptionString, type ParsedArgs } from '../args.ts';
import { listFixtureIds } from '../commands/sim.ts';
import { EXIT_USAGE_OR_DATA_ERROR, makeReport, type CliReport } from '../report.ts';

export type OptionKind = 'string' | 'flag';

export interface CommandSpec {
  name: string;
  options: Record<string, OptionKind>;
  help?: string;
  maxPositionals?: number;
  run: (args: CommandArgs) => CliReport | Promise<CliReport>;
}

export const COMMON_OPTIONS: Record<string, OptionKind> = {
  format: 'string',
  verbose: 'flag',
};

export interface CommandArgs extends ParsedArgs {
  string(name: string): string | null;
  flag(name: string): boolean;
}

export function declaredOptions(spec: CommandSpec): Record<string, boolean> {
  const declared: Record<string, boolean> = {};
  for (const [name, kind] of Object.entries({ ...spec.options, ...COMMON_OPTIONS })) {
    declared[name] = kind === 'string';
  }
  return declared;
}

export function makeCommandArgs(parsed: ParsedArgs): CommandArgs {
  return Object.assign(parsed, {
    string: (name: string): string | null => getOptionString(parsed, name),
    flag: (name: string): boolean => parsed.options.has(name),
  });
}

export function usageError(message: string): CliReport {
  return makeReport(
    'usage',
    { message },
    { failures: [message], exitCode: EXIT_USAGE_OR_DATA_ERROR },
  );
}

export const s = (args: ParsedArgs, name: string): string | undefined =>
  getOptionString(args, name) ?? undefined;

export const n = (args: ParsedArgs, name: string): string | null => getOptionString(args, name);

export function pick<const T extends string>(
  args: ParsedArgs,
  keys: readonly T[],
): Record<T, string | null> {
  const out = {} as Record<T, string | null>;
  for (const key of keys) out[key] = n(args, key);
  return out;
}

export function pickU<const T extends string>(
  args: ParsedArgs,
  keys: readonly T[],
): Record<T, string | undefined> {
  const out = {} as Record<T, string | undefined>;
  for (const key of keys) out[key] = s(args, key);
  return out;
}

const HEADER = `hoop-rush — developer CLI for the Hoop Rush engine and data

Usage:
  bun run hoop-rush <command> [options]

Commands:`;

const FOOTER =
  '\n\nCommon options:\n  --format text|json\n  --verbose\n\nExit codes: 0 success · 1 failed checks · 2 invalid input or execution error';

export function commandHelp(command: CommandSpec): string {
  if (command.help !== undefined) return command.help;
  const flags = Object.keys(declaredOptions(command))
    .map((flag) => `--${flag}`)
    .join(' ');
  return `  ${command.name}\n                        ${flags}\n                        (no help entry yet)`;
}

export function buildHelpText(commands: readonly CommandSpec[]): string {
  const sections = commands.map((command) => commandHelp(command));
  return `${HEADER}\n${sections.join('\n')}\n\nFixtures:\n  ${listFixtureIds().join(', ')}${FOOTER}`;
}

export function helpReport(commands: readonly CommandSpec[]): CliReport {
  return makeReport('help', {}, { details: [buildHelpText(commands).trimEnd()] });
}
