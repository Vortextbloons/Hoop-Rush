import { n, pick, s } from './core.ts';
import { collectionPackCalibrate } from '../commands/collection-calibrate.ts';
import { collectionGameCalibrate } from '../commands/collection-game-calibrate.ts';
import { collectionGameAudit, collectionGameReproduce } from '../commands/collection-game.ts';
import { collectionProgressionCalibrate } from '../commands/collection-progression-calibrate.ts';
import { collectionProgressionAudit } from '../commands/collection-progression.ts';
import { collectionPackAudit, collectionPullReproduce } from '../commands/collection.ts';

import type { CommandSpec } from './core.ts';

export const collectionCommands: CommandSpec[] = [
  {
    name: 'collection pack-audit',
    options: { manifest: 'string' },
    run: (args) => collectionPackAudit(pick(args, ['manifest'])),
  },
  {
    name: 'collection pull-reproduce',
    options: { input: 'string', manifest: 'string' },
    run: (args) => collectionPullReproduce(pick(args, ['input', 'manifest'])),
  },
  {
    name: 'collection pack-calibrate',
    options: {
      samples: 'string',
      'starter-seeds': 'string',
      out: 'string',
      manifest: 'string',
      validate: 'string',
    },
    run: (args) =>
      collectionPackCalibrate({
        samples: s(args, 'samples'),
        starterSeeds: s(args, 'starter-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
  {
    name: 'collection game-audit',
    options: { manifest: 'string', games: 'string' },
    run: (args) => collectionGameAudit(pick(args, ['manifest', 'games'])),
  },
  {
    name: 'collection game-reproduce',
    options: { input: 'string', manifest: 'string' },
    run: (args) => collectionGameReproduce(pick(args, ['input', 'manifest'])),
  },
  {
    name: 'collection game-calibrate',
    options: {
      workers: 'string',
      'calibration-seeds': 'string',
      'validation-seeds': 'string',
      out: 'string',
      manifest: 'string',
      validate: 'string',
    },
    run: (args) =>
      collectionGameCalibrate({
        workers: s(args, 'workers'),
        calibrationSeeds: s(args, 'calibration-seeds'),
        validationSeeds: s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
  {
    name: 'collection progression-audit',
    options: { manifest: 'string', player: 'string', input: 'string' },
    help: `  collection progression-audit
                         Audit the pinned collection progression rules: every
                         challenge requirement, feasibility, and matching player
                         count, sampled per-pack target odds, and optional
                         exported-state set/first-clear reconciliation.
                          --player <playerId>    One catalog player's target odds
                          --input <bundle.json>  Exported collection bundle
                          --manifest <path>      Manifest (default packaged)`,
    run: (args) => collectionProgressionAudit(pick(args, ['manifest', 'player', 'input'])),
  },
  {
    name: 'collection progression-calibrate',
    options: {
      workers: 'string',
      'calibration-seeds': 'string',
      'validation-seeds': 'string',
      out: 'string',
      manifest: 'string',
      validate: 'string',
    },
    help: `  collection progression-calibrate
                         Calibrate M4.4 targeting, challenge, and set economy:
                         analytic player/pack target odds, at least 1,000,000
                         simulated ordinary targeted slot draws across tuning
                         and disjoint held-out seeds, challenge/standard game
                         cohorts, set claim states, and the M4.3 repeat-rate
                         envelope. Writes and hash-pins
                         collection/progression-targets.json.
                          --workers N            Worker threads (default 8)
                          --calibration-seeds N  Tuning seed roots (default 6)
                          --validation-seeds N   Held-out seed roots (default 4)
                          --out <path>           Artifact path (default packaged)
                          --manifest <path>      Manifest (default packaged)
                          --validate <path>      Re-validate a written artifact`,
    run: (args) =>
      collectionProgressionCalibrate({
        workers: s(args, 'workers'),
        calibrationSeeds: s(args, 'calibration-seeds'),
        validationSeeds: s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        validate: n(args, 'validate'),
      }),
  },
];
