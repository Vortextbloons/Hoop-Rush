# @hoop-rush/persistence

IndexedDB/Dexie adapters for challenge (classic/sandbox), cap-rush, havoc,
draft-duel, fixed-five, havoc-multiplayer, and Full Court saves. Record-level
schemas live here; domain schemas stay in `@hoop-rush/data-contracts`. See
**AGENTS.md** in this package for namespace rules and testing notes.

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts`. Storage wrappers in
  `src/schemas/` add only record-level envelope fields; never re-declare a
  domain schema or enum.
- **Storage namespace**: one database, `hoop-rush-saves-v2`
  (`HOOP_RUSH_DATABASE_NAME` in `repositories/dexie.ts`). The previous
  `hoop-rush-saves` database is never read or migrated. **Dexie versions 15
  through 20 are supported**: each upgrades additively to 21 and keeps its
  records. Databases older than 15 reset local saves, history, and profiles
  during upgrade so users start fresh. Do not restore historical migrations.
- **Full Court save layout**: `fullCourtSeasonCheckpoints` (key `runId`) stores
  the checkpoint and `fullCourtSeasonScores` (key `[runId+gameId]`) stores the
  compact results. A slot commit writes the checkpoint and all 15 score rows in
  one transaction, guarded by the next slot and the run's lock digest.
  `fullCourtCoaching` (key `runId`) stores each run's validated coaching plan,
  and `fullCourtBlueprints` (key `key`) stores reusable tactics blueprints.
- **Cap Rush save layout.** Save schema 4 keeps the immutable locked inputs in
  `capRushLockedInputs`, writes only a reference into `capRushActive`, and
  records compact `capRushLeagueResults` beside the full league boxes. Only save
  schema 4 is readable; an older active row reports `unsupported` and the player
  abandons that run, while older completed history rows are skipped. Discard
  removes only the run's rows, never profile stores.
- **Command commits**: Cap Rush and Havoc share outcome and artifact contracts
  from `data-contracts/command-commit.ts`. The expected revision must agree
  with the receipt before a commit can write. Mode adapters keep artifact
  validation, idempotent receipt handling, and transaction ownership.
- **Atomic commits**: checkpoint writes commit in one transaction, and pending
  blocks are deleted in the same transaction as the state they replace. Never
  commit state and clear pendings separately.
- **Validate on read**: records parse with Zod at read time. Readers raise
  unsupported-version errors and never silently rewrite a record.
- `repositories/support.ts` owns shared record envelopes, parse helpers, scoped
  compound-index reads and deletes, command receipt comparison, and
  revision/digest guards.
- `repositories/save-envelope.ts` owns the order and preconditions of a save
  commit: envelope version checks, stored-command reads, replay classification,
  and the compact progress summary. It does not own commit *contents*; table
  sets and artifacts stay explicit per mode.

## Layout

- `src/index.ts`: runtime surface (repositories and record schemas).
- `src/repositories/`: `dexie.ts`, `cap-rush.ts`, `cap-rush-multiplayer.ts`,
  `havoc.ts`, `fixed-five.ts`, `draft-duel.ts`, `havoc-multiplayer.ts`,
  `full-court-draft.ts`, `full-court-season.ts`, `full-court-coaching.ts`,
  `full-court-blueprint.ts`, `profile.ts`, `support.ts`, `save-envelope.ts`.
- `src/schemas/`: record envelopes per mode.
- `src/testing/`: fake-IndexedDB test support.

## Verification

```text
bun test <path>
bun run --filter @hoop-rush/persistence test:run
```

`storage-namespace.test.ts` proves the legacy database is never touched.
`dexie-active-run.test.ts` covers the challenge save/load round-trip and
progress digest.
