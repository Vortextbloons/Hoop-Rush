import { n, pick } from './core.ts';
import { hasOption } from '../args.ts';
import {
  importEraProfile,
  importFreeze,
  importManifest,
  importOpponent,
  importPools,
  importRatings,
  importRunAll,
} from '../commands/import.ts';

import type { CommandSpec } from './core.ts';

export const importCommands: CommandSpec[] = [
  {
    name: 'import ratings',
    options: {
      seasons: 'string',
      'force-ratings': 'flag',
      'overall-only': 'flag',
      workers: 'string',
    },
    help: `  import ratings         Derive ratings/tendencies/traits/contracts from fetched
                         raw-data roster + season-stats (Python stays the fetch
                         layer only). --seasons 2024-25,2023-24 (comma-separated)
                         --force-ratings       Recompute already-rated seasons
                          --overall-only   Rebuild Overall without changing skills`,
    run: (args) =>
      importRatings({
        seasons: n(args, 'seasons'),
        forceRatings: hasOption(args, 'force-ratings'),
        overallOnly: hasOption(args, 'overall-only'),
        workers: n(args, 'workers'),
      }),
  },
  {
    name: 'import pools',
    options: { pools: 'string', all: 'flag', 'no-assets': 'flag', workers: 'string' },
    help: `  import pools           Build franchise-era pools (spec/02) and update the
                         manifest pool index.
                         --pools lakers/1990s,celtics/1980s  Targets (comma-sep)
                         --all                 Every available (franchise, era)
                          --no-assets           Skip headshot/photo annotation
                          (annotation stays in scripts/annotate-markers.mjs)`,
    run: (args) =>
      importPools({
        pools: n(args, 'pools'),
        all: hasOption(args, 'all'),
        noAssets: hasOption(args, 'no-assets'),
        workers: n(args, 'workers'),
      }),
  },
  {
    name: 'import era-profile',
    options: { era: 'string' },
    help: `  import era-profile     Derive era simulation profiles from packaged stints +
                         Lakers pool anchors. --era 1990s,1980s (default all)`,
    run: (args) => importEraProfile(pick(args, ['era'])),
  },
  {
    name: 'import manifest',
    options: {},
    help: `  import manifest        Refresh manifest content hashes for pools, era profiles,
                         opponents, and the bracket artifact`,
    run: () => importManifest(),
  },
  {
    name: 'import opponent',
    options: {},
    help: `  import opponent        Author the lakers-1990s opening opponent artifact`,
    run: () => importOpponent(),
  },
  {
    name: 'import freeze',
    options: { report: 'string', era: 'string' },
    help: `  import freeze          Freeze a calibrate-run baseline into the era profile.
                         --report <calibrate-report.json>  (required)
                         --era <eraId> (default 1990s)`,
    run: (args) => importFreeze(pick(args, ['report', 'era'])),
  },
  {
    name: 'import run-all',
    options: {
      seasons: 'string',
      'include-schedule': 'flag',
      'force-stints': 'flag',
      'force-ratings': 'flag',
      workers: 'string',
      'skip-bbref': 'flag',
      pools: 'string',
    },
    help: `  import run-all         Full pipeline: Python fetch layer (rosters, stints,
                         season stats, schedule, bbref ids) then native ratings
                         and pools.
                         --seasons 2024-25,2023-24  --workers N (default 6)
                         --include-schedule  --force-stints  --force-ratings
                         --skip-bbref  --pools lakers/1990s`,
    run: (args) =>
      importRunAll({
        seasons: n(args, 'seasons'),
        includeSchedule: hasOption(args, 'include-schedule'),
        forceStints: hasOption(args, 'force-stints'),
        forceRatings: hasOption(args, 'force-ratings'),
        workers: n(args, 'workers'),
        skipBbref: hasOption(args, 'skip-bbref'),
        pools: n(args, 'pools'),
      }),
  },
];
