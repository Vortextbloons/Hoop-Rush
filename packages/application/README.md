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
@hoop-rush/application/challenge  challenge run session (classic/sandbox job lifecycle)
@hoop-rush/application/collection collection play session (prep, execution, acceptance)
@hoop-rush/application/draft-duel draft duel room session (transport/repository ports)
@hoop-rush/application/fixed-five fixed-five room session + command policy/retry helpers
@hoop-rush/application/havoc    havoc session + run/history view contract
@hoop-rush/application/season   season block wire/acceptance + season policies
```

## Current exports

- `runSubmission` and submission policies/report types: the retry and
  conflict policy runtime shared by every mode (`src/submission.ts`).
- `ChallengeSession` + ports: the classic/sandbox run lifecycle (load, start,
  cancel, reveal pacing, acceptance, completion promotion) with a worker job
  port, repository port, asset port, and clock (`src/challenge/`).
- `HavocSession` + ports: the havoc draft/run/season/comparison lifecycle with
  a runner port, repository port, asset port, and id port; `HavocServiceError`
  and the run/history view contract live here (`src/havoc/`).
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

1. Stage 7: consolidate tooling, finish deletion, and land the remaining net
   source reduction.

Stage 5a landed: Classic/Sandbox challenge orchestration moved into
`ChallengeSession` (`src/challenge/`). The web `ChallengeRunner` is replaced
by the session plus a worker job port (`challenge-job.ts`); the presenter
mirrors the session snapshot, and the mode views moved under
`apps/web/src/lib/features/challenge/`. `challengeRunProgressDigest` moved to
the engine so framework-independent code can gate promotions.

Stage 5b landed: havoc orchestration moved into `HavocSession` (`src/havoc/`)
behind repository, runner, asset, and id ports; the web `havoc-service.ts` is
now only composition and singletons. The web service contract, state
presenters, and views moved under `apps/web/src/lib/features/havoc/`;
`HavocLoadError` moved to data-contracts (persistence re-exports it).

Stages 5c-5f landed: every mode's code is co-located under
`apps/web/src/lib/features/<mode>/`, and Collection, Draft Duel, and fixed-five
multiplayer gained web-side sessions with presenters
(`CollectionPlaySession`, `DraftDuelSession`, `FixedFiveRoomSession`) that own
preparation/execution/acceptance/retries and drop late results after dispose.

Stage 6 landed: storage and multiplayer adapters simplified.

- 6b: `packages/persistence/src/repositories/support.ts` shares record
  envelopes, parse helpers, scoped compound-index reads/deletes, command
  receipt comparison, and revision/digest guards across every repository.
- 6c: the IndexedDB namespace moved to `hoop-rush-saves-v2` at a single Dexie
  version; the v1→v22 migration chain, Collection legacy read paths, and the
  unused engine `migrateCollection*` exports were deleted. Web composes one
  `HoopRushDatabase` instance through `$lib/persistence`.
- 6d: multiplayer replay and deterministic transitions live in the engine
  (`modes/fixed-five/log.ts`, `modes/draft-duel/log.ts`); the web room-state
  module keeps asset loading, player-ref resolution, and snapshot overlay only.
- 6e: `apps/web/src/lib/supabase-runtime.ts` owns the Supabase client cache,
  anonymous auth, env validation, realtime room registry, and transient
  broadcast plumbing; `multiplayer-membership.ts` shares membership storage.
  Deployed RPC names/arguments and payload shapes are pinned by
  `*-transport.test.ts` conformance suites.
- 6f: `CollectionPlaySession`, `DraftDuelSession`, and `FixedFiveRoomSession`
  moved into this package behind ports (transport, repository, runner, assets,
  clock, ids, membership, notice, guard storage). Web keeps presenters,
  controllers, composition, and browser adapters; `createDraftDuelSession`
  stays in web as composition.

Stage 4 landed: engine season orchestration is split and de-duplicated.
`postseason.ts` (1,911 lines) became `postseason/{schedule,state,play-in,
bracket,injuries,game,progression}` with a facade, and the three postseason
command handlers share one `advanceSeasonPostseason` loop. `block.ts` (2,174
lines) became `block/{validation,preparation,execution,assembly,commit,audit,
run}` with a facade. Shared regular-season/postseason mechanisms now live in
`injuries.ts` (`rollInjuryWithSeedNamespace`), `health.ts`
(`seasonGameHealthSeamWithRoll`), `injury-events.ts`, and `game-launch.ts`;
deliberate differences (postseason ignores the rehab premium) are pinned by
`injuries.test.ts`. Golden pins added before the split:
`block-golden.test.ts` (block-0 checkpoint/state/commit digests),
`season-block-validation.test.ts` (rejection matrix), and
`injuries.test.ts` (roll vectors for both namespaces). Block game iteration
is centralized in `block/iteration.ts` (`seasonBlockGameSteps`, shared
options, rotation-scoped rosters); `run.ts`, the season block worker job, and
the free-agency calibrate CLI all use it. CLI post-block commit
deduplication against `completeSeasonBlockCommit` remains open.

Stage 2 complete: block jobs return raw `candidate`/`interrupted` events and
`SeasonSession` owns start/resume reconciliation, acceptance, atomic commits,
interruption persistence, and publication (part A). Postseason coordination
also lives in the session now: the decision loop, command-id chaining,
duplicate retry, advancement commits, and champion promotion; the web
postseason runner is a simulation job over the worker only (part B). Covered
by `session-block.test.ts` (16), `session-postseason.test.ts` (14), and the
web transport/integration suites.

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
