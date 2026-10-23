# @hoop-rush/persistence

IndexedDB/Dexie adapters for challenge (classic/sandbox), havoc, draft-duel,
fixed-five, and havoc-multiplayer saves. Record-level schemas live here; domain
schemas stay in `@hoop-rush/data-contracts`. See **AGENTS.md** in this package
for namespace rules and testing notes.

## Hard rules

- **Schema source of truth**: `@hoop-rush/data-contracts`. Storage wrappers in
  `src/schemas/` add only record-level envelope fields; never re-declare a
  domain schema or enum.
- **Storage namespace**: one database, `hoop-rush-saves-v2`
  (`HOOP_RUSH_DATABASE_NAME` in `repositories/dexie.ts`). The previous
  `hoop-rush-saves` database is never read or migrated; schema changes add a new
  Dexie version inside the current namespace. Collection / Ultimate Run saves
  are not stored; legacy `collection*` stores in the old database are ignored.
- **Atomic commits**: checkpoint writes commit in one transaction; pending
  blocks are deleted in the same transaction as the state they supersede. Never
  commit state and clear pendings separately.
- **Validate on read**: records parse with Zod at read time; readers raise
  unsupported-version errors and never silently rewrite a record.
- `repositories/support.ts` owns shared record envelopes, parse helpers, scoped
  compound-index reads/deletes, command receipt comparison, and
  revision/digest guards.
- The Season Run persistence benchmark is not on the runtime index; import it
  from `@hoop-rush/persistence/benchmark`.

## Layout

- `src/index.ts` — runtime surface (repositories + record schemas).
- `src/repositories/` — `dexie.ts` (database + challenge/classic),
  `season-run*.ts`, `season-postseason*.ts`, `season-draft.ts`, `havoc.ts`,
  `fixed-five.ts`, `draft-duel.ts`, `havoc-multiplayer.ts`, `support.ts`.
- `src/schemas/` — record envelopes per mode.
- `src/season/` — engine seams, audits, replay, mutable-state normalization.
- `src/benchmark/season-run.ts` — commit/reload/storage budgets used by
  `bun run hoop-rush season benchmark persistence`.
- `src/testing/` — fake-IndexedDB test support and the Season Run fixture kit.

## Verification

```text
bun test <path>
bun run --filter @hoop-rush/persistence test:run
bun run hoop-rush season benchmark persistence
```

`src/repositories/season-run.test.ts` and `season-postseason.test.ts` cover
atomicity and reconciliation; `storage-namespace.test.ts` proves the legacy
database is never touched; `support.test.ts` covers the shared guards.
