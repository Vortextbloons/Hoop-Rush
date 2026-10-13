import { n, pick, pickU, s, seedRange } from './core.ts';
import { hasOption } from '../args.ts';
import {
  seasonBenchmarkBlock,
  seasonBenchmarkDeterminism,
  seasonBenchmarkFull,
  seasonBenchmarkPersistence,
} from '../commands/season-benchmark.ts';
import {
  seasonBlockAudit,
  seasonBlockSimulate,
  seasonFullSimulate,
} from '../commands/season-block.ts';
import { seasonChallengesCalibrate } from '../commands/season-challenges.ts';
import { seasonDraftCalibrate } from '../commands/season-draft-calibrate.ts';
import { seasonDraftReproduce } from '../commands/season-draft.ts';
import {
  seasonEffectsCalibrate,
  seasonEffectsDistribution,
  seasonEffectsRoles,
  seasonEffectsSensitivity,
} from '../commands/season-effects.ts';
import {
  seasonEvolutionBenchmark,
  seasonEvolutionCalibrate,
  seasonEvolutionValidate,
} from '../commands/season-evolution.ts';
import { seasonFreeAgencyAudit } from '../commands/season-free-agency-audit.ts';
import { seasonFreeAgencyCalibrate } from '../commands/season-free-agency-calibrate.ts';
import { seasonGameCalibrate, seasonGameSimulate } from '../commands/season-game.ts';
import { seasonHealthCalibrate } from '../commands/season-health.ts';
import { seasonHomeCourtCalibrate } from '../commands/season-home-court.ts';
import { seasonInfluenceCalibrate } from '../commands/season-influence.ts';
import { seasonPostseasonAudit } from '../commands/season-postseason-audit.ts';
import { seasonPostseasonCalibrate } from '../commands/season-postseason-calibrate.ts';
import { seasonRunReproduce } from '../commands/season-reproduce.ts';
import {
  seasonRostersAudit,
  seasonRostersCalibrate,
  seasonRostersGenerate,
} from '../commands/season-rosters.ts';
import { seasonScheduleAudit, seasonScheduleGenerate } from '../commands/season-schedule.ts';
import { seasonTradeAudit, seasonTradeCalibrate } from '../commands/season-trade.ts';

import type { CommandSpec } from './core.ts';

