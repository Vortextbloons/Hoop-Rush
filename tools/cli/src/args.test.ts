import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from './args.ts';
describe('parseArgs', () => {
  it('parses a two-word command with options', () => {
    const args = parseArgs(['data', 'validate', '--input', 'x.json', '--verbose'], {
      input: true,
      verbose: false,
    });
    expect(args.command).toEqual(['data', 'validate']);
    expect(args.options.get('input')).toBe('x.json');
    expect(args.options.get('verbose')).toBe(true);
    expect(args.positional).toEqual([]);
  });
  it('collects positional arguments after --', () => {
    const args = parseArgs(['data', 'validate', '--', 'extra'], { input: true });
    expect(args.positional).toEqual(['extra']);
  });
  it('rejects unknown options', () => {
    expect(() => parseArgs(['data', 'validate', '--nope'], { input: true })).toThrow(UsageError);
    expect(() => parseArgs(['data', 'validate', '--nope'], { input: true })).toThrow(
      'unknown option --nope',
    );
  });
  it('rejects missing values', () => {
    expect(() => parseArgs(['data', 'validate', '--input'], { input: true })).toThrow(
      'requires a value',
    );
  });
  it('rejects a missing command', () => {
    expect(() => parseArgs([], {})).toThrow('missing command');
  });
});
