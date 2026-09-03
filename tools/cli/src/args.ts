export class UsageError extends Error {
}
export function parseCount(value: string | undefined, option: string, fallback: number): number {
    if (value === undefined)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new UsageError(`${option} must be a nonnegative integer (got "${value}")`);
    }
    return parsed;
}
export interface SeedRangeOptionBag {
    'seed-from'?: string | null;
    'seed-to'?: string | null;
    workers?: string | null;
}
export function parseSeedRange(args: SeedRangeOptionBag, defaultTo: number, options: {
    requireOrder?: boolean;
    error?: new (message: string) => Error;
} = {}): {
    from: number;
    to: number;
} {
    const from = parseCount(args['seed-from'] ?? undefined, '--seed-from', 0);
    const to = parseCount(args['seed-to'] ?? undefined, '--seed-to', defaultTo);
    if (options.requireOrder === true && to < from) {
        const ErrorType = options.error ?? UsageError;
        throw new ErrorType('--seed-to must be >= --seed-from');
    }
    return { from, to };
}
export function parseWorkers(args: Pick<SeedRangeOptionBag, 'workers'>, fallback: number, options: {
    clampToAtLeastOne?: boolean;
} = {}): number {
    const workers = parseCount(args.workers ?? undefined, '--workers', fallback);
    return options.clampToAtLeastOne === true ? Math.max(1, workers) : workers;
}
export interface ParsedArgs {
    command: string[];
    positional: string[];
    options: Map<string, string | boolean>;
}
export function parseArgs(argv: readonly string[], declared: Readonly<Record<string, boolean>>): ParsedArgs {
    const command: string[] = [];
    const positional: string[] = [];
    const options = new Map<string, string | boolean>();
    let i = 0;
    for (; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === undefined || token === '--' || token.startsWith('-'))
            break;
        command.push(token);
    }
    if (command.length === 0) {
        throw new UsageError('missing command');
    }
    for (; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === undefined)
            break;
        if (token === '--') {
            for (let j = i + 1; j < argv.length; j += 1) {
                const rest = argv[j];
                if (rest !== undefined)
                    positional.push(rest);
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
        }
        else {
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
export function parseOption(args: ParsedArgs, name: string, fallback: string): string {
    const value = args.options.get(name);
    return typeof value === 'string' ? value : fallback;
}
