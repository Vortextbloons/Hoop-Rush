# Simulation Rust/Wasm experiments

Run from the repository root with Bun and Rust's `wasm32-unknown-unknown` target
installed. No Cargo dependencies or wasm-bindgen installation are required.
Compiled modules live in a temporary directory removed after execution.

## Full standard game kernel

```sh
bun scripts/sim-wasm/full-benchmark.ts
```

`game.rs` owns all random draws, the period clock, possessions, turnovers,
fouls and foul trouble, bonus free throws, shot resolution, rebounds and
continuations, assists, overtime, and numeric stat recording. There are no
JavaScript imports or callbacks during simulation. Integer RNG operations wrap
exactly like Mulberry32; probability calculations use f64 without fast math.

`game.ts` reuses TypeScript team preparation and computes immutable matchup
tables. It transfers those tables once per game, calls the Rust kernel, then
decodes counters through the existing recorder and fact builder. Rust reads
tables in place and uses stack arrays for game state, with no per-game heap
allocations. There are 6,926 input doubles and 481 output doubles. The adapter's
serialized field order matches `Team::read` and `simulate`.

This is an experimental full **standard fixed-five game loop**, not a production
backend switch or a port of every engine mode. Havoc/Cap Rush mutation hooks,
custom RNG factories, effects, home-court hooks, and playback observers are not
implemented. Production workers and package APIs are unchanged. Regenerate
matchup tables when teams or profiles change.

Verification compares complete results, including diagnostics and facts, against
TypeScript and runs accounting checks for 4,282 games:

- All 12 CLI fixtures, each with base and variant inputs over 100 seeds.
- Strong/weak and average mirrored lineups from real 1960s, 1990s, and 2020s
  Lakers pools over 200 seeds, covering anchors and reconstructed shooting.
- An 82-game synthetic schedule with 30 distinct opponent rating profiles.

The final run included 113 overtime games. Malformed input length is rejected,
and the benchmark asserts that the compiled module has no imports.

The benchmark writes `sim-wasm-full-results.json` with runtime and CPU identity,
binary size, initialization time, parity counts, and timings. It measures:

- 15 rotating rounds of 900 prepared games against ordinary TypeScript and the
  existing prepared TypeScript batch path. Input copying, Rust execution, result
  decoding, and facts are timed. Matchup setup and module startup are excluded.
- 30 alternating one-off samples per fixture, including matchup preparation.
- 20 alternating measured 82-game runs after one warmup. Both backends prepare
  fresh state per run; Wasm prepares all 30 matchups inside the timer. TypeScript
  uses its existing shared-team preparation. This is simulation only, not a
  complete application season run.

Latest local medians on a Ryzen 5 9600X, Windows x64, Bun 1.4.4:

| Workload | TypeScript | Rust/Wasm |
| --- | ---: | ---: |
| 900 games, prepared batch | 145.94 ms | 29.28 ms |
| 82 games / 30 opponents, including preparation | 15.02 ms | 10.35 ms |
| One-off game, including preparation | 0.21-0.22 ms | 0.33 ms |

The stripped module is 29,211 bytes; initialization took 4.66 ms separately.
Repeated development runs showed roughly 4-5x prepared-loop speedups and
1.45-1.7x speedups for the preparation-inclusive schedule. Absolute timings varied
with machine activity. These are desktop Bun results, not browser or phone
measurements. A slower device may save more elapsed time, but the relative gain
must be measured on that device; CPU throttling alone does not establish it.

Validation also ran the existing simulation suite (43 passed, one skipped),
production build, experiment TypeScript checks, and formatting checks.
The unchanged production engine passed `calibrate run --samples 2000`.
`calibrate sensitivity --samples 200` failed `sens-fouls`: 22.88 to 23.25 FTA
(+1.6%), below its required increase. This unresolved failure was not bypassed.

## Earlier RNG-only experiment

```sh
bun scripts/sim-wasm/benchmark.ts
```

Writes `sim-wasm-results.json`. Verifies 20,000 draws per buffer size and
900 complete game results per backend, then measures 12 rotating rounds.
TypeScript took 140.70 ms per 900 games; best buffered Wasm RNG took
142.89 ms and per-draw Wasm calls took 244.87 ms. RNG alone offered no speedup.
