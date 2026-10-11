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
4. Block wire/acceptance helpers moved here; `season-block-runner.ts`
   re-exports them until its consumers migrate.

Next (stage 2 continued):

1. Add `src/season/ports.ts`:
   `SeasonRunRepositoryPort` (`SeasonRunRepository & SeasonPostseasonRepository`
   type), `SeasonBlockRunnerPort`/`SeasonPostseasonRunnerPort` (the event
   contracts in `block-wire.ts` plus the postseason twin), `SeasonAssetPort`
   (era profile, catalog, free-agency index/targets, home-court profile),
   `SeasonNotifierPort` (cross-tab), `ClockPort` (`now`/`monotonic`/`sleep`),
   `IdPort` (`newId(prefix)`), `ClearDraftPort`.
2. Move `season-hub-state.ts` into `src/season/session.ts` as `SeasonSession`
   with `getSnapshot`, `subscribe`, `execute`, `cancel`, `dispose`, keeping
   the current public method names so the Svelte shell facade is unchanged.
   Bind the snapshot cache to the instance instead of the module singleton,
   and add a `disposed` guard for late async continuations.
3. Move the pure selectors with it: `describeCommandRejection`,
   `tradeBoardViewModel`, `indexAfterCommit`, `seasonRunLoadDiagnosticOf`.
4. Rewire `apps/web` through `season-session-ports.ts` (asset/worker/cross-tab/
   Dexie/id/clock adapters), delete `season-hub-state.ts` and
   `season-state-cache.ts`, and port `season-hub-state.test.ts` here with
   injected fakes.
5. Then move block acceptance/commit sequencing out of
   `season-block-runner.ts` (candidate + progress from the job, acceptance and
   atomic commit in the session) and the postseason orchestration out of
   `season-postseason-runner.ts`.

Determinism guard for all of it: seeded block/postseason digests, the
committed fixtures under `tools/cli/src/fixtures/`, and the golden suites must
stay byte-identical. See `scripts/code-size/README.md` for the baseline log.
