import { pickU, s } from './core.ts';
import { hasOption } from '../args.ts';
import { calibrateOverall } from '../commands/calibrate-overall.ts';
import { calibrateRatings } from '../commands/calibrate-ratings.ts';
import { calibrateThreePoint } from '../commands/calibrate-three-point.ts';
import { calibrateRun, calibrateSensitivity } from '../commands/calibrate.ts';

import type { CommandSpec } from './core.ts';

export const calibrateCommands: CommandSpec[] = [
  {
    name: 'calibrate overall',
    options: { output: 'string' },
    help: `  calibrate overall      Freeze the Overall scale from unique player peaks
                         across all supported NBA seasons.
                          --output <path>  Ratings model artifact`,
    run: (args) => calibrateOverall(s(args, 'output')),
  },
  {
    name: 'calibrate run',
    options: {
      samples: 'string',
      'seed-from': 'string',
      workers: 'string',
      fixture: 'string',
      profile: 'string',
      era: 'string',
      'challenge-samples': 'string',
      'opponent-games': 'string',
      'allow-skipped': 'flag',
    },
    help: `  calibrate run          Compare seeded batches against the frozen era profile targets.
                         --samples N (default 2000)  --seed-from N  --profile <path>
                         --era <eraId> (default 1990s; selects the era-matched pool)
                         Exits 1 when any required gate fails.`,
    run: (args) =>
      calibrateRun({
        samples: s(args, 'samples'),
        'seed-from': s(args, 'seed-from'),
        workers: s(args, 'workers'),
        profile: s(args, 'profile'),
        era: s(args, 'era'),
        'challenge-samples': s(args, 'challenge-samples'),
        'opponent-games': s(args, 'opponent-games'),
        'allow-skipped': hasOption(args, 'allow-skipped'),
      }),
  },
  {
    name: 'calibrate sensitivity',
    options: {
      samples: 'string',
      'seed-from': 'string',
      workers: 'string',
      fixture: 'string',
      profile: 'string',
      era: 'string',
      'challenge-samples': 'string',
      'opponent-games': 'string',
      'allow-skipped': 'flag',
    },
    help: `  calibrate sensitivity  A/B the single-dimension sensitivity fixtures.
                         --samples N (default 200)   --profile <path>  --era <eraId>`,
    run: (args) => calibrateSensitivity(pickU(args, ['samples', 'profile', 'era'])),
  },
  {
    name: 'calibrate ratings',
    options: {
      player: 'string',
      report: 'string',
      samples: 'string',
      workers: 'string',
      output: 'string',
      manifest: 'string',
    },
    help: `  calibrate ratings      Generate the deterministic paired-simulation Ratings v3 artifact.
                          --samples N (default 256) --workers N --output <path>`,
    run: (args) =>
      calibrateRatings(
        pickU(args, ['samples', 'workers', 'output', 'manifest', 'player', 'report']),
      ),
  },
  {
    name: 'calibrate three-point',
    options: { write: 'flag', manifest: 'string', output: 'string' },
    help: `  calibrate three-point  Fit the conservative three-point reconstruction model and freeze
                         the versioned three-point-targets artifact.
                          --samples N --workers N --out <path> --validate <path>`,
    run: (args) =>
      calibrateThreePoint({
        write: hasOption(args, 'write'),
        format: s(args, 'format'),
        manifest: s(args, 'manifest'),
        output: s(args, 'output'),
      }),
  },
];
