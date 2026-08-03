/**
 * Strict argument parsing. Commands reject unknown options and invalid
 * combinations; defaults are printed in help output (spec/09).
 */

export class UsageError extends Error {}

/** Parses an optional count option; absent falls back, malformed throws. */
export function parseCount(value: string | undefined, option: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`${option} must be a nonnegative integer (got "${value}")`);
  }
  return parsed;
}

export interface ParsedArgs {
  /** Command words, e.g. ["data", "validate"]. */
  command: string[];
  positional: string[];
  options: Map<string, string | boolean>;
}

/**
 * Parses argv after the executable name. `declared` maps option names (without
 * leading dashes) to whether they take a value. Unknown options throw.
 */
export function parseArgs(
  argv: readonly string[],
  declared: Readonly<Record<string, boolean>>,
): ParsedArgs {
  const command: string[] = [];
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();

  let i = 0;
  for (; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || token === '--' || token.startsWith('-')) break;
    command.push(token);
  }

  if (command.length === 0) {
    throw new UsageError('missing command');
  }

  for (; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) break;
    if (token === '--') {
      for (let j = i + 1; j < argv.length; j += 1) {
        const rest = argv[j];
        if (rest !== undefined) positional.push(rest);
      }
      break;
    }
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const takesValue = declared[name];
    if (takesValue === undefined) {
      throw new UsageError(`unknown option --${name}`);
    }
    if (takesValue) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`option --${name} requires a value`);
      }
      options.set(name, value);
      i += 1;
    } else {
      options.set(name, true);
    }
  }

  return { command, positional, options };
}

export function getOptionString(args: ParsedArgs, name: string): string | null {
  const value = args.options.get(name);
  return typeof value === 'string' ? value : null;
}

export function hasOption(args: ParsedArgs, name: string): boolean {
  return args.options.has(name);
}
