<div align="center">

<img src="branding/App_logo.png" alt="Hoop Rush" width="140" />

# Hoop Rush

### Every dynasty has a first loss. **Make yours never.**

Pick real NBA peaks, build a lineup, and chase a perfect run through a fixed 82-game gauntlet — or lean into salary-cap drafting, mutated roguelike seasons, and online draft duels on top of the same possession sim.

<br />

*Build your dream five. Chase the perfect season.*

</div>

---

## What you’re playing

Hoop Rush is a **fantasy lineup basketball sim** built around one obsessive question: *can this five go undefeated?*

You draft from decades of real player seasons, then sim **possession by possession** — box scores, fatigue, matchups, and streaks emerge from the engine, not from scripted story beats. Every run has a **seed**, so you can replay, compare, and argue about the same game later.

Progress **saves in your browser** (IndexedDB). No account required for solo modes.

---

## Game modes

<table>
<tr>
<td width="28%"><strong>Classic</strong></td>
<td>Five draft rounds. Each round assigns a franchise and decade; you get one reroll per round, then lock a <code>G, G, F, F, C</code> lineup. Same frozen 30-team bracket as the other challenge modes — the draft is the puzzle.</td>
</tr>
<tr>
<td><strong>Sandbox</strong></td>
<td>Skip the roulette: pick any five peak seasons you want, then take on all 30 opponents on the shared 82-game schedule. Pure “what if this lineup?” energy.</td>
</tr>
<tr>
<td><strong>Hoop Havoc</strong></td>
<td>Draft five <strong>mutated</strong> players, sim an automatic 82-game season against the shared gauntlet, then <strong>replay the same schedule without mutations</strong> to see what the powers actually changed.</td>
</tr>
<tr>
<td><strong>Cap Rush</strong></td>
<td>Salary-cap draft: five historical seasons at fixed positions, apron and luxury-tax pressure, optional mutation spins — then an 82-game season (and postseason) built from that payroll puzzle. Still chasing 82–0 when the build allows it.</td>
</tr>
</table>

**Draft Duel** is **online only**: five rounds of simultaneous picks, then a best-of-seven broadcast — registered in the lobby, not on the solo home screen.

---

## The 82-game gauntlet

Classic, Sandbox, and Havoc share a **fixed opponent set** and **82-game road** — everyone faces the same teams in the same order, so records are comparable. Cap Rush runs its own 82-game (and playoff) arc after the cap draft, with a generated opponent field tied to your build.

| | |
| --- | --- |
| **30 teams** | Work through the full league on an authored schedule, not a random draw each night. |
| **Game-by-game** | Step through the season or sim ahead; read box scores and trends like a real standings push. |
| **Tier chase** | Finish with a record that matches how close you came to perfection — the home screen remembers your recent runs. |
| **Resume anytime** | Pick up mid-season from a saved checkpoint in this browser. |

---

## Play with friends (optional)

**Multiplayer** lobbies use Supabase for rooms, presence, and commands; simulation still runs locally in each browser.

| Format | Vibe |
| --- | --- |
| **Shared season** (Classic or Sandbox) | Everyone builds a five and plays the **same 82-game schedule** — compare records and head-to-head. |
| **Duel** | Two lineups, **best of seven** — first to four wins the series. |
| **Draft Duel** | Five draft rounds, eight cards per round, simultaneous reveals, then **best of seven**. |
| **Hoop Havoc** | Mutated five-man drafts, then a **best-of-seven** broadcast. |
| **Cap Rush** | Cap Clash / Cap Roulette — salary-cap auction drafts and shared season progression (see lobby formats). |

Solo **Classic, Sandbox, Havoc, and Cap Rush** work offline in the browser. Multiplayer formats need the hosted coordination service.

---

## Why the box scores feel real

Hoop Rush cares about **credible stat lines** — shooting splits, usage, fatigue, and game flow tied to player ratings and possessions. If a box score looks wrong, the goal is to explain it from **what actually happened in the sim**, not to fudge the narrative.

That discipline is why seeds, replays, and “run it again” comparisons matter to the project — even if you only care about beating 82–0 once.

---

## Play locally

Requires [Bun](https://bun.sh) **≥ 1.4.4** (see `package.json`).

```bash
bun install
bun run dev
```

Open **http://localhost:5173**, choose a mode, and draft.

---

<details>
<summary><strong>For developers</strong> — repo layout & commands</summary>

<br />

**Stack:** SvelteKit client · TypeScript engine with a Rust/Wasm standard-game kernel · IndexedDB saves · Web Workers for long sims · Bun workspaces and test runner.

```
apps/web                  → game UI (mode code under src/lib/features/<mode>)
packages/application      → mode sessions & shared command runtime (framework-free)
packages/engine           → basketball & mode logic
packages/data-contracts   → schemas & packaged data
packages/persistence      → local saves (Dexie)
packages/importer           → NBA data import pipeline
tools/cli                 → `hoop-rush` CLI (sim, audit, data, calibration)
```

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run the web app |
| `bun run check` / `bun run lint` | Typecheck & lint (all workspaces) |
| `bun run test:quick` | Fast per-workspace test gate |
| `bun run verify:quick` | Lint + typecheck + quick tests (typical pre-push) |
| `bun run verify` | Full static checks, all tests, and production build |
| `bun run verify:changed` | Checks for workspaces touched vs `HEAD` |
| `bun run hoop-rush` | CLI — sim, audit, data tools (`bun run hoop-rush help`) |

See the root **AGENTS.md** (agent defaults), checked-in scoped guides
(`apps/web/AGENTS.md`, `packages/engine/AGENTS.md`, `packages/persistence/AGENTS.md`, …),
and local **Docs/** for contribution expectations. [Adding a game mode](ADDING_MODES.md) covers mode registration and
shared multiplayer composition; [multiplayer operations](supabase/README.md)
covers compatible migration and release checks. Per-package architecture guides:

```
apps/web/AGENTS.md                 web client mode layout, workers, high-risk files
packages/persistence/AGENTS.md     Dexie namespace, record envelopes, storage rules
packages/application/README.md     application sessions and submission runtime
packages/engine/README.md          basketball and mode rules, boundary rules
packages/data-contracts/README.md  schemas, versions, protocols
packages/persistence/README.md     IndexedDB adapters and storage rules
packages/importer/README.md        data pipeline stages
packages/test-fixtures/README.md     deterministic test builders
apps/web/README.md                 SvelteKit client layout and composition
tools/cli/README.md                command registry and calibration tooling
```

</details>

---

<div align="center">

<sub>Made with a love of credible box scores.</sub>

</div>
