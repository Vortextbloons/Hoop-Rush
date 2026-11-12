# @hoop-rush/application

Framework-independent orchestration for Hoop Rush. This package owns typed
command execution and committed-state publication; the web app renders and
gathers intent, the engine owns basketball rules, adapters own I/O.

## Boundary rules

- May import `@hoop-rush/data-contracts` and `@hoop-rush/engine`.
- **Must not import `@hoop-rush/persistence` at all** — not for runtime, and
  not for types. Use-case contracts live in each mode's `ports.ts` as ordinary
  interfaces, and the persistence repositories satisfy them structurally. This
  is enforced by `eslint.config.js`, which rejects the import outright.
- Must not import Svelte, Dexie, Web Workers, browsers, `node:*`, or Supabase.
- Must not read wall clocks or random values; clocks, ids, and seeds are
  injected through ports.
- Enforced by `eslint.config.js` (same restricted-import discipline as the
  engine).

## Entry points

```text
@hoop-rush/application/cap-rush        cap rush solo session (draft/season/postseason)
@hoop-rush/application/cap-rush-multiplayer cap rush room session and ports
@hoop-rush/application/challenge  challenge run session (classic/sandbox job lifecycle)
@hoop-rush/application/draft-duel draft duel room session (transport/repository ports)
@hoop-rush/application/fixed-five fixed-five room session + command policy/retry helpers
@hoop-rush/application/havoc    havoc session + run/history view contract
@hoop-rush/application/havoc-multiplayer havoc room session and ports
@hoop-rush/application/multiplayer lobby, room lifecycle, commands, and series coordination
```

## Current exports

- In-memory multiplayer transports and picker/home-side protocol helpers live
  in each mode's `in-memory-transport.ts`, exported through `fixed-five`,
  `draft-duel`, and `havoc-multiplayer`. Callers inject the clock and either a
  seed, RNG, or secure byte source; these implementations perform no browser I/O.
- `FixedFiveRoomSession` composes `FixedFiveCompetitionFlow` (batch simulation,
  saved-result recovery, stats rebuilding) and `FixedFiveVerificationFlow`
  (proposals, confirmations, mismatch recovery, receipts, completion). Each flow
  owns its state; the session owns room synchronization, drafting, and Duel playback.
  `FixedFiveCheckpointWriter` owns the durable command cursor and snapshot key.
  Failed writes remain pending for the next sync and surface through the session.

- `LobbySession` owns lobby commands, one coalesced two-second refresh loop,
  validated snapshots, membership recovery ports, and navigation intents.
  `RoomLifecycle` scopes delayed work and subscriptions with attachment
  generations. `SeriesCoordinator` shares readiness, playback, game jobs, and
  proposal/confirmation tracking across Draft Duel, Havoc, and Fixed Five Duel.
  Their adapters retain deterministic replay, inputs, digests, audits, timeout
  selection, recaps, and protocol-specific transitions. See
  [the mode extension guide](../../ADDING_MODES.md).

- `runSubmission` and submission policies/report types: the retry and
  conflict policy runtime shared by every mode (`src/submission.ts`).
- `decideCommandAdmission` (`src/multiplayer/command-admission.ts`): the shared
  command admission order — identity, payload size, duplicate replay, expected
  revision, ordinal continuity, payload schema. It reports a neutral reason and
  each mode maps that to its own published rejection code, so per-mode
  vocabularies stay intact until they are unified deliberately.
- Series room orchestration composes `RoomSynchronization` (validated logs and
  durable command cursors), `RoomActions` (busy state and stable retry IDs),
  `DeadlineRecovery` (room-scoped timeout recovery), `GameExecution` (committed
  outputs), and `SeriesCoordinator` (readiness and playback). Mode adapters use
  a named `SeriesRoomModel` type map rather than positional type arguments.
  The session template retains phase policy and mode hooks.
- Cap Rush and Havoc commits use `command-commit.ts` in data-contracts. Both
  application ports and persistence adapters use the same outcome/artifact
  contracts. Each commit states its expected revision; adapters validate it
  against the receipt before entering the existing atomic write path.
- `SeriesRoomSession.runGamePipeline` (`src/multiplayer/series-room-session.ts`):
  composes `GameExecution` for Draft Duel and Havoc. The execution owns in-flight
  games and committed outputs, and returns a typed outcome. Outputs become
  available for proposals only after persistence. Each mode supplies
  `simulateGame` and `persistOutput`.
- `ChallengeSession` + ports: the classic/sandbox run lifecycle (load, start,
  cancel, reveal pacing, acceptance, completion promotion) with a worker job
  port, repository port, asset port, and clock (`src/challenge/`). Each execution
  owns a `ChallengeResultQueue` for ordering and pacing. Restarts settle pending
  writes before using the committed run; completion promotion has its own phase.
- `HavocSession` + ports: the havoc draft/run/season/comparison lifecycle with
  a runner port, repository port, asset port, and id port; `HavocServiceError`
  and the run/history view contract live here (`src/havoc/`).
- `CapRushSession` + ports: the Cap Rush draft/season/postseason lifecycle with
  draft repository, asset, and id ports (`src/cap-rush/`).
- `CapRushMultiplayerSession` + ports: the shared auction draft, league season,
  and playoff coordination (`src/cap-rush-multiplayer/`).

## History

Season Run was removed on 2026-10-14 and Ultimate Run/Collection mode on
2026-10-22. Their sessions, policies, and wire helpers no longer exist in this
package; treat any `season/` or `SeasonSession` reference in older notes as
historical.

## Tooling status

- The CLI is a typed command registry (`tools/cli/src/registry/`) with pinned
  command surface and help fixtures; calibration artifacts, cohorts, and gate
  reporting share one package.
- The importer manifest schema and IO moved to a leaf module, removing the
  pools <-> manifest cycle.
- Unreferenced runtime exports and retired paths were deleted across every
  package; web test doubles live under `testing/` directories; the quick test
  gate has a checked-in exclusion manifest with a staleness guard.
- Per-package READMEs are tracked (this file, engine, data-contracts,
  persistence, importer, test-fixtures, web, cli) and are the architecture
  reference. Local `Docs/` remains the long-form working documentation.

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
`apps/web/src/lib/features/<mode>/`, and Draft Duel and fixed-five multiplayer
gained web-side sessions with presenters (`DraftDuelSession`,
`FixedFiveRoomSession`) that own preparation/execution/acceptance/retries and
drop late results after dispose. (Collection / Ultimate Run was removed on
2026-10-22.)

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
- 6f: `DraftDuelSession` and `FixedFiveRoomSession` moved into this package
  behind ports (transport, repository, runner, assets, clock, ids, membership,
  notice, guard storage). Web keeps presenters, controllers, composition, and
  browser adapters; `createDraftDuelSession` stays in web as composition.

Stage 4 landed: engine season orchestration was split and de-duplicated
(`postseason/` and `block/` subpackages with facades). Both trees, and their
shared injury/health helpers, were removed with Season Run on 2026-10-14.

Determinism guard for mode orchestration: seeded digests and the committed
fixtures under `tools/cli/src/fixtures/` must stay byte-identical.