export const seasonCommands: CommandSpec[] = [
  {
    name: 'season schedule generate',
    options: { out: 'string', league: 'string', seed: 'string', manifest: 'string' },
    help: `  season schedule generate
                         Generate the deterministic Season Run schedule from
                         the frozen league manifest (82 rounds, 1,230 games).
                         Without --out this only previews the report and hash.
                         --out <path>         Write the artifact (required for writes)
                         --league <path>      League artifact (default packaged)
                         --seed <hex>         Generation seed (default committed)`,
    run: (args) => seasonScheduleGenerate(pick(args, ['out', 'league', 'seed', 'manifest'])),
  },
  {
    name: 'season schedule audit',
    options: { schedule: 'string', league: 'string', manifest: 'string' },
    help: `  season schedule audit  Audit the packaged Season Run league and schedule:
                         schema and versions, counts, identities, rounds,
                         opponent frequencies, home/away balance, duplicate
                         games, byte-identical regeneration, manifest hashes.
                         --schedule <path>    Schedule artifact (default packaged)
                         --league <path>      League artifact (default packaged)
                         --manifest <path>    Manifest for hash cross-check`,
    run: (args) =>
      seasonScheduleAudit({
        schedule: n(args, 'schedule'),
        league: n(args, 'league'),
        manifest: n(args, 'manifest'),
        verbose: hasOption(args, 'verbose'),
      }),
  },
  {
    name: 'season draft reproduce',
    options: { input: 'string', manifest: 'string' },
    help: `  season draft reproduce
                         Reproduce the committed Season Run draft from a frozen
                         seed and fixture facts, asserting the committed audit.
                         --input <draft.json> --seed <hex> --manifest <path>`,
    run: (args) => seasonDraftReproduce(pick(args, ['input', 'manifest'])),
  },
  {
    name: 'season rosters generate',
    options: { seed: 'string', draft: 'string', out: 'string', manifest: 'string' },
    help: `  season rosters generate
                         Generate the deterministic AI league from verified
                         roster targets and audit the result.
                         --input <draft.json> --targets <path> --manifest <path>`,
    run: (args) => seasonRostersGenerate(pick(args, ['seed', 'draft', 'out', 'manifest'])),
  },
  {
    name: 'season rosters audit',
    options: { input: 'string', manifest: 'string', 'human-franchises': 'string' },
    help: `  season rosters audit   Audit a generated league: versions, quotas, tier
                         thresholds, pools, anchors, exclusivity, legality,
                         and the generation digest.
                         --input <run.json> --targets <path> --manifest <path>`,
    run: (args) => seasonRostersAudit(pick(args, ['input', 'manifest', 'human-franchises'])),
  },
  {
    name: 'season rosters calibrate',
    options: {
      workers: 'string',
      'calibration-seeds': 'string',
      'validation-seeds': 'string',
      out: 'string',
      manifest: 'string',
      targets: 'string',
      validate: 'flag',
    },
    help: `  season rosters calibrate
                         Calibrate the roster-targets cohort and freeze the
                         measured facts into roster-targets-v2.
                         --calibration-seeds N --validation-seeds N
                         --out <path> --targets <path> --manifest <path>`,
    run: (args) =>
      seasonRostersCalibrate({
        workers: s(args, 'workers'),
        'calibration-seeds': s(args, 'calibration-seeds'),
        'validation-seeds': s(args, 'validation-seeds'),
        out: s(args, 'out'),
        manifest: s(args, 'manifest'),
        targets: s(args, 'targets'),
        validate: hasOption(args, 'validate'),
      }),
  },
  {
    name: 'season draft calibrate',
    options: {
      workers: 'string',
      'calibration-seeds': 'string',
      'validation-seeds': 'string',
      out: 'string',
      manifest: 'string',
    },
    help: `  season draft calibrate
                         Calibrate the roster-generation targets from a draft
                         cohort and freeze roster-targets-v2.
                         --input <run.json> --calibration-seeds N
                         --validation-seeds N --out <path> --manifest <path>`,
    run: (args) =>
      seasonDraftCalibrate(
        pickU(args, ['workers', 'calibration-seeds', 'validation-seeds', 'out', 'manifest']),
      ),
  },
  {
    name: 'season game simulate',
    options: { input: 'string', seed: 'string' },
    help: `  season game simulate   Simulate one Season Run game with exact-seconds facts
                         (rotations, stints, deviations).
                         --input <fixture-id> --seed <hex>`,
    run: (args) => seasonGameSimulate(pick(args, ['input', 'seed'])),
  },
  {
    name: 'season game calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      effects: 'string',
    },
    help: `  season game calibrate  Calibrate the game cohort and freeze
                          season-game-targets-v4.
                         --fixture <ids> --seed-from N --seed-to N --workers N
                         --out <path> --manifest <path>`,
    run: (args) =>
      seasonGameCalibrate(
        pick(args, ['fixture', 'seed-from', 'seed-to', 'workers', 'out', 'manifest', 'effects']),
      ),
  },
  {
    name: 'season block simulate',
    options: {
      input: 'string',
      block: 'string',
      manifest: 'string',
      profile: 'string',
    },
    help: `  season block simulate  Run one ten-game block through the authoritative
                         block pipeline over a committed run fixture.
                         --input <run.json> (default fixtures/season-run.json)
                         --block N (default: the cursor's next block)
                         --manifest <path> --profile <eraId>`,
    run: (args) => seasonBlockSimulate(pick(args, ['input', 'block', 'manifest', 'profile'])),
  },
  {
    name: 'season block audit',
    options: { input: 'string', run: 'string', manifest: 'string', profile: 'string' },
    help: `  season block audit     Audit a candidate checkpoint JSON: schema, cursor,
                         reconciliation, recap, and digest verification.
                         --input <checkpoint.json> --run <run.json>
                         --manifest <path> --profile <eraId>`,
    run: (args) => seasonBlockAudit(pick(args, ['input', 'run', 'manifest', 'profile'])),
  },
  {
    name: 'season full simulate',
    options: { input: 'string', manifest: 'string', profile: 'string' },
    help: `  season full simulate   Simulate all nine blocks (1,230 games) and print
                          per-block digests, the final digest, the M2.5 state
                          chain, and final health/transaction facts.
                          --input <run.json> --manifest <path> --profile <eraId>`,
    run: (args) => seasonFullSimulate(pick(args, ['input', 'manifest', 'profile'])),
  },
  {
    name: 'season home-court calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      constants: 'string',
      validate: 'string',
    },
    help: `  season home-court calibrate
                         Measure the tuned home-court profile against the
                         frozen 0.575 held-out target and write the evidence
                         artifact (home-court-targets.json).
                         --fixture <ids> --seed-from N --seed-to N --workers N
                         --constants a,b (dev tuning) --out <path>
                         --validate <path> (check an existing artifact)`,
    run: (args) =>
      seasonHomeCourtCalibrate({
        fixture: n(args, 'fixture'),
        constants: n(args, 'constants'),
        ...seedRange(args),
      }),
  },
  {
    name: 'season effects sensitivity',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      validate: 'string',
    },
    help: `  season effects sensitivity
                          A/B the effects mechanism caps across the fixture
                          cohort (sensitivity report, no artifact write).
                          --fixture <ids> --seed-from N --seed-to N --workers N`,
    run: (args) => seasonEffectsSensitivity({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  {
    name: 'season effects distribution',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      validate: 'string',
    },
    help: `  season effects distribution
                          Aggregate the mechanism-role distributions of the
                          calibration cohort (distribution report).
                          --fixture <ids> --seed-from N --seed-to N --workers N`,
    run: (args) => seasonEffectsDistribution({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  {
    name: 'season effects roles',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      validate: 'string',
    },
    help: `  season effects roles   Measure role separation across the cohort (roles
                          report: usage share, shot mix, chemistry effects).
                          --fixture <ids> --seed-from N --seed-to N --workers N`,
    run: (args) => seasonEffectsRoles({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  {
    name: 'season effects calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      fixture: 'string',
      validate: 'string',
    },
    help: `  season effects calibrate
                          Freeze season-effect-targets-v1 from the cohort
                          gates (envelopes, separation, held-out checks).
                          --fixture <ids> --seed-from N --seed-to N --workers N
                          --out <path> --validate <path>`,
    run: (args) => seasonEffectsCalibrate({ fixture: n(args, 'fixture'), ...seedRange(args) }),
  },
  {
    name: 'season health calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
    },
    help: `  season health calibrate  Freeze injury-targets-v2 from a season cohort plus
                           roll-level probe (incidence, severity, durations,
                           same-game return, recurrence 40bp + rehab premium
                           60bp = 100bp total for 10-game window, season-ending,
                           monotonicity, standings independence, zero-rehab
                           byte-identical, rehab failure no-change).
                           --input <run.json> --seed-from N --seed-to N
                           --out <path> --validate <path> --manifest <path>`,
    run: (args) => seasonHealthCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  {
    name: 'season trade audit',
    options: { input: 'string', manifest: 'string' },
    help: `  season trade audit       Audit trade hard gates: ownership/roster/rotation/
                           chemistry/health/ledger/state-chain, no Influence-only,
                           cash caps, inquiry/exchange limits, reconciliation.
                           --input <run.json> --manifest <path>`,
    run: (args) => seasonTradeAudit(pick(args, ['input', 'manifest'])),
  },
  {
    name: 'season trade calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
      write: 'flag',
    },
    help: `  season trade calibrate  Freeze trade-targets-v3 from seasons with windows at
                           blocks 2/4/5 (AI trades per season, legality, value
                           bands, determinism, chemistry invariants, Influence
                           cash caps, inquiry/exchange limits, reconciliation).
                           --input <run.json> --seed-from N --seed-to N
                           --out <path> --validate <path> --manifest <path>`,
    run: (args) => seasonTradeCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  {
    name: 'season influence calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
      write: 'flag',
    },
    help: `  season influence calibrate
                           Freeze influence-targets-v2 (floor 0, ledger
                           reconciliation, income identity, debt frequency, cap
                           violations, campaign rewards, inquiry purchases,
                           trade cash 1-2 per proposal/window, cash reconciliation,
                           rehab spends 2 per injury).
                           --input <run.json> --seed-from N --seed-to N
                           --out <path> --validate <path> --manifest <path>`,
    run: (args) => seasonInfluenceCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  {
    name: 'season challenges calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
      write: 'flag',
    },
    run: (args) => seasonChallengesCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  {
    name: 'season evolution calibrate',
    options: {
      fixture: 'string',
      'seed-from': 'string',
      'seed-to': 'string',
      out: 'string',
      manifest: 'string',
      validate: 'string',
      write: 'flag',
    },
    run: (args) =>
      seasonEvolutionCalibrate(
        pick(args, ['fixture', 'seed-from', 'seed-to', 'out', 'manifest', 'validate']),
      ),
  },
  {
    name: 'season evolution validate',
    options: { out: 'string', manifest: 'string' },
    run: (args) => seasonEvolutionValidate(pick(args, ['out', 'manifest'])),
  },
  {
    name: 'season evolution benchmark',
    options: { fixture: 'string', manifest: 'string' },
    run: (args) => seasonEvolutionBenchmark(pick(args, ['fixture', 'manifest'])),
  },
  {
    name: 'season free-agency audit',
    options: { input: 'string', manifest: 'string' },
    help: `  season free-agency audit
                          Audit a persisted run's recorded free-agency facts
                          (window order 2/4/6, candidate uniqueness, one
                          featured, canonical identity persistence,
                          declarations, traces, band/signing/spend caps,
                          ledger/transaction/ownership links, effects
                          invariants).
                          --input <run.json> --manifest <path>`,
    run: (args) => seasonFreeAgencyAudit(pick(args, ['input', 'manifest'])),
  },
  {
    name: 'season free-agency calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
    },
    help: `  season free-agency calibrate
                          Freeze free-agency-targets-v1 from seasons with
                          markets at blocks 2/4/6 (composition, identity and
                          canonical stability, interest/win/signing/skip by
                          band, caps 1/2/3/3, spend, tie-break ordering,
                          trace accuracy, quality vs drafted starters, elite
                          exclusion, legality, effects invariants,
                          determinism, summary identity).
                          --input <run.json> --seed-from N --seed-to N
                          --out <path> --validate <path> --manifest <path>`,
    run: (args) => seasonFreeAgencyCalibrate({ input: n(args, 'input'), ...seedRange(args) }),
  },
  {
    name: 'season run reproduce',
    options: { input: 'string', manifest: 'string', profile: 'string' },
    help: `  season run reproduce   Rebuild a completed Season Run from a full-run replay
                           export (replay-export-v1) and fail at the FIRST
                           divergence: ordinal, command id, state digest, result
                           digest, game result, awards, trade grades, champion,
                           free-agency facts, or specific M2.5.5 kinds
                           (campaign-offers/evaluations, board/inquiries,
                           AI response/counter, AI transaction, rehab outcome,
                           value trends, Influence cash).
                           --input <export.json> --manifest <path>
                           --profile <eraId> --format <format>`,
    run: (args) => seasonRunReproduce(pick(args, ['input', 'manifest', 'profile'])),
  },
  {
    name: 'season postseason audit',
    options: { input: 'string' },
    help: `  season postseason audit
                          Audit a completed postseason (export or fixture):
                          duplicate/missing teams, invalid feeders, incorrect
                          home court, games after clinching, inconsistent
                          summaries, champion/completion mismatches.
                          --input <export.json|fixture.json> --format <format>`,
    run: (args) => seasonPostseasonAudit(pick(args, ['input'])),
  },
  {
    name: 'season postseason calibrate',
    options: {
      'seed-from': 'string',
      'seed-to': 'string',
      workers: 'string',
      out: 'string',
      manifest: 'string',
      input: 'string',
      validate: 'string',
      write: 'flag',
    },
    help: `  season postseason calibrate
                          Measure the postseason cohort against the frozen
                          postseason-targets-v1 gates (series length, upsets,
                          home advantage, advancement by strength, award
                          plausibility, forfeits, integrity failures) and freeze
                          the artifact with --write.
                          --seed-from N --seed-to N --out <path>
                          --manifest <path> --validate <path> --write
                          --workers N --input <run.json> --format <format>`,
    run: (args) =>
      seasonPostseasonCalibrate({
        input: n(args, 'input'),
        write: hasOption(args, 'write'),
        ...seedRange(args),
      }),
  },
  {
    name: 'season benchmark block',
    options: {
      input: 'string',
      manifest: 'string',
      profile: 'string',
      samples: 'string',
      out: 'string',
    },
    help: `  season benchmark block Measure normal-block (0) and final-block (8) times
                         against the desktop budgets (3s / 1s).
                         --out <path> --input <run.json>`,
    run: (args) => seasonBenchmarkBlock(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  {
    name: 'season benchmark full',
    options: {
      input: 'string',
      manifest: 'string',
      profile: 'string',
      samples: 'string',
      out: 'string',
    },
    help: `  season benchmark full  Measure the full-season time against the 30s budget.
                         --out <path> --input <run.json>`,
    run: (args) => seasonBenchmarkFull(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  {
    name: 'season benchmark determinism',
    options: {
      input: 'string',
      manifest: 'string',
      profile: 'string',
      samples: 'string',
      out: 'string',
    },
    help: `  season benchmark determinism
                         Run the full season twice plus an interrupted-resume
                         run; fail when any digest diverges.
                         --out <path> --input <run.json>`,
    run: (args) => seasonBenchmarkDeterminism(pick(args, ['input', 'manifest', 'profile', 'out'])),
  },
  {
    name: 'season benchmark persistence',
    options: {
      input: 'string',
      manifest: 'string',
      profile: 'string',
      samples: 'string',
      out: 'string',
    },
    help: `  season benchmark persistence
                          Run the persistence package's Season Run benchmark
                          harness (commit/reload p95, storage size).
                          --samples N --out <path>`,
    run: (args) => seasonBenchmarkPersistence(pick(args, ['samples', 'out'])),
  },
];
