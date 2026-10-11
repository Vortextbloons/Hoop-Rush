# Code-size harness

Acceptance for the maintainability refactor measures **maintained source**
separately from tests, styles, docs, and generated data.

```bash
python scripts/code-size/measure.py --output scripts/code-size/baseline.json
```

- Sources: Git-tracked plus non-ignored untracked files (`.ts`, `.js`, `.mjs`,
  `.cjs`, `.svelte`, `.css`, `.scss`, `.html`, `.py`, `.sql`, `.sh`, `.ps1`).
- Markdown docs, JSON generated data, and `raw-data/` are not counted.
- Svelte files are split into `<script>`, `<style>`, and markup sections.
- `maintained source = runtime + scripts + ui-script + ui-markup`; `test`,
  `styles`, `config`, `sql`, and `html` are reported separately.

## Stage 1 baseline (2026-10-11, HEAD `f38f594c` + stage-1 fixes)

```
291,535 physical lines; 284,433 nonblank; 1,024 files
maintained source: 227,979 physical (runtime + scripts + svelte script + svelte markup)

role            physical  nonblank
runtime*         178,077   175,178
test              38,488    37,326
ui-markup*        26,512    26,044
ui-script*        20,012    19,431
styles            18,369    16,937
sql                6,284     6,168
scripts*           3,378     2,951
config               383       366
html                  32        32

area                            physical  production
apps/web                         103,084      96,408
packages/engine                   80,288      61,408
tools/cli                         41,629      40,705
packages/data-contracts           24,960      21,900
packages/persistence              13,812       9,184
packages/importer                 11,989      10,399
supabase                           8,454       6,284
scripts                            3,776       3,378
packages/test-fixtures             3,512       3,350
```

Duplication evidence: `repeated-code-evidence.json` (produced at baseline).

## Baseline verification (stage 1)

| Gate | Result |
| --- | --- |
| `pnpm static` (check + lint) | Pass. `svelte-check`: 0 errors, 1 pre-existing a11y warning (`AwardsSection.svelte`). |
| `pnpm test:run` | 103 files / 996 tests: 995 passed, 1 skipped. |
| `pnpm build` | Pass (client + SSR). |
| `pnpm hoop-rush data validate` | `data validate: OK`. |

Known baseline instability: `tools/cli/src/season-generation.integration.test.ts`
(full league generation, 3 seeds) took ~24 s under full-suite load against a
20 s ceiling. It passes standalone (~20 s of test time). Stage 1 raised the
per-test ceiling to 120 s; the determinism assertions are unchanged.

## Golden and determinism sources

Committed fixtures (`tools/cli/src/fixtures/`): `season-run.json`,
`season-draft-commands.json`, `season-draft-finalized.json`,
`season-game-*.json` (tight/overtime/balanced/...), challenge, and sensitivity
fixtures.

Named seed modules: `packages/engine/src/challenge/seeds.ts`,
`packages/engine/src/season/season-seeds.ts`,
`packages/data-contracts/src/season-seeds.ts`,
`packages/data-contracts/src/havoc-seeds.ts`.

Deterministic CLI checks:

```text
pnpm hoop-rush season block audit
pnpm hoop-rush season full simulate
pnpm hoop-rush season benchmark determinism
pnpm hoop-rush season run reproduce
pnpm hoop-rush season postseason audit
pnpm hoop-rush season free-agency audit
pnpm hoop-rush season draft reproduce
pnpm hoop-rush collection game-reproduce
pnpm hoop-rush collection pull-reproduce
```

Performance: existing benchmark reports live in `Docs/quality/benchmarks/`
(local-only). Re-run and compare the CLI benchmarks when execution or storage
paths change (stages 2, 4, and 6).

## Baseline log

- 2026-10-11, stage 1: baseline captured before any refactor stage. Full test
  run recorded above; the one timeout was repro'd isolated, then its ceiling
  was raised to 120 s.
- 2026-10-11, stage 2a (`9ab1e708`): shared submission runtime moved to
  `packages/application`; web `$lib/submit` re-exports it. Policies stay in
  web until their modes migrate.
- 2026-10-11, stage 2b (`e78ed913`): season domain error classes moved to
  `data-contracts` so framework-independent code can classify failures without
  importing Dexie-backed runtime modules. Persistence re-exports them.
