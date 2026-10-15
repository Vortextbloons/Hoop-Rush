# @hoop-rush/web

The SvelteKit client. Views render authoritative snapshots and gather intent;
they never re-implement basketball rules or persistence policy.

## Layer rules

```text
routes/ and lib/features/<mode>/  ->  @hoop-rush/application sessions  ->  engine
                                       ^ persistence, workers, assets are ports
```

- Mode code lives under `src/lib/features/<mode>/` (challenge, havoc,
  collection, draft-duel, fixed-five, havoc-multiplayer). Shared room and lobby
  infrastructure lives in `src/lib/features/multiplayer/`.
- `src/lib/modes/catalog.ts` registers discovery, formats, preserved routes,
  and lazy settings/room adapters. Add modes through this catalog and their
  validated data-contracts settings; shared lobby and shell views stay generic.
- The root layout owns one lobby coordinator. It consumes application lobby
  snapshots/navigation intents, polls through one non-overlapping scheduler,
  and refreshes on focus/reconnection. Room layouts scope mode sessions.
- Mode sessions (`ChallengeSession`, `HavocSession`,
  `CollectionPlaySession`, `DraftDuelSession`, `FixedFiveRoomSession`,
  `HavocMultiplayerSession`) live in
  `@hoop-rush/application` behind ports. Web composes them with browser
  adapters; do not reintroduce Dexie, workers, or localStorage into the
  application package.
- Shared UI primitives stay in `src/lib/components/`; shared helpers (ids, data,
  player refs, draft presentation/fit/slots, supabase runtime, membership) stay
  in `src/lib/`.
- Workers live in `src/workers/`; their messages are validated with Zod at both
  ends and must match `@hoop-rush/data-contracts` worker schemas.
- Test doubles stay under `testing/` directories (`src/lib/testing/`,
  `src/lib/features/havoc/testing/`) and are
  imported only by tests.

## Persistence and data

- Saves go through `@hoop-rush/persistence` repositories composed by
  `getPersistence()` in `src/lib/persistence.ts`, one `HoopRushDatabase` on the
  `hoop-rush-saves-v2` namespace. The only other direct Dexie use is the
  content-addressed asset cache (`src/lib/pool-cache.ts`).
- `static/data/**` is generated. Never edit it by hand; regenerate with the CLI
  (`pnpm hoop-rush import ...`, package `gen-*` scripts) and run
  `pnpm hoop-rush data validate`.

## Verification

```text
pnpm --filter @hoop-rush/web check        # svelte-check (full, no cache)
pnpm --filter @hoop-rush/web lint
pnpm --filter @hoop-rush/web test:run
pnpm exec vitest run --project @hoop-rush/web <path>
pnpm build
```

Journeys that need a browser (classic draft into a run, collection play,
havoc run, multiplayer room) are manual smoke
checks; browser automation has been removed.
