# @hoop-rush/data-contracts

Runtime Zod schemas, version literals, ids, and wire/protocol shapes shared by
every package and the multiplayer backend. This package is the single source of
truth for domain shapes and for the version constants that storage records and
workers embed.

## Boundary rules

- May import `zod` only. No I/O, no framework imports.
- Storage record wrappers belong in `@hoop-rush/persistence`; worker messages,
  multiplayer protocols, and simulation artifacts belong here.
- Version literals live in `src/versions.ts` (1.0 surface) and
  `src/season-versions.ts` (shared game/rotation/draft-catalog artifacts and
  worker wires). Never hardcode a version literal elsewhere; import the
  constant so a bump fails closed in TypeScript.
- `src/supabase-types.gen.ts` is generated from `supabase gen types` and is
  diff-checked by `.github/workflows/supabase.yml`.

## Layout

- `src/index.ts` — the public surface.
- `src/ids.ts`, `src/versions.ts`, `src/season-versions.ts` — brands and
  versions.
- Domain groups: `run.ts`, `bracket.ts`, `classic.ts`, `player-season.ts`,
  `season-*.ts` (hash, identity, seeds, versions, plus the shared game wire:
  game simulation, rotation, home court, effects, evolution, draft catalog),
  `havoc-*.ts`, `draft-duel*.ts`, `fixed-five*.ts`, `collection*.ts`,
  `projection*.ts`, `worker.ts`, `league-worker.ts`.
- `src/loaders/` — packaged-artifact parsing helpers used by the web client.

## Verification

```text
pnpm exec vitest run --project @hoop-rush/data-contracts <path>
pnpm --filter @hoop-rush/data-contracts test:run
```

Changing a schema or version constant requires updating every consumer in the
same change: persistence records, engine handlers, web transports, worker
wires, and the multi-tab/multiplayer conformance suites.
