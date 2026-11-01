# @hoop-rush/persistence

IndexedDB/Dexie adapters for challenge (classic/sandbox), cap-rush, havoc,
draft-duel, fixed-five, and havoc-multiplayer saves. Record-level schemas live
here; domain schemas stay in `@hoop-rush/data-contracts`. See **AGENTS.md** in
this package for namespace rules and testing notes.

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts`. Storage wrappers in
  `src/schemas/` add only record-level envelope fields; never re-declare a
  domain schema or enum.
- **Storage namespace**: one database, `hoop-rush-saves-v2`
  (`HOOP_RUSH_DATABASE_NAME` in `repositories/dexie.ts`). The previous
  `hoop-rush-saves` database is never read or migrated. **Only Dexie version 14
  is supported**; an older database is rejected with a site-data reset
  instruction rather than upgraded. Do not restore historical migrations.
- **Command commits**: Cap Rush and Havoc share outcome/artifact contracts from
  `data-contracts/command-commit.ts`. The expected revision must agree with the
  receipt before a commit can write. Mode adapters retain artifact validation,
  idempotent receipt handling, and transaction ownership.
- **Atomic commits**: checkpoint writes commit in one transaction; pending
  blocks are deleted in the same transaction as the state they supersede. Never
  commit state and clear pendings separately.
- **Validate on read**: records parse with Zod at read time; readers raise
  unsupported-version errors and never silently rewrite a record.
- `repositories/support.ts` owns shared record envelopes, parse helpers, scoped
  compound-index reads/deletes, command receipt comparison, and
  revision/digest guards.
- `repositories/save-envelope.ts` owns the order and preconditions of a save
  commit: envelope version checks, stored-command reads, replay classification,
  and the compact progress summary. It does not own commit *contents* — table
  sets and artifacts stay explicit per mode.

## Layout

- `src/index.ts` — runtime surface (repositories + record schemas).
- `src/repositories/` — `dexie.ts`, `cap-rush.ts`, `havoc.ts`, `fixed-five.ts`,
  `draft-duel.ts`, `havoc-multiplayer.ts`, `profile.ts`, `support.ts`,
  `save-envelope.ts`.
- `src/schemas/` — record envelopes per mode.
- `src/testing/` — fake-IndexedDB test support.

## Verification

```text
bun test <path>
bun run --filter @hoop-rush/persistence test:run
```

`storage-namespace.test.ts` proves the legacy database is never touched;
`support.test.ts` covers the shared guards.
