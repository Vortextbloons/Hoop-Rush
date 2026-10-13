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
- 2026-10-11, stage 4 close: full gates re-run on the split engine.
  `pnpm static` 0 errors (1 pre-existing a11y warning); `pnpm test:run`
  111 files / 1,052 passed + 1 skipped (baseline 103 / 995 + 1); `pnpm build`
  pass; `pnpm hoop-rush data validate` OK; `pnpm code-size` engine production
  61,408 → 61,548 lines (split scaffolding offset by ~360 de-duplicated
  runtime lines) and test lines 38,488 → 41,124 (new pins and suites).
  Remaining stage-4 follow-ups: one block game-iteration primitive for the
  worker/CLI, and the CLI post-block commit composition.
- 2026-10-12, stage 5a: Classic/Sandbox challenge orchestration moved to
  `packages/application/src/challenge` (`ChallengeSession` + ports, 11 new
  tests); the web `ChallengeRunner` is replaced by the session and a worker
  job port. Views and mode modules moved under
  `apps/web/src/lib/features/challenge/`; `challengeRunProgressDigest` moved
  from persistence to `packages/engine/src/challenge/digests.ts` so the
  application session can gate promotions without a persistence runtime
  import. Byte-identical seeded game results: results are still produced by
  `challenge-worker.ts` via the same engine calls.
- 2026-10-12, stage 5b: havoc orchestration moved to
  `packages/application/src/havoc` (`HavocSession` + contract + ports; the
  former web service integration suite now runs there, 4 tests). The web
  `havoc-service.ts` is composition only; service contract, presenters,
  selectors, and views moved under `apps/web/src/lib/features/havoc/`.
  `HavocLoadError` moved to data-contracts (persistence re-exports it for
  existing consumers). The worker runner stays a web transport implementing
  the application runner port.
- 2026-10-12, stage 5c: remaining mode code co-located under
  `apps/web/src/lib/features/`: `collection/**` (pages, presenters, selectors,
  runners, styles), `draft-duel/**` (controller, transport, playback, views),
  and `multiplayer/**` (fixed-five transport/runner/state/command submit,
  lobby boundary, views). Pure file moves plus `$lib` import rewrites; no
  behavior change.

- 2026-10-12, stage 5d: Collection play lifecycle moved out of
  `CollectionPlayPage.svelte` into `CollectionPlaySession` +
  `CollectionPlayPresenter` (`apps/web/src/lib/features/collection/`).
  Preparation, worker execution, acceptance, reward refresh, recovery of an
  already-committed game, cancellation/disposal, and snapshot publication now
  live in the session with injected ports (hub actions, worker job, clock,
  error mapping); the page renders the mirrored snapshot and owns playback
  only. 12 new session tests.

- 2026-10-12, stage 5e: Draft Duel split into a plain
  `DraftDuelSession` (transport/repository/runner/assets/clock ports; command
  dedup + retry timers, deadline autopick, game pipeline, propose/confirm,
  persistence, rematch flows) and a runes `DraftDuelPresenter` that mirrors the
  session view and owns playback/transient display. The old
  `draft-duel-controller.svelte.ts` is a one-line alias. Existing suites
  retained (6 files / 53 tests, +6 session/presenter tests).

- 2026-10-12, stage 5f: fixed-five room client extracted from
  `routes/multiplayer/room/[roomId]/+page.svelte` (2,297 → 884 lines; script
  1,425 → 39) into `FixedFiveRoomSession` (plain TS; ports for transport,
  repository, runners, assets, membership, clock) and a runes
  `FixedFiveRoomController` that mirrors the session snapshot and owns
  navigation/UI-only state. Command shapes, seeds, digests, retry policy,
  timers, and verification flow unchanged; 6 new session/controller tests.

- 2026-10-12, stage 6a: transport protocol pins added
  (`fixed-five-transport.test.ts`, `draft-duel-transport.test.ts`, 16 tests)
  against a fake Supabase client (`apps/web/src/lib/fake-supabase-client.ts`),
  plus a two-connection storage harness test. Code-size baseline re-captured:
  maintained source 230,209 physical (runtime 182,365; web production 93,196,
  engine production 61,743, application production 5,231, persistence
  production 9,111).
- 2026-10-12, stage 6b: `packages/persistence/src/repositories/support.ts`
  shares envelopes, parse helpers, scoped reads/deletes, receipt comparison,
  and revision/digest guards; fixed-five, draft-duel, havoc, collection, and
  season repositories delegate. `support.test.ts` (6 tests). Persistence
  production 9,111 → 8,998 lines (pre-6c snapshot).
- 2026-10-12, stage 6c: IndexedDB namespace moved to `hoop-rush-saves-v2`
  (single Dexie `version(1)`); the v1→v22 chain, Collection legacy read
  unions/migrations, stale-record cleanup, and engine `migrateCollection*`
  exports deleted; web composes one database instance. 19 files changed,
  +117/−756. Persistence production measured after 6c: 8,838 lines.
- 2026-10-12, stage 6d: `modes/fixed-five/log.ts` and
  `modes/draft-duel/log.ts` now own command-log replay and deterministic
  transitions; web `fixed-five-room-state.ts` keeps asset loading,
  player-ref resolution, and snapshot overlay. New `log.test.ts` (6 tests) and
  `replayDraftDuelLog` coverage in `draft-duel.test.ts`.
- 2026-10-12, stage 6e: `apps/web/src/lib/supabase-runtime.ts` (client cache,
  anonymous auth, env validation, realtime room registry, transient broadcast)
  and `multiplayer-membership.ts` replace per-mode copies; both transports
  declare only tables, RPCs, and row mapping. 12 files changed, +572/−597.
- 2026-10-12, stage 6f: `CollectionPlaySession`, `DraftDuelSession`, and
  `FixedFiveRoomSession` moved into `@hoop-rush/application` behind ports;
  web keeps presenters, controllers, composition, and browser adapters.
  `fixed-five-command-submit` and the fixed-five policies moved too.

## Stage 6 status (2026-10-12)

Complete. Storage and multiplayer adapters are shared:
`hoop-rush-saves-v2` is the only save namespace, repository plumbing is
centralized in `support.ts`, multiplayer replay lives in the engine, Supabase
plumbing is shared, and every mode session lives in `@hoop-rush/application`
behind ports. Web keeps views, presenters/controllers, composition, and
browser adapters. Remaining: stage 7 (tooling consolidation and deletion).

Measured after stage 6f: maintained source 230,319 physical (runtime 182,480;
web production 89,553, engine production 62,466, application production 8,534,
persistence production 8,838). The session/engine moves are line-neutral
relocations; the storage slice removed ~750 runtime lines (web production
93,196 → 89,553, persistence 9,111 → 8,838), offset by the new application
session/port scaffolding. The remaining net reduction lands with stage 7's
tooling consolidation and deletion.
