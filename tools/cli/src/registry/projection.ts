import { n } from './core.ts';
import { hasOption } from '../args.ts';
import {
  projectionBase,
  projectionBenchmark,
  projectionBuild,
  projectionCalibrateBase,
} from '../commands/projection.ts';

import type { CommandSpec } from './core.ts';

export const projectionCommands: CommandSpec[] = [
  {
    name: 'projection base',
    options: {
      fixture: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      samples: 'string',
      workers: 'string',
      profile: 'string',
      manifest: 'string',
      model: 'string',
      era: 'string',
      reference: 'string',
    },
    run: (args) =>
      projectionBase({
        fixture: n(args, 'fixture'),
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        reference: n(args, 'reference'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'projection build',
    options: { manifest: 'string', out: 'string', write: 'flag' },
    run: (args) =>
      projectionBuild({
        manifest: n(args, 'manifest'),
        out: n(args, 'out'),
        write: hasOption(args, 'write'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'projection calibrate-base',
    options: {
      manifest: 'string',
      model: 'string',
      targets: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      samples: 'string',
      workers: 'string',
      era: 'string',
      out: 'string',
      validate: 'flag',
      'write-model': 'flag',
    },
    run: (args) =>
      projectionCalibrateBase({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        targets: n(args, 'targets'),
        'seed-from': n(args, 'seed-from'),
        'seed-to': n(args, 'seed-to'),
        samples: n(args, 'samples'),
        workers: n(args, 'workers'),
        era: n(args, 'era'),
        out: n(args, 'out'),
        validate: hasOption(args, 'validate'),
        'write-model': hasOption(args, 'write-model'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'projection validate',
    options: {
      manifest: 'string',
      model: 'string',
      targets: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      samples: 'string',
      workers: 'string',
      era: 'string',
      out: 'string',
      validate: 'flag',
      'write-model': 'flag',
    },
    run: (args) =>
      projectionCalibrateBase({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        targets: n(args, 'targets'),
        'seed-from': n(args, 'seed-from'),
        'seed-to': n(args, 'seed-to'),
        samples: n(args, 'samples'),
        workers: n(args, 'workers'),
        era: n(args, 'era'),
        out: n(args, 'out'),
        validate: true,
        'write-model': false,
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'projection benchmark',
    options: { manifest: 'string', model: 'string', era: 'string', samples: 'string' },
    run: (args) =>
      projectionBenchmark({
        manifest: n(args, 'manifest'),
        model: n(args, 'model'),
        era: n(args, 'era'),
        samples: n(args, 'samples'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
];
