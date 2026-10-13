import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderText } from './report.ts';
import {
  COMMANDS,
  buildHelpText,
  declaredOptions,
  helpReport,
  makeCommandArgs,
} from './registry/index.ts';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as unknown;
}

const expectedOptions = readJson('command-options.json') as Record<
  string,
  Record<string, 'string' | 'flag'>
>;

describe('CLI command registry', () => {
  it('registers every command from the frozen surface in order', () => {
    expect(COMMANDS.map((command) => command.name)).toEqual(Object.keys(expectedOptions));
  });

  it('declares the frozen option surface for every command', () => {
    for (const command of COMMANDS) {
      const declared: Record<string, 'string' | 'flag'> = {};
      for (const [name, takesValue] of Object.entries(declaredOptions(command))) {
        declared[name] = takesValue ? 'string' : 'flag';
      }
      const expected = { ...expectedOptions[command.name], format: 'string', verbose: 'flag' };
      expect(declared, command.name).toEqual(expected);
    }
  });

  it('documents every command in the rendered help', () => {
    const text = buildHelpText(COMMANDS);
    for (const command of COMMANDS) {
      expect(text, command.name).toContain(command.name);
      expect(typeof command.run, command.name).toBe('function');
    }
  });

  it('allows exactly one positional argument for havoc audit', () => {
    const audit = COMMANDS.find((command) => command.name === 'havoc audit');
    expect(audit?.maxPositionals).toBe(1);
    expect(COMMANDS.filter((command) => command.maxPositionals !== undefined)).toEqual([audit]);
  });

  it('renders the committed help text byte-for-byte', () => {
    const expected = readFileSync(resolve(FIXTURES, 'help.txt'), 'utf8');
    expect(`${renderText(helpReport(COMMANDS))}\n`).toBe(expected);
  });

  it('reads values and flags through the typed accessors', () => {
    const args = makeCommandArgs({
      command: ['season', 'block', 'audit'],
      positional: [],
      options: new Map<string, string | boolean>([
        ['out', 'targets.json'],
        ['write', true],
      ]),
    });
    expect(args.string('out')).toBe('targets.json');
    expect(args.string('write')).toBeNull();
    expect(args.flag('write')).toBe(true);
    expect(args.flag('out')).toBe(true);
    expect(args.flag('missing')).toBe(false);
  });
});
