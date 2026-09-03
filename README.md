# Hoop Rush

> **Build your dream five. Chase the perfect season.** A fast, local-first
> basketball simulation game — draft a lineup from a real NBA franchise and
> decade, then run the gauntlet of an 82-game season against a fixed,
> deterministically authored opponent set.

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Svelte 5](https://img.shields.io/badge/Svelte-5-ff3e00?style=flat-square&logo=svelte&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-static-4a4a55?style=flat-square&logo=svelte&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-f69220?style=flat-square&logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-tested-6e9f18?style=flat-square&logo=vitest&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-e2e-2eade0?style=flat-square&logo=playwright&logoColor=white)

</div>

---

## The Game

| | |
| --- | --- |
| **Sandbox & Classic modes** | Draft your five-man lineup and play through an 82-game challenge run against a frozen 30-team bracket. |
| **Credible simulation** | A seeded, possession-by-possession engine produces realistic box scores, fatigue, and season reports — no scripted outcomes. |
| **Deterministic by design** | Every run is reproducible from its seed. Replays, audits, and calibration all come from the same engine. |
| **Saved on your machine** | Runs save, reload, and resume through IndexedDB. Local-first — no account, no backend required. |
| **Runs off the main thread** | Simulation happens in a Web Worker, so the UI stays smooth even during long seasons. |

## The Stack

- **Svelte 5 + SvelteKit** (static build) for the client
- **Pure TypeScript** engine — basketball rules with zero UI dependencies
- **Zod** for runtime validation at trust boundaries
- **Dexie / IndexedDB** for local persistence
- **Web Workers** for batch simulation
- **Vitest · fast-check · Playwright** for tests

## Repository Layout

```
apps/web            → SvelteKit client
packages/engine     → basketball simulation & game logic
packages/persistence→ local save storage
packages/data-contracts → schemas & packaged data
tools/cli           → simulation, calibration, audit CLI
```

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Run the dev server
pnpm dev

# 3. Open http://localhost:5173 and draft your lineup
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the web app in watch mode |
| `pnpm check` | Typecheck every package |
| `pnpm lint` | ESLint + Prettier checks |
| `pnpm test:run` | Run the full test suite once |
| `pnpm verify` | Full gate: check + lint + tests + build |
| `pnpm hoop-rush` | Developer CLI (`sim`, `calibrate`, `benchmark`, …) |

---

<div align="center">

Made with a love of credible box scores.

</div>