- 2026-10-11, stage 2c: season command/block policies and the block
  wire/acceptance helpers (`buildWorkerRequest`, `acceptWorkerResult`, runner
  contract types, `SeasonArtifactUrls`) moved to
  `packages/application/season`; the web runner re-exports them for existing
  consumers. Measured after the slice with `pnpm code-size`.
- 2026-10-11, stage 2d: `SeasonSession` and its ports moved to
  `packages/application/src/season/` (session, ports, state cache,
  postseason wire, selectors); web now constructs it through
  `season-session-ports.ts`. The old web hub and module cache are deleted;
  the session test suite (23 tests) runs in the application package.
- 2026-10-11, stage 3: `season-shell-state.svelte.ts` became the reactive
  presenter (single mirror of `session.getSnapshot()`, `$derived` views,
  `init`/`dispose` lifetime); `routes/season/run/+layout.svelte` dropped from
  957 to 428 lines with markup unchanged. New presenter suite (7 tests).
- 2026-10-11, stage 2e: block acceptance/commit moved into `SeasonSession`;
  the web block runner is a transport emitting raw `candidate`/`interrupted`
  events. New session block suites (16 + 1 integration test).
- 2026-10-11, stage 2f: postseason coordination (decision loop, commits,
  promotion) moved into `SeasonSession`; the web postseason runner is a
  simulation job. New session postseason suite (14 tests) and reworked
  transport suite. Stage 2 complete.
- 2026-10-11, stage 4a: golden harness frozen before splitting engine
  orchestration. New pins: `season-block-validation.test.ts` (rejection-code
  matrix, runs in quick), `block-golden.test.ts` (block-0 checkpoint,
  post-block state, and commit digests plus per-game summary digest),
  `injuries.test.ts` (regular/postseason roll vectors covering miss, minor
  same-game return, moderate, major, and season-ending, plus the rehab
  premium). Season suite re-baselined green (12 files / 136 tests).
  Pre-existing baseline issue found while capturing CLI gates:
  `season block simulate` and `season full simulate` on the committed
  `tools/cli/src/fixtures/season-run.json` throw `SeasonBlockInvariantError`
  at game s000023 (thunder loses its rotation's only legal replacement in
  block 0); the CLI's monolithic path has no interruption handling, so those
  two commands are not usable as stage-4 gates. Stage-4 gates are the engine
  and application golden suites plus `cli-season-reproduce` (self-contained)
  and the full CI run.
- 2026-10-11, stage 4b: `postseason.ts` (1,911 lines) split into
  `postseason/{schedule,state,play-in,bracket,injuries,game}.ts` plus
  `constants/errors/types` and a 38-line facade; importers moved to
  `./postseason/index.ts` and the old module deleted. Pure moves; engine,
  application, and web season suites unchanged.
- 2026-10-11, stage 4c: the three postseason command handlers now share one
  `advanceSeasonPostseason` loop (`postseason/progression.ts`) with explicit
  stop/forfeit options; the duplicated simulate-apply loops in
  `commands/postseason.ts` are deleted (advance 186 → 97 lines). Verified with
  `season-commands`, `postseason`, application session, web transport, and
  `cli-season-reproduce` suites.
- 2026-10-11, stage 4d: `block.ts` (2,174 lines) split into
  `block/{validation,preparation,execution,assembly,commit,audit,run}.ts`
  plus `types/errors` and a 35-line facade; importers moved to
  `./block/index.ts` and the old module deleted. Pure moves; engine,
  application, web, and `cli-season-reproduce` suites unchanged.
- 2026-10-11, stage 4e: regular-season/postseason duplication collapsed:
  `rollInjuryWithSeedNamespace` / `rollRehabOutcomeWithSeedNamespace` and
  `seasonGameHealthSeamWithRoll` in `injuries.ts`/`health.ts`, plus
  `injury-events.ts` (side lookup, same-game returns, compact injury events).
  The two modes now delegate; deliberate differences (postseason ignores the
  rehab premium) stay pinned by `injuries.test.ts`. Block-0 golden digest and
  all postseason/command suites unchanged.
- 2026-10-11, stage 4f: `game-launch.ts` now owns active-player selection,
  per-version position/target/durability maps, and the shared
  `SeasonGameSimulationInput` assembly; block and postseason game execution
  both delegate. Verified by the block-0 golden digest, postseason and command
  suites, the application session suites, web season suites, and
  `cli-season-reproduce`.
