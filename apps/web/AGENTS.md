# Hoop Rush — Web App Guide

Package overview and verification commands: **README.md**.

SvelteKit client: renders state, gathers intent, issues typed commands. All
basketball rules come from `@hoop-rush/engine` — never re-implement simulation,
selection, or accounting logic here. Dependency direction is one-way: web
imports engine, never the reverse.

## Mode layout

- Mode code lives under `src/lib/features/<mode>/` (mode views, presenters,
  controllers, transports, runners, and composition). Shared UI primitives stay
  in `src/lib/components/`; shared helpers (ids, data, sleep, draft
  presentation/fit/slots, player refs, run preamble, supabase runtime,
  membership storage) stay in `src/lib/`.
- `src/lib/gamecast/` owns neutral playback. The five-man `GameResult` helpers
  live beside the home/away battle selectors, feed folding, box folding, and
  `GamecastBattleBox.svelte` shared by Havoc multiplayer and Cap Rush. Keep
  mode labels, controls, and series-specific stats in `features/<mode>/`.
- Mode sessions live in `@hoop-rush/application` behind ports:
  `challenge/`, `havoc/`, `draft-duel/`, `fixed-five/`, `havoc-multiplayer/`,
  and `multiplayer/` (lobby). Web
  composes them with browser adapters; do not reintroduce Dexie, workers, or
  localStorage into the application package.
- `challenge/` — classic/sandbox run views + the worker job transport.
- `havoc/` — havoc views, presenters, runner (transport), and service
  composition.
- `draft-duel/` — presenter/controller, Supabase transport, worker runner,
  playback selectors, views, and the `createDraftDuelSession` composition.
- `fixed-five/` — transport, runner, room-state selectors, draft/result views,
  and the room controller that composes `FixedFiveRoomSession`.
- `havoc-multiplayer/` — Havoc room views, presenter, transport, runner, and
  `createHavocMultiplayerSession` browser composition.
- `multiplayer/` — shared lobby transport, layout-owned lobby context,
  `MultiplayerLobby`, `RoomShell`, lazy room loading, and error/invite helpers.
  Polling and navigation intents come from the one `LobbySession` owned by
  the root layout; room views consume it rather than starting lobby timers.
- `src/lib/modes/catalog.ts` — explicit typed registration for discovery,
  formats, routes, and lazy mode adapters. Settings schemas and IDs live in
  data-contracts. Keep mode-specific branches out of the shared lobby/shell.

## Worker boundaries

- Workers: `src/workers/` (`challenge-worker.ts` and the other mode workers).
  Their messages are validated with Zod at both ends; keep the worker and
  runner envelope schemas in sync with `@hoop-rush/data-contracts` worker
  schemas.

## Persistence

- Saves go through `@hoop-rush/persistence` repositories composed by
  `getPersistence()` in `src/lib/persistence.ts` (one `HoopRushDatabase`
  instance on the `hoop-rush-saves-v2` namespace). Do not construct repository
  databases ad hoc. The only other direct Dexie use in web is the
  content-addressed asset cache (`src/lib/pool-cache.ts`), which hash-verifies
  packaged data.
- `apps/web/static/data/**` is generated build-time data — never edit by hand;
regenerate through the CLI (`bun run hoop-rush import ...`, `gen-*` package
scripts) and run `bun run hoop-rush data validate`. `static/data/collection/`
  is the packaged **player catalog** (`loaders/collection-catalog.ts` and
  `collection*` schemas in data-contracts), not the removed Ultimate Run mode.

## High-risk files (read top to bottom before editing)

- `src/routes/classic/+page.svelte` and `src/routes/sandbox/+page.svelte` —
  preserve the `mounted`-flag discipline: post-destroy async writes or
  navigation without the guard breaks with Svelte update-depth errors.
- `src/lib/features/challenge/challenge-job.ts` — worker transport only
  (request ids, wire validation, termination). Reveal pacing, acceptance, and
  promotion live in `ChallengeSession`; keep the transport's callback contract
  aligned with the application job port.
- `src/lib/features/havoc/havoc-runner.ts` — worker transport only. Command
  dispatch, digest verification, acceptance, and publication live in
  `HavocSession`; the web `havoc-service.ts` only composes ports.
- `packages/application/src/fixed-five/session.ts` +
  `src/lib/features/fixed-five/fixed-five-room-controller.svelte.ts` — the
  room page is rendering only; transport resume/subscribe, command submission,
  the worker pipeline, verification receipts, and timers live in the session.
  Keep the authoritative room log single-sourced there and the controller's
  `defaultSessionDeps` complete (buildTeam, ids, friendly error, guard storage).
- `packages/application/src/draft-duel/session.ts` +
  `src/lib/features/draft-duel/draft-duel-presenter.svelte.ts` — command
  dedup/retry stamps, deadline autopick, game pipeline, and verification live
  in the session; playback/transients in the presenter. `draft-duel-session.ts`
  is composition only.
- `src/lib/supabase-runtime.ts` — shared Supabase client cache, anonymous auth,
  env validation, realtime room registry, and transient broadcast plumbing.
  RPC names/arguments are pinned by `*-transport.test.ts` conformance suites;
  change transport plumbing without changing the deployed protocol.

## Verification

- Typecheck: `bun run --filter @hoop-rush/web check` (watch: `bun run check:watch:web`)
- Single test: `bun test <path>`
- Run unit tests in the package dir (`bun test`).
