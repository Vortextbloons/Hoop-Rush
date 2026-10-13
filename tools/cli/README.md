# @hoop-rush/cli

The developer CLI (`pnpm hoop-rush <command>`) for simulation, audits,
calibration, data tools, and artifact generation. It calls the same engine,
contracts, and importer packages the web app uses; there is no second
simulation implementation.

## Structure

- `src/index.ts` — dispatch and reporting only: resolves the command key,
  parses args through the registry, validates `--format`, and renders text or
  JSON (`report.ts`, exit codes 0/1/2).
- `src/registry/` — the typed command registry. `core.ts` owns option kinds,
  common options (`--format`, `--verbose`), arg accessors, usage errors, and
  help rendering; one module per area (`data.ts`, `sim.ts`, `calibrate.ts`,
  `havoc.ts`, `season.ts`, `collection.ts`, `projection.ts`, `import.ts`,
  `docs.ts`) declares each command's name, options, help text, and handler.
  `index.ts` fixes the help order.
- `src/calibration/` — shared calibration infrastructure: `harness.ts` (seed and
  worker resolution, cohort runners, worker fixture loading), `artifacts.ts`
  (artifact commit + validation + manifest hash pinning), `report.ts` (targets
  label and gate-failure epilogue), and `shell.ts` (the shared calibration flow:
  validate short circuit, cohort measurement, gate summary, lazy artifact build,
  commit, report assembly).
- `src/commands/` — the handlers and their basketball metrics. Calibration
  gates, cohort definitions, and artifact schemas stay with each command.
- `src/gen-*.ts` — standalone generators run through package scripts
  (`gen-fixtures`, `gen-season-assets`, ...), not through the command registry.

## Adding a command

1. Add the handler in `src/commands/<area>.ts`.
2. Add a spec in the matching `src/registry/<area>.ts` module and, if the help
   order matters, register the name in `registry/index.ts`.
3. Run the registry pin tests. The command surface and rendered help are pinned
   by `src/registry.test.ts` against `src/fixtures/command-options.json` and
   `src/fixtures/help.txt`; regenerate the fixtures only when the surface change
   is intentional.
4. Add a focused test (command handler or CLI integration).

`src/fixtures/` also holds the committed fixtures (`season-run.json`,
`season-draft-commands.json`, `season-game-*.json`, ...) used by audits and
reproduction tests. `pnpm hoop-rush help` prints the in-tool help.

## Verification

```text
pnpm --filter @hoop-rush/cli check
pnpm --filter @hoop-rush/cli lint
pnpm --filter @hoop-rush/cli test:run
pnpm hoop-rush data validate
```
