import { n } from './core.ts';
import { UsageError, hasOption } from '../args.ts';
import { havocAudit } from '../commands/havoc-audit.ts';
import { havocCalibrate } from '../commands/havoc-cohorts.ts';
import { havocSimulate } from '../commands/havoc-simulate.ts';

import type { CommandSpec } from './core.ts';

export const havocCommands: CommandSpec[] = [
  {
    name: 'havoc simulate',
    options: {
      seed: 'string',
      picks: 'string',
      comparison: 'flag',
      manifest: 'string',
    },
    run: (args) =>
      havocSimulate({
        seed: n(args, 'seed'),
        picks: n(args, 'picks'),
        comparison: hasOption(args, 'comparison'),
        manifest: n(args, 'manifest'),
      }),
  },
  {
    name: 'havoc audit',
    options: { input: 'string', manifest: 'string' },
    maxPositionals: 1,
    run: (args) => {
      const inline = args.command[2] ?? null;
      const trailing = args.positional[0] ?? null;
      if (
        args.command.length > 3 ||
        args.positional.length > 1 ||
        (inline !== null && trailing !== null)
      ) {
        throw new UsageError('havoc audit accepts at most one report path');
      }
      return havocAudit({
        input: n(args, 'input'),
        positional: inline ?? trailing,
        manifest: n(args, 'manifest'),
      });
    },
  },
  {
    name: 'havoc calibrate',
    options: {
      'seed-count': 'string',
      'holdout-count': 'string',
      mechanism: 'string',
      games: 'string',
      manifest: 'string',
    },
    run: (args) =>
      havocCalibrate({
        'seed-count': n(args, 'seed-count'),
        'holdout-count': n(args, 'holdout-count'),
        mechanism: n(args, 'mechanism'),
        games: n(args, 'games'),
        manifest: n(args, 'manifest'),
      }),
  },
];
