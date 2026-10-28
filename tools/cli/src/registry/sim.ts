import { pickU, s } from './core.ts';
import { hasOption, parseOption } from '../args.ts';
import { benchmark } from '../commands/benchmark.ts';
import { bracketAudit } from '../commands/bracket-audit.ts';
import { bracketGenerate } from '../commands/bracket-generate.ts';
import { simChallengeAverage } from '../commands/challenge-average.ts';
import { simChallenge } from '../commands/challenge.ts';
import { DEFAULT_MANIFEST } from '../commands/data-loader.ts';
import { simDiagnose, simSeason } from '../commands/diagnose.ts';
import { draftFitBenchmark } from '../commands/draft-fit-benchmark.ts';
import { replay } from '../commands/replay.ts';
import { simBatch, simGame } from '../commands/sim.ts';

import type { CommandSpec } from './core.ts';

export const simCommands: CommandSpec[] = [
  {
    name: 'sim game',
    options: {
      input: 'string',
      seed: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      samples: 'string',
      workers: 'string',
      fixture: 'string',
      profile: 'string',
    },
    help: `  sim game               Simulate one game from a fixture with an explicit seed.
                          --input <fixture-id>   equal|strong-medium|strong-weak (default none)
                          --seed <hex>           Explicit game seed (required)
                          --profile <path>       Override the packaged 1990s era profile`,
    run: (args) => simGame(pickU(args, ['input', 'seed', 'profile'])),
  },
  {
    name: 'sim batch',
    options: {
      input: 'string',
      seed: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      samples: 'string',
      workers: 'string',
      fixture: 'string',
      profile: 'string',
    },
    help: `  sim batch              Run seeded games over a deterministic seed range.
                          --fixture <id>         Fixture id (default equal)
                          --seed-from N --seed-to N   Inclusive seed range
                          --samples N           Convenience for seed-to = seed-from + N - 1
                          --workers N           Chunks; results never depend on the count`,
    run: (args) =>
      simBatch(pickU(args, ['fixture', 'seed-from', 'seed-to', 'samples', 'workers', 'profile'])),
  },
  {
    name: 'sim diagnose',
    options: { fixture: 'string', samples: 'string', profile: 'string' },
    help: `  sim diagnose           Aggregate per-player usage, shot-mix, assist, rebound, and
                         contest data across a seeded batch of games.
                          --fixture <id> (default equal) --samples N (default 200)`,
    run: (args) => simDiagnose(pickU(args, ['fixture', 'samples', 'profile'])),
  },
  {
    name: 'sim season',
    options: { fixture: 'string', samples: 'string', profile: 'string' },
    help: `  sim season             Simulate 82-game seasons and check per-game shooting
                         variance against independent per-shot binomial draws.
                          --fixture <id> (default equal) --samples N (default 1, max 10)`,
    run: (args) => simSeason(pickU(args, ['fixture', 'samples', 'profile'])),
  },
  {
    name: 'sim challenge',
    options: {
      lineup: 'string',
      seed: 'string',
      reruns: 'string',
      era: 'string',
      profile: 'string',
      bracket: 'string',
    },
    help: `  sim challenge          Run one complete 82-game challenge against the frozen bracket.
                         --lineup <ref[,...]>  Five players in G,G,F,F,C slot order
                                              (required). Refs are ids or names:
                                              playerId | playerId@franchise/era |
                                              Name | Name@Franchise | Name@Franchise/era.
                                              Ambiguous ids/names are rejected with
                                              qualifying forms; a franchise-qualified
                                              name picks the best peak (highest selection score)
                         --seed <hex>          Run seed (required)
                         --reruns N            Best-of whole-season attempts (default 2)
                         --era <eraId>         Simulation era (default 2010s; selects the
                                               packaged era profile)
                         --profile <path>      Override the packaged era profile
                         --bracket <path>      Override the packaged bracket artifact`,
    run: (args) =>
      simChallenge(pickU(args, ['lineup', 'seed', 'reruns', 'era', 'profile', 'bracket'])),
  },
  {
    name: 'sim challenge-average',
    options: {
      lineup: 'string',
      seed: 'string',
      reruns: 'string',
      era: 'string',
      profile: 'string',
      bracket: 'string',
    },
    help: `  sim challenge-average  Run N complete 82-game challenges against the frozen bracket and
                         report the mean of every stat across attempts (plus min/max/sd).
                         Same options as sim challenge; --reruns defaults to 10 and is
                         the number of attempts averaged. Use this to debug variance.
                         --lineup <ref[,...]>  Five players in G,G,F,F,C slot order
                         --seed <hex>          Run seed (required)
                         --reruns N            Attempts to average (default 10)
                         --era <eraId>         Simulation era (default 2010s)
                         --profile <path>      Override the packaged era profile
                         --bracket <path>      Override the packaged bracket artifact`,
    run: (args) =>
      simChallengeAverage(pickU(args, ['lineup', 'seed', 'reruns', 'era', 'profile', 'bracket'])),
  },
  {
    name: 'bracket audit',
    options: { input: 'string' },
    help: `  bracket audit          Validate the frozen 30-team bracket and 82-game schedule:
                         schema/hash/versions, legal balanced lineups, duplicates,
                         strength percentiles and median, schedule counts and repeats,
                         opening opponent unchanged, and schedule regeneration.
                         --input <path>   Manifest path (default apps/web/static/data/manifest.json)`,
    run: (args) =>
      bracketAudit(parseOption(args, 'input', DEFAULT_MANIFEST), hasOption(args, 'verbose')),
  },
  {
    name: 'bracket generate',
    options: {
      seed: 'string',
      'games-per-pair': 'string',
      'min-score': 'string',
      'data-version': 'string',
      out: 'string',
    },
    help: `  bracket generate       (dev) Author the frozen bracket from packaged NBA data and
                         commit it with the manifest. Deterministic under --seed.
                         --seed <hex> --games-per-pair N (default 12)
                         --min-score N (default 45)`,
    run: (args) =>
      bracketGenerate({
        seed: s(args, 'seed'),
        'games-per-pair': s(args, 'games-per-pair'),
        'min-score': s(args, 'min-score'),
        'data-version': s(args, 'data-version'),
        out: s(args, 'out'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'benchmark',
    options: {
      fixture: 'string',
      samples: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      profile: 'string',
      baseline: 'string',
      'write-baseline': 'string',
    },
    help: `  benchmark              Measure pool cold/cached, warm single-game, and 82-game throughput.
                         --fixture <id> (default equal) --samples N (default 50)
                         --seed-from N --workers N
                         --baseline <path> Compare matched fingerprints at 125% + noise.
                         --write-baseline <path> Write a versioned JSON baseline.`,
    run: (args) =>
      benchmark({
        fixture: s(args, 'fixture'),
        samples: s(args, 'samples'),
        'seed-from': s(args, 'seed-from'),
        'seed-to': s(args, 'seed-to'),
        workers: s(args, 'workers'),
        profile: s(args, 'profile'),
        baseline: s(args, 'baseline'),
        'write-baseline': s(args, 'write-baseline'),
      }),
  },
  {
    name: 'benchmark draft-fit',
    options: {
      manifest: 'string',
      seed: 'string',
      samples: 'string',
      games: 'string',
      'refine-top': 'string',
      era: 'string',
      franchise: 'string',
    },
    help: `  benchmark draft-fit     Compare legal highest-Overall and projected-suggestion fives
                          across deterministic random franchise/decade rolls.
                           --samples N       Number of rolls (default 10)
                           --games N         Games per benchmark tier (default 10)
                           --seed <hex>      Roll seed (default derived)
                           --refine-top N    Projected candidates to refine (default 96)
                           --era <id> --franchise <id>  Optional pool filters`,
    run: (args) =>
      draftFitBenchmark({
        manifest: s(args, 'manifest'),
        seed: s(args, 'seed'),
        samples: s(args, 'samples'),
        games: s(args, 'games'),
        'refine-top': s(args, 'refine-top'),
        era: s(args, 'era'),
        franchise: s(args, 'franchise'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'replay',
    options: { input: 'string', expected: 'string' },
    help: `  replay                 Reproduce a saved game input and compare with an expected result.
                         --input <game-input.json> --expected <game-result.json>`,
    run: (args) =>
      replay({
        input: s(args, 'input'),
        expected: s(args, 'expected'),
      }),
  },
];
