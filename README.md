<div align="center">

<img src="branding/App_logo.png" alt="Hoop Rush" width="140" />

# Hoop Rush

### Every dynasty has a first loss. **Make yours never.**

Pick real NBA peaks, build a lineup, and chase a perfect run through a fixed 82-game gauntlet — or lean into mutated roguelike drafts and multiplayer draft duels on top of the same possession sim.

<br />

*Build your dream five. Chase the perfect season.*

</div>

---

## What you’re playing

Hoop Rush is a **fantasy lineup basketball sim** built around one obsessive question: *can this five go undefeated?*

You draft from decades of real player seasons, then sim **possession by possession** — box scores, fatigue, matchups, and streaks emerge from the engine, not from scripted story beats. Every run has a **seed**, so you can replay, compare, and argue about the same game later.

Progress **saves in your browser**. No account required to play solo.

---

## Game modes

<table>
<tr>
<td width="28%"><strong>Classic</strong></td>
<td>Five draft rounds. Each round assigns a franchise and decade; you get one reroll per round, then lock your five. Same frozen 30-team bracket as every other challenge mode — the draft is the puzzle.</td>
</tr>
<tr>
<td><strong>Sandbox</strong></td>
<td>Skip the roulette: pick any five peak seasons you want, then take on all 30 opponents on the shared 82-game schedule. Pure “what if this lineup?” energy.</td>
</tr>
<tr>
<td><strong>Hoop Havoc</strong></td>
<td>Draft five **mutated** players — outrageous modifiers and ledger effects — and try to go **82–0** against the same gauntlet. Compare runs, chase broken builds, lean into chaos.</td>
</tr>
</table>

---

## The 82-game gauntlet

Classic, Sandbox, and Havoc all share a **fixed opponent set** and **82-game road** — everyone faces the same teams in the same order, so records are comparable.

| | |
| --- | --- |
| **30 teams** | Work through the full league on a authored schedule, not a random draw each night. |
| **Game-by-game** | Step through the season or sim ahead; read box scores and trends like a real standings push. |
| **Tier chase** | Finish with a record that matches how close you came to perfection — the home screen remembers your recent runs. |
| **Resume anytime** | Pick up mid-season from a saved checkpoint in this browser. |

---

## Play with friends (optional)

**Multiplayer** lobbies let you share the same ruleset and compare results:

| Format | Vibe |
| --- | --- |
| **Shared season** | Everyone builds a five and plays the **same 82-game schedule** — compare records and head-to-head. |
| **Duel** | Two lineups, **best of seven** — first to four wins the series. |
| **Draft Duel** | Draft against an opponent, then settle it in a short series. |

Online rooms need the hosted multiplayer service; **Classic and Sandbox solo always work offline** in the browser.

---

## Why the box scores feel real

Hoop Rush cares about **credible stat lines** — shooting splits, usage, fatigue, and game flow tied to player ratings and possessions. If a box score looks wrong, the goal is to explain it from **what actually happened in the sim**, not to fudge the narrative.

That discipline is why seeds, replays, and “run it again” comparisons matter to the project — even if you only care about beating 82–0 once.

---

## Play locally

```bash
pnpm install
pnpm dev
```

Open **http://localhost:5173**, choose a mode, and draft.

---

<details>
<summary><strong>For developers</strong> — repo layout & commands</summary>

<br />

**Stack:** SvelteKit client · TypeScript simulation engine · IndexedDB saves · Web Workers for long sims · Vitest.

```
apps/web                → game UI (mode code under src/lib/features/<mode>)
packages/application    → mode sessions & shared command runtime (framework-free)
packages/engine         → basketball & mode logic
packages/data-contracts → schemas & packaged data
packages/persistence    → local saves
```

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the web app |
| `pnpm check` / `pnpm lint` | Typecheck & lint |
| `pnpm test:quick` | Fast test gate |
| `pnpm verify` | Full check before release |
| `pnpm hoop-rush` | CLI — sim, audit, data tools (`pnpm hoop-rush help`) |

See **AGENTS.md** and local **Docs/** for contribution expectations. The
per-package architecture guides are checked in:

See [Adding a game mode](ADDING_MODES.md) for mode registration and shared
multiplayer composition, and [multiplayer operations](supabase/README.md) for
compatible migration and release checks.

```
packages/application/README.md   application sessions and submission runtime
packages/engine/README.md        basketball and mode rules, boundary rules
packages/data-contracts/README.md  schemas, versions, protocols
packages/persistence/README.md   IndexedDB adapters and storage rules
packages/importer/README.md      data pipeline stages
packages/test-fixtures/README.md deterministic test builders
apps/web/README.md               SvelteKit client layout and composition
tools/cli/README.md              command registry and calibration tooling
```

</details>

---

<div align="center">

<sub>Made with a love of credible box scores.</sub>

</div>
