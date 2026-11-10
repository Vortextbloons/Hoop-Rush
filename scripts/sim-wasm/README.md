# Simulation Rust/Wasm build and benchmarks

Standard fixed-five games now use the production Rust/Wasm kernel through
`packages/engine/src/sim/game.ts`. The old TypeScript standard game loop is in
`packages/engine/src/archive/code/sim/game.ts` for parity tests and benchmarks.
Shared TypeScript possession rules remain active for Havoc and Cap Rush.

## Building the module

```sh
rustup target add wasm32-unknown-unknown
bun scripts/sim-wasm/build.ts
bun scripts/sim-wasm/build.ts --check
```

Rust 1.97.0 was used for the initial production artifact. The build uses edition
2024, optimization level 3, LTO, one codegen unit, aborting panics, and stripped
symbols. No Cargo dependencies or wasm-bindgen installation are required.
Temporary compiled files are removed after generation.

Commit `packages/engine/src/sim/wasm/game.rs` and the generated
`game-wasm.gen.ts` together. Normal app builds and CI consume that generated
module without requiring Rust. The source fingerprint test rejects stale
artifacts. The module is loaded synchronously from bundled bytes: no fetch,
URL configuration, platform-specific loader, or async public API is needed.

## Production behavior

Rust owns the seeded RNG, period clock, possessions, turnovers, fouls and foul
trouble, bonus free throws, shots, rebounds and continuations, assists, overtime,
and stat counters. TypeScript prepares matchup probabilities and formats
results using the existing recorder and fact builder. The binary ABI has 6,926
input doubles and 481 output doubles. Rust reads tables in place and uses stack
arrays, with no per-game heap allocations.

Ordinary games use Rust RNG directly without JavaScript callbacks. Playback
observers and custom RNG factories get isolated module instances so callbacks
can start nested games without overwriting the outer game's state. Custom RNGs
retain their `next`, `chance`, and `weightedPickTable` calls and original item
arrays. The engine version and seeded outputs are unchanged.

The batch entry point reuses matchup preparation by profile and player-array
identities. Treat those inputs as immutable, as with the previous prepared batch
implementation.

## Full-game benchmark

```sh
bun scripts/sim-wasm/full-benchmark.ts
```

This uses the committed production module and archived TypeScript reference; it
does not compile Rust. It writes `sim-wasm-full-results.json` and checks complete
result parity and accounting for 4,282 games, including synthetic sensitivity
fixtures, actual 1960s/1990s/2020s Lakers player pools, and a synthetic 82-game
schedule. The latest run included 113 overtime games.

Measurements include 15 rotating 900-game batches, 30 alternating one-off samples
per fixture, and 20 alternating 82-game runs with 30 opponents after one warmup.
Warm game timings include input transfer, execution, result decoding, and facts.
The 82-game timings also include all matchup preparation; they do not include
application orchestration, persistence, or reveal pacing. Module initialization
is reported separately. One-off games can be slower because of preparation.

These are desktop Bun measurements, not browser or lower-end phone results.
Measure on the target device before claiming a larger relative speedup there.

## Earlier RNG-only benchmark

```sh
bun scripts/sim-wasm/benchmark.ts
```

This retains the original TypeScript reference and the standalone `rng.rs`
experiment. It writes `sim-wasm-results.json`; RNG-only Wasm did not improve game
throughput. The production migration uses the full-game kernel instead.
