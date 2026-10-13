# @hoop-rush/engine

Pure TypeScript basketball and mode rules. This package owns every simulation
decision: possession resolution, ratings effects, season orchestration, drafts,
trades, free agency, injuries, the postseason, havoc runs, and collection game
play.

## Boundary rules

- May import `@hoop-rush/data-contracts` only.
- Must not import Svelte, Dexie, Web Workers, browsers, `node:*`, or Supabase;
  `eslint.config.js` enforces this for `src/sim`, `src/season`, `src/domain`,
  `src/projection`, `src/modes`, `src/bracket`, and `src/challenge`.
- Must not read wall clocks or call `Math.random()`; every stochastic system
  takes an injected seed (`createRng`, named seed namespaces) and every clock is
  injected. ESLint restricts `Math.random`, `Date.now`, and `performance`.
- Determinism must survive replay, retries, calibration, and multiplayer
  verification. Rejection reasons and recorded facts are the only explanations
  allowed for a box score.

## Layout

- `src/sim/` — the possession engine: `possession.ts`, `rng.ts`, `constants.ts`,
  `facts.ts`, `invariants.ts`, `game.ts`.
- `src/season/` — league, schedule, rotations, `block/` (validation,
  preparation, execution, assembly, commit, audit, iteration), `postseason/`
  (schedule, state, `play-in`, bracket, game, progression), `commands/`, trades,
  free agency, health/injuries, influence, objectives, evolution.
- `src/modes/` — `havoc/`, `draft-duel/` (incl. command-log replay),
  `fixed-five/` (incl. sandbox builder and command-log replay).
- `src/challenge/` — the fixed-five challenge aggregate and seeds.
- `src/collection/` — pack draws, targeting, game commands, minute plans.
- `src/projection/`, `src/bracket/` — projection model and the frozen bracket.
- `src/index.ts` — the package export surface; `src/season/commands/shared.ts`
  holds command handler contracts and the retired-command handler.

## Verification

```text
pnpm exec vitest run --project @hoop-rush/engine <path>
pnpm --filter @hoop-rush/engine test:run
pnpm hoop-rush season block audit --input <checkpoint.json> --run <run.json>
pnpm hoop-rush season run reproduce --input <export.json>
pnpm hoop-rush calibrate run
```

Simulation changes must keep accounting invariants (`src/sim/invariants.ts`),
golden block/state digests (`season/block-golden.test.ts`,
`season/season-block-validation.test.ts`), and calibration gates healthy.
