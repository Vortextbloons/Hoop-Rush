# @hoop-rush/engine

TypeScript basketball and mode rules with a Rust/Wasm standard game kernel. This package owns possession
simulation, ratings effects, challenge/league aggregates, havoc, cap-rush,
draft-duel, fixed-five, and classic draft flows.

## Boundary rules

- May import `@hoop-rush/data-contracts` only.
- Must not import Svelte, Dexie, Web Workers, browsers, `node:*`, or Supabase;
  `eslint.config.js` enforces this for `src/sim`, `src/domain`, `src/projection`,
  `src/modes`, `src/bracket`, and `src/challenge`.
- Must not read wall clocks or call `Math.random()`; every stochastic system
  takes an injected seed (`createRng`, named seed namespaces) and every clock is
  injected. ESLint restricts `Math.random`, `Date.now`, and `performance`.
- Determinism must survive replay, retries, calibration, and multiplayer
  verification. Rejection reasons and recorded facts are the only explanations
  allowed for a box score.

## Layout

- `src/sim/` — possession engine: `possession.ts`, `rng.ts`, `constants.ts`,
  `facts.ts`, `invariants.ts`, `game.ts`.
- `src/sim/wasm/game.rs` — standard fixed-five game loop, bundled by
  `wasm/game-wasm.gen.ts`; `wasm-game.ts` prepares and decodes its numeric ABI.
- `src/archive/code/sim/game.ts` — replaced TypeScript game loop, used only by
  parity tests and benchmarks. Havoc/Cap Rush retain the shared possession rules.
- `src/modes/` — `havoc/`, `cap-rush/`, `draft-duel/`, `fixed-five/`,
  `classic/`, `sandbox/`.
- `src/challenge/` — challenge aggregate, league simulation, seeds.
- `src/projection/`, `src/bracket/` — projection model and bracket generation.
- `src/game/` — shared simulation hooks (`effects.ts`, `home-court.ts`).
- `src/index.ts` — package export surface.

## Mode ownership

Cap Rush's public `draft-commands.ts` dispatches to typed draft, season, and
postseason reducers. Each reducer owns its phase-specific command set;
`command-outcome.ts` owns shared admission and receipt construction. The
persisted aggregate remains the compatibility boundary.

Havoc's battle runtime composes `battle-participants.ts` for roster activation,
clones, substitutions, and participant lookup; `battle-profile-effects.ts` for
rating changes and time-lord/equalizer state; and `battle-mutation-ledger.ts`
for event ordering, scoring attribution, rollups, and highlights. The runtime
retains possession hooks and explicitly orders those owners at boundaries.
`runtime-refactor-parity.test.ts` pins pre-refactor results and replay tapes
across seeded mutation scenarios.

## Verification

Normal builds and CI use the committed Wasm module and do not require Rust.
After changing the Rust source, install the `wasm32-unknown-unknown` target and
run `bun scripts/sim-wasm/build.ts` from the repository root. Commit both source
and generated module; the engine tests reject an outdated source fingerprint.
`bun scripts/sim-wasm/full-benchmark.ts` compares production Wasm with the archive.

```text
bun test <path>
bun run --filter @hoop-rush/engine test:run
bun run hoop-rush calibrate run
```

Simulation changes must keep accounting invariants (`src/sim/invariants.ts`) and
calibration gates healthy.
