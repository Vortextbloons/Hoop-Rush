# @hoop-rush/application

Framework-independent orchestration for Hoop Rush. This package owns typed
command execution and committed-state publication; the web app renders and
gathers intent, the engine owns basketball rules, adapters own I/O.

## Boundary rules

- May import `@hoop-rush/data-contracts` and `@hoop-rush/engine`.
- May import `@hoop-rush/persistence` **types only** (runtime access goes
  through a persistence port).
- Must not import Svelte, Dexie, Web Workers, browsers, `node:*`, or Supabase.
- Must not read wall clocks or random values; clocks, ids, and seeds are
  injected through ports.
- Enforced by `eslint.config.js` (same restricted-import discipline as the
  engine).

## Entry points

```text
@hoop-rush/application          shared submission runtime (runSubmission + types)
@hoop-rush/application/season   season block wire/acceptance + season policies
```

## Current exports

- `runSubmission` and submission policies/report types: the retry and
  conflict policy runtime shared by every mode (`src/submission.ts`).
- Season block wire helpers moved out of the web runner:
  `buildWorkerRequest`, `acceptWorkerResult`, `SeasonRunnerEvent`,
  `SeasonBlockStartInput`, `SeasonBlockResumeInput`, `SeasonBlockRunner`,
  `SeasonBlockTransport`, `SeasonArtifactUrls` (`src/season/block-wire.ts`).
- `SEASON_COMMAND_POLICY`, `SEASON_BLOCK_POLICY`, `canResubmitBlock`
  (`src/season/policies.ts`).

## Migration status (Season Run session)

Landed:

1. Shared submission runtime moved from `apps/web/src/lib/submit`.
2. Season command/block policies moved here (web re-exports them).
3. Season domain error classes moved to `data-contracts`
   (`SeasonRunLoadError`, `SeasonRunCommandStaleStateError`, ...).
4. Block wire/acceptance helpers moved here (`block-wire.ts`).
5. **`SeasonSession` landed**: the former web `season-hub-state.ts` now lives
   in `src/season/session.ts`, constructed through the ports in `ports.ts`.
   The snapshot cache is instance-scoped (`state-cache.ts`), and a `disposed`
   guard drops late continuations. The web app builds it through
   `apps/web/src/lib/season/season-session-ports.ts`; the old web hub and
   cache modules are deleted, and `session.test.ts` (23 tests) runs here.

Next:

1. Finish stage 2 (part B): move postseason coordination out of
   `season-postseason-runner.ts` — the runner becomes a simulation job
   returning results and progress, while `SeasonSession` runs the decision
   loop, commits advancements, and promotes the champion.
2. Stages 4-7 as planned: engine orchestration split, remaining modes,
   storage/multiplayer adapters, tooling and deletion.

Stage 2 (part A) landed: block jobs now return raw `candidate`/`interrupted`
events. `SeasonSession` owns start/resume reconciliation, acceptance digest
gates, the engine commit pipeline, the atomic `commitSeasonBlock`, pending
interruption persistence, and post-commit publication. The web block runner is
a transport over the worker only; the pure assembly helpers live in
`src/season/block-state.ts`. Covered by `session-block.test.ts` (16 tests) and
the web candidate→commit integration test.

Stage 3 landed: `apps/web/src/lib/season/season-shell-state.svelte.ts` is now
the reactive presenter — one subscription mirrors `session.getSnapshot()`
into `$state`, cheap views are `$derived`, and the layout
(`routes/season/run/+layout.svelte`, 957 → 428 lines) only owns session
lifetime, navigation, dialogs, and rendering. The mirrored `recomputeRunFacts`
cycle and the 160-line command façade are gone; local editor state survives
progress emits and unchanged-rotation commits (covered by
`season-shell-state.test.ts`).

Determinism guard for all of it: seeded block/postseason digests, the
committed fixtures under `tools/cli/src/fixtures/`, and the golden suites must
stay byte-identical. See `scripts/code-size/README.md` for the baseline log.
